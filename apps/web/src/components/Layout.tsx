import { NavLink, Outlet, useNavigate } from "react-router";
import { useAuth } from "../store/auth";
import { RankBadge } from "./RankBadge";

const NAV = [
  { to: "/", label: "Accueil", icon: "⌂", end: true },
  { to: "/ranked", label: "Ranked 1v1", icon: "⚔" },
  { to: "/missions", label: "Missions", icon: "◎" },
  { to: "/leaderboard", label: "Classement", icon: "▤" },
  { to: "/lab", label: "Lab libre", icon: ">_" },
];

function navClass({ isActive }: { isActive: boolean }) {
  return `flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
    isActive ? "bg-cyan-400/10 text-cyan-200" : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
  }`;
}

export function Layout() {
  const user = useAuth((s) => s.user);
  const navigate = useNavigate();

  return (
    <div className="flex h-full flex-col md:flex-row">
      <aside className="flex shrink-0 flex-col border-b border-lab-border bg-lab-panel/60 md:w-60 md:border-r md:border-b-0">
        <div className="flex items-center justify-between px-5 py-4">
          <NavLink to="/" className="text-lg font-bold tracking-tight text-white">
            CPT <span className="text-cyan-400">Multi</span>
          </NavLink>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:overflow-visible">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={navClass}>
              <span className="w-5 text-center font-mono text-xs" aria-hidden>
                {n.icon}
              </span>
              <span className="whitespace-nowrap">{n.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto hidden border-t border-lab-border p-3 md:block">
          {user ? (
            <button
              type="button"
              onClick={() => navigate("/profile")}
              className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-white/5"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-cyan-400/15 font-bold text-cyan-200">
                {user.username[0]!.toUpperCase()}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-slate-100">{user.username}</span>
                <RankBadge elo={user.elo} size="sm" />
              </span>
            </button>
          ) : (
            <NavLink
              to="/login"
              className="block rounded-md bg-cyan-400 px-3 py-2 text-center text-sm font-semibold text-slate-950 hover:bg-cyan-300"
            >
              Se connecter
            </NavLink>
          )}
        </div>
        <div className="flex gap-2 px-3 pb-3 md:hidden">
          <NavLink to={user ? "/profile" : "/login"} className={navClass}>
            {user ? `Profil · ${user.username}` : "Se connecter"}
          </NavLink>
        </div>
      </aside>
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3 border-b border-lab-border px-6 py-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-white">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-400">{subtitle}</p>}
      </div>
      {children}
    </header>
  );
}
