import { describe, expect, it } from "vitest";
import { parseCommandLog, solveTimeMs } from "../src/services/missions";
import { record } from "./helpers";

const topology = record("premiers-pas").detail.topology;

describe("solo solve time", () => {
  it("drops negative or non-finite command timestamps", () => {
    const log = parseCommandLog(
      [
        { deviceId: "SW1", line: "enable", t: -5000 },
        { deviceId: "SW1", line: "end", t: Number.NaN },
      ],
      topology,
    );
    expect(log.map((c) => c.t)).toEqual([0, 0]);
  });

  it("never records a negative time", () => {
    expect(solveTimeMs(-1_000_000_000, [{ deviceId: "SW1", line: "end", t: 0 }], 300)).toBe(0);
    expect(solveTimeMs(Number.NEGATIVE_INFINITY, [], 300)).toBe(0);
    expect(solveTimeMs("12", [], 300)).toBe(0);
  });

  it("uses the later of the reported time and the last command, capped at the limit", () => {
    expect(solveTimeMs(4000, [{ deviceId: "SW1", line: "end", t: 6000 }], 300)).toBe(6000);
    expect(solveTimeMs(9000, [{ deviceId: "SW1", line: "end", t: 6000 }], 300)).toBe(9000);
    expect(solveTimeMs(999_999, [], 300)).toBe(300_000);
  });
});
