import { Link } from "react-router";
import { api } from "../api/client";
import { PageHeader } from "../components/Layout";
import { CATEGORY_LABEL, DifficultyChip, ErrorNote } from "../components/ui";
import { formatDuration, formatTime, useAsync } from "../hooks/useAsync";
import { useAuth } from "../store/auth";

export function MissionsPage() {
  const user = useAuth((s) => s.user);
  const missions = useAsync(() => api.missions(), [user?.id]);

  return (
    <>
      <PageHeader
        title="Missions"
        subtitle="Scénarios chronométrés. Ce sont aussi les missions tirées au sort en ranked : entraîne-toi ici."
      />
      <div className="p-6">
        {missions.error && <ErrorNote>{missions.error}</ErrorNote>}
        {missions.loading && !missions.data && <p className="text-slate-400">Chargement…</p>}
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {missions.data?.map((m) => (
            <Link
              key={m.slug}
              to={`/missions/${m.slug}`}
              className="group flex flex-col rounded-lg border border-lab-border bg-lab-panel p-5 hover:border-slate-500"
            >
              <div className="flex items-center gap-2">
                <DifficultyChip value={m.difficulty} />
                <span className="text-xs text-slate-500">{CATEGORY_LABEL[m.category]}</span>
                {m.modes.includes("RANKED_1V1") && (
                  <span className="ml-auto text-[11px] text-cyan-300/80">Pool ranked</span>
                )}
              </div>
              <h2 className="mt-3 text-lg font-semibold text-white group-hover:text-cyan-200">{m.title}</h2>
              <p className="mt-1 flex-1 text-sm text-slate-400">{m.summary}</p>
              <div className="mt-4 flex items-center gap-4 text-xs text-slate-500">
                <span>{m.objectiveCount} objectifs</span>
                <span>Limite {formatDuration(m.timeLimit * 1000)}</span>
                {m.parTimeSec && <span>Par {formatDuration(m.parTimeSec * 1000)}</span>}
                {m.bestTimeMs != null && (
                  <span className="ml-auto font-mono text-emerald-300">✓ {formatTime(m.bestTimeMs)}</span>
                )}
              </div>
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
