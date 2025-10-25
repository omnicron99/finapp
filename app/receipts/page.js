// app/receipts/page.js
import Link from "next/link";
import { prisma } from "../../lib/prisma.js";

export const dynamic = "force-dynamic";

function centsToBRL(cents, currency = "BRL") {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency });
}

export default async function ReceiptsPage() {
  const items = await prisma.receipt.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
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
      createdAt: true,
    },
  });

  return (
    <main style={{ maxWidth: 980, margin: "24px auto", padding: 16 }}>
      <h1 style={{ marginBottom: 8 }}>Recibos salvos</h1>
      <p style={{ color: "#555" }}>
        Itens processados pela API. <Link href="/">Voltar ao upload</Link>
      </p>

      {items.length === 0 ? (
        <div style={{ marginTop: 16, color: "#6b7280" }}>
          Nada por aqui ainda. Envie um arquivo na página inicial.
        </div>
      ) : (
        <div style={{ marginTop: 16, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 860 }}>
            <thead>
              <tr>
                <th style={th}>Título</th>
                <th style={th}>Valor</th>
                <th style={th}>Data</th>
                <th style={th}>Arquivo</th>
                <th style={th}>Categoria</th>
                <th style={th}>OCR</th>
                <th style={th}>Incluído</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id}>
                  <td style={td}>{r.title}</td>
                  <td style={td}>{centsToBRL(r.amountCents, r.currency)}</td>
                  <td style={td}>
                    {new Date(r.occurredAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}
                  </td>
                  <td style={td}>
                    <a href={r.sourceFile} target="_blank" rel="noreferrer">abrir</a>
                  </td>
                  <td style={td}>{r.category || <span style={{opacity:.6}}>(sem)</span>}</td>
                  <td style={td}>
                    {r.ocrEngine}
                    {r.ocrConfidence != null ? ` (${Math.round(r.ocrConfidence)}%)` : ""}
                  </td>
                  <td style={td}>
                    {new Date(r.createdAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

const th = {
  textAlign: "left",
  padding: "10px 8px",
  borderBottom: "1px solid #e5e7eb",
  background: "#f9fafb",
  fontWeight: 600,
  fontSize: 14,
};
const td = { padding: "10px 8px", borderBottom: "1px solid #f1f5f9", fontSize: 14 };
