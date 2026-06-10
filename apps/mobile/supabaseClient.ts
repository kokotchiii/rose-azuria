import AsyncStorage from "@react-native-async-storage/async-storage";
import { createSupabaseClient } from "@resto/shared";

const url     = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

// Si les variables manquent (ex. build sans .env), on NE plante PAS au démarrage
// (ce qui donnerait un écran noir) : on garde un flag pour afficher un message
// clair dans l'app, et on crée le client avec des valeurs neutres.
export const supabaseConfigError: string | null = (!url || !anonKey)
  ? "Configuration Supabase manquante : les variables d'environnement n'ont pas été incluses dans ce build."
  : null;

// AsyncStorage → la session est conservée entre deux ouvertures de l'app
// (« se souvenir de moi » : plus besoin de se reconnecter à chaque lancement).
export const supabase = createSupabaseClient(
  url ?? "https://placeholder.supabase.co",
  anonKey ?? "placeholder-anon-key",
  { storage: AsyncStorage },
);
