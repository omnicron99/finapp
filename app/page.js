"use client";

import { useState } from "react";
import { DateTime } from "luxon";

export default function HomePage() {
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  function onPick(e) {
    const f = e.target.files?.[0] || null;
    setFile(f);
    setResult(null);
    setError(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (f && f.type.startsWith("image/")) {
      setPreviewUrl(URL.createObjectURL(f));
    } else {
      setPreviewUrl(null);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setResult(null);
    setError(null);

    if (!file) {
      setError("Selecione um arquivo (imagem ou PDF).");
      return;
    }

    const maxMB = 15;
    if (file.size > maxMB * 1024 * 1024) {
      setError(`Arquivo muito grande. Máximo permitido: ${maxMB} MB.`);
      return;
    }

    const fd = new FormData();
    fd.append("file", file);

    setLoading(true);
    try {
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(json?.error || "Falha no processamento.");
        setResult(null);
      } else {
        setResult(json.receipt || null);
        setError(null);
      }
    } catch (err) {
      setError("Erro de rede ao enviar o arquivo.");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 720, margin: "24px auto", padding: 16 }}>
      <h1 style={{ marginBottom: 8 }}>Organização Financeira — Upload</h1>
      <p style={{ color: "#555", marginBottom: 16 }}>
        Envie uma <strong>imagem</strong> (JPG/PNG) ou <strong>PDF</strong> de nota/extrato.
        A API vai extrair texto, identificar <em>valor</em>, <em>data/hora</em> e um <em>título</em>, e salvar no banco.
      </p>

      <form onSubmit={handleSubmit} style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 16 }}>
        <input type="file" accept="image/*,application/pdf" onChange={onPick} disabled={loading} />
        <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
          <button
            type="submit"
            disabled={!file || loading}
            style={{
              padding: "8px 14px",
              borderRadius: 8,
              border: "1px solid #111827",
              background: loading ? "#e5e7eb" : "#111827",
              color: loading ? "#111827" : "white",
              cursor: !file || loading ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "Processando…" : "Enviar e processar"}
          </button>
          {file && (
            <span style={{ fontSize: 12, color: "#6b7280" }}>
              Selecionado: <strong>{file.name}</strong> ({Math.round(file.size / 1024)} KB)
            </span>
          )}
        </div>
      </form>

      {previewUrl && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 6 }}>Pré-visualização (imagem):</div>
          <img
            src={previewUrl}
            alt="Pré-visualização"
            style={{ maxWidth: "100%", borderRadius: 8, border: "1px solid #e5e7eb" }}
          />
        </div>
      )}

      {error && (
        <div
          style={{
            marginTop: 16,
            color: "#b91c1c",
            background: "#fee2e2",
            border: "1px solid #fecaca",
            padding: 12,
            borderRadius: 8,
          }}
        >
          <strong>Erro: </strong>
          {error}
        </div>
      )}

      {result && (
        <div style={{ marginTop: 16, border: "1px solid #e5e7eb", borderRadius: 12, padding: 16 }}>
          <h2 style={{ marginTop: 0 }}>Revisar antes de salvar</h2>
          <ReviewForm initial={result} />
        </div>
      )}
    </main>
  );
}

/* ====================== Formulário de Revisão ====================== */

function ReviewForm({ initial }) {
  const [title, setTitle] = useState(initial.title || "");
  const [amount, setAmount] = useState(brlFromCents(initial.amountBRL ?? null, initial.amountCents));

  // initial.occurredAt vem em UTC do backend → mostrar em America/Sao_Paulo no input
  const [occurredAt, setOccurredAt] = useState(
    DateTime.fromISO(initial.occurredAt, { zone: "utc" })
      .setZone("America/Sao_Paulo")
      .toFormat("yyyy-LL-dd'T'HH:mm")
  );

  const [category, setCategory] = useState(initial.category || "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState(null);

  async function onSave(e) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    setErr(null);

    const amountCents = centsFromBRLLike(amount);
    if (!Number.isFinite(amountCents) || amountCents < 0) {
      setErr("Valor inválido.");
      setSaving(false);
      return;
    }

    // input datetime-local está em hora local (America/Sao_Paulo) → converter para UTC ISO
    const occurredAtUTC = occurredAt
      ? DateTime.fromFormat(occurredAt, "yyyy-LL-dd'T'HH:mm", { zone: "America/Sao_Paulo" })
          .toUTC()
          .toISO()
      : undefined;

    const res = await fetch(`/api/receipts/${initial.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        amountCents,
        occurredAt: occurredAtUTC,
        category: category || null,
      }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErr(json?.error || "Falha ao salvar alterações.");
      setSaving(false);
      return;
    }
    setSaving(false);
    setSaved(true);
  }

  const cats = ["Alimentação","Mercado","Transporte","Saúde","Lazer","Moradia","Educação","Outros"];

  return (
    <form onSubmit={onSave} style={{ display: "grid", gap: 12 }}>
      <label style={lbl}>
        Título
        <input value={title} onChange={(e)=>setTitle(e.target.value)} style={inp}/>
      </label>

      <label style={lbl}>
        Valor (R$)
        <input value={amount} onChange={(e)=>setAmount(e.target.value)} style={inp} placeholder="47,81"/>
      </label>

      <label style={lbl}>
        Data e hora
        <input type="datetime-local" value={occurredAt} onChange={(e)=>setOccurredAt(e.target.value)} style={inp}/>
      </label>

      <label style={lbl}>
        Categoria
        <select value={category} onChange={(e)=>setCategory(e.target.value)} style={inp}>
          <option value="">(sem categoria)</option>
          {cats.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </label>

      <div style={{ fontSize: 12, color: "#6b7280" }}>
        Arquivo: <a href={initial.sourceFile} target="_blank" rel="noreferrer">{initial.sourceFile}</a><br/>
        {/* Exibição no fuso do Brasil */}
        Data detectada:{" "}
        {new Date(initial.occurredAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}
        <br/>
        OCR: {initial.ocrEngine} {initial.ocrConfidence != null ? `(${Math.round(initial.ocrConfidence)}%)` : ""}
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button disabled={saving} style={btnPrimary}>
          {saving ? "Salvando…" : "Salvar alterações"}
        </button>
        {saved && <span style={{ color: "#15803d" }}>Salvo!</span>}
        {err && <span style={{ color: "#b91c1c" }}>{err}</span>}
      </div>
    </form>
  );
}

/* ====================== estilos e helpers ====================== */

const lbl = { display: "grid", gap: 6, fontWeight: 600 };
const inp = { padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 8 };
const btnPrimary = { padding: "8px 14px", borderRadius: 8, border: "1px solid #111827", background: "#111827", color: "white", cursor: "pointer" };

function centsFromBRLLike(brlLike) {
  if (typeof brlLike === "number") return Math.round(brlLike * 100);
  if (!brlLike) return NaN;
  const s = String(brlLike).replace(/[R$\s]/g,"").replace(/\./g,"").replace(",",".");
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}
function brlFromCents(amountBRLString, amountCents) {
  if (typeof amountCents === "number") {
    return (amountCents/100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (amountBRLString && typeof amountBRLString === "string") {
    return amountBRLString.replace(/[^\d,]/g,"");
  }
  return "";
}
