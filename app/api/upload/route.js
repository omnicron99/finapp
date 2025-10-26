// app/api/upload/route.js
import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as pdfParseNS from "pdf-parse";
import Tesseract from "tesseract.js"; // só usamos se quiser fallback direto (mantido)
import * as chrono from "chrono-node";
import { DateTime } from "luxon";
import { prisma } from "../../../lib/prisma.js";
import { supabase } from "../../../lib/supabase.js";

export const runtime = "nodejs";
const pExecFile = promisify(execFile);

const pdfParse = pdfParseNS.default ?? pdfParseNS.PDFParse;
if (!pdfParse) {
  throw new Error("pdf-parse não expôs nem default nem PDFParse; verifique a versão instalada.");
}

const BUCKET = process.env.SUPABASE_BUCKET || "receipts";
const TZ = "America/Sao_Paulo";

/* ================== POST ================== */
export async function POST(req) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");
    if (!file) {
      return NextResponse.json({ error: "Arquivo não enviado" }, { status: 400 });
    }

    // lê buffer e metadados
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const originalName = file.name || `upload-${Date.now()}`;
    const ext = (originalName.split(".").pop() || "").toLowerCase();
    const mime = file.type || (ext === "pdf" ? "application/pdf" : "application/octet-stream");
    const isPDF = ext === "pdf" || mime === "application/pdf";

    // caminho TEMP (para OCR/pdf raster)
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "finapp-"));
    const tmpName = `${Date.now()}-${originalName}`.replace(/\s+/g, "_");
    const tmpPath = path.join(tmpDir, tmpName);
    fs.writeFileSync(tmpPath, buffer);

    // 1) Extrair texto (pdf-parse → fallback OCR por worker)
    let rawText = "";
    let ocrEngine = "";
    let ocrConfidence = null;

    if (isPDF) {
      try {
        const pdfData = await pdfParse(buffer); // buffer direto
        rawText = (pdfData.text || "").trim();
        ocrEngine = rawText ? "pdf-text" : "tesseract";
        if (!rawText) {
          const ocr = await runOCRWorker(tmpPath); // usa tmpPath
          rawText = ocr.text;
          ocrConfidence = ocr.avg_confidence ?? null;
        }
      } catch {
        const ocr = await runOCRWorker(tmpPath);
        rawText = ocr.text;
        ocrEngine = "tesseract";
        ocrConfidence = ocr.avg_confidence ?? null;
      }
    } else {
      const ocr = await runOCRWorker(tmpPath);
      rawText = ocr.text;
      ocrEngine = "tesseract";
      ocrConfidence = ocr.avg_confidence ?? null;
    }

    if (!rawText) {
      cleanupTmp(tmpDir);
      return NextResponse.json({ error: "Não foi possível extrair texto do arquivo." }, { status: 422 });
    }

    // 2) Parsing de valor, data/hora e título
    const amountCents = extractAmountCentsBR(rawText);
    const occurredAt = extractDateTime(rawText) ?? new Date();
    const title = extractTitle(rawText, originalName);

    // 3) Upload para Supabase Storage
    const y = new Date().getFullYear();
    const key = `${y}/${Date.now()}-${tmpName}`; // caminho no bucket
    const up = await supabase.storage.from(BUCKET).upload(key, buffer, {
      contentType: mime,
      upsert: false,
    });
    if (up.error) {
      console.error("[upload supabase] erro:", up.error);
      cleanupTmp(tmpDir);
      return NextResponse.json({ error: "Falha ao subir arquivo no storage" }, { status: 500 });
    }
    const pub = supabase.storage.from(BUCKET).getPublicUrl(key);
    const publicUrl = pub.data?.publicUrl;

    // 4) Persistir no banco (URL público)
    const rec = await prisma.receipt.create({
      data: {
        title,
        amountCents,
        currency: "BRL",
        occurredAt,
        sourceFile: publicUrl || `supabase://${BUCKET}/${key}`,
        rawText,
        ocrEngine,
        ocrConfidence: ocrConfidence ?? undefined,
      },
    });

    // limpar temporários
    cleanupTmp(tmpDir);

    return NextResponse.json({
      ok: true,
      receipt: {
        id: rec.id,
        title: rec.title,
        amountBRL: centsToBRL(rec.amountCents),
        occurredAt: rec.occurredAt,
        sourceFile: rec.sourceFile,         // agora é URL https do Supabase
        ocrEngine: rec.ocrEngine,
        ocrConfidence: rec.ocrConfidence,
      },
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Erro interno no upload" }, { status: 500 });
  }
}

/* ============== OCR worker runner (pdf/img) ============== */
async function runOCRWorker(filePath) {
  // usa o worker que você já tem (scripts/ocr-worker.cjs)
  const tessdataDir =
    process.env.TESSDATA_PREFIX ||
    path.join(process.cwd(), "tessdata"); // em Docker já temos pacote por

  const nodeBin = process.execPath; // node atual
  const workerScript = path.join(process.cwd(), "scripts", "ocr-worker.cjs");

  const { stdout } = await pExecFile(nodeBin, [workerScript, filePath, tessdataDir], {
    timeout: 120000, // 120s
    maxBuffer: 128 * 1024 * 1024,
  });

  const out = JSON.parse(stdout);
  if (!out.ok) throw new Error(out.message || "OCR_FAIL");
  return out; // { ok, text, avg_confidence }
}

function cleanupTmp(tmpDir) {
  try {
    const files = fs.readdirSync(tmpDir);
    for (const f of files) fs.unlinkSync(path.join(tmpDir, f));
    fs.rmdirSync(tmpDir);
  } catch {}
}

/* ================= Helpers ================= */

function extractAmountCentsBR(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

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

      let score = 0;
      if (/R\$/i.test(line)) score += 3;
      if (kw.test(line)) score += 2;
      if (idx <= 6) score += 1;
      if (cents > 2_000_000) score -= 3;

      cand.push({ cents, score, line, idx });
    }
  });

  if (cand.length === 0) return 0;
  cand.sort((a, b) => (b.score - a.score) || (b.cents - a.cents));
  return cand[0].cents;
}

function extractDateTime(text) {
  const full = /(\d{2}\/\d{2}\/\d{4})\s*(?:às|as)?\s*(\d{2}:\d{2}(?::\d{2})?)/i;
  const m = full.exec(text);
  if (m) {
    const [d, mo, y] = m[1].split("/").map(Number);
    const time = m[2];
    const fmt = time.split(":").length === 2 ? "yyyy-M-d HH:mm" : "yyyy-M-d HH:mm:ss";
    const dt = DateTime.fromFormat(`${y}-${mo}-${d} ${time}`, fmt, { zone: TZ });
    if (dt.isValid) return dt.toUTC().toJSDate();
  }
  const reDate = /(\d{2}\/\d{2}\/\d{4})/;
  const md = reDate.exec(text);
  if (md) {
    const [d, mo, y] = md[1].split("/").map(Number);
    const dt = DateTime.fromObject({ year: y, month: mo, day: d, hour: 12 }, { zone: TZ });
    if (dt.isValid) return dt.toUTC().toJSDate();
  }
  const results = chrono.pt.parse(text, new Date(), { forwardDate: true });
  if (results.length) {
    const js = results[0].date();
    const dt = DateTime.fromJSDate(js, { zone: TZ });
    if (dt.isValid) return dt.toUTC().toJSDate();
  }
  return null;
}

function extractTitle(text, fallbackName) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const ignore = /^(cnpj|cpf|nota|nº|numero|número|documento|chave|coo|cupom|extrato|pagamento|debito|débito|credito|crédito)\b/i;
  const candidate = lines.find((l) => l.length >= 4 && !ignore.test(l) && /[A-Za-zÀ-ÿ]/.test(l));
  return (candidate || fallbackName).slice(0, 120);
}

function centsToBRL(cents) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
