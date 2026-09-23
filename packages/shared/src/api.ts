/** REST DTOs shared by apps/server and apps/web. */
import type { RankTier } from "./rating";
import type { Topology } from "./topology";

export type Difficulty = "EASY" | "MEDIUM" | "HARD" | "EXPERT";
export type ChallengeCategory = "SWITCHING" | "ROUTING" | "SECURITY" | "SERVICES" | "TROUBLESHOOTING";
export type GameMode = "RANKED_1V1" | "SPEEDRUN" | "CTF" | "CASUAL";
export type MatchResult = "WIN" | "LOSS" | "DRAW" | "DNF";

export interface PublicUser {
  id: string;
  username: string;
  elo: number;
  peakElo: number;
  rankTier: RankTier;
  rankLabel: string;
  createdAt: string;
}

export interface UserStatsDto {
  matchesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  currentStreak: number;
  bestStreak: number;
  challengesSolved: number;
  fastestSolveMs: number | null;
}

export interface AuthResponse {
  token: string;
  user: PublicUser;
}

export interface MatchHistoryItem {
  id: string;
  mode: GameMode;
  missionTitle: string;
  missionSlug: string;
  result: MatchResult | null;
  eloDelta: number | null;
  completionTimeMs: number | null;
  opponent: string | null;
  endedAt: string | null;
}

export interface ProfileResponse {
  user: PublicUser;
  stats: UserStatsDto;
  recentMatches: MatchHistoryItem[];
}

export interface MissionObjective {
  label: string;
}

export interface MissionSummary {
  slug: string;
  title: string;
  summary: string;
  difficulty: Difficulty;
  category: ChallengeCategory;
  modes: GameMode[];
  timeLimit: number;
  parTimeSec: number | null;
  objectiveCount: number;
  /** Only when authenticated. */
  bestTimeMs?: number | null;
}

export interface MissionDetail extends MissionSummary {
  briefing: string;
  topology: Topology;
  objectives: MissionObjective[];
}

export interface CommandEntry {
  deviceId: string;
  line: string;
  /** ms since the mission started (client clock, informative). */
  t: number;
}

export interface EvaluateResponse {
  results: boolean[];
  solved: boolean;
}

export interface AttemptResponse extends EvaluateResponse {
  timeMs: number;
  bestTimeMs: number | null;
  personalBest: boolean;
}

export interface LeaderboardRow {
  rank: number;
  username: string;
  elo: number;
  rankLabel: string;
  wins: number;
  losses: number;
}

export interface MissionLeaderboardRow {
  rank: number;
  username: string;
  timeMs: number;
  achievedAt: string;
}
