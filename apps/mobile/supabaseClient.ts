import AsyncStorage from "@react-native-async-storage/async-storage";
import { createSupabaseClient } from "@resto/shared";

const url     = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

// AsyncStorage → la session est conservée entre deux ouvertures de l'app
// (« se souvenir de moi » : plus besoin de se reconnecter à chaque lancement).
export const supabase = createSupabaseClient(url, anonKey, { storage: AsyncStorage });
