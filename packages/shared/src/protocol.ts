/** Socket.io events for matchmaking and ranked matches. */
import type { CommandEntry, MissionDetail, PublicUser } from "./api";

export interface Opponent {
  username: string;
  elo: number;
  rankLabel: string;
}

export interface MatchFound {
  matchId: string;
  mission: MissionDetail;
  opponent: Opponent;
  /** Epoch ms. */
  startedAt: number;
  endsAt: number;
  /** Sent when reconnecting to a running match: replay to rebuild the lab. */
  replay?: CommandEntry[];
}

export interface MatchProgress {
  matchId: string;
  /** Own objective results, in objective order. */
  results: boolean[];
  /** Opponent's number of passed objectives (their details stay hidden). */
  opponentPassed: number;
  total: number;
}

export type MatchEndReason = "solved" | "timeout" | "forfeit" | "disconnect";

export interface MatchEnd {
  matchId: string;
  outcome: "win" | "loss" | "draw";
  reason: MatchEndReason;
  eloBefore: number;
  eloAfter: number;
  eloDelta: number;
  timeMs: number | null;
  user: PublicUser;
}

export interface QueueStatus {
  inQueue: boolean;
  playersInQueue: number;
  waitingSec: number;
}

export interface ServerToClientEvents {
  "queue:status": (status: QueueStatus) => void;
  "match:found": (match: MatchFound) => void;
  "match:progress": (progress: MatchProgress) => void;
  "match:end": (end: MatchEnd) => void;
  /** The match could not be saved: it is cancelled with no ELO change. */
  "match:aborted": (payload: { matchId: string; message: string }) => void;
  "error:message": (message: string) => void;
}

export interface ClientToServerEvents {
  "queue:join": () => void;
  "queue:leave": () => void;
  "match:command": (payload: { matchId: string; deviceId: string; line: string }) => void;
  "match:forfeit": (payload: { matchId: string }) => void;
}
