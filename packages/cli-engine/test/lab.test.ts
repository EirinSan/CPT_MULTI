import type { Topology } from "@cpt/shared";
import { describe, expect, it } from "vitest";
import { Lab, evaluateAssertions } from "../src";

const topology: Topology = {
  version: 1,
  devices: [
    { id: "R1", kind: "router", hostname: "R1", position: { x: 0, y: 0 } },
    { id: "R2", kind: "router", hostname: "R2", position: { x: 1, y: 0 }, startupConfig: ["interface g0/0/0", "no shutdown"] },
    { id: "PC", kind: "pc", hostname: "PC", position: { x: 2, y: 0 } },
  ],
  links: [
    { id: "wan", cable: "copper-crossover", a: { deviceId: "R1", interface: "Gi0/0/0" }, b: { deviceId: "R2", interface: "GigabitEthernet0/0/0" } },
    { id: "lan", cable: "copper-straight", a: { deviceId: "R1", interface: "GigabitEthernet0/0/1" }, b: { deviceId: "PC", interface: "eth0" } },
  ],
};

describe("Lab", () => {
  it("applies startup config silently", () => {
    const lab = new Lab(topology);
    const r2 = lab.session("R2");
    expect(r2.mode).toBe("user");
    expect(r2.history).toEqual([]);
    expect(r2.device.interfaces[0]!.adminUp).toBe(true);
  });

  it("raises the link on both ends when the second side comes up", () => {
    const lab = new Lab(topology);
    expect(lab.linkUp("wan")).toBe(false);
    for (const l of ["en", "conf t", "int g0/0/0"]) lab.execute("R1", l);
    const { output, syslog } = lab.execute("R1", "no shutdown");
    expect(output).toContain("%LINEPROTO-5-UPDOWN: Line protocol on Interface GigabitEthernet0/0/0, changed state to up");
    // R2 gets its own syslog asynchronously.
    expect(syslog.get("R2")).toContain("%LINK-3-UPDOWN: Interface GigabitEthernet0/0/0, changed state to up");
    expect(lab.linkUp("wan")).toBe(true);

    const down = lab.execute("R1", "shutdown");
    expect(down.syslog.get("R2")).toContain("%LINK-3-UPDOWN: Interface GigabitEthernet0/0/0, changed state to down");
    expect(lab.linkUp("wan")).toBe(false);
  });

  it("gives carrier from hosts, which are always on", () => {
    const lab = new Lab(topology);
    for (const l of ["en", "conf t", "int g0/0/1", "no shut"]) lab.execute("R1", l);
    expect(lab.linkUp("lan")).toBe(true);
  });

  it("only installs static routes with a reachable next hop", () => {
    const lab = new Lab(topology);
    const set = {
      all: [{ label: "static", type: "route" as const, device: "R1", prefix: "10.9.0.0/16", protocol: "static" as const, nextHop: "10.0.0.2" }],
    };
    for (const l of ["en", "conf t", "ip route 10.9.0.0 255.255.0.0 10.0.0.2"]) lab.execute("R1", l);
    expect(evaluateAssertions(lab, set)[0]!.passed).toBe(false);
    for (const l of ["int g0/0/0", "ip address 10.0.0.1 255.255.255.252", "no shut"]) lab.execute("R1", l);
    expect(evaluateAssertions(lab, set)[0]!.passed).toBe(true);
  });
});
