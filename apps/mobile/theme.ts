// Design tokens — refonte « Rose » : épuré / moderne (style Notion/Linear).
// Fond neutre clair, cartes nettes, accent bordeaux-rosé profond (chic).
// Typo : Playfair Display réservé aux grands chiffres/titres héros + Karla partout.

export const colors = {
  primary:      "#7C2D48", // bordeaux-rosé profond — actions principales, chic
  primaryPress: "#611F37", // état pressé
  primarySoft:  "#F4E7EC", // teinte douce (puces actives, fonds subtils)
  secondary:    "#A65A72", // mauve-rosé désaturé
  gold:         "#9A7B3F", // accent secondaire discret (laiton)
  goldSoft:     "#F3EEE2",
  bg:           "#FAFAF9", // fond neutre chaud, très clair
  surface:      "#FFFFFF",
  surfaceAlt:   "#F4F3F1",
  text:         "#1C1A19", // encre quasi-noire (contraste fort)
  textMuted:    "#78716C", // texte secondaire (≥4.5:1 sur blanc)
  border:       "#ECEAE7", // bordure très subtile
  borderStrong: "#DED9D4",
  success:      "#15803D",
  successBg:    "#DCFCE7",
  danger:       "#B4232B",
  dangerBg:     "#FBE9EA",
  white:        "#FFFFFF",
  chipBg:       "#F2F0ED",
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
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 999,
} as const;

// Échelle typographique — moderne : serif réservé aux grands chiffres/héros,
// sans-serif (Karla) pour titres et corps. Libellés en capitales espacées.
export const type = {
  display: { fontFamily: fonts.display,     fontSize: 34, letterSpacing: -0.5 },
  h1:      { fontFamily: fonts.semibold,    fontSize: 26, letterSpacing: -0.4 },
  h2:      { fontFamily: fonts.semibold,    fontSize: 20, letterSpacing: -0.2 },
  title:   { fontFamily: fonts.semibold,    fontSize: 16 },
  body:    { fontFamily: fonts.body,        fontSize: 15.5 },
  label:   { fontFamily: fonts.semibold,    fontSize: 11.5, letterSpacing: 0.6, textTransform: "uppercase" },
  small:   { fontFamily: fonts.body,        fontSize: 13 },
} as const;

// Ombres neutres et discrètes (look épuré).
export const shadow = {
  card: {
    shadowColor: "#1C1A19",
    shadowOpacity: 0.05,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  lifted: {
    shadowColor: "#1C1A19",
    shadowOpacity: 0.10,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
} as const;

// Cible tactile minimale (accessibilité)
export const TOUCH = 48;
