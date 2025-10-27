// app/api/upload/route.js
import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as pdfParseNS from "pdf-parse";
const pdfParse = pdfParseNS.default ?? pdfParseNS.PDFParse;
import * as chrono from "chrono-node";
import { DateTime } from "luxon";
import { supabaseAdmin } from "../../../lib/supabase-admin.js";

export const runtime = "nodejs";
const pExecFile = promisify(execFile);
const TZ = "America/Sao_Paulo";

// pasta de uploads (Render: setar UPLOADS_DIR=/app/storage/uploads)
const uploadsDir = process.env.UPLOADS_DIR
  ? process.env.UPLOADS_DIR
  : path.join(process.cwd(), "public", "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

export async function POST(req) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");
    if (!file) return NextResponse.json({ error: "Arquivo não enviado" }, { status: 400 });

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const originalName = file.name || `upload-${Date.now()}`;
    const ext = (originalName.split(".").pop() || "").toLowerCase();
    const mime = file.type || (ext === "pdf" ? "application/pdf" : "application/octet-stream");
    const isPDF = ext === "pdf" || mime === "application/pdf";

    // salva definitivo no disco (organizado por ano)
    const yyyy = new Date().getFullYear();
    const subdir = path.join(uploadsDir, String(yyyy));
    if (!fs.existsSync(subdir)) fs.mkdirSync(subdir, { recursive: true });

    const safeName = `${Date.now()}-${originalName}`.replace(/\s+/g, "_");
    const finalPath = path.join(subdir, safeName);
    fs.writeFileSync(finalPath, buffer);

    // TEMP para OCR/pdf raster
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "finapp-"));
    const tmpPath = path.join(tmpDir, safeName);
    fs.writeFileSync(tmpPath, buffer);

    // extrai texto (pdf-parse → fallback OCR worker)
    let rawText = "";
    let ocrEngine = "";
    let ocrConfidence = null;

    if (isPDF) {
      try {
        const pdfData = await pdfParse(buffer);
        rawText = (pdfData.text || "").trim();
        ocrEngine = rawText ? "pdf-text" : "tesseract";
        if (!rawText) {
          const ocr = await runOCRWorker(tmpPath);
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

    // parsing metadados
    const amountCents = extractAmountCentsBR(rawText);
    const occurredAt = extractDateTime(rawText) ?? new Date();
    const title = extractRecipient(rawText, originalName);
    // URL pública local via rota /files (sem expor caminho real)
    const publicUrl = `/files/${yyyy}/${safeName}`;

    // === INSERT no Supabase via REST (sem Prisma) ===
    const sb = supabaseAdmin();
    const payload = {
      id: cryptoRandomId(),
      title,
      amount_cents: amountCents,
      currency: "BRL",
      occurred_at: toISO(occurredAt),     // timestamptz
      source_file: publicUrl,
      raw_text: rawText,
      ocr_engine: ocrEngine || "tesseract",
      ocr_confidence: ocrConfidence ?? null,
      category: null
    };
    const { data, error } = await sb
      .from("Receipt")
      .insert(payload)
      .select("*")
      .single();

    cleanupTmp(tmpDir);

    if (error) {
      console.error("[supabase insert] erro:", error);
      return NextResponse.json({ error: "Falha ao salvar no banco" }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      receipt: {
        id: data.id,
        title: data.title,
        amountBRL: (data.amount_cents / 100).toLocaleString("pt-BR", { style: "currency", currency: data.currency }),
        occurredAt: data.occurred_at,
        sourceFile: data.source_file,
        ocrEngine: data.ocr_engine,
        ocrConfidence: data.ocr_confidence
      },
    });
  } catch (err) {
    console.error("[/api/upload] ERRO:", err);
    return NextResponse.json({ error: "Erro interno no upload" }, { status: 500 });
  }
}

/* ===== Helpers ===== */

function cryptoRandomId() {
  // cuid-like simples sem dependência externa
  return "r_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function toISO(d) {
  // garante ISO com timezone (UTC) para timestamptz
  return new Date(d).toISOString();
}

async function runOCRWorker(filePath) {
  const tessdataDir = process.env.TESSDATA_PREFIX || path.join(process.cwd(), "tessdata");
  const nodeBin = process.execPath;
  const workerScript = path.join(process.cwd(), "scripts", "ocr-worker.cjs");
  const { stdout } = await pExecFile(nodeBin, [workerScript, filePath, tessdataDir], {
    timeout: 120000, maxBuffer: 128 * 1024 * 1024,
  });
  const out = JSON.parse(stdout);
  if (!out.ok) throw new Error(out.message || "OCR_FAIL");
  return out;
}

function cleanupTmp(tmpDir) {
  try {
    for (const f of fs.readdirSync(tmpDir)) fs.unlinkSync(path.join(tmpDir, f));
    fs.rmdirSync(tmpDir);
  } catch {}
}

function extractAmountCentsBR(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const moneyRegex = /(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2}|\d+\.\d{2}|\d+,\d{2})/g;
  const kw = /(total|valor|pagar|pagamento|cobrança|cobranca)/i;
  const toCents = s => {
    const norm = s.replace(/[^\d,\.]/g, "").replace(/\./g, "").replace(",", ".");
    const n = Number(norm);
    return Number.isFinite(n) ? Math.round(n * 100) : NaN;
  };
  const cand = [];
  lines.forEach((line, idx) => {
    let m;
    while ((m = moneyRegex.exec(line)) !== null) {
      const cents = toCents(m[1]);
      if (!Number.isFinite(cents)) continue;
      let score = 0;
      if (/R\$/i.test(line)) score += 3;
      if (kw.test(line)) score += 2;
      if (idx <= 6) score += 1;
      if (cents > 2_000_000) score -= 3;
      cand.push({ cents, score });
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
  const onlyDate = /(\d{2}\/\d{2}\/\d{4})/;
  const md = onlyDate.exec(text);
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
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const ignore = /^(cnpj|cpf|nota|nº|numero|número|documento|chave|coo|cupom|extrato|pagamento|debito|débito|credito|crédito)\b/i;
  const candidate = lines.find(l => l.length >= 4 && !ignore.test(l) && /[A-Za-zÀ-ÿ]/.test(l));
  return (candidate || fallbackName).slice(0, 120);
}

function extractRecipient(text, fallback) {
  // Tenta capturar o nome do recebedor no padrão mais comum
  // Ex: "Recebedor\nSupermercado Cometa Ltda"
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  let idx = lines.findIndex(l => /^recebedor\b/i.test(l));
  if (idx >= 0 && lines[idx + 1]) {
    const next = lines[idx + 1].trim();
    if (/[A-Za-zÀ-ÿ]{3,}/.test(next)) return next.slice(0, 120);
  }

  // Alternativas: palavras tipo "destinatário", "beneficiário", etc.
  idx = lines.findIndex(l => /destinat|benefic/i.test(l));
  if (idx >= 0 && lines[idx + 1]) {
    const next = lines[idx + 1].trim();
    if (/[A-Za-zÀ-ÿ]{3,}/.test(next)) return next.slice(0, 120);
  }

  // Fallback: tenta achar a primeira linha com nome de empresa
  const empresa = lines.find(l =>
    /(ltda|me|epp|comerc|supermerc|farm|padar|rest|loja|mercad)/i.test(l)
  );
  if (empresa) return empresa.slice(0, 120);

  return fallback;
}

