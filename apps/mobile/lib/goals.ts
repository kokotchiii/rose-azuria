// Objectif de croissance du CA, persisté localement (par appareil) via AsyncStorage.
// Note : choix volontaire pour rester léger / sans migration. Pourra passer côté
// serveur (table partagée) si l'objectif doit être commun à tous les membres.

import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "rose.growthTargetPct";
const DEFAULT = 10;

export async function getGrowthTarget(): Promise<number> {
  try {
    const v = await AsyncStorage.getItem(KEY);
    const n = v != null ? Number(v) : NaN;
    return Number.isFinite(n) ? n : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

export async function setGrowthTarget(pct: number): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, String(pct));
  } catch {
    // silencieux : l'objectif reste en mémoire pour la session
  }
}
