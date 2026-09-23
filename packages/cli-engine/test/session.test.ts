import { describe, expect, it } from "vitest";
import { CliSession, createDevice } from "../src";

function sw() {
  return new CliSession(createDevice("switch-l2", "SW1"));
}

function router() {
  return new CliSession(createDevice("router", "R1"));
}

describe("mode navigation", () => {
  it("walks user -> privileged -> config -> config-if and back", () => {
    const s = sw();
    expect(s.prompt).toBe("SW1>");
    s.execute("enable");
    expect(s.prompt).toBe("SW1#");
    expect(s.execute("configure terminal")).toEqual([
      "Enter configuration commands, one per line.  End with CNTL/Z.",
    ]);
    expect(s.prompt).toBe("SW1(config)#");
    s.execute("interface fa0/1");
    expect(s.prompt).toBe("SW1(config-if)#");
    s.execute("exit");
    expect(s.prompt).toBe("SW1(config)#");
    s.execute("interface GigabitEthernet 0/1");
    expect(s.currentInterface?.name).toBe("GigabitEthernet0/1");
    expect(s.execute("end")).toContain("%SYS-5-CONFIG_I: Configured from console by console");
    expect(s.prompt).toBe("SW1#");
    s.execute("disable");
    expect(s.prompt).toBe("SW1>");
  });

  it("accepts unambiguous abbreviations", () => {
    const s = sw();
    s.execute("en");
    s.execute("conf t");
    expect(s.mode).toBe("config");
    s.execute("int g0/2");
    expect(s.mode).toBe("config-if");
  });

  it("drops from a sub-mode to global config on a global command", () => {
    const s = sw();
    s.execute("en");
    s.execute("conf t");
    s.execute("int fa0/1");
    s.execute("hostname CORE");
    expect(s.prompt).toBe("CORE(config)#");
  });

  it("runs exec commands with do and stays in config", () => {
    const s = sw();
    s.execute("en");
    s.execute("conf t");
    const out = s.execute("do show ip interface brief");
    expect(out[0]).toMatch(/^Interface\s+IP-Address/);
    expect(s.mode).toBe("config");
  });

  it("does not know configure in user mode", () => {
    const s = sw();
    expect(s.execute("configure terminal")).toEqual([
      "    ^".replace("    ", " ".repeat("SW1>".length)),
      "% Invalid input detected at '^' marker.",
      "",
    ]);
  });
});

describe("errors", () => {
  it("reports ambiguous abbreviations", () => {
    const s = sw();
    expect(s.execute("e")).toEqual(['% Ambiguous command:  "e"']);
  });

  it("reports incomplete commands", () => {
    const s = sw();
    s.execute("en");
    expect(s.execute("show ip")[0]).toBe("% Incomplete command.");
  });

  it("places the caret under the bad token", () => {
    const s = sw();
    s.execute("en");
    const out = s.execute("show ipx");
    expect(out[0]).toBe(" ".repeat("SW1#show ".length) + "^");
    expect(s.syntaxErrors).toBe(1);
  });

  it("treats a lone unknown word as a hostname", () => {
    expect(sw().execute("foo")[0]).toBe('Translating "foo"...domain server (255.255.255.255)');
  });
});

describe("help and completion", () => {
  it("lists commands for `?`", () => {
    const s = sw();
    const out = s.help("");
    expect(out.some((l) => /^\s+enable\s+Turn on privileged commands$/.test(l))).toBe(true);
    expect(out.some((l) => l.trim().startsWith("configure"))).toBe(false);
  });

  it("lists matching keywords for a partial word", () => {
    const s = sw();
    s.execute("en");
    expect(s.help("con")).toEqual(["configure"]);
  });

  it("shows <cr> when the command is complete", () => {
    const s = sw();
    s.execute("en");
    expect(s.help("show ip interface brief ")).toEqual(["  <cr>"]);
  });

  it("completes keywords with Tab", () => {
    const s = sw();
    s.execute("en");
    expect(s.complete("conf")).toBe("configure ");
    expect(s.complete("sh ip int b")).toBe("sh ip int brief ");
    expect(s.complete("xyz")).toBeNull();
    s.execute("conf t");
    expect(s.complete("do sh")).toBe("do show ");
  });

  it("does not offer switch commands on a router", () => {
    const s = router();
    s.execute("en");
    s.execute("conf t");
    expect(s.help("vl")).toEqual(["% Unrecognized command"]);
  });
});

describe("interface configuration", () => {
  it("configures an IP and brings the interface up with syslog", () => {
    const s = router();
    s.execute("en");
    s.execute("conf t");
    s.execute("int g0/0/0");
    expect(s.execute("ip address 10.0.1.1 255.255.255.0")).toEqual([]);
    const out = s.execute("no shutdown");
    expect(out).toContain("%LINK-5-CHANGED: Interface GigabitEthernet0/0/0, changed state to down");
    const plug = s.setCarrier("GigabitEthernet0/0/0", true);
    expect(plug).toContain("%LINK-3-UPDOWN: Interface GigabitEthernet0/0/0, changed state to up");
    expect(plug).toContain(
      "%LINEPROTO-5-UPDOWN: Line protocol on Interface GigabitEthernet0/0/0, changed state to up",
    );
    s.execute("end");
    const route = s.execute("show ip route");
    expect(route).toContain("C        10.0.1.0/24 is directly connected, GigabitEthernet0/0/0");
    expect(route).toContain("L        10.0.1.1/32 is directly connected, GigabitEthernet0/0/0");
  });

  it("rejects network addresses and overlaps", () => {
    const s = router();
    s.execute("en");
    s.execute("conf t");
    s.execute("int g0/0/0");
    expect(s.execute("ip address 10.0.1.0 255.255.255.0")).toEqual(["Bad mask /24 for address 10.0.1.0"]);
    s.execute("ip address 10.0.1.1 255.255.255.0");
    s.execute("int g0/0/1");
    expect(s.execute("ip address 10.0.1.2 255.255.0.0")).toEqual(["% 10.0.0.0 overlaps with GigabitEthernet0/0/0"]);
  });

  it("refuses IP addresses on L2 ports", () => {
    const s = sw();
    s.execute("en");
    s.execute("conf t");
    s.execute("int fa0/1");
    expect(s.execute("ip address 10.0.0.1 255.255.255.0")).toEqual([
      "% IP addresses may not be configured on L2 links.",
    ]);
  });

  it("keeps free text descriptions intact", () => {
    const s = sw();
    s.execute("en");
    s.execute("conf t");
    s.execute("int fa0/3");
    s.execute("description  Uplink to  R1 ");
    expect(s.device.interfaces.find((i) => i.name === "FastEthernet0/3")?.description).toBe("Uplink to  R1");
  });
});

describe("vlans", () => {
  it("creates vlans, names them and assigns access ports", () => {
    const s = sw();
    s.execute("en");
    s.execute("conf t");
    s.execute("vlan 10");
    expect(s.prompt).toBe("SW1(config-vlan)#");
    s.execute("name SALES");
    s.execute("int fa0/2");
    s.execute("switchport mode access");
    s.execute("switchport access vlan 10");
    expect(s.execute("switchport access vlan 20")).toEqual(["% Access VLAN does not exist. Creating vlan 20"]);
    s.execute("end");
    const out = s.execute("show vlan brief");
    expect(out.find((l) => l.startsWith("10 "))).toBe(`10   ${"SALES".padEnd(33)}active`);
    expect(out.find((l) => l.startsWith("20 "))).toBe(`20   ${"VLAN0020".padEnd(33)}active    Fa0/2`);
    expect(out.find((l) => l.startsWith("1 "))).not.toContain("Fa0/2,");
  });

  it("brings an SVI up when an access port in its vlan comes up", () => {
    const s = sw();
    s.execute("en");
    s.execute("conf t");
    s.execute("int vlan 1");
    s.execute("ip address 192.168.1.2 255.255.255.0");
    s.execute("no shut");
    const out = s.setCarrier("FastEthernet0/1", true);
    expect(out).toContain("%LINEPROTO-5-UPDOWN: Line protocol on Interface Vlan1, changed state to up");
  });
});

describe("running-config", () => {
  it("reflects the configuration and can be saved", () => {
    const s = sw();
    s.execute("en");
    s.execute("conf t");
    s.execute("hostname ACCESS-1");
    s.execute("int fa0/5");
    s.execute("shutdown");
    s.execute("end");
    const cfg = s.execute("show running-config");
    expect(cfg).toContain("hostname ACCESS-1");
    const i = cfg.indexOf("interface FastEthernet0/5");
    expect(cfg.slice(i, i + 4)).toContain(" shutdown");
    expect(s.execute("show startup-config")).toEqual(["startup-config is not present"]);
    expect(s.execute("write memory")).toEqual(["Building configuration...", "[OK]"]);
    expect(s.execute("show startup-config")[1]).toBe("Current configuration:");
  });
});
