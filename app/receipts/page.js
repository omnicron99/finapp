// app/receipts/page.js
import { supabaseAdmin } from "../../lib/supabase-admin";

export const dynamic = "force-dynamic";

export default async function ReceiptsPage() {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("Receipt")
    .select("id,title,amount_cents,currency,occurred_at,source_file,category,created_at,ocr_engine,ocr_confidence")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return <main style={{maxWidth:820,margin:"20px auto",padding:16}}>
      <h1>Recebimentos salvos</h1>
      <pre style={{color:"crimson"}}>{error.message}</pre>
    </main>;
  }

  return (
    <main style={{ maxWidth: 820, margin: "20px auto", padding: 16 }}>
      <h1>Recebimentos salvos</h1>
      <p>Últimos 50 itens processados.</p>
      <table style={{ width: "100%", marginTop: 16, borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>Título</th>
            <th style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>Valor</th>
            <th style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>Data</th>
            <th style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>Arquivo</th>
            <th style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>Categoria</th>
          </tr>
        </thead>
        <tbody>
          {data?.map((r) => (
            <tr key={r.id}>
              <td style={{ padding: 6 }}>{r.title}</td>
              <td style={{ padding: 6 }}>
                {(r.amount_cents / 100).toLocaleString("pt-BR", { style: "currency", currency: r.currency })}
              </td>
              <td style={{ padding: 6 }}>{new Date(r.occurred_at).toLocaleString("pt-BR")}</td>
              <td style={{ padding: 6 }}>
                <a href={r.source_file} target="_blank" rel="noreferrer">abrir</a>
              </td>
              <td style={{ padding: 6 }}>{r.category || "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
