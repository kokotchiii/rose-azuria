// Layout principal : sidebar gauche + zone de contenu à droite.

import type { ReactNode } from "react";
import { supabase } from "../supabaseClient";
import type { Profile } from "@resto/shared";

export type PageKey = "dashboard" | "capture" | "expenses" | "suppliers" | "products" | "todos" | "export" | "revenues";

interface Props {
  page: PageKey;
  onChangePage: (p: PageKey) => void;
  profile: Profile | null;
  children: ReactNode;
}

const NAV: Array<{ key: PageKey; label: string; icon: string }> = [
  { key: "dashboard", label: "Tableau de bord", icon: "📊" },
  { key: "capture",   label: "Capturer un justificatif", icon: "📷" },
  { key: "expenses",  label: "Dépenses", icon: "🧾" },
  { key: "revenues",  label: "Recettes", icon: "💰" },
  { key: "suppliers", label: "Fournisseurs", icon: "🏪" },
  { key: "products",  label: "Produits récurrents", icon: "🛒" },
  { key: "todos",     label: "À faire", icon: "✅" },
  { key: "export",    label: "Export comptable", icon: "📤" },
];

export function Layout({ page, onChangePage, profile, children }: Props) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div>Rose</div>
          <div className="brand-sub">Gestion · Azuria</div>
        </div>
        <nav>
          {NAV.map((n) => (
            <button
              key={n.key}
              className={`nav-item ${page === n.key ? "active" : ""}`}
              onClick={() => onChangePage(n.key)}
            >
              <span className="ico">{n.icon}</span>
              {n.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="user">{profile?.full_name ?? "Utilisateur"}</div>
          <button className="link" onClick={() => supabase.auth.signOut()}>
            Se déconnecter
          </button>
        </div>
      </aside>
      <main className="content">{children}</main>
    </div>
  );
}
