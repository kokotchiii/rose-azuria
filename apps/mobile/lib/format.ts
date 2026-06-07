// Formatage simple (sans dépendre d'Intl, qui peut manquer de locale sur RN).

export function fmtEUR(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "—";
  const v = Number(n).toFixed(2).replace(".", ",");
  // séparateur de milliers (espace fine)
  const [intPart, dec] = v.split(",");
  const withSep = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${withSep},${dec} €`;
}

export function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  const iso = d.slice(0, 10);
  const [y, m, day] = iso.split("-");
  if (!y || !m || !day) return d;
  return `${day}/${m}/${y}`;
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function startOfMonthISO(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}
