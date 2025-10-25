// scripts/ocr-worker.cjs
// Uso: node scripts/ocr-worker.cjs <absolute_file_path> <tessdata_dir>

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const sharp = require("sharp");
const Tesseract = require("tesseract.js");

const pExecFile = promisify(execFile);

function isPDF(fp) {
  return /\.pdf$/i.test(fp);
}

function resolvePdftoppm() {
  const envDir = process.env.POPPLER_PATH || process.env.POPPLER_BIN;
  if (envDir) {
    const candidate = path.join(envDir, process.platform === "win32" ? "pdftoppm.exe" : "pdftoppm");
    if (fs.existsSync(candidate)) return candidate;
  }
  // fallback: via PATH do sistema
  return process.platform === "win32" ? "pdftoppm.exe" : "pdftoppm";
}

async function pdfToPngs(pdfPath, dpi = 300) {
  const bin = resolvePdftoppm();
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdfimgs-"));
  const outPrefix = path.join(outDir, "page");

  // -png: PNG | -r: DPI | -gray: tons de cinza (melhora OCR)
  await pExecFile(bin, ["-png", "-r", String(dpi), "-gray", pdfPath, outPrefix], {
    maxBuffer: 128 * 1024 * 1024,
  });

  const files = fs
    .readdirSync(outDir)
    .filter((f) => /^page-\d+\.png$/i.test(f))
    .map((f) => path.join(outDir, f))
    .sort((a, b) => {
      const na = parseInt(a.match(/-(\d+)\.png$/i)[1], 10);
      const nb = parseInt(b.match(/-(\d+)\.png$/i)[1], 10);
      return na - nb;
    });

  return { outDir, files };
}

// Pré-processa imagens: redimensiona, cinza, normaliza e binariza
async function preprocessImageBuffer(buf) {
  const img = sharp(buf, { failOn: 'none' });

  const meta = await img.metadata().catch(() => ({}));
  const targetWidth = Math.max(900, Math.min(1800, (meta.width || 1200)));

  const processed = await img
    .resize({ width: targetWidth, withoutEnlargement: false })
    .grayscale()
    .normalize()            // equaliza contraste
    .threshold(170)         // binariza; ajuste 160–190 se quiser
    .toFormat("png")
    .toBuffer();

  return processed;
}

async function ocrBuffer(buf, tessdataDir) {
  // worker simples já é suficiente em Node puro
  const { data } = await Tesseract.recognize(buf, "por", {
    langPath: tessdataDir,
    cachePath: path.join(process.cwd(), ".cache"),
    // aumentar a “força” para números e layout estável:
    // parâmetros do Tesseract que o tesseract.js respeita
    tessedit_char_blacklist: "|=/\\_~",
    preserve_interword_spaces: "1",
    user_defined_dpi: "300",
  });
  return data;
}

async function main() {
  const filePath = process.argv[2];
  const tessdataDir = process.argv[3];

  if (!filePath || !fs.existsSync(filePath)) {
    console.error(JSON.stringify({ ok: false, error: "FILE_NOT_FOUND", filePath }));
    process.exit(2);
  }
  if (!tessdataDir || !fs.existsSync(path.join(tessdataDir, "por.traineddata"))) {
    console.error(JSON.stringify({ ok: false, error: "TESSDATA_MISSING", tessdataDir }));
    process.exit(3);
  }

  try {
    let text = "";
    let confidences = [];

    if (isPDF(filePath)) {
      const { outDir, files } = await pdfToPngs(filePath, 300);
      if (files.length === 0) throw new Error("PDF_RASTER_EMPTY");

      for (const imgPath of files) {
        const raw = fs.readFileSync(imgPath);
        const pre = await preprocessImageBuffer(raw);
        const d = await ocrBuffer(pre, tessdataDir);
        if (d?.text) text += "\n" + d.text;
        if (typeof d?.avg_confidence === "number") confidences.push(d.avg_confidence);
      }

      try {
        for (const f of files) fs.unlinkSync(f);
        fs.rmdirSync(path.dirname(files[0]));
      } catch {}
    } else {
      const raw = fs.readFileSync(filePath);
      const pre = await preprocessImageBuffer(raw);
      const d = await ocrBuffer(pre, tessdataDir);
      text = d?.text || "";
      if (typeof d?.avg_confidence === "number") confidences.push(d.avg_confidence);
    }

    const avg_confidence =
      confidences.length ? confidences.reduce((a, b) => a + b, 0) / confidences.length : null;

    console.log(JSON.stringify({ ok: true, text: (text || "").trim(), avg_confidence }));
    process.exit(0);
  } catch (e) {
    console.error(JSON.stringify({ ok: false, error: "OCR_FAIL", message: e?.message || String(e) }));
    process.exit(1);
  }
}

main();
