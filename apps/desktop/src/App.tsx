import { useState } from "react";
import { Layout, type PageKey } from "./components/Layout";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";
import { Capture } from "./pages/Capture";
import { Expenses } from "./pages/Expenses";
import { Suppliers } from "./pages/Suppliers";
import { Products } from "./pages/Products";
import { Todos } from "./pages/Todos";
import { Export } from "./pages/Export";
import { Revenues } from "./pages/Revenues";
import { useAuth } from "./hooks/useAuth";

export function App() {
  const { session, profile, loading } = useAuth();
  const [page, setPage] = useState<PageKey>("capture");

  if (loading) {
    return <div className="centered muted">Chargement…</div>;
  }
  if (!session || !profile) {
    return <Login />;
  }

  return (
    <Layout page={page} onChangePage={setPage} profile={profile}>
      {page === "dashboard" && <Dashboard />}
      {page === "capture"   && <Capture profile={profile} />}
      {page === "expenses"  && <Expenses />}
      {page === "suppliers" && <Suppliers />}
      {page === "products"  && <Products />}
      {page === "todos"     && <Todos profile={profile} />}
      {page === "export"    && <Export />}
      {page === "revenues"  && <Revenues profile={profile} />}
    </Layout>
  );
}
