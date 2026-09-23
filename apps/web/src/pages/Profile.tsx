import { useEffect } from "react";
import { Link, useNavigate } from "react-router";
import { api } from "../api/client";
import { PageHeader } from "../components/Layout";
import { RankBadge, tierProgress } from "../components/RankBadge";
import { Button, ErrorNote, Panel } from "../components/ui";
import { formatTime, useAsync } from "../hooks/useAsync";
import { useAuth } from "../store/auth";

const RESULT: Record<string, [string, string]> = {
  WIN: ["Victoire", "text-emerald-300"],
  LOSS: ["Défaite", "text-rose-300"],
  DRAW: ["Nul", "text-slate-300"],
  DNF: ["Abandon", "text-slate-500"],
};

export function ProfilePage() {
  const { logout, setUser } = useAuth();
  const navigate = useNavigate();
  const profile = useAsync(() => api.me(), []);

  useEffect(() => {
    if (profile.data) setUser(profile.data.user);
  }, [profile.data, setUser]);

  if (profile.error) return <div className="p-6"><ErrorNote>{profile.error}</ErrorNote></div>;
  if (!profile.data) return <div className="p-6 text-slate-400">Chargement…</div>;
  const { user, stats, recentMatches } = profile.data;
  const winRate = stats.matchesPlayed ? Math.round((stats.wins / stats.matchesPlayed) * 100) : 0;
  const { next, progress } = tierProgress(user.elo);

  return (
    <>
      <PageHeader title={user.username} subtitle={`Membre depuis le ${new Date(user.createdAt).toLocaleDateString("fr-FR")}`}>
        <Button
          variant="ghost"
          onClick={() => {
            logout();
            navigate("/");
          }}
        >
          Se déconnecter
        </Button>
      </PageHeader>
      <div className="grid gap-4 p-6 lg:grid-cols-3">
        <Panel title="Classement">
          <div className="flex items-center justify-between">
            <RankBadge elo={user.elo} size="lg" />
            <span className="font-mono text-3xl font-bold text-white">{user.elo}</span>
          </div>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-800">
            <div className="h-full bg-cyan-400" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
            <Stat label="Meilleur ELO" value={user.peakElo} />
            <Stat label="Prochain rang" value={next ? next[0] + next.slice(1).toLowerCase() : "—"} />
          </dl>
        </Panel>
        <Panel title="Statistiques" className="lg:col-span-2">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Matchs ranked" value={stats.matchesPlayed} />
            <Stat label="Victoires" value={`${stats.wins} (${winRate}%)`} />
            <Stat label="Série / record" value={`${stats.currentStreak} / ${stats.bestStreak}`} />
            <Stat label="V / D / N" value={`${stats.wins} / ${stats.losses} / ${stats.draws}`} />
            <Stat label="Missions réussies" value={stats.challengesSolved} />
            <Stat label="Solve le plus rapide" value={stats.fastestSolveMs ? formatTime(stats.fastestSolveMs) : "—"} />
          </dl>
        </Panel>
        <Panel title="Historique" className="lg:col-span-3">
          {recentMatches.length === 0 ? (
            <p className="text-sm text-slate-400">
              Aucune partie pour l'instant. <Link to="/ranked" className="text-cyan-300">Lance un ranked</Link> ou une{" "}
              <Link to="/missions" className="text-cyan-300">mission</Link>.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="py-2 pr-4 font-medium">Mode</th>
                    <th className="py-2 pr-4 font-medium">Mission</th>
                    <th className="py-2 pr-4 font-medium">Adversaire</th>
                    <th className="py-2 pr-4 font-medium">Résultat</th>
                    <th className="py-2 pr-4 font-medium">Temps</th>
                    <th className="py-2 pr-4 text-right font-medium">ELO</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-lab-border">
                  {recentMatches.map((m) => {
                    const [label, color] = RESULT[m.result ?? "DNF"]!;
                    return (
                      <tr key={m.id}>
                        <td className="py-2 pr-4 text-slate-400">{m.mode === "RANKED_1V1" ? "Ranked" : "Solo"}</td>
                        <td className="py-2 pr-4">
                          <Link to={`/missions/${m.missionSlug}`} className="text-slate-200 hover:text-cyan-200">
                            {m.missionTitle}
                          </Link>
                        </td>
                        <td className="py-2 pr-4 text-slate-400">{m.opponent ?? "—"}</td>
                        <td className={`py-2 pr-4 font-medium ${color}`}>{label}</td>
                        <td className="py-2 pr-4 font-mono text-slate-300">
                          {m.completionTimeMs ? formatTime(m.completionTimeMs) : "—"}
                        </td>
                        <td
                          className={`py-2 pr-4 text-right font-mono ${
                            (m.eloDelta ?? 0) > 0 ? "text-emerald-300" : (m.eloDelta ?? 0) < 0 ? "text-rose-300" : "text-slate-500"
                          }`}
                        >
                          {m.eloDelta === null ? "—" : `${m.eloDelta > 0 ? "+" : ""}${m.eloDelta}`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 font-mono text-lg text-slate-100">{value}</dd>
    </div>
  );
}
