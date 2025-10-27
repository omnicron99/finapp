import { NextResponse } from "next/server";
import { DateTime } from "luxon";
import { supabaseAdmin } from "../../../../lib/supabase-admin.js";

export const runtime = "nodejs";

// PUT /api/receipts/:id
export async function PUT(req, ctx) {
  const { id } = await ctx.params; // Next 15: params é async
  try {
    const body = await req.json();

    // Monta o objeto de update mapeando para SNAKE_CASE do banco
    const update = {};

    if (typeof body.title === "string") {
      update.title = body.title.slice(0, 120);
    }

    // Valor: aceita amountCents (número) OU amountBRL ("41,85" ou 41.85)
    if (body.amountCents != null) {
      const cents = Number(body.amountCents);
      if (Number.isFinite(cents)) update.amount_cents = Math.trunc(cents);
    } else if (body.amountBRL != null) {
      update.amount_cents = brlToCents(body.amountBRL);
    }

    // Data/hora: aceita "dd/MM/yyyy HH:mm" (PT-BR) ou ISO
    if (body.occurredAt) {
      const iso = toISO(body.occurredAt);
      if (!iso) {
        return NextResponse.json({ error: "Data/Hora inválida" }, { status: 400 });
      }
      update.occurred_at = iso; // coluna timestamptz
    }

    if (body.category !== undefined) {
      update.category = body.category === "" ? null : String(body.category);
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "Nada para atualizar" }, { status: 400 });
    }

    const sb = supabaseAdmin(); // usa SERVICE_ROLE
    const { data, error } = await sb
      .from("Receipt")
      .update(update)
      .eq("id", id)
      .select("id,title,amount_cents,currency,occurred_at,source_file,ocr_engine,ocr_confidence,category")
      .single();

    if (error) {
      // >>> MOSTRAR O ERRO REAL para debugar por que o PUT não passa
      console.error("[PUT /receipts/:id] supabase error:", error);
      return NextResponse.json(
        { error: "Falha ao atualizar", supabase: { message: error.message, hint: error.hint, code: error.code, details: error.details } },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      receipt: {
        id: data.id,
        title: data.title,
        amountBRL: (data.amount_cents / 100).toLocaleString("pt-BR", { style: "currency", currency: data.currency || "BRL" }),
        occurredAt: data.occurred_at, // armazenado em UTC, exibido no front como America/Sao_Paulo
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

// GET /api/receipts/:id  (helper pra checar o que está no banco)
export async function GET(_req, ctx) {
  const { id } = await ctx.params;
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("Receipt")
    .select("id,title,amount_cents,currency,occurred_at,source_file,ocr_engine,ocr_confidence,category")
    .eq("id", id)
    .single();
  if (error) {
    return NextResponse.json({ error: "Não encontrado", supabase: error }, { status: 404 });
  }
  return NextResponse.json({ ok: true, data });
}

/* ===== helpers ===== */

function brlToCents(input) {
  if (typeof input === "number") return Math.round(input * 100);
  if (typeof input !== "string") return NaN;
  const norm = input.replace(/[^\d,.,,]/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(norm);
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}

function toISO(text) {
  // ISO direto
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) {
    const d = new Date(text);
    return isNaN(+d) ? null : d.toISOString();
  }
  // "dd/MM/yyyy HH:mm" ou "...:ss"
  const m = String(text).match(/^\s*(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?\s*$/);
  if (!m) return null;
  const [, dd, MM, yyyy, HH, mm, ss] = m.map((x) => (x == null ? x : Number(x)));
  const fmt = ss != null ? "yyyy-M-d HH:mm:ss" : "yyyy-M-d HH:mm";
  const str = ss != null ? `${yyyy}-${MM}-${dd} ${HH}:${mm}:${ss}` : `${yyyy}-${MM}-${dd} ${HH}:${mm}`;
  const dt = DateTime.fromFormat(str, fmt, { zone: "America/Sao_Paulo" });
  return dt.isValid ? dt.toUTC().toJSDate().toISOString() : null;
}
