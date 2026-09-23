/** Evaluates a challenge's AssertionSet against a Lab. */
import type { Assertion, AssertionResult, AssertionSet } from "@cpt/shared";
import { channelMembers, findInterface, interfaceStatus, isVirtual, parseInterfaceName } from "./device";
import { bridgeId } from "./l2";
import { runningConfig } from "./show/config";
import type { DeviceState, InterfaceState } from "./types";
import type { Lab } from "./lab";
import { maskToPrefix } from "./net";
import { computeRib } from "./rib";

const UNSUPPORTED = "non supporté par le moteur actuel";

/** "Gi0/1" or a range "Fa0/4-24" -> interfaces (empty if any is missing). */
function resolvePorts(dev: DeviceState, spec: string): InterfaceState[] {
  const m = /^([a-z-]+)((?:\d+\/)*)(\d+)-(\d+)$/i.exec(spec.replace(/\s+/g, ""));
  if (!m) {
    const one = findInterface(dev, spec);
    return one ? [one] : [];
  }
  const parsed = parseInterfaceName(`${m[1]}${m[2]}${m[3]}`);
  if (!parsed) return [];
  const out: InterfaceState[] = [];
  for (let n = Number(m[3]); n <= Number(m[4]); n++) {
    const i = dev.interfaces.find((x) => x.type === parsed.type && x.number === `${m[2]}${n}`);
    if (!i) return [];
    out.push(i);
  }
  return out;
}

/** Blocks (header + indented lines) whose header matches `section`. */
function configSections(lines: string[], section: string | undefined): string[][] {
  if (!section) return [lines];
  const re = new RegExp(section);
  const out: string[][] = [];
  let current: string[] | null = null;
  for (const l of lines) {
    if (!/^\s/.test(l)) {
      current = re.test(l) ? [l] : null;
      if (current) out.push(current);
    } else current?.push(l);
  }
  return out;
}

function check(lab: Lab, a: Assertion): { passed: boolean; detail?: string } {
  if (a.type === "ping" || a.type === "mac-entry" || a.type === "acl-blocks") {
    return { passed: false, detail: UNSUPPORTED };
  }
  const dev = lab.device(a.device);
  if (!dev) return { passed: false, detail: `équipement ${a.device} introuvable` };

  switch (a.type) {
    case "hostname":
      return { passed: dev.hostname === a.value };

    case "interface": {
      const ports = resolvePorts(dev, a.interface);
      if (ports.length === 0) return { passed: false, detail: `interface ${a.interface} introuvable` };
      for (const iface of ports) {
        if (a.status && interfaceStatus(dev, iface).status !== a.status) return { passed: false };
        if (a.ipv4) {
          const [ip, len] = a.ipv4.split("/");
          if (!iface.ipv4 || iface.ipv4.address !== ip || maskToPrefix(iface.ipv4.mask) !== Number(len)) {
            return { passed: false };
          }
        }
        if (a.mode) {
          const mode = iface.switchport ? (iface.oper.trunk ? "trunk" : "access") : "routed";
          if (mode !== a.mode) return { passed: false };
        }
      }
      return { passed: true };
    }

    case "trunk": {
      const iface = findInterface(dev, a.interface);
      if (!iface?.switchport) return { passed: false };
      const up = interfaceStatus(dev, iface).protocol === "up";
      if ((a.trunking ?? true) !== (up && iface.oper.trunk)) return { passed: false };
      if (a.nativeVlan !== undefined && iface.switchport.nativeVlan !== a.nativeVlan) return { passed: false };
      if (a.allowedVlans) {
        const allowed = iface.switchport.allowedVlans;
        if (allowed === "all" || allowed.join(",") !== [...a.allowedVlans].sort((x, y) => x - y).join(",")) {
          return { passed: false };
        }
      }
      return { passed: true };
    }

    case "stp-root": {
      const root = dev.stp.root.get(a.vlan);
      const me = bridgeId(dev, a.vlan);
      return { passed: !!root && root.mac === me.mac && root.priority === me.priority };
    }

    case "etherchannel": {
      const po = dev.interfaces.find((i) => i.type === "Port-channel" && Number(i.number) === a.group);
      if (!po || interfaceStatus(dev, po).protocol !== "up") return { passed: false };
      const members = channelMembers(dev, po).filter((m) => m.oper.bundled);
      if (members.length < (a.minMembers ?? 2)) return { passed: false };
      if (a.protocol) {
        const proto = (m: string) => (m === "active" || m === "passive" ? "lacp" : m === "on" ? "on" : "pagp");
        if (!members.every((m) => proto(m.channelGroup!.mode) === a.protocol)) return { passed: false };
      }
      return { passed: true };
    }

    case "running-config": {
      const blocks = configSections(runningConfig(dev).slice(3), a.section);
      const re = new RegExp(a.pattern);
      const hit = (b: string[]) => b.some((l) => re.test(l));
      const found = a.every ? blocks.length > 0 && blocks.every(hit) : blocks.some(hit);
      return { passed: a.absent ? !found : found };
    }

    case "vlan": {
      const vlan = dev.vlans.get(a.vlanId);
      if (!vlan) return { passed: false };
      if (a.name && vlan.name.toLowerCase() !== a.name.toLowerCase()) return { passed: false };
      if (a.accessPorts) {
        const expected = new Set(a.accessPorts.map((p) => findInterface(dev, p)?.name ?? p));
        const actual = new Set(
          dev.interfaces
            .filter((i) => !isVirtual(i) && i.switchport && !i.oper.trunk && i.switchport.accessVlan === a.vlanId)
            .map((i) => i.name),
        );
        if (expected.size !== actual.size || [...expected].some((p) => !actual.has(p))) return { passed: false };
      }
      return { passed: true };
    }

    case "route": {
      const [network, len] = a.prefix.split("/");
      const code = a.protocol === "connected" ? "C" : a.protocol === "static" ? "S" : undefined;
      const found = computeRib(dev).some(
        (r) =>
          r.network === network &&
          r.prefixLength === Number(len) &&
          (!code || r.code === code) &&
          (!a.nextHop || r.nextHop === a.nextHop) &&
          (!a.outInterface || r.outInterface === findInterface(dev, a.outInterface)?.name),
      );
      return { passed: a.absent ? !found : found };
    }
  }
}

export function evaluateAssertions(lab: Lab, set: AssertionSet): AssertionResult[] {
  return set.all.map((a) => ({ label: a.label, ...check(lab, a) }));
}
