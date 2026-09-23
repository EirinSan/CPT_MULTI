/**
 * Authoritative state of one ranked match. Each player has their own Lab on
 * the server; every command is replayed here and objectives are evaluated
 * with the hidden assertions. Pure (no I/O) so it can be unit tested.
 */
import { Lab, evaluateAssertions } from "@cpt/cli-engine";
import type { CommandEntry, MatchEndReason } from "@cpt/shared";
import { config } from "../config";
import type { MissionRecord } from "../services/missions";
import type { QueueEntry } from "./matchmaking";

export interface RoomPlayer {
  entry: QueueEntry;
  lab: Lab;
  commands: CommandEntry[];
  results: boolean[];
  solvedAt: number | null;
}

export interface MatchOutcome {
  /** null = draw. */
  winnerId: string | null;
  reason: MatchEndReason;
}

export class MatchRoom {
  readonly players: [RoomPlayer, RoomPlayer];
  readonly endsAt: number;
  outcome: MatchOutcome | null = null;
  private readonly consoles: Set<string>;

  constructor(
    readonly id: string,
    readonly mission: MissionRecord,
    entries: [QueueEntry, QueueEntry],
    readonly startedAt: number,
  ) {
    const topology = mission.detail.topology;
    this.consoles = new Set(topology.devices.filter((d) => d.kind !== "pc" && d.kind !== "server").map((d) => d.id));
    const make = (entry: QueueEntry): RoomPlayer => {
      const lab = new Lab(topology);
      return { entry, lab, commands: [], results: this.evaluate(lab), solvedAt: null };
    };
    this.players = [make(entries[0]), make(entries[1])];
    this.endsAt = startedAt + mission.detail.timeLimit * 1000;
  }

  player(userId: string): RoomPlayer | undefined {
    return this.players.find((p) => p.entry.userId === userId);
  }

  opponent(userId: string): RoomPlayer | undefined {
    return this.players.find((p) => p.entry.userId !== userId);
  }

  static passed(p: RoomPlayer): number {
    return p.results.filter(Boolean).length;
  }

  /**
   * Replays one command for a player. Returns false if the command was
   * rejected (match over, unknown device, oversized line).
   */
  applyCommand(userId: string, deviceId: string, line: string, now: number): boolean {
    const p = this.player(userId);
    if (!p || this.outcome || now > this.endsAt) return false;
    if (!this.consoles.has(deviceId) || typeof line !== "string" || line.length > config.maxLineLength) return false;
    if (p.commands.length >= config.maxCommands) return false;
    p.commands.push({ deviceId, line, t: now - this.startedAt });
    p.lab.execute(deviceId, line);
    p.results = this.evaluate(p.lab);
    if (p.solvedAt === null && p.results.every(Boolean)) {
      p.solvedAt = now;
      this.outcome = { winnerId: userId, reason: "solved" };
    }
    return true;
  }

  /** Ends the match on timeout: most objectives wins, equal = draw. */
  timeout(): MatchOutcome {
    if (this.outcome) return this.outcome;
    const [a, b] = this.players;
    const pa = MatchRoom.passed(a);
    const pb = MatchRoom.passed(b);
    this.outcome = { winnerId: pa === pb ? null : pa > pb ? a.entry.userId : b.entry.userId, reason: "timeout" };
    return this.outcome;
  }

  forfeit(userId: string, reason: "forfeit" | "disconnect"): MatchOutcome {
    if (this.outcome) return this.outcome;
    this.outcome = { winnerId: this.opponent(userId)!.entry.userId, reason };
    return this.outcome;
  }

  private evaluate(lab: Lab): boolean[] {
    return evaluateAssertions(lab, this.mission.assertions).map((r) => r.passed);
  }
}
