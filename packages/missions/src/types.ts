import type { AssertionSet, ChallengeCategory, Difficulty, GameMode, Topology } from "@cpt/shared";

export interface MissionDefinition {
  slug: string;
  title: string;
  /** One line, shown in lists. */
  summary: string;
  /** Scenario text shown before starting. */
  briefing: string;
  difficulty: Difficulty;
  category: ChallengeCategory;
  modes: GameMode[];
  tags: string[];
  /** Seconds. */
  timeLimit: number;
  parTimeSec: number;
  topology: Topology;
  assertions: AssertionSet;
  /**
   * Reference solution (deviceId -> CLI lines typed from user EXEC mode).
   * Used by tests to prove every mission is solvable. Server-side only.
   */
  solution: Record<string, string[]>;
}
