/**
 * Declarative assertions evaluated against the simulated network state to
 * decide whether a challenge is solved. Stored as JSON in
 * `Challenge.targetStateAssertions` and never sent to clients: players only
 * see each assertion's `label`.
 */

interface AssertionBase {
  /** Objective shown to the player, e.g. "Le VLAN 10 s'appelle VENTES". */
  label: string;
}

export type Assertion = AssertionBase &
  (
    | {
        type: "hostname";
        device: string;
        value: string;
      }
    | {
        type: "route";
        device: string;
        prefix: string; // "10.0.2.0/24"
        nextHop?: string;
        outInterface?: string;
        protocol?: "connected" | "static" | "ospf" | "eigrp" | "rip";
        /** Passes when the route is NOT installed (cleanup objectives). */
        absent?: boolean;
      }
    | {
        type: "ping";
        from: string;
        to: string; // device id or IPv4 address
        /** Maximum tolerated loss, 0 by default. */
        maxLossPercent?: number;
      }
    | {
        type: "interface";
        device: string;
        interface: string;
        status?: "up" | "down" | "administratively down";
        ipv4?: string; // "10.0.1.1/24"
        mode?: "access" | "trunk" | "routed";
      }
    | {
        type: "vlan";
        device: string;
        vlanId: number;
        name?: string;
        /** Exact set of access ports in this VLAN (short or full names). */
        accessPorts?: string[];
      }
    | {
        type: "mac-entry";
        device: string;
        mac: string;
        vlanId: number;
        port: string;
      }
    | {
        type: "acl-blocks";
        from: string;
        to: string;
        protocol: "icmp" | "tcp" | "udp";
        port?: number;
      }
  );

export type AssertionType = Assertion["type"];

export interface AssertionSet {
  /** Every assertion must pass for the challenge to be solved. */
  all: Assertion[];
  /**
   * Penalty rules used by speedrun mode, e.g. unused config lines.
   * Optional: absent means no penalty.
   */
  penalties?: {
    perSyntaxErrorSeconds?: number;
    perUselessCommandSeconds?: number;
  };
}

export interface AssertionResult {
  label: string;
  passed: boolean;
  detail?: string;
}
