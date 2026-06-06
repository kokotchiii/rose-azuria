import { createSupabaseClient } from "@resto/shared";

const url     = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createSupabaseClient(url, anonKey);
