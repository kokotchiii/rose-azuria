// Design tokens — style Minimalisme / Swiss, palette "Rose" (rouge appétissant + or).
// Source : skill ui-ux-pro-max (design system pour app finance/restaurant).

export const colors = {
  primary:      "#DC2626", // rouge — actions principales
  primaryPress: "#B91C1C", // état pressé
  secondary:    "#F87171",
  gold:         "#CA8A04", // accent / CTA secondaire
  bg:           "#FEF2F2", // fond rosé clair
  surface:      "#FFFFFF",
  surfaceAlt:   "#FBE9E9",
  text:         "#450A0A", // texte principal (contraste fort)
  textMuted:    "#6B5563", // texte secondaire (≥4.5:1 sur blanc)
  border:       "#EAD3D3",
  borderStrong: "#D9B8B8",
  success:      "#15803D",
  successBg:    "#DCFCE7",
  danger:       "#B91C1C",
  dangerBg:     "#FEE2E2",
  white:        "#FFFFFF",
  chipBg:       "#F5EAEA",
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 999,
} as const;

export const type = {
  h1:    { fontSize: 28, fontWeight: "700" as const, letterSpacing: -0.5 },
  h2:    { fontSize: 20, fontWeight: "700" as const, letterSpacing: -0.3 },
  title: { fontSize: 17, fontWeight: "600" as const },
  body:  { fontSize: 16, fontWeight: "400" as const },
  label: { fontSize: 13, fontWeight: "600" as const, letterSpacing: 0.2 },
  small: { fontSize: 13, fontWeight: "400" as const },
} as const;

// Ombre douce et nette (cohérente iOS/Android)
export const shadow = {
  card: {
    shadowColor: "#7F1D1D",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
} as const;

// Cible tactile minimale (accessibilité)
export const TOUCH = 48;
