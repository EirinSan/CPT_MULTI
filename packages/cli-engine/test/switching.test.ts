import type { Topology } from "@cpt/shared";
import { describe, expect, it } from "vitest";
import { CliSession, Lab, commandCatalog, createDevice } from "../src";

const at = { x: 0, y: 0 };
const link = (id: string, a: string, ai: string, b: string, bi: string) => ({
  id,
  cable: "copper-crossover" as const,
  a: { deviceId: a, interface: ai },
  b: { deviceId: b, interface: bi },
});

/** SW1 - SW2 - SW3 triangle, PC1 on SW1 Fa0/1, PC2 on SW2 Fa0/1. */
function triangle(): Lab {
  const topo: Topology = {
    version: 1,
    devices: [
      { id: "SW1", kind: "switch-l2", hostname: "SW1", position: at },
      { id: "SW2", kind: "switch-l2", hostname: "SW2", position: at },
      { id: "SW3", kind: "switch-l2", hostname: "SW3", position: at },
      { id: "PC1", kind: "pc", hostname: "PC1", position: at },
      { id: "PC2", kind: "pc", hostname: "PC2", position: at },
    ],
    links: [
      link("l12", "SW1", "Gi0/1", "SW2", "Gi0/1"),
      link("l23", "SW2", "Gi0/2", "SW3", "Gi0/1"),
      link("l31", "SW3", "Gi0/2", "SW1", "Gi0/2"),
      link("p1", "SW1", "Fa0/1", "PC1", "eth0"),
      link("p2", "SW2", "Fa0/1", "PC2", "eth0"),
    ],
  };
  return new Lab(topo);
}

function run(lab: Lab, dev: string, ...lines: string[]): string[] {
  return lines.flatMap((l) => lab.execute(dev, l).output);
}

function sw(): CliSession {
  const s = new CliSession(createDevice("switch-l2", "SW1"));
  s.execute("enable");
  s.execute("configure terminal");
  return s;
}

describe("passwords and login", () => {
  it("asks for the enable secret with 3 attempts", () => {
    const s = sw();
    s.execute("enable secret cisco123");
    s.execute("end");
    s.execute("disable");
    s.execute("enable");
    expect(s.prompt).toBe("Password: ");
    expect(s.pending?.secret).toBe(true);
    expect(s.execute("wrong")).toEqual([]);
    s.execute("wrong");
    expect(s.execute("wrong")).toEqual(["% Bad secrets", ""]);
    expect(s.prompt).toBe("SW1>");
    s.execute("enable");
    s.execute("cisco123");
    expect(s.prompt).toBe("SW1#");
    expect(s.execute("show running-config | include enable")[0]).toMatch(/^enable secret 9 \$9\$\S+\$\S+$/);
  });

  it("encrypts line passwords as type 7 and reads them back", () => {
    const s = sw();
    s.execute("line console 0");
    expect(s.prompt).toBe("SW1(config-line)#");
    s.execute("password cisco");
    s.execute("login");
    s.execute("service password-encryption");
    const line = s.execute("do show run | include password 7")[0]!;
    expect(line).toMatch(/^ password 7 [0-9A-F]+$/);
    const copy = new CliSession(createDevice("switch-l2", "X"));
    copy.loadConfig(s.runningConfigLines());
    expect(copy.device.lines.console.password).toBe("cisco");
  });

  it("requires the console password after logout", () => {
    const s = sw();
    s.execute("banner motd #Acces reserve#");
    s.execute("line con 0");
    s.execute("password cisco");
    s.execute("login");
    s.execute("end");
    const bye = s.execute("exit");
    expect(bye).toContain("Press RETURN to get started.");
    const login = s.execute("");
    expect(login).toContain("Acces reserve");
    expect(login).toContain("User Access Verification");
    expect(s.prompt).toBe("Password: ");
    s.execute("cisco");
    expect(s.prompt).toBe("SW1>");
  });

  it("supports login local with usernames", () => {
    const s = sw();
    s.execute("username admin privilege 15 secret S3cret");
    s.execute("line console 0");
    s.execute("login local");
    s.execute("end");
    s.execute("exit");
    s.execute("");
    expect(s.prompt).toBe("Username: ");
    s.execute("admin");
    s.execute("S3cret");
    expect(s.prompt).toBe("SW1#");
  });

  it("collects multi-line banners", () => {
    const s = sw();
    expect(s.execute("banner motd $")).toEqual(["Enter TEXT message.  End with the character '$'."]);
    s.execute("Ligne 1");
    s.execute("Ligne 2$");
    expect(s.device.banners.motd).toBe("Ligne 1\nLigne 2");
  });
});

describe("SSH", () => {
  it("needs a hostname and domain before generating keys", () => {
    const s = new CliSession(createDevice("switch-l2"));
    s.execute("en");
    s.execute("conf t");
    expect(s.execute("crypto key generate rsa")).toEqual(["% Please define a hostname other than Switch."]);
    s.execute("hostname SW1");
    expect(s.execute("crypto key generate rsa")).toEqual(["% Please define a domain-name first."]);
    s.execute("ip domain-name lab.local");
    s.execute("crypto key generate rsa");
    expect(s.prompt).toBe("How many bits in the modulus [512]: ");
    expect(s.execute("1024")).toContain("% Generating 1024 bit RSA keys, keys will be non-exportable...");
    expect(s.execute("ip ssh version 2")).toEqual([]);
    s.execute("line vty 0 15");
    s.execute("transport input ssh");
    s.execute("login local");
    expect(s.execute("do show ip ssh")[0]).toBe("SSH Enabled - version 2.0");
    expect(s.execute("do show run | section vty")).toEqual([
      "line vty 0 4",
      " login local",
      " transport input ssh",
      "line vty 5 15",
      " login local",
      " transport input ssh",
    ]);
  });
});

describe("interface range and filters", () => {
  it("configures several ports at once", () => {
    const s = sw();
    s.execute("interface range fa0/1 - 4 , fa0/10");
    expect(s.prompt).toBe("SW1(config-if-range)#");
    s.execute("switchport mode access");
    expect(s.execute("switchport access vlan 30")).toEqual(Array(5).fill("% Access VLAN does not exist. Creating vlan 30").slice(0, 1));
    s.execute("end");
    const row = s.execute("show vlan brief | include ^30")[0]!;
    expect(row).toContain("Fa0/1, Fa0/2, Fa0/3, Fa0/4");
    expect(s.execute("show vlan brief").some((l) => l.includes("Fa0/10"))).toBe(true);
  });

  it("supports include / exclude / begin / section / count", () => {
    const s = sw();
    s.execute("end");
    expect(s.execute("show running-config | include hostname")).toEqual(["hostname SW1"]);
    expect(s.execute("show running-config | count interface")).toEqual(["Number of lines which match regexp = 27"]);
    expect(s.execute("show running-config | begin line con")[0]).toBe("line con 0");
    expect(s.execute("sh run | sec interface Vlan1")).toEqual(["interface Vlan1", " no ip address", " shutdown"]);
    expect(s.help("show run | ")).toHaveLength(5);
  });
});

describe("DTP and trunks", () => {
  it("negotiates a trunk between 'trunk' and 'dynamic auto'", () => {
    const lab = triangle();
    run(lab, "SW1", "en", "conf t", "int g0/1", "switchport mode trunk", "end");
    const trunk = run(lab, "SW2", "en", "show interfaces trunk");
    expect(trunk.join("\n")).toMatch(/Gi0\/1\s+auto\s+802\.1q\s+trunking\s+1/);
    expect(run(lab, "SW2", "show interfaces gi0/2 switchport")[3]).toBe("Operational Mode: static access");
  });

  it("stays access between two 'dynamic auto' ports", () => {
    const lab = triangle();
    expect(run(lab, "SW1", "en", "show interfaces trunk")).toEqual([]);
  });

  it("logs a native VLAN mismatch", () => {
    const lab = triangle();
    run(lab, "SW1", "en", "conf t", "int g0/1", "switchport mode trunk");
    const out = run(lab, "SW1", "switchport trunk native vlan 99");
    expect(out.join("\n")).toContain("%CDP-4-NATIVE_VLAN_MISMATCH: Native VLAN mismatch discovered on GigabitEthernet0/1 (99), with SW2 GigabitEthernet0/1 (1).");
  });

  it("rejects trunk mode while encapsulation is negotiate on an L3 switch", () => {
    const s = new CliSession(createDevice("switch-l3", "DSW1"));
    s.execute("en");
    s.execute("conf t");
    s.execute("int g0/1");
    expect(s.execute("switchport mode trunk")[0]).toMatch(/^Command rejected: An interface whose trunk encapsulation is "Auto"/);
    s.execute("switchport trunk encapsulation dot1q");
    expect(s.execute("switchport mode trunk")).toEqual([]);
  });
});

describe("spanning tree", () => {
  it("elects a root and blocks exactly one port of the triangle", () => {
    const lab = triangle();
    for (const d of ["SW1", "SW2", "SW3"]) run(lab, d, "en", "conf t", "int range g0/1 - 2", "switchport mode trunk", "end");
    run(lab, "SW3", "conf t", "spanning-tree vlan 1 priority 4096", "end");
    expect(run(lab, "SW3", "show spanning-tree vlan 1").join("\n")).toContain("This bridge is the root");
    const blocked = ["SW1", "SW2", "SW3"].flatMap((d) => run(lab, d, "show spanning-tree vlan 1").filter((l) => /Altn BLK/.test(l)));
    expect(blocked).toHaveLength(1);
    const sw1 = run(lab, "SW1", "show spanning-tree vlan 1").join("\n");
    expect(sw1).toContain("Root ID    Priority    4097");
    expect(sw1).toMatch(/Gi0\/2\s+Root FWD 4/);
    expect(run(lab, "SW3", "show spanning-tree summary")[1]).toBe("Root bridge for: VLAN0001");
  });

  it("err-disables a port with BPDU guard facing another switch", () => {
    const lab = triangle();
    const out = run(lab, "SW1", "en", "conf t", "int g0/2", "spanning-tree bpduguard enable");
    expect(out).toContain("%SPANTREE-2-BLOCK_BPDUGUARD: Received BPDU on port GigabitEthernet0/2 with BPDU Guard enabled. Disabling port.");
    expect(run(lab, "SW1", "do show interfaces status | include Gi0/2")[0]).toContain("err-disabled");
    // The far end loses its link.
    expect(lab.linkUp("l31")).toBe(false);
    run(lab, "SW1", "no spanning-tree bpduguard", "shutdown", "no shutdown");
    expect(lab.linkUp("l31")).toBe(true);
  });
});

describe("port security", () => {
  it("learns a sticky MAC into the running-config", () => {
    const lab = triangle();
    expect(run(lab, "SW1", "en", "conf t", "int fa0/1", "switchport port-security")).toContain("Command rejected: FastEthernet0/1 is a dynamic port.");
    run(lab, "SW1", "switchport mode access", "switchport port-security", "switchport port-security mac-address sticky");
    const pc1 = lab.nodes.get("PC1")!.hostMac!;
    expect(run(lab, "SW1", "do show run int fa0/1")).toContain(` switchport port-security mac-address sticky ${pc1}`);
    expect(run(lab, "SW1", "do show port-security int fa0/1")[1]).toBe("Port Status                : Secure-up");
  });

  it("shuts the port down on violation", () => {
    const lab = triangle();
    run(lab, "SW1", "en", "conf t", "int fa0/1", "switchport mode access", "switchport port-security mac-address 0000.1111.2222");
    const out = run(lab, "SW1", "switchport port-security");
    expect(out.join("\n")).toMatch(/%PORT_SECURITY-2-PSECURE_VIOLATION: Security violation occurred, caused by MAC address \S+ on port FastEthernet0\/1\./);
    expect(run(lab, "SW1", "do show port-security")[3]).toMatch(/Fa0\/1\s+1\s+1\s+1\s+Shutdown/);
    expect(lab.linkUp("p1")).toBe(false);
  });
});

describe("MAC learning, CDP, VTP", () => {
  it("learns hosts across the switched network", () => {
    const lab = triangle();
    for (const d of ["SW1", "SW2", "SW3"]) run(lab, d, "en", "conf t", "int range g0/1 - 2", "switchport mode trunk", "end");
    const pc1 = lab.nodes.get("PC1")!.hostMac!;
    expect(run(lab, "SW1", "show mac address-table dynamic").join("\n")).toMatch(new RegExp(`1\\s+${pc1}\\s+DYNAMIC\\s+Fa0/1`));
    expect(run(lab, "SW2", "show mac address-table").join("\n")).toContain(pc1);
    expect(run(lab, "SW3", "show mac address-table").join("\n")).toContain(pc1);
  });

  it("lists CDP neighbors", () => {
    const lab = triangle();
    const out = run(lab, "SW1", "en", "show cdp neighbors");
    expect(out.join("\n")).toMatch(/SW2\s+Gig 0\/1\s+165\s+S I\s+WS-C2960-\s+Gig 0\/1/);
    expect(out.at(-1)).toBe("Total cdp entries displayed : 2");
    run(lab, "SW1", "conf t", "no cdp run", "end");
    expect(run(lab, "SW1", "show cdp neighbors")).toEqual(["% CDP is not enabled"]);
  });

  it("propagates VLANs from a VTP server to a client", () => {
    const lab = triangle();
    run(lab, "SW1", "en", "conf t", "vtp domain LAB", "int g0/1", "switchport mode trunk", "exit", "vlan 10", "name VENTES", "end");
    run(lab, "SW2", "en", "conf t", "vtp mode client", "end");
    expect(run(lab, "SW2", "show vlan brief").join("\n")).toMatch(/10\s+VENTES\s+active/);
    expect(run(lab, "SW2", "show vtp status").join("\n")).toMatch(/VTP Domain Name\s+: LAB/);
    expect(run(lab, "SW2", "conf t", "vlan 20")).toContain("VTP VLAN configuration not allowed when device is in CLIENT mode.");
  });
});

describe("EtherChannel", () => {
  const pair = (ma: string, mb: string) => {
    const lab = new Lab({
      version: 1,
      devices: [
        { id: "A", kind: "switch-l2", hostname: "A", position: at },
        { id: "B", kind: "switch-l2", hostname: "B", position: at },
      ],
      links: [link("x", "A", "Fa0/23", "B", "Fa0/23"), link("y", "A", "Fa0/24", "B", "Fa0/24")],
    });
    run(lab, "A", "en", "conf t", "int range fa0/23 - 24", "switchport mode trunk", `channel-group 1 mode ${ma}`, "end");
    run(lab, "B", "en", "conf t", "int range fa0/23 - 24", "switchport mode trunk", `channel-group 1 mode ${mb}`, "end");
    return lab;
  };

  it("bundles LACP active/passive", () => {
    const lab = pair("active", "passive");
    const out = run(lab, "A", "show etherchannel summary");
    expect(out.at(-1)).toMatch(/^1\s+Po1\(SU\)\s+LACP\s+Fa0\/23\(P\)\s+Fa0\/24\(P\)$/);
    // One logical link: no blocked port.
    expect(run(lab, "B", "show spanning-tree vlan 1").some((l) => l.includes("BLK"))).toBe(false);
  });

  it("does not bundle passive/passive", () => {
    const lab = pair("passive", "passive");
    expect(run(lab, "A", "show etherchannel summary").at(-1)).toMatch(/Po1\(SD\)/);
  });
});

describe("files and reload", () => {
  it("restores the startup-config and keeps VLANs in vlan.dat", () => {
    const s = sw();
    s.execute("hostname SAVED");
    s.execute("vlan 42");
    s.execute("end");
    expect(s.execute("write memory")).toEqual(["Building configuration...", "[OK]"]);
    s.execute("conf t");
    s.execute("hostname CHANGED");
    s.execute("end");
    s.execute("reload");
    expect(s.prompt).toBe("System configuration has been modified. Save? [yes/no]: ");
    s.execute("no");
    expect(s.prompt).toBe("Proceed with reload? [confirm]");
    expect(s.execute("")).toContain("Press RETURN to get started.");
    s.execute("");
    expect(s.prompt).toBe("SAVED>");
    expect(s.device.vlans.has(42)).toBe(true);
  });

  it("forgets VLANs once vlan.dat is deleted", () => {
    const s = sw();
    s.execute("vlan 42");
    s.execute("end");
    s.execute("delete flash:vlan.dat");
    s.execute("");
    s.execute("");
    s.execute("reload");
    s.execute("no");
    s.execute("");
    expect(s.device.vlans.has(42)).toBe(false);
  });

  it("round-trips a rich running-config through loadConfig", () => {
    const s = sw();
    for (const l of [
      "hostname CORE",
      "enable secret cisco",
      "username admin privilege 15 secret admin",
      "service password-encryption",
      "ip domain-name lab.local",
      "no ip domain-lookup",
      "ip default-gateway 10.0.0.1",
      "spanning-tree mode rapid-pvst",
      "spanning-tree vlan 10,20 priority 8192",
      "spanning-tree portfast default",
      "vtp mode transparent",
      "vlan 10",
      "name USERS",
      "vlan 20",
      "interface fa0/1",
      "description Poste 1",
      "switchport mode access",
      "switchport access vlan 10",
      "switchport port-security",
      "switchport port-security maximum 2",
      "switchport port-security violation restrict",
      "spanning-tree bpduguard enable",
      "interface g0/1",
      "switchport mode trunk",
      "switchport trunk native vlan 99",
      "switchport trunk allowed vlan 10,20,99",
      "interface vlan 10",
      "ip address 10.0.10.2 255.255.255.0",
      "no shutdown",
      "line con 0",
      "password console",
      "login",
      "logging synchronous",
      "exec-timeout 5 0",
      "line vty 0 4",
      "login local",
      "transport input ssh",
      "banner motd #Hello#",
    ]) {
      const errors = s.execute(l).filter((x) => /^%/.test(x) && !/^(% Access VLAN|%Warning|%LINK|%LINEPROTO)/.test(x));
      expect(errors, l).toEqual([]);
    }
    const cfg = s.runningConfigLines();
    const copy = new CliSession(createDevice("switch-l2", "Switch", "SW1"), { seed: "SW1" });
    copy.loadConfig(cfg);
    expect(copy.runningConfigLines()).toEqual(cfg);
  });
});

describe("catalog", () => {
  it("documents the command set from the grammar", () => {
    const iface = commandCatalog("switch-l2", "config-if").map((e) => e.syntax);
    expect(iface).toContain("switchport port-security maximum <1-8192>");
    expect(iface).toContain("channel-group <1-48> mode <active|passive|on|desirable|auto>");
    const exec = commandCatalog("switch-l2", "privileged").map((e) => e.syntax);
    expect(exec).toContain("show interfaces <interface> switchport");
    expect(commandCatalog("router", "config").map((e) => e.syntax)).not.toContain("vlan <WORD>");
  });
});
