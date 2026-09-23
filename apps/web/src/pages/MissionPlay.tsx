import type { AttemptResponse, CommandEntry, MissionDetail } from "@cpt/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { api } from "../api/client";
import { PageHeader } from "../components/Layout";
import { MissionWorkspace } from "../components/MissionWorkspace";
import { ObjectiveList } from "../components/ObjectiveList";
import { Button, CATEGORY_LABEL, DifficultyChip, ErrorNote, Panel } from "../components/ui";
import { formatDuration, formatTime, useAsync, useNow } from "../hooks/useAsync";
import { useAuth } from "../store/auth";

type Phase = "briefing" | "playing" | "solved" | "timeout";

export function MissionPlayPage() {
  const { slug = "" } = useParams();
  const mission = useAsync(() => api.mission(slug), [slug]);

  if (mission.error) return <div className="p-6"><ErrorNote>{mission.error}</ErrorNote></div>;
  if (!mission.data) return <div className="p-6 text-slate-400">Chargement…</div>;
  return <MissionRun key={slug} mission={mission.data} />;
}

function MissionRun({ mission }: { mission: MissionDetail }) {
  const user = useAuth((s) => s.user);
  const [phase, setPhase] = useState<Phase>("briefing");
  const [run, setRun] = useState(0);
  const [results, setResults] = useState<boolean[] | null>(null);
  const [attempt, setAttempt] = useState<AttemptResponse | null>(null);
  const [solveMs, setSolveMs] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const startedAt = useRef(0);
  const commands = useRef<CommandEntry[]>([]);
  const evalTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const evalSeq = useRef(0);
  const now = useNow(250);
  const elapsed = phase === "playing" ? now - startedAt.current : (solveMs ?? 0);
  const limitMs = mission.timeLimit * 1000;

  const start = () => {
    commands.current = [];
    startedAt.current = Date.now();
    setResults(null);
    setAttempt(null);
    setSolveMs(null);
    setError(null);
    setRun((r) => r + 1);
    setPhase("playing");
  };

  useEffect(() => {
    if (phase === "playing" && elapsed > limitMs) setPhase("timeout");
  }, [phase, elapsed, limitMs]);

  useEffect(() => () => {
    if (evalTimer.current) clearTimeout(evalTimer.current);
  }, []);

  const finish = useCallback(
    async (log: CommandEntry[]) => {
      const time = log.at(-1)?.t ?? 0;
      setSolveMs(time);
      setPhase("solved");
      if (!user) return;
      try {
        setAttempt(await api.submitAttempt(mission.slug, log, time));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [mission.slug, user],
  );

  const onCommand = (deviceId: string, line: string) => {
    commands.current.push({ deviceId, line, t: Date.now() - startedAt.current });
    if (evalTimer.current) clearTimeout(evalTimer.current);
    // Debounced: the server replays the whole log and checks the objectives.
    evalTimer.current = setTimeout(async () => {
      const seq = ++evalSeq.current;
      const log = [...commands.current];
      try {
        const res = await api.evaluate(mission.slug, log);
        if (seq !== evalSeq.current) return;
        setResults(res.results);
        if (res.solved) void finish(log);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }, 350);
  };

  const header = (
    <PageHeader title={mission.title} subtitle={mission.summary}>
      <div className="flex items-center gap-3">
        <DifficultyChip value={mission.difficulty} />
        <span className="text-xs text-slate-500">{CATEGORY_LABEL[mission.category]}</span>
        {phase !== "briefing" && (
          <span
            className={`rounded-md border border-lab-border px-3 py-1 font-mono text-lg ${
              phase === "solved" ? "text-emerald-300" : limitMs - elapsed < 60_000 ? "text-rose-300" : "text-slate-100"
            }`}
          >
            {phase === "solved" ? formatTime(elapsed) : formatDuration(elapsed)}
            <span className="text-xs text-slate-500"> / {formatDuration(limitMs)}</span>
          </span>
        )}
      </div>
    </PageHeader>
  );

  if (phase === "briefing") {
    return (
      <>
        {header}
        <div className="grid gap-4 p-6 lg:grid-cols-3">
          <Panel title="Briefing" className="lg:col-span-2">
            <p className="leading-relaxed text-slate-300">{mission.briefing}</p>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Button onClick={start}>Démarrer la mission</Button>
              <span className="text-xs text-slate-500">
                Chrono lancé au démarrage · limite {formatDuration(limitMs)}
                {mission.parTimeSec ? ` · par ${formatDuration(mission.parTimeSec * 1000)}` : ""}
              </span>
            </div>
            {!user && (
              <p className="mt-4 text-sm text-slate-400">
                <Link to="/login" className="text-cyan-300">Connecte-toi</Link> pour enregistrer ton temps.
              </p>
            )}
          </Panel>
          <Panel title="Objectifs">
            <ObjectiveList objectives={mission.objectives} results={null} />
          </Panel>
          <MissionBoard slug={mission.slug} />
        </div>
      </>
    );
  }

  return (
    <>
      {header}
      <div className="flex min-h-0 flex-1 flex-col p-4">
        <MissionWorkspace
          key={run}
          topology={mission.topology}
          objectives={mission.objectives}
          results={results}
          onCommand={onCommand}
          locked={phase !== "playing"}
          aside={
            <>
              {phase === "solved" && (
                <Panel className="border-emerald-500/50">
                  <p className="text-lg font-semibold text-emerald-300">Mission réussie</p>
                  <p className="mt-1 font-mono text-3xl text-white">{formatTime(solveMs ?? 0)}</p>
                  {attempt && (
                    <p className="mt-1 text-sm text-slate-400">
                      {attempt.personalBest ? "Nouveau record personnel !" : `Record : ${formatTime(attempt.bestTimeMs ?? 0)}`}
                    </p>
                  )}
                  {!user && <p className="mt-1 text-sm text-slate-400">Temps non enregistré (non connecté).</p>}
                  <div className="mt-4 flex gap-2">
                    <Button onClick={start}>Rejouer</Button>
                    <Link to="/missions" className="rounded-md border border-lab-border px-4 py-2 text-sm text-slate-200">
                      Missions
                    </Link>
                  </div>
                </Panel>
              )}
              {phase === "timeout" && (
                <Panel className="border-rose-500/50">
                  <p className="text-lg font-semibold text-rose-300">Temps écoulé</p>
                  <div className="mt-4 flex gap-2">
                    <Button onClick={start}>Réessayer</Button>
                  </div>
                </Panel>
              )}
              {error && <ErrorNote>{error}</ErrorNote>}
            </>
          }
        />
      </div>
    </>
  );
}

function MissionBoard({ slug }: { slug: string }) {
  const board = useAsync(() => api.missionLeaderboard(slug), [slug]);
  return (
    <Panel title="Meilleurs temps" className="lg:col-span-3">
      {board.data && board.data.length > 0 ? (
        <ol className="grid gap-1 text-sm sm:grid-cols-2 lg:grid-cols-5">
          {board.data.slice(0, 10).map((r) => (
            <li key={r.username} className="flex items-center gap-2">
              <span className="w-5 text-right font-mono text-slate-500">{r.rank}</span>
              <span className="text-slate-200">{r.username}</span>
              <span className="ml-auto font-mono text-emerald-300 lg:ml-2">{formatTime(r.timeMs)}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-slate-400">Personne n'a encore réussi cette mission. Sois le premier.</p>
      )}
    </Panel>
  );
}
