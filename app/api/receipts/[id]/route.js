// app/api/receipts/[id]/route.js
import { NextResponse } from "next/server";
import { DateTime } from "luxon";
import { supabaseAdmin } from "../../../../lib/supabase-admin.js";

export async function PUT(req, ctx) {
  // Next 15+: params é assíncrono
  const { id } = await ctx.params;

  try {
    const body = await req.json();
    const update = {};

    // Título (nome do comprovante)
    if (typeof body.title === "string") {
      update.title = body.title.slice(0, 120);
    }

    // Valor — aceita amountBRL ("41,85") ou amountCents (4185)
    if (body.amountCents != null) {
      update.amount_cents = parseInt(body.amountCents);
    } else if (body.amountBRL) {
      update.amount_cents = brlToCents(body.amountBRL);
    }

    // Data/hora
    if (body.occurredAt) {
      const iso = toISOFromPt(body.occurredAt);
      if (iso) update.occurred_at = iso;
    }

    // Categoria
    if (body.category !== undefined) {
      update.category = body.category === "" ? null : String(body.category);
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "Nada para atualizar" }, { status: 400 });
    }

    // Atualiza via Supabase REST
    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("Receipt")
      .update(update)
      .eq("id", id)
      .select("*")
      .single();

    if (error) {
      console.error("[PUT /receipts/:id] erro supabase:", error);
      return NextResponse.json({ error: "Falha ao atualizar" }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      receipt: {
        id: data.id,
        title: data.title,
        amountBRL: (data.amount_cents / 100).toLocaleString("pt-BR", {
          style: "currency",
          currency: data.currency,
        }),
        occurredAt: data.occurred_at,
        sourceFile: data.source_file,
        ocrEngine: data.ocr_engine,
        ocrConfidence: data.ocr_confidence,
        category: data.category,
      },
    });
  } catch (err) {
    console.error("[PUT /receipts/:id] erro:", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

/* ===== helpers ===== */

function brlToCents(input) {
  if (typeof input === "number") return Math.round(input * 100);
  if (typeof input !== "string") return NaN;
  const norm = input
    .replace(/[^\d,\.]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const n = Number(norm);
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}

function toISOFromPt(text) {
  const TZ = "America/Sao_Paulo";
  const m = String(text).match(
    /^\s*(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?\s*$/
  );
  if (!m) return null;
  const [, dd, MM, yyyy, HH, mm, ss] = m.map((x) =>
    x == null ? x : Number(x)
  );
  const fmt = ss != null ? "yyyy-M-d HH:mm:ss" : "yyyy-M-d HH:mm";
  const str =
    ss != null
      ? `${yyyy}-${MM}-${dd} ${HH}:${mm}:${ss}`
      : `${yyyy}-${MM}-${dd} ${HH}:${mm}`;
  const dt = DateTime.fromFormat(str, fmt, { zone: TZ });
  return dt.isValid ? dt.toUTC().toJSDate().toISOString() : null;
}
