// lib/supabase.js
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE; // server-side only
if (!url || !key) {
  console.warn("[supabase] SUPABASE_URL ou SUPABASE_SERVICE_ROLE ausente(s).");
}

export const supabase = createClient(url, key, {
  auth: { persistSession: false },
});
