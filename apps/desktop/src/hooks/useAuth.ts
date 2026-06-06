// Hook qui renvoie la session Supabase + le profil métier (avec establishment_id).
// Sert dans tous les écrans pour savoir qui est l'utilisateur et quel établissement
// utiliser pour ses queries.

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import type { Profile } from "@resto/shared";
import { supabase } from "../supabaseClient";

export interface AuthState {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
}

export function useAuth(): AuthState {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) {
      setProfile(null);
      return;
    }
    supabase
      .from("profiles")
      .select("*")
      .eq("id", session.user.id)
      .single()
      .then(({ data }) => setProfile(data as Profile | null));
  }, [session]);

  return { session, profile, loading };
}
