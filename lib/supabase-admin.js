// lib/supabase-admin.js
import { createClient } from "@supabase/supabase-js";

export function supabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE;
  if (!url || !key) {
    throw new Error("Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE no ambiente do servidor.");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}
