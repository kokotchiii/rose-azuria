// Réglages locaux (par appareil) via AsyncStorage.
import AsyncStorage from "@react-native-async-storage/async-storage";

// Taux de TVA standards en restauration (France).
export const TVA_RATES = [5.5, 10, 20] as const;
export const TVA_DEFAULT = 10;

const KEY_TVA = "rose.defaultTvaRate";

export async function getDefaultTvaRate(): Promise<number> {
  try {
    const v = await AsyncStorage.getItem(KEY_TVA);
    const n = v != null ? Number(v) : NaN;
    return Number.isFinite(n) ? n : TVA_DEFAULT;
  } catch {
    return TVA_DEFAULT;
  }
}

export async function setDefaultTvaRate(rate: number): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_TVA, String(rate));
  } catch {
    // silencieux
  }
}
