import { describe, expect, it } from "vitest";
import { eloWindow, findPairs } from "../src/realtime/matchmaking";
import { entry } from "./helpers";

describe("matchmaking", () => {
  it("widens the window with waiting time", () => {
    expect(eloWindow(0)).toBe(100);
    expect(eloWindow(10_000)).toBe(350);
    expect(eloWindow(10_000_000)).toBe(1000);
  });

  it("pairs close ratings immediately", () => {
    const pairs = findPairs([entry("a", 1000), entry("b", 1050)], 0);
    expect(pairs.map((p) => p.map((e) => e.userId))).toEqual([["a", "b"]]);
  });

  it("waits before pairing distant ratings", () => {
    const q = [entry("a", 1000), entry("b", 1400)];
    expect(findPairs(q, 1000)).toEqual([]);
    expect(findPairs(q, 13_000)).toHaveLength(1);
  });

  it("prefers the closest opponent and never pairs a player twice", () => {
    const q = [entry("a", 1000, 0), entry("b", 1090, 1), entry("c", 1010, 2)];
    const pairs = findPairs(q, 5);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.map((e) => e.userId)).toEqual(["a", "c"]);
  });
});
