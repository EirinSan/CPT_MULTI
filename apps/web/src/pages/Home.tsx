import { Link } from "react-router";
import { api } from "../api/client";
import { PageHeader } from "../components/Layout";
import { RankBadge, tierProgress } from "../components/RankBadge";
import { DifficultyChip, Panel } from "../components/ui";
import { useAsync } from "../hooks/useAsync";
import { useAuth } from "../store/auth";

const MODES = [
  {
    to: "/ranked",
    title: "Ranked 1v1",
    text: "Même mission que ton adversaire, le premier à tout valider gagne des points ELO.",
    accent: "from-cyan-500/20",
  },
  {
    to: "/missions",
    title: "Missions",
    text: "Scénarios solo chronométrés : VLANs, routage, dépannage. Bats ton record.",
    accent: "from-emerald-500/20",
  },
  {
    to: "/lab",
    title: "Lab libre",
    text: "Switchs et routeur sans objectif, pour t'entraîner à la CLI.",
    accent: "from-slate-500/20",
  },
];

export function HomePage() {
  const user = useAuth((s) => s.user);
  const missions = useAsync(() => api.missions(), [user?.id]);
  const next = missions.data?.find((m) => !m.bestTimeMs);

  return (
    <>
      <PageHeader
        title={user ? `Salut ${user.username}` : "Bienvenue sur CPT Multi"}
        subtitle="Simulation réseau compétitive : configure plus vite et plus juste que les autres."
      />
      <div className="grid gap-4 p-6 lg:grid-cols-3">
        {user ? <RankCard elo={user.elo} /> : <GuestCard />}
        <Panel title="Prochaine mission" className="lg:col-span-2">
          {next ? (
            <Link to={`/missions/${next.slug}`} className="group block">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-slate-100 group-hover:text-cyan-200">{next.title}</span>
                <DifficultyChip value={next.difficulty} />
              </div>
              <p className="mt-1 text-sm text-slate-400">{next.summary}</p>
              <span className="mt-3 inline-block text-sm text-cyan-300">Lancer →</span>
            </Link>
          ) : (
            <p className="text-sm text-slate-400">
              {missions.loading ? "Chargement…" : "Toutes les missions sont validées. Direction le ranked !"}
            </p>
          )}
        </Panel>
        {MODES.map((m) => (
          <Link
            key={m.to}
            to={m.to}
            className={`group rounded-lg border border-lab-border bg-gradient-to-br ${m.accent} to-transparent p-5 hover:border-slate-500`}
          >
            <h2 className="text-lg font-semibold text-white group-hover:text-cyan-200">{m.title}</h2>
            <p className="mt-2 text-sm text-slate-400">{m.text}</p>
          </Link>
        ))}
      </div>
    </>
  );
}

function RankCard({ elo }: { elo: number }) {
  const { next, progress, remaining } = tierProgress(elo);
  return (
    <Panel title="Ton rang">
      <div className="flex items-center justify-between">
        <RankBadge elo={elo} size="lg" />
        <span className="font-mono text-2xl font-bold text-white">{elo}</span>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-800">
        <div className="h-full rounded-full bg-cyan-400" style={{ width: `${Math.round(progress * 100)}%` }} />
      </div>
      <p className="mt-2 text-xs text-slate-500">
        {next ? `${remaining} points avant ${next[0] + next.slice(1).toLowerCase()}` : "Rang maximal atteint"}
      </p>
    </Panel>
  );
}

function GuestCard() {
  return (
    <Panel title="Ton compte">
      <p className="text-sm text-slate-400">
        Crée un compte pour jouer en ranked, enregistrer tes temps et apparaître au classement.
      </p>
      <Link
        to="/login"
        className="mt-4 inline-block rounded-md bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-300"
      >
        Se connecter / s'inscrire
      </Link>
    </Panel>
  );
}
