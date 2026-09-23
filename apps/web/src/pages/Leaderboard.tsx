import { useState } from "react";
import { api } from "../api/client";
import { PageHeader } from "../components/Layout";
import { RankBadge } from "../components/RankBadge";
import { ErrorNote, Panel } from "../components/ui";
import { formatTime, useAsync } from "../hooks/useAsync";
import { useAuth } from "../store/auth";

export function LeaderboardPage() {
  const [tab, setTab] = useState<string>("ranked");
  const missions = useAsync(() => api.missions(), []);

  return (
    <>
      <PageHeader title="Classement" subtitle="Top ELO en ranked et meilleurs temps par mission." />
      <div className="p-6">
        <div className="mb-4 flex flex-wrap gap-1">
          <Tab active={tab === "ranked"} onClick={() => setTab("ranked")}>
            Ranked 1v1
          </Tab>
          {missions.data?.map((m) => (
            <Tab key={m.slug} active={tab === m.slug} onClick={() => setTab(m.slug)}>
              {m.title}
            </Tab>
          ))}
        </div>
        {tab === "ranked" ? <RankedBoard /> : <MissionBoard slug={tab} />}
      </div>
    </>
  );
}

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-sm ${active ? "bg-cyan-400/15 text-cyan-200" : "text-slate-400 hover:text-slate-200"}`}
    >
      {children}
    </button>
  );
}

function RankedBoard() {
  const me = useAuth((s) => s.user?.username);
  const board = useAsync(() => api.rankedLeaderboard(), []);
  if (board.error) return <ErrorNote>{board.error}</ErrorNote>;
  return (
    <Panel>
      {board.data?.length === 0 && <p className="text-sm text-slate-400">Aucun match classé joué pour l'instant.</p>}
      <table className="w-full text-left text-sm">
        <tbody className="divide-y divide-lab-border">
          {board.data?.map((r) => (
            <tr key={r.username} className={r.username === me ? "bg-cyan-400/5" : undefined}>
              <td className="w-10 py-2 font-mono text-slate-500">{r.rank}</td>
              <td className="py-2 font-medium text-slate-100">{r.username}</td>
              <td className="py-2"><RankBadge elo={r.elo} size="sm" /></td>
              <td className="py-2 font-mono text-slate-400">
                {r.wins}V · {r.losses}D
              </td>
              <td className="py-2 text-right font-mono text-lg text-white">{r.elo}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

function MissionBoard({ slug }: { slug: string }) {
  const me = useAuth((s) => s.user?.username);
  const board = useAsync(() => api.missionLeaderboard(slug), [slug]);
  if (board.error) return <ErrorNote>{board.error}</ErrorNote>;
  return (
    <Panel>
      {board.data?.length === 0 && <p className="text-sm text-slate-400">Aucun temps enregistré sur cette mission.</p>}
      <table className="w-full text-left text-sm">
        <tbody className="divide-y divide-lab-border">
          {board.data?.map((r) => (
            <tr key={r.username} className={r.username === me ? "bg-cyan-400/5" : undefined}>
              <td className="w-10 py-2 font-mono text-slate-500">{r.rank}</td>
              <td className="py-2 font-medium text-slate-100">{r.username}</td>
              <td className="py-2 text-slate-500">{new Date(r.achievedAt).toLocaleDateString("fr-FR")}</td>
              <td className="py-2 text-right font-mono text-lg text-emerald-300">{formatTime(r.timeMs)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}
