import { useState } from "react";
import { supabase } from "../supabaseClient";

export function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
    setLoading(false);
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <h1>Resto Dépenses</h1>
        <p className="muted">Connecte-toi pour gérer les dépenses du restaurant.</p>
        <form onSubmit={onSubmit} className="form">
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email" />
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="mot de passe"
            type="password"
          />
          <button type="submit" disabled={loading}>
            {loading ? "..." : "Se connecter"}
          </button>
          {error && <p className="error">{error}</p>}
        </form>
      </div>
    </div>
  );
}
