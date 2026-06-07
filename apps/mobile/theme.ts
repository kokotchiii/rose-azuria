// Design tokens — refonte « Rose » : minimalisme éditorial chaud.
// Typo : Playfair Display (titres / grands chiffres) + Karla (UI / corps).
// Palette rouge appétissant + or, validée par le skill ui-ux-pro-max.

export const colors = {
  primary:      "#DC2626", // rouge — actions principales
  primaryPress: "#B91C1C", // état pressé
  primarySoft:  "#FCE5E5", // teinte douce (puces actives, fonds subtils)
  secondary:    "#F87171",
  gold:         "#CA8A04", // accent / CTA secondaire
  goldSoft:     "#FEF3C7",
  bg:           "#FEF4F3", // fond rosé clair, chaud
  surface:      "#FFFFFF",
  surfaceAlt:   "#FBE9E9",
  text:         "#431407", // encre brun profond (contraste fort)
  textMuted:    "#6B5563", // texte secondaire (≥4.5:1 sur blanc)
  border:       "#F1DEDE", // bordure douce
  borderStrong: "#E2C7C7",
  success:      "#15803D",
  successBg:    "#DCFCE7",
  danger:       "#B91C1C",
  dangerBg:     "#FEE2E2",
  white:        "#FFFFFF",
  chipBg:       "#F7ECEC",
} as const;

// Familles de police (noms exportés par @expo-google-fonts, chargés dans App.tsx).
export const fonts = {
  display:     "PlayfairDisplay_700Bold",
  displaySemi: "PlayfairDisplay_600SemiBold",
  body:        "Karla_400Regular",
  medium:      "Karla_500Medium",
  semibold:    "Karla_600SemiBold",
  bold:        "Karla_700Bold",
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 36,
} as const;

export const radius = {
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24,
  pill: 999,
} as const;

// Échelle typographique (style éditorial : titres serif, libellés capitales espacées).
export const type = {
  display: { fontFamily: fonts.display,     fontSize: 34, letterSpacing: -0.5 },
  h1:      { fontFamily: fonts.display,     fontSize: 28, letterSpacing: -0.4 },
  h2:      { fontFamily: fonts.displaySemi, fontSize: 22, letterSpacing: -0.2 },
  title:   { fontFamily: fonts.semibold,    fontSize: 17 },
  body:    { fontFamily: fonts.body,        fontSize: 16 },
  label:   { fontFamily: fonts.bold,        fontSize: 12, letterSpacing: 0.8, textTransform: "uppercase" },
  small:   { fontFamily: fonts.body,        fontSize: 13 },
} as const;

// Ombres douces, deux niveaux (cartes vs éléments surélevés).
export const shadow = {
  card: {
    shadowColor: "#7F1D1D",
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  lifted: {
    shadowColor: "#7F1D1D",
    shadowOpacity: 0.12,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
    elevation: 7,
  },
} as const;

// Cible tactile minimale (accessibilité)
export const TOUCH = 48;
