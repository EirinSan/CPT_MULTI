import { missionBySlug } from "@cpt/missions";
import type { MissionRecord } from "../src/services/missions";
import type { QueueEntry } from "../src/realtime/matchmaking";

export function record(slug: string): MissionRecord {
  const m = missionBySlug(slug)!;
  return {
    id: slug,
    version: 1,
    assertions: m.assertions,
    detail: {
      slug,
      title: m.title,
      summary: m.summary,
      briefing: m.briefing,
      difficulty: m.difficulty,
      category: m.category,
      modes: m.modes,
      timeLimit: m.timeLimit,
      parTimeSec: m.parTimeSec,
      objectiveCount: m.assertions.all.length,
      topology: m.topology,
      objectives: m.assertions.all.map((a) => ({ label: a.label })),
    },
  };
}

export function entry(userId: string, elo: number, joinedAt = 0): QueueEntry {
  return { userId, username: userId, elo, gamesPlayed: 10, joinedAt };
}
