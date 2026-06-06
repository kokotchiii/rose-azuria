// Factory du client Supabase. Chaque app (desktop / mobile) appelle
// `createSupabaseClient(url, anonKey)` avec ses propres variables d'env.

import { createClient, SupabaseClient } from "@supabase/supabase-js";

export function createSupabaseClient(url: string, anonKey: string): SupabaseClient {
  if (!url || !anonKey) {
    throw new Error(
      "Supabase URL ou anon key manquants. Vérifie ton .env (VITE_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_URL).",
    );
  }
  return createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
  });
}
