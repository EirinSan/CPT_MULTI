/**
 * A CLI session attached to one device: the mode state machine
 *
 *   user (>) --enable--> privileged (#) --configure terminal--> config (config)#
 *      ^                   |      ^                               |     |
 *      +----disable--------+      +------------end / exit---------+     |
 *                                 +-----end---- config-if / config-vlan <+
 *
 * The session is UI-agnostic: it takes a line, returns output lines. The
 * terminal (xterm.js) is plugged in through LineDiscipline.
 */
import { commandTreeFor } from "./commands";
import { interfaceStatus } from "./device";
import { complete, help, parse, tokenize, type CommandTree, type Node, type ParseResult } from "./grammar";
import type { CliMode, DeviceState, InterfaceState } from "./types";

export interface CommandContext {
  session: CliSession;
  device: DeviceState;
  print: (...lines: string[]) => void;
}

const CONFIG_MODES = new Set<CliMode>(["config", "config-if", "config-vlan"]);
const SUB_MODES = new Set<CliMode>(["config-if", "config-vlan"]);
const HISTORY_SIZE = 20;

interface Target {
  root: Node;
  /** Line to parse against `root`. */
  text: string;
  /** Offset of `text` inside the original line. */
  offset: number;
  prefix: string;
  isDo: boolean;
}

type Status = ReturnType<typeof interfaceStatus>;

export interface CliSessionOptions {
  /** Override the command tree (tests, custom NOS flavours). */
  tree?: CommandTree;
  now?: () => number;
}

export class CliSession {
  mode: CliMode = "user";
  currentInterface: InterfaceState | null = null;
  currentVlan: number | null = null;
  readonly history: string[] = [];
  /** Number of commands rejected by the parser (feeds speedrun penalties). */
  syntaxErrors = 0;

  private readonly tree: CommandTree;
  private readonly now: () => number;
  private readonly bootedAt: number;

  constructor(
    readonly device: DeviceState,
    opts: CliSessionOptions = {},
  ) {
    this.tree = opts.tree ?? commandTreeFor(device.kind);
    this.now = opts.now ?? Date.now;
    this.bootedAt = this.now();
  }

  get prompt(): string {
    const h = this.device.hostname;
    switch (this.mode) {
      case "user":
        return `${h}>`;
      case "privileged":
        return `${h}#`;
      case "config":
        return `${h}(config)#`;
      case "config-if":
        return `${h}(config-if)#`;
      case "config-vlan":
        return `${h}(config-vlan)#`;
    }
  }

  uptime(): string {
    const minutes = Math.floor((this.now() - this.bootedAt) / 60000);
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h} hours, ${m} minutes`;
  }

  /** Execute one line and return the output to display. */
  execute(line: string): string[] {
    const out: string[] = [];
    if (line.trim() === "") return out;
    this.pushHistory(line.trim());

    const promptLength = this.prompt.length;
    const target = this.resolve(line);
    let result: ParseResult = parse(target.root, target.text);

    // In a sub-mode (config-if...), global config commands are accepted too
    // and drop the session back to global config, as on IOS.
    let fellBack = false;
    if (!result.ok && !target.isDo && SUB_MODES.has(this.mode)) {
      const alt = parse(this.tree.root("config"), line);
      if (alt.ok) {
        result = alt;
        fellBack = true;
      }
    }

    if (!result.ok) {
      this.syntaxErrors++;
      out.push(...this.formatError(result, line, target, promptLength));
      return out;
    }

    const before = this.snapshotStatuses();
    const ctx: CommandContext = {
      session: this,
      device: this.device,
      print: (...lines) => out.push(...lines),
    };
    if (fellBack) {
      this.mode = "config";
      this.currentInterface = null;
      this.currentVlan = null;
    }
    if (target.isDo) {
      // Run the exec command as if in privileged mode, keep current mode.
      const saved = { mode: this.mode, iface: this.currentInterface, vlan: this.currentVlan };
      this.mode = "privileged";
      result.handler(ctx, result.args);
      this.mode = saved.mode;
      this.currentInterface = saved.iface;
      this.currentVlan = saved.vlan;
    } else {
      result.handler(ctx, result.args);
    }
    out.push(...this.statusChanges(before));
    return out;
  }

  /** `?` help. `line` is the text typed before the question mark. */
  help(line: string): string[] {
    const target = this.resolve(line);
    return help(target.root, target.text);
  }

  /** Tab completion; null means "nothing to complete" (ring the bell). */
  complete(line: string): string | null {
    const target = this.resolve(line);
    const done = complete(target.root, target.text);
    if (done !== null) return target.prefix + done;
    if (!target.isDo && SUB_MODES.has(this.mode)) return complete(this.tree.root("config"), line);
    return null;
  }

  /**
   * Called by the simulation engine when a cable is plugged/unplugged or the
   * peer changes state. Returns the syslog lines to print on the console.
   */
  setCarrier(interfaceName: string, carrier: boolean): string[] {
    const iface = this.device.interfaces.find((i) => i.name === interfaceName);
    if (!iface || iface.carrier === carrier) return [];
    const before = this.snapshotStatuses();
    iface.carrier = carrier;
    return this.statusChanges(before);
  }

  private resolve(line: string): Target {
    const execRoot = this.tree.root(this.mode);
    if (CONFIG_MODES.has(this.mode)) {
      const m = /^(\s*do\s+)/i.exec(line);
      if (m) {
        const prefix = m[1]!;
        return {
          root: this.tree.root("privileged"),
          text: line.slice(prefix.length),
          offset: prefix.length,
          prefix,
          isDo: true,
        };
      }
    }
    return { root: execRoot, text: line, offset: 0, prefix: "", isDo: false };
  }

  private formatError(
    result: Exclude<ParseResult, { ok: true }>,
    line: string,
    target: Target,
    promptLength: number,
  ): string[] {
    switch (result.error) {
      case "invalid": {
        const tokens = tokenize(target.text);
        const isExec = this.mode === "user" || this.mode === "privileged";
        if (isExec && tokens.length === 1 && result.offset === tokens[0]!.start) {
          // IOS treats an unknown single word as a hostname to telnet to.
          return [
            `Translating "${tokens[0]!.text}"...domain server (255.255.255.255)`,
            "% Unknown command or computer name, or unable to find computer address",
          ];
        }
        return [
          " ".repeat(promptLength + target.offset + result.offset) + "^",
          "% Invalid input detected at '^' marker.",
          "",
        ];
      }
      case "ambiguous":
        return [`% Ambiguous command:  "${line.trim()}"`];
      case "incomplete":
        return ["% Incomplete command.", ""];
    }
  }

  private pushHistory(line: string): void {
    this.history.push(line);
    if (this.history.length > HISTORY_SIZE) this.history.shift();
  }

  private snapshotStatuses(): Map<InterfaceState, Status> {
    return new Map(this.device.interfaces.map((i) => [i, interfaceStatus(this.device, i)]));
  }

  /** Syslog messages for every interface whose line/protocol state changed. */
  private statusChanges(before: Map<InterfaceState, Status>): string[] {
    const out: string[] = [];
    for (const iface of this.device.interfaces) {
      const prev = before.get(iface) ?? { status: "administratively down", protocol: "down" };
      const next = interfaceStatus(this.device, iface);
      if (prev.status !== next.status) {
        if (next.status === "administratively down") {
          out.push(`%LINK-5-CHANGED: Interface ${iface.name}, changed state to administratively down`);
        } else if (next.status === "up" || prev.status === "up") {
          out.push(`%LINK-3-UPDOWN: Interface ${iface.name}, changed state to ${next.status}`);
        } else {
          out.push(`%LINK-5-CHANGED: Interface ${iface.name}, changed state to ${next.status}`);
        }
      }
      if (prev.protocol !== next.protocol) {
        out.push(`%LINEPROTO-5-UPDOWN: Line protocol on Interface ${iface.name}, changed state to ${next.protocol}`);
      }
    }
    return out.length ? ["", ...out] : out;
  }
}
