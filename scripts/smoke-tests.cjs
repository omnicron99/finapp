// scripts/smoke-tests.cjs
// ----------------------------------------------------------
// Teste local do OCR (Tesseract.js) e parsing de notas/extratos
// Uso: node scripts/smoke-tests.cjs samples/nota.jpg
// ----------------------------------------------------------

const fs = require("fs");
const path = require("path");
const pdfParse = require("pdf-parse");
const Tesseract = require("tesseract.js");
const chrono = require("chrono-node");

// === logs iniciais (só pra confirmar execução) ===
console.log("[start] smoke-tests.cjs iniciado");
console.log("[cwd]", process.cwd());

// === funções auxiliares ===

// Extrai o maior valor monetário (em centavos) encontrado no texto
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

// Formata valor BRL a partir de centavos
function centsToBRL(cents) {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

// === função principal ===
async function main() {
  const filePath = process.argv[2];
  console.log("[argv]", process.argv);

  if (!filePath) {
    console.error(
      "Informe o caminho do arquivo. Exemplo:\nnode scripts/smoke-tests.cjs samples/nota.jpg"
    );
    process.exit(1);
  }

  const abs = path.resolve(filePath);
  console.log("[file]", abs);

  if (!fs.existsSync(abs)) {
    console.error("Arquivo não encontrado:", abs);
    process.exit(1);
  }

  const buffer = fs.readFileSync(abs);
  const ext = path.extname(abs).toLowerCase();
  let text = "";

  // --- pasta local do idioma (tessdata/por.traineddata) ---
  const tesseractOptions = {
    langPath: path.join(process.cwd(), "tessdata"),
    cachePath: path.join(process.cwd(), ".cache"),
  };

  if (ext === ".pdf") {
    try {
      const data = await pdfParse(buffer);
      text = (data.text || "").trim();
      if (text) {
        console.log("PDF pesquisável detectado (sem OCR).");
      } else {
        console.log("PDF sem texto pesquisável, rodando OCR…");
        const { data: ocr } = await Tesseract.recognize(
          buffer,
          "por",
          tesseractOptions
        );
        text = (ocr.text || "").trim();
      }
    } catch (e) {
      console.log("Falha no parser de PDF, tentando OCR…");
      const { data: ocr } = await Tesseract.recognize(
        buffer,
        "por",
        tesseractOptions
      );
      text = (ocr.text || "").trim();
    }
  } else {
    console.log("Imagem detectada, rodando OCR…");
    const { data: ocr } = await Tesseract.recognize(
      buffer,
      "por",
      tesseractOptions
    );
    text = (ocr.text || "").trim();
  }

  if (!text) {
    console.log("❌ Não foi possível extrair texto.");
    process.exit(2);
  }

  // --- resultados ---
  console.log("\n=== Trecho do texto extraído ===");
  console.log(text.slice(0, 800)); // mostra até 800 caracteres do texto

  console.log("\n=== Resultado do parsing ===");
  const cents = extractAmountCentsBR(text);
  console.log("Valor (centavos):", cents);
  console.log("Valor (BRL):", centsToBRL(cents));

  const results = chrono.pt.parse(text, new Date(), { forwardDate: true });
  const dt = results.length ? results[0].date() : null;
  console.log("Data/Hora:", dt ? dt.toLocaleString("pt-BR") : "(não encontrada)");

  console.log("\n✅ OCR e parsing finalizados com sucesso.");
}

// === executa o teste ===
main().catch((e) => {
  console.error("[erro]", e);
  process.exit(1);
});
