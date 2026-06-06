// Constantes partagées (mêmes valeurs que les CHECK SQL).

export const PAYMENT_SOURCES = ["cb_pro", "cb_perso", "especes", "virement"] as const;
export type PaymentSource = (typeof PAYMENT_SOURCES)[number];

export const EXTRA_PAYMENT_SOURCES = ["especes", "cb", "virement"] as const;
export type ExtraPaymentSource = (typeof EXTRA_PAYMENT_SOURCES)[number];

export const EXTRA_TYPES = ["salle", "cuisine", "plonge", "bar", "commis", "autre"] as const;
export type ExtraType = (typeof EXTRA_TYPES)[number];

export const SERVICES = ["midi", "soir", "journee"] as const;
export type Service = (typeof SERVICES)[number];

export const ORDER_STATUSES = [
  "brouillon",
  "envoyee",
  "livree_partielle",
  "livree",
  "facturee",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const DOC_TYPES = ["facture", "bon_de_livraison", "ticket", "note_de_frais", "autre"] as const;
export type DocType = (typeof DOC_TYPES)[number];

export const DEFAULT_CATEGORIES = [
  "Matières premières (food)",
  "Boissons",
  "Loyer",
  "Énergie / fluides",
  "Équipement / entretien",
  "Fournitures",
  "Marketing",
  "Frais bancaires",
  "Transport / déplacements",
  "Honoraires (comptable…)",
  "Taxes",
  "Autres",
] as const;
