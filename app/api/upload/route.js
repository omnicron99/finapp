// app/api/upload/route.js
import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");
import { DateTime } from "luxon";
import * as chrono from "chrono-node";
import { prisma } from "../../../lib/prisma.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

export const runtime = "nodejs";
const pExecFile = promisify(execFile);

// ---------- utils ----------
const log = (...a) => console.log("[/api/upload]", ...a);

// ===== Helpers =====

// 3.1 — Valor com heurística por linhas e palavras-chave
function extractAmountCentsBR(text) {
  const lines = text
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);

  // fun que converte "1.234,56" ou "1234,56" etc. em cents
  const toCents = (s) => {
    const norm = s.replace(/[^\d,\.]/g, "").replace(/\./g, "").replace(",", ".");
    const n = Number(norm);
    return Number.isFinite(n) ? Math.round(n * 100) : NaN;
  };

  const moneyRegex = /(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2}|\d+\.\d{2}|\d+,\d{2})/g;
  const kw = /(total|valor|pagar|pagamento|cobrança|cobranca)/i;

  const cand = [];

  lines.forEach((line, idx) => {
    let m;
    while ((m = moneyRegex.exec(line)) !== null) {
      const raw = m[1];
      const cents = toCents(raw);
      if (!Number.isFinite(cents)) continue;

      // score por contexto
      let score = 0;
      if (/R\$/i.test(line)) score += 3;       // tem R$
      if (kw.test(line)) score += 2;           // tem palavra-chave
      if (idx <= 6) score += 1;                // cabeçalho geralmente tem o valor
      // penaliza números absurdos
      if (cents > 2_000_000) score -= 3;       // > R$ 20.000,00 dificilmente é uma compra simples

      cand.push({ cents, score, line, idx });
    }
  });

  if (cand.length === 0) return 0;

  // Ordena por score desc e, em empate, pelo maior valor (muitas notas destacam o total maior)
  cand.sort((a, b) => (b.score - a.score) || (b.cents - a.cents));

  return cand[0].cents;
}

// 3.2 — Data/Hora: prioriza padrões completos antes do Chrono
function extractDateTime(text) {
  const TZ = "America/Sao_Paulo";

  // Ex.: 03/08/2025 às 11:32:15  |  03/08/2025 11:32
  const full = /(\d{2}\/\d{2}\/\d{4})\s*(?:às|as)?\s*(\d{2}:\d{2}(?::\d{2})?)/i;
  const m = full.exec(text);
  if (m) {
    const [d, mo, y] = m[1].split("/").map(Number);
    const time = m[2];
    const fmt = time.split(":").length === 2 ? "yyyy-M-d HH:mm" : "yyyy-M-d HH:mm:ss";
    const dt = DateTime.fromFormat(`${y}-${mo}-${d} ${time}`, fmt, { zone: TZ });
    if (dt.isValid) return dt.toUTC().toJSDate();
  }

  // Só data: 03/08/2025
  const onlyDate = /(\d{2}\/\d{2}\/\d{4})/;
  const md = onlyDate.exec(text);
  if (md) {
    const [d, mo, y] = md[1].split("/").map(Number);
    const dt = DateTime.fromObject({ year: y, month: mo, day: d, hour: 12, minute: 0, second: 0 }, { zone: TZ });
    if (dt.isValid) return dt.toUTC().toJSDate();
  }

  // Fallback: Chrono → interpreta como local de SP e converte para UTC
  const results = chrono.pt.parse(text, new Date(), { forwardDate: true });
  if (results.length) {
    const js = results[0].date(); // JS Date no fuso local do servidor
    const dt = DateTime.fromJSDate(js, { zone: TZ });
    if (dt.isValid) return dt.toUTC().toJSDate();
  }

  return null;
}


// 3.3 — Título: mantém sua lógica
function extractTitle(text, fallbackName) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const ignore = /^(cnpj|cpf|nota|nº|numero|número|documento|chave|coo|cupom|extrato|pagamento|debito|débito|credito|crédito)\b/i;
  const candidate = lines.find(l => l.length >= 4 && !ignore.test(l) && /[A-Za-zÀ-ÿ]/.test(l));
  return (candidate || fallbackName).slice(0, 120);
}

function centsToBRL(cents) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function withTimeout(promise, ms, label) {
  let t;
  const timeout = new Promise((_, rej) => t = setTimeout(() => rej(new Error(`timeout ${label} (${ms}ms)`)), ms));
  return Promise.race([promise.finally(() => clearTimeout(t)), timeout]);
}

// ---------- OCR via processo externo ----------
async function runOCRExternal(absFilePath) {
  const scriptPath = path.join(process.cwd(), "scripts", "ocr-worker.cjs");
  const tessDir = path.join(process.cwd(), "tessdata");

  if (!fs.existsSync(scriptPath)) throw new Error("OCR worker script não encontrado.");
  if (!fs.existsSync(path.join(tessDir, "por.traineddata"))) throw new Error("tessdata/por.traineddata ausente.");

  // usa o próprio Node atual para rodar o script
  const { stdout, stderr } = await withTimeout(
    pExecFile(process.execPath, [scriptPath, absFilePath, tessDir], { maxBuffer: 10 * 1024 * 1024 }),
    120000,
    "ocr-exec"
  );

  // o worker imprime JSON no stdout se tudo der certo
  let payload = null;
  try { payload = JSON.parse(stdout || stderr || "{}"); } catch { /* noop */ }

  if (!payload || payload.ok !== true) {
    const msg = payload?.error || "OCR_FAIL";
    throw new Error(`Falha no OCR externo: ${msg}`);
  }
  return payload; // { ok, text, avg_confidence, words }
}

// ---------- rota principal ----------
export async function POST(req) {
  const started = Date.now();
  try {
    log("início POST");
    const formData = await req.formData();
    const file = formData.get("file");
    if (!file) return NextResponse.json({ error: "Arquivo não enviado" }, { status: 400 });

    // salvar arquivo
    const uploadsDir = process.env.UPLOADS_DIR
  ? process.env.UPLOADS_DIR
  : path.join(process.cwd(), "public", "uploads");
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const originalName = file.name || `upload-${Date.now()}`;
    const safeName = `${Date.now()}-${originalName}`.replace(/\s+/g, "_");
    const absSaved = path.join(uploadsDir, safeName);
    fs.writeFileSync(absSaved, buffer);
    const publicPath = `/uploads/${safeName}`;
    log("arquivo salvo:", publicPath, "size:", buffer.length, "bytes");

    // tentamos pdf-parse antes (se for PDF pesquisável)
    const ext = (originalName.split(".").pop() || "").toLowerCase();
    const isPDF = ext === "pdf" || file.type === "application/pdf";
    let rawText = "";
    let ocrEngine = "";
    let ocrConfidence = null;

    if (isPDF) {
      try {
        log("pdf-parse iniciando…");
        const data = await withTimeout(pdfParse(buffer), 30000, "pdf-parse");
        rawText = (data.text || "").trim();
        log("pdf-parse ok? len:", rawText.length);
        if (rawText) {
          ocrEngine = "pdf-parse";
        } else {
          log("PDF sem texto → OCR externo");
          const o = await runOCRExternal(absSaved);
          rawText = (o.text || "").trim();
          ocrEngine = "tesseract";
          ocrConfidence = o.avg_confidence ?? null;
        }
      } catch {
        log("pdf-parse falhou → OCR externo");
        const o = await runOCRExternal(absSaved);
        rawText = (o.text || "").trim();
        ocrEngine = "tesseract";
        ocrConfidence = o.avg_confidence ?? null;
      }
    } else {
      log("imagem → OCR externo");
      const o = await runOCRExternal(absSaved);
      rawText = (o.text || "").trim();
      ocrEngine = "tesseract";
      ocrConfidence = o.avg_confidence ?? null;
    }

    if (!rawText) return NextResponse.json({ error: "Sem texto após OCR." }, { status: 422 });

    const amountCents = extractAmountCentsBR(rawText);
    const occurredAt = extractDateTime(rawText) ?? new Date();
    const title = extractTitle(rawText, originalName);

    // salvar no banco
    log("gravando no banco…");
    const rec = await prisma.receipt.create({
      data: {
        title,
        amountCents,
        currency: "BRL",
        occurredAt,
        sourceFile: publicPath,
        rawText,
        ocrEngine,
        ocrConfidence: ocrConfidence ?? undefined,
      },
    });

    log("ok em", Date.now() - started, "ms");
    return NextResponse.json({
      ok: true,
      receipt: {
        id: rec.id,
        title: rec.title,
        amountBRL: centsToBRL(rec.amountCents),
        occurredAt: rec.occurredAt,
        sourceFile: rec.sourceFile,
        ocrEngine: rec.ocrEngine,
        ocrConfidence: rec.ocrConfidence,
      },
    });
  } catch (e) {
    log("ERRO:", e?.message || e);
    return NextResponse.json({ error: "Erro no upload", detail: e?.message || String(e) }, { status: 500 });
  }
}
