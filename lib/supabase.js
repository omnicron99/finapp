// lib/supabase.js
import { createClient } from "@supabase/supabase-js";

/**
 * Cria o client apenas quando for chamado (runtime),
 * evitando falhar no build do Next.
 */
export function getSupabaseServerClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE; // server-only
  if (!url || !key) {
    throw new Error("Supabase envs ausentes: defina SUPABASE_URL e SUPABASE_SERVICE_ROLE no ambiente de execução.");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}
