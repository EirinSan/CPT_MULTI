/**
 * Declarative assertions evaluated against the simulated network state to
 * decide whether a challenge is solved. Stored as JSON in
 * `Challenge.targetStateAssertions`.
 */

export type Assertion =
  | {
      type: "route";
      device: string;
      prefix: string; // "10.0.2.0/24"
      nextHop?: string;
      outInterface?: string;
      protocol?: "connected" | "static" | "ospf" | "eigrp" | "rip";
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
    }
  | {
      type: "vlan";
      device: string;
      vlanId: number;
      name?: string;
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
    };

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
  assertion: Assertion;
  passed: boolean;
  detail?: string;
}
