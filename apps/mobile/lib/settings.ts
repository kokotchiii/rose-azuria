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

// ---------- Planning d'ouverture (pour les projections) ----------
// Un service midi et/ou soir par jour de semaine (index 0 = lundi … 6 = dimanche).
export interface DaySchedule { midi: boolean; soir: boolean }

const KEY_SCHEDULE = "rose.openSchedule";
const KEY_OPENING = "rose.openingDate";

// Défaut : midi + soir du lundi au vendredi, samedi soir, dimanche fermé (11 services).
export const DEFAULT_OPEN_SCHEDULE: DaySchedule[] = [
  { midi: true, soir: true },   // Lundi
  { midi: true, soir: true },   // Mardi
  { midi: true, soir: true },   // Mercredi
  { midi: true, soir: true },   // Jeudi
  { midi: true, soir: true },   // Vendredi
  { midi: false, soir: true },  // Samedi
  { midi: false, soir: false }, // Dimanche
];
export const DEFAULT_OPENING_DATE = "2026-06-02";

function isValidSchedule(v: unknown): v is DaySchedule[] {
  return Array.isArray(v) && v.length === 7 && v.every((d) => d && typeof d.midi === "boolean" && typeof d.soir === "boolean");
}

export async function getOpenSchedule(): Promise<DaySchedule[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY_SCHEDULE);
    if (!raw) return DEFAULT_OPEN_SCHEDULE;
    const parsed = JSON.parse(raw);
    return isValidSchedule(parsed) ? parsed : DEFAULT_OPEN_SCHEDULE;
  } catch {
    return DEFAULT_OPEN_SCHEDULE;
  }
}

export async function setOpenSchedule(s: DaySchedule[]): Promise<void> {
  try { await AsyncStorage.setItem(KEY_SCHEDULE, JSON.stringify(s)); } catch { /* silencieux */ }
}

export async function getOpeningDate(): Promise<string> {
  try {
    const v = await AsyncStorage.getItem(KEY_OPENING);
    return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : DEFAULT_OPENING_DATE;
  } catch {
    return DEFAULT_OPENING_DATE;
  }
}

export async function setOpeningDate(d: string): Promise<void> {
  try { await AsyncStorage.setItem(KEY_OPENING, d); } catch { /* silencieux */ }
}

// Nombre de services ouverts par jour de semaine, dérivé du planning.
export function servicesPerWeekdayOf(s: DaySchedule[]): number[] {
  return s.map((d) => (d.midi ? 1 : 0) + (d.soir ? 1 : 0));
}
