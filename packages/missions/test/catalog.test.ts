import { Lab, evaluateAssertions } from "@cpt/cli-engine";
import { describe, expect, it } from "vitest";
import { MISSIONS } from "../src";

describe.each(MISSIONS.map((m) => [m.slug, m] as const))("mission %s", (_slug, mission) => {
  it("is not solved at start", () => {
    const results = evaluateAssertions(new Lab(mission.topology), mission.assertions);
    expect(results.every((r) => r.passed)).toBe(false);
  });

  it("is solved by its reference solution without syntax errors", () => {
    const lab = new Lab(mission.topology);
    for (const [deviceId, lines] of Object.entries(mission.solution)) {
      for (const line of lines) lab.execute(deviceId, line);
      expect(lab.session(deviceId).syntaxErrors, `${deviceId} syntax errors`).toBe(0);
    }
    const results = evaluateAssertions(lab, mission.assertions);
    expect(results.filter((r) => !r.passed).map((r) => r.label)).toEqual([]);
  });

  it("has consistent metadata", () => {
    const ids = new Set(mission.topology.devices.map((d) => d.id));
    for (const l of mission.topology.links) {
      expect(ids.has(l.a.deviceId) && ids.has(l.b.deviceId)).toBe(true);
    }
    expect(mission.parTimeSec).toBeLessThan(mission.timeLimit);
    expect(mission.assertions.all.length).toBeGreaterThan(0);
  });
});
