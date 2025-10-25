// app/api/receipts/[id]/route.js
import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma.js";

export const runtime = "nodejs";

export async function PUT(req, ctx) {
  try {
    // ⚠️ no App Router, params é async:
    const { id } = await ctx.params;

    const body = await req.json();

    // normaliza inputs
    let { title, amountCents, occurredAt, category } = body || {};

    if (typeof amountCents === "string") amountCents = parseInt(amountCents, 10);
    if (occurredAt && typeof occurredAt === "string") {
      const d = new Date(occurredAt);
      occurredAt = isNaN(d) ? undefined : d;
    }

    const updated = await prisma.receipt.update({
      where: { id },
      data: {
        ...(title != null ? { title } : {}),
        ...(Number.isFinite(amountCents) ? { amountCents } : {}),
        ...(occurredAt instanceof Date && !isNaN(occurredAt) ? { occurredAt } : {}),
        // category pode ser string ou null (para limpar)
        ...(category !== undefined ? { category } : {}),
      },
      select: {
        id: true,
        title: true,
        amountCents: true,
        currency: true,
        occurredAt: true,
        sourceFile: true,
        ocrEngine: true,
        ocrConfidence: true,
        category: true,
      },
    });

    return NextResponse.json({ ok: true, receipt: updated });
  } catch (e) {
    return NextResponse.json(
      { error: "Falha ao atualizar", detail: e?.message },
      { status: 400 }
    );
  }
}
