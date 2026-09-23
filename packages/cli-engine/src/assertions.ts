/** Evaluates a challenge's AssertionSet against a Lab. */
import type { Assertion, AssertionResult, AssertionSet } from "@cpt/shared";
import { interfaceStatus, isVirtual } from "./device";
import { findInterface, type Lab } from "./lab";
import { maskToPrefix } from "./net";
import { computeRib } from "./rib";

const UNSUPPORTED = "non supporté par le moteur actuel";

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
      const iface = findInterface(dev, a.interface);
      if (!iface) return { passed: false, detail: `interface ${a.interface} introuvable` };
      if (a.status && interfaceStatus(dev, iface).status !== a.status) return { passed: false };
      if (a.ipv4) {
        const [ip, len] = a.ipv4.split("/");
        if (!iface.ipv4 || iface.ipv4.address !== ip || maskToPrefix(iface.ipv4.mask) !== Number(len)) {
          return { passed: false };
        }
      }
      if (a.mode) {
        const mode = iface.switchport ? iface.switchport.mode : "routed";
        if (mode !== a.mode) return { passed: false };
      }
      return { passed: true };
    }

    case "vlan": {
      const vlan = dev.vlans.get(a.vlanId);
      if (!vlan) return { passed: false };
      if (a.name && vlan.name.toLowerCase() !== a.name.toLowerCase()) return { passed: false };
      if (a.accessPorts) {
        const expected = new Set(a.accessPorts.map((p) => findInterface(dev, p)?.name ?? p));
        const actual = new Set(
          dev.interfaces
            .filter((i) => !isVirtual(i) && i.switchport?.mode === "access" && i.switchport.accessVlan === a.vlanId)
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
