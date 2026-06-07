// Factory du client Supabase. Chaque app (desktop / mobile) appelle
// `createSupabaseClient(url, anonKey)` avec ses propres variables d'env.

import { createClient, SupabaseClient, SupportedStorage } from "@supabase/supabase-js";

export interface CreateClientOptions {
  // Adaptateur de stockage de session. Sur mobile (RN), passer AsyncStorage
  // pour garder l'utilisateur connecté entre deux lancements de l'app.
  storage?: SupportedStorage;
}

export function createSupabaseClient(
  url: string,
  anonKey: string,
  options: CreateClientOptions = {},
): SupabaseClient {
  if (!url || !anonKey) {
    throw new Error(
      "Supabase URL ou anon key manquants. Vérifie ton .env (VITE_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_URL).",
    );
  }
  return createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      ...(options.storage ? { storage: options.storage } : {}),
    },
  });
}
