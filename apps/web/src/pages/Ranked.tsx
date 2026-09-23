import type { MatchEnd, MatchEndReason, MatchFound, MatchProgress, QueueStatus } from "@cpt/shared";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { connectRanked, type RankedSocket } from "../api/socket";
import { PageHeader } from "../components/Layout";
import { MissionWorkspace } from "../components/MissionWorkspace";
import { RankBadge } from "../components/RankBadge";
import { Button, DifficultyChip, ErrorNote, Panel, Spinner } from "../components/ui";
import { formatDuration, formatTime, useNow } from "../hooks/useAsync";
import { useAuth } from "../store/auth";

type State =
  | { phase: "idle" }
  | { phase: "queue"; status: QueueStatus }
  | { phase: "match"; match: MatchFound; progress: MatchProgress | null }
  | { phase: "ended"; match: MatchFound; progress: MatchProgress | null; end: MatchEnd };

function reasonText(end: MatchEnd): string {
  const won = end.outcome === "win";
  const texts: Record<MatchEndReason, string> = {
    solved: won ? "Tous les objectifs validés en premier" : "Ton adversaire a validé tous les objectifs",
    timeout: "Temps écoulé : départage au nombre d'objectifs",
    forfeit: won ? "Ton adversaire a abandonné" : "Abandon",
    disconnect: won ? "Ton adversaire s'est déconnecté" : "Déconnexion",
  };
  return texts[end.reason];
}

export function RankedPage() {
  const { token, user, setUser } = useAuth();
  const socket = useRef<RankedSocket | null>(null);
  const [state, setState] = useState<State>({ phase: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!token) return;
    const s = connectRanked(token);
    socket.current = s;
    s.on("connect", () => {
      setConnected(true);
      setError(null);
    });
    s.on("disconnect", () => setConnected(false));
    s.on("connect_error", () => setError("Serveur ranked injoignable."));
    s.on("error:message", setError);
    s.on("queue:status", (status) =>
      setState((prev) =>
        status.inQueue ? { phase: "queue", status } : prev.phase === "queue" ? { phase: "idle" } : prev,
      ),
    );
    s.on("match:found", (match) => setState({ phase: "match", match, progress: null }));
    s.on("match:progress", (progress) =>
      setState((prev) =>
        (prev.phase === "match" || prev.phase === "ended") && prev.match.matchId === progress.matchId
          ? { ...prev, progress }
          : prev,
      ),
    );
    s.on("match:end", (end) => {
      setUser(end.user);
      setState((prev) =>
        prev.phase === "match" && prev.match.matchId === end.matchId
          ? { phase: "ended", match: prev.match, progress: prev.progress, end }
          : prev,
      );
    });
    s.on("match:aborted", ({ matchId, message }) => {
      setError(message);
      setState((prev) => (prev.phase === "match" && prev.match.matchId === matchId ? { phase: "idle" } : prev));
    });
    return () => {
      s.disconnect();
      socket.current = null;
    };
  }, [token, setUser]);

  const joinQueue = () => {
    setError(null);
    socket.current?.emit("queue:join");
  };

  if (state.phase === "match" || state.phase === "ended") {
    return <MatchView state={state} socket={socket.current} onRequeue={joinQueue} />;
  }

  return (
    <>
      <PageHeader title="Ranked 1v1" subtitle="Même mission, même topologie. Le premier à valider tous les objectifs gagne." />
      <div className="grid gap-4 p-6 lg:grid-cols-3">
        <Panel title="Matchmaking" className="lg:col-span-2">
          {state.phase === "queue" ? (
            <div className="flex flex-wrap items-center gap-4">
              <Spinner />
              <div>
                <p className="font-semibold text-slate-100">Recherche d'un adversaire…</p>
                <p className="text-sm text-slate-400">
                  {formatDuration(state.status.waitingSec * 1000)} · {state.status.playersInQueue} joueur(s) en file ·
                  l'écart d'ELO accepté s'élargit avec l'attente
                </p>
              </div>
              <Button variant="ghost" className="ml-auto" onClick={() => socket.current?.emit("queue:leave")}>
                Annuler
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-4">
              <Button onClick={joinQueue} disabled={!connected}>
                Rechercher un match
              </Button>
              <span className="text-sm text-slate-400">
                {connected ? "Connecté au serveur de matchs." : "Connexion au serveur…"}
              </span>
            </div>
          )}
          {error && <div className="mt-4"><ErrorNote>{error}</ErrorNote></div>}
        </Panel>
        {user && (
          <Panel title="Ton rang">
            <div className="flex items-center justify-between">
              <RankBadge elo={user.elo} size="lg" />
              <span className="font-mono text-2xl font-bold text-white">{user.elo}</span>
            </div>
          </Panel>
        )}
        <Panel title="Règles" className="lg:col-span-3">
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-300">
            <li>Une mission est tirée au sort dans le pool ranked (voir <Link to="/missions" className="text-cyan-300">Missions</Link>).</li>
            <li>Chaque commande est rejouée par le serveur sur ton propre lab : c'est lui qui valide les objectifs.</li>
            <li>Tu vois la progression de ton adversaire (nombre d'objectifs), pas sa configuration.</li>
            <li>À la fin du temps, celui qui a validé le plus d'objectifs gagne ; égalité = match nul.</li>
            <li>Quitter la page ou se déconnecter plus de 20 s compte comme un abandon.</li>
          </ul>
        </Panel>
      </div>
    </>
  );
}

function MatchView({
  state,
  socket,
  onRequeue,
}: {
  state: Extract<State, { phase: "match" | "ended" }>;
  socket: RankedSocket | null;
  onRequeue: () => void;
}) {
  const { match, progress } = state;
  const ended = state.phase === "ended";
  const now = useNow(250);
  const remaining = ended ? 0 : match.endsAt - now;
  const total = match.mission.objectives.length;
  const mine = progress?.results.filter(Boolean).length ?? 0;
  const theirs = progress?.opponentPassed ?? 0;

  const forfeit = () => {
    if (window.confirm("Abandonner ce match ? Tu perdras des points ELO.")) {
      socket?.emit("match:forfeit", { matchId: match.matchId });
    }
  };

  return (
    <>
      <PageHeader title={match.mission.title} subtitle={match.mission.briefing}>
        <div className="flex items-center gap-3">
          <DifficultyChip value={match.mission.difficulty} />
          <span
            className={`rounded-md border border-lab-border px-3 py-1 font-mono text-lg ${
              remaining < 60_000 && !ended ? "text-rose-300" : "text-slate-100"
            }`}
          >
            {formatDuration(remaining)}
          </span>
          {!ended && (
            <Button variant="danger" onClick={forfeit}>
              Abandonner
            </Button>
          )}
        </div>
      </PageHeader>
      <div className="flex min-h-0 flex-1 flex-col p-4">
        <MissionWorkspace
          key={match.matchId}
          topology={match.mission.topology}
          objectives={match.mission.objectives}
          results={progress?.results ?? null}
          replay={match.replay}
          locked={ended}
          onCommand={(deviceId, line) => socket?.emit("match:command", { matchId: match.matchId, deviceId, line })}
          aside={
            <>
              {state.phase === "ended" && <MatchResult end={state.end} onRequeue={onRequeue} />}
              <Panel title="Duel">
                <ProgressRow label="Toi" value={mine} total={total} color="bg-cyan-400" />
                <div className="mt-3" />
                <ProgressRow
                  label={
                    <span className="flex items-center gap-2">
                      {match.opponent.username} <RankBadge elo={match.opponent.elo} size="sm" />
                    </span>
                  }
                  value={theirs}
                  total={total}
                  color="bg-rose-400"
                />
              </Panel>
            </>
          }
        />
      </div>
    </>
  );
}

function ProgressRow({ label, value, total, color }: { label: React.ReactNode; value: number; total: number; color: string }) {
  return (
    <div>
      <div className="flex items-center justify-between text-sm text-slate-300">
        {label}
        <span className="font-mono text-xs text-slate-400">
          {value}/{total}
        </span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-800">
        <div className={`h-full ${color} transition-all`} style={{ width: `${(value / Math.max(total, 1)) * 100}%` }} />
      </div>
    </div>
  );
}

function MatchResult({ end, onRequeue }: { end: MatchEnd; onRequeue: () => void }) {
  const title = { win: "Victoire", loss: "Défaite", draw: "Match nul" }[end.outcome];
  const color = { win: "text-emerald-300 border-emerald-500/50", loss: "text-rose-300 border-rose-500/50", draw: "text-slate-200 border-slate-500/50" }[end.outcome];
  return (
    <Panel className={color}>
      <p className={`text-2xl font-bold ${color.split(" ")[0]}`}>{title}</p>
      <p className="mt-1 text-sm text-slate-400">
        {reasonText(end)}
        {end.timeMs !== null ? ` · ${formatTime(end.timeMs)}` : ""}
      </p>
      <div className="mt-4 flex items-center gap-3">
        <span className={`font-mono text-2xl ${end.eloDelta >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
          {end.eloDelta >= 0 ? "+" : ""}
          {end.eloDelta}
        </span>
        <span className="text-sm text-slate-400">
          {end.eloBefore} → <span className="font-mono text-slate-100">{end.eloAfter}</span>
        </span>
        <RankBadge elo={end.eloAfter} />
      </div>
      <div className="mt-4 flex gap-2">
        <Button onClick={onRequeue}>Rejouer</Button>
        <Link to="/profile" className="rounded-md border border-lab-border px-4 py-2 text-sm text-slate-200">
          Profil
        </Link>
      </div>
    </Panel>
  );
}
