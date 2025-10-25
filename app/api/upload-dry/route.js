// app/api/upload-dry/route.js
import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
export const runtime = "nodejs";

export async function POST(req) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");
    if (!file) return NextResponse.json({ error: "Arquivo não enviado" }, { status: 400 });

    const uploadsDir = path.join(process.cwd(), "public", "uploads");
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const originalName = file.name || `upload-${Date.now()}`;
    const safeName = `${Date.now()}-${originalName}`.replace(/\s+/g, "_");
    const fullPath = path.join(uploadsDir, safeName);
    fs.writeFileSync(fullPath, buffer);

    return NextResponse.json({
      ok: true,
      savedAs: `/uploads/${safeName}`,
      sizeBytes: buffer.length,
      mime: file.type || null,
    });
  } catch (e) {
    console.error("[/api/upload-dry] erro:", e);
    return NextResponse.json({ error: "Falha no upload-dry" }, { status: 500 });
  }
}
