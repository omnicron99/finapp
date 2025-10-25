// app/api/health/route.js
import { NextResponse } from "next/server";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    ok: true,
    now: new Date().toISOString(),
    cwd: process.cwd(),
  });
}
