import { missionBySlug } from "@cpt/missions";
import { describe, expect, it } from "vitest";
import { MatchRoom } from "../src/realtime/match-room";
import { replay } from "../src/services/missions";
import { entry, record } from "./helpers";

function room() {
  return new MatchRoom("m1", record("premiers-pas"), [entry("alice", 1000), entry("bob", 1000)], 0);
}

describe("MatchRoom", () => {
  it("first player to satisfy every assertion wins", () => {
    const r = room();
    for (const line of missionBySlug("premiers-pas")!.solution.SW1!) r.applyCommand("alice", "SW1", line, 1000);
    expect(r.outcome).toEqual({ winnerId: "alice", reason: "solved" });
    expect(r.player("alice")!.solvedAt).toBe(1000);
    // Commands after the end are ignored.
    expect(r.applyCommand("bob", "SW1", "enable", 2000)).toBe(false);
  });

  it("keeps each player's lab separate", () => {
    const r = room();
    r.applyCommand("alice", "SW1", "enable", 1);
    r.applyCommand("alice", "SW1", "conf t", 2);
    r.applyCommand("alice", "SW1", "hostname SW-ACCES", 3);
    expect(MatchRoom.passed(r.player("alice")!)).toBe(1);
    expect(MatchRoom.passed(r.player("bob")!)).toBe(0);
  });

  it("rejects unknown devices and oversized lines", () => {
    const r = room();
    expect(r.applyCommand("alice", "PC1", "enable", 1)).toBe(false);
    expect(r.applyCommand("alice", "SW1", "x".repeat(1000), 1)).toBe(false);
    expect(r.applyCommand("mallory", "SW1", "enable", 1)).toBe(false);
  });

  it("decides timeouts on objectives passed", () => {
    const r = room();
    for (const l of ["enable", "conf t", "hostname SW-ACCES"]) r.applyCommand("bob", "SW1", l, 1);
    expect(r.timeout()).toEqual({ winnerId: "bob", reason: "timeout" });
    expect(room().timeout()).toEqual({ winnerId: null, reason: "timeout" });
  });

  it("gives the win to the opponent on forfeit", () => {
    expect(room().forfeit("alice", "forfeit")).toEqual({ winnerId: "bob", reason: "forfeit" });
  });
});

describe("replay", () => {
  it("validates a command log server-side", () => {
    const mission = record("routes-statiques");
    const solution = missionBySlug("routes-statiques")!.solution;
    const commands = Object.entries(solution).flatMap(([deviceId, lines]) =>
      lines.map((line, t) => ({ deviceId, line, t })),
    );
    expect(replay(mission, commands)).toEqual({ results: [true, true, true, true], solved: true, syntaxErrors: 0 });
    expect(replay(mission, commands.slice(0, 5)).solved).toBe(false);
  });
});
