// Types métier (miroirs des tables SQL).

import type {
  PaymentSource,
  ExtraPaymentSource,
  ExtraType,
  Service,
  OrderStatus,
  DocType,
} from "./constants";

export type UUID = string;

export interface Establishment {
  id: UUID;
  name: string;
  siret: string | null;
  created_at: string;
}

export interface Profile {
  id: UUID;
  establishment_id: UUID;
  full_name: string | null;
  role: "owner" | "member";
  created_at: string;
}

export interface Category {
  id: UUID;
  establishment_id: UUID;
  label: string;
  is_active: boolean;
}

export interface Supplier {
  id: UUID;
  establishment_id: UUID;
  name: string;
  siret: string | null;
  default_category_id: UUID | null;
  contact: string | null;
}

export interface DocumentRecord {
  id: UUID;
  establishment_id: UUID;
  storage_path: string;
  file_type: string | null;
  uploaded_by: UUID | null;
  ai_status: "pending" | "done" | "failed";
  ai_raw_json: AiExtraction | null;
  created_at: string;
}

// Type de dépense : facture fournisseur vs achat de dépannage (petit achat / note de frais).
export type ExpenseKind = "facture" | "depannage";

export interface Expense {
  id: UUID;
  establishment_id: UUID;
  kind: ExpenseKind;
  expense_date: string; // YYYY-MM-DD
  due_date: string | null;   // YYYY-MM-DD (échéance de paiement)
  paid: boolean;             // facture réglée ?
  paid_at: string | null;
  supplier_id: UUID | null;
  category_id: UUID | null;
  amount_ttc: number;
  tva_rate: number | null;
  amount_tva: number | null;
  payer_id: UUID | null;
  payment_source: PaymentSource;
  invoice_number: string | null;
  document_id: UUID | null;
  order_id: UUID | null;
  note: string | null;
  reimbursable: boolean;
  reimbursed: boolean;
  reimbursed_at: string | null;
  justif_verified: boolean;        // justificatif papier vérifié et pointé
  justif_verified_at: string | null;
  reconciled: boolean;             // pointée sur un relevé bancaire (rapprochement)
  created_by: UUID | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Rapprochement bancaire
// ---------------------------------------------------------------------------

export type BankTxDirection = "debit" | "credit";
export type BankTxStatus = "unmatched" | "matched" | "ignored";

export interface BankTransaction {
  id: UUID;
  establishment_id: UUID;
  import_batch: UUID | null;
  tx_date: string;            // YYYY-MM-DD
  label: string;             // libellé brut du relevé
  amount: number;            // toujours positif (la direction donne le sens)
  direction: BankTxDirection;
  matched_expense_id: UUID | null;
  status: BankTxStatus;
  raw_json: unknown | null;
  created_by: UUID | null;
  created_at: string;
}

// Une opération telle que renvoyée par l'Edge Function parse-bank-statement.
export interface ParsedBankTx {
  date: string;              // YYYY-MM-DD
  label: string;
  amount: number;            // positif
  direction: BankTxDirection;
}

export interface BankStatementParse {
  bank_name: string | null;
  account_holder: string | null;
  period_start: string | null;
  period_end: string | null;
  transactions: ParsedBankTx[];
}

export interface CashWithdrawal {
  id: UUID;
  establishment_id: UUID;
  withdrawal_date: string;
  amount: number;
  reason: string | null;
  user_id: UUID | null;
}

export interface ExtraWorker {
  id: UUID;
  establishment_id: UUID;
  full_name: string;
  default_type: ExtraType | null;
  default_rate: number | null;
  contact: string | null;
  is_active: boolean;
}

export interface ExtraRecord {
  id: UUID;
  establishment_id: UUID;
  worker_id: UUID;
  extra_date: string;
  service: Service | null;
  extra_type: ExtraType;
  hours: number | null;
  amount_paid: number;
  payment_source: ExtraPaymentSource;
  document_id: UUID | null;
  note: string | null;
  created_by: UUID | null;
  created_at: string;
}

export interface Order {
  id: UUID;
  establishment_id: UUID;
  supplier_id: UUID | null;
  order_date: string;
  status: OrderStatus;
  category_id: UUID | null;
  note: string | null;
  created_by: UUID | null;
}

// Réponse normalisée de l'Edge Function classify-document.
export interface AiExtraction {
  document_type: DocType;
  supplier_name: string | null;
  supplier_siret: string | null;
  document_date: string | null; // YYYY-MM-DD (date d'émission)
  due_date: string | null;       // YYYY-MM-DD (date d'échéance / à régler avant)
  invoice_number: string | null;
  currency: "EUR";
  amount_ht: number | null;
  amount_tva: number | null;
  amount_ttc: number | null;
  tva_rate: number | null;
  suggested_category: string;
  line_items: Array<{
    description: string;
    quantity: number | null;
    unit_price: number | null;
  }>;
  confidence: number;
}
