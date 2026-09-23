import type {
  AttemptResponse,
  AuthResponse,
  CommandEntry,
  EvaluateResponse,
  LeaderboardRow,
  MissionDetail,
  MissionLeaderboardRow,
  MissionSummary,
  ProfileResponse,
} from "@cpt/shared";
import { useAuth } from "../store/auth";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = useAuth.getState().token;
  const res = await fetch(`/api${path}`, {
    method: init.method ?? "GET",
    headers: {
      ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    if (res.status === 401 && token) useAuth.getState().logout();
    throw new ApiError(res.status, data.error ?? `Erreur ${res.status}`);
  }
  return data as T;
}

export const api = {
  register: (username: string, password: string) =>
    request<AuthResponse>("/auth/register", { method: "POST", body: { username, password } }),
  login: (username: string, password: string) =>
    request<AuthResponse>("/auth/login", { method: "POST", body: { username, password } }),
  me: () => request<ProfileResponse>("/me"),
  missions: () => request<MissionSummary[]>("/missions"),
  mission: (slug: string) => request<MissionDetail>(`/missions/${slug}`),
  evaluate: (slug: string, commands: CommandEntry[]) =>
    request<EvaluateResponse>(`/missions/${slug}/evaluate`, { method: "POST", body: { commands } }),
  submitAttempt: (slug: string, commands: CommandEntry[], durationMs: number) =>
    request<AttemptResponse>(`/missions/${slug}/attempts`, { method: "POST", body: { commands, durationMs } }),
  missionLeaderboard: (slug: string) => request<MissionLeaderboardRow[]>(`/missions/${slug}/leaderboard`),
  rankedLeaderboard: () => request<LeaderboardRow[]>("/leaderboards/ranked"),
};
