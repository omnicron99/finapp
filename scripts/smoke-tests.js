// scripts/smoke-tests.js
// Uso: node scripts/smoke-tests.js samples/SEU_ARQUIVO.pdf
// ou : node scripts/smoke-tests.js samples/nota.jpg

import fs from "fs";
import path from "path";
import pdfParse from "pdf-parse";
import Tesseract from "tesseract.js";
import * as chrono from "chrono-node";

// === Helpers (mesmos que usaremos no app) ===
function extractAmountCentsBR(text) {
  const regex = /(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2}|\d+\.\d{2}|\d+,\d{2})/g;
  let match;
  let best = 0;
  while ((match = regex.exec(text)) !== null) {
    const raw = match[1];
    const normalized = raw.replace(/\./g, "").replace(",", ".");
    const cents = Math.round(parseFloat(normalized) * 100);
    if (cents > best) best = cents;
  }
  return best;
}

function extractDateTime(text) {
  const results = chrono.pt.parse(text, new Date(), { forwardDate: true });
  if (results.length === 0) return null;
  return results[0].date();
}

// === Programa principal ===
console.log('INICIANDO SCRIPT');
async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Informe o caminho do arquivo. Ex.: node scripts/smoke-tests.js samples/nota.jpg");
    process.exit(1);
  }
  const abs = path.resolve(filePath);
  const buf = fs.readFileSync(abs);

  const ext = path.extname(abs).toLowerCase();
  let text = "";

  if (ext === ".pdf") {
    try {
      const data = await pdfParse(buf);
      text = (data.text || "").trim();
      if (!text) {
        console.log("PDF sem texto pesquisável, tentando OCR…");
        const { data: ocr } = await Tesseract.recognize(buf, "por");
        text = ocr.text.trim();
      } else {
        console.log("PDF pesquisável detectado (sem OCR).");
      }
    } catch (e) {
      console.log("Falha no parser de PDF, tentando OCR…");
      const { data: ocr } = await Tesseract.recognize(buf, "por");
      text = ocr.text.trim();
    }
  } else {
    console.log("Imagem detectada, rodando OCR…");
    const { data: ocr } = await Tesseract.recognize(buf, "por");
    text = ocr.text.trim();
  }

  if (!text) {
    console.log("Não consegui extrair texto.");
    process.exit(2);
  }

  console.log("\n=== Trecho do texto extraído ===");
  console.log(text.slice(0, 800));
  console.log("\n=== Resultado do parsing ===");
  const cents = extractAmountCentsBR(text);
  const dt = extractDateTime(text);
  console.log("Valor (centavos):", cents);
  console.log("Valor (BRL):", (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
  console.log("Data/Hora:", dt ? dt.toLocaleString("pt-BR") : "(não encontrada)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
