import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";
import { api } from "../api/client";
import { Button, ErrorNote } from "../components/ui";
import { useAuth } from "../store/auth";

export function AuthPage() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { token, login } = useAuth();
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? "/";

  if (token) return <Navigate to={from} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = mode === "login" ? await api.login(username, password) : await api.register(username, password);
      login(res.token, res.user);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm rounded-xl border border-lab-border bg-lab-panel p-6">
        <h1 className="text-xl font-semibold text-white">{mode === "login" ? "Connexion" : "Créer un compte"}</h1>
        <p className="mt-1 text-sm text-slate-400">
          {mode === "login" ? "Retrouve ton rang et tes records." : "Commence à 1000 ELO en Bronze II."}
        </p>
        <div className="mt-5 grid grid-cols-2 rounded-md border border-lab-border p-1 text-sm">
          {(["login", "register"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m);
                setError(null);
              }}
              className={`rounded px-3 py-1.5 ${mode === m ? "bg-cyan-400/15 text-cyan-200" : "text-slate-400"}`}
            >
              {m === "login" ? "Connexion" : "Inscription"}
            </button>
          ))}
        </div>
        <label className="mt-5 block text-sm text-slate-300">
          Pseudo
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
            minLength={3}
            maxLength={20}
            className="mt-1 w-full rounded-md border border-lab-border bg-lab-bg px-3 py-2 text-slate-100 outline-none focus:border-cyan-400"
          />
        </label>
        <label className="mt-4 block text-sm text-slate-300">
          Mot de passe
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            required
            minLength={mode === "register" ? 8 : 1}
            className="mt-1 w-full rounded-md border border-lab-border bg-lab-bg px-3 py-2 text-slate-100 outline-none focus:border-cyan-400"
          />
        </label>
        {error && <div className="mt-4"><ErrorNote>{error}</ErrorNote></div>}
        <Button type="submit" disabled={busy} className="mt-5 w-full">
          {busy ? "…" : mode === "login" ? "Se connecter" : "Créer mon compte"}
        </Button>
      </form>
    </div>
  );
}
