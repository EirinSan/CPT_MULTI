/**
 * A CLI session attached to one device: the mode state machine
 *
 *   user (>) --enable--> privileged (#) --configure terminal--> config (config)#
 *      ^                   |      ^                               |
 *      +----disable--------+      +------------end / exit---------+
 *                                 +---end--- config-if / config-if-range /
 *                                            config-vlan / config-line
 *
 * The session is UI-agnostic: it takes a line, returns output lines. Some
 * commands ask a follow-up question (passwords, [confirm]...): they set
 * `pending`, and the next line typed answers it.
 */
import { commandTreeFor } from "./commands";
import { createDevice, interfaceStatus, type LinkStatus } from "./device";
import { complete, help, parse, tokenize, type CommandTree, type Node, type ParseResult } from "./grammar";
import { computeL2 } from "./l2";
import { verifySecret } from "./passwords";
import { runningConfig } from "./show/config";
import type { CliMode, DeviceState, InterfaceState } from "./types";

export interface CommandContext {
  session: CliSession;
  device: DeviceState;
  print: (...lines: string[]) => void;
}

/** A question waiting for the next input line. */
export interface PendingInput {
  prompt: string;
  /** Do not echo what is typed (passwords). */
  secret: boolean;
  /** `?` and Tab are plain characters while answering. */
  handle: (input: string) => string[];
}

export const CONFIG_MODES = new Set<CliMode>(["config", "config-if", "config-if-range", "config-vlan", "config-line"]);
const SUB_MODES = new Set<CliMode>(["config-if", "config-if-range", "config-vlan", "config-line"]);
const HISTORY_SIZE = 20;

const FILTERS = [
  ["begin", "Begin with the line that matches"],
  ["count", "Count number of lines which match regexp"],
  ["exclude", "Exclude lines that match"],
  ["include", "Include lines that match"],
  ["section", "Filter a section of output"],
] as const;

interface Target {
  root: Node;
  /** Line to parse against `root`. */
  text: string;
  /** Offset of `text` inside the original line. */
  offset: number;
  prefix: string;
  isDo: boolean;
}

export interface CliSessionOptions {
  /** Override the command tree (tests, custom NOS flavours). */
  tree?: CommandTree;
  now?: () => number;
  /** Seed for stable MAC addresses across reloads. */
  seed?: string;
}

export class CliSession {
  mode: CliMode = "user";
  /** Interfaces being configured (one in config-if, several in config-if-range). */
  currentInterfaces: InterfaceState[] = [];
  currentVlan: number | null = null;
  currentLines: { kind: "console" | "vty"; from: number; to: number } | null = null;
  readonly history: string[] = [];
  /** Number of commands rejected by the parser (feeds speedrun penalties). */
  syntaxErrors = 0;
  pending: PendingInput | null = null;
  /** Set by a Lab: L2 state is then computed across all devices. */
  attachedToLab = false;

  private readonly tree: CommandTree;
  private readonly now: () => number;
  private bootedAt: number;
  readonly seed: string;

  constructor(
    public device: DeviceState,
    opts: CliSessionOptions = {},
  ) {
    this.tree = opts.tree ?? commandTreeFor(device.kind);
    this.now = opts.now ?? Date.now;
    this.bootedAt = this.now();
    this.seed = opts.seed ?? device.hostname;
    this.refreshStandalone();
  }

  get currentInterface(): InterfaceState | null {
    return this.currentInterfaces[0] ?? null;
  }

  set currentInterface(i: InterfaceState | null) {
    this.currentInterfaces = i ? [i] : [];
  }

  get prompt(): string {
    if (this.pending) return this.pending.prompt;
    const h = this.device.hostname;
    switch (this.mode) {
      case "user":
        return `${h}>`;
      case "privileged":
        return `${h}#`;
      default:
        return `${h}(${this.mode})#`;
    }
  }

  /** Current wall clock as seen by the device (`clock set` shifts it). */
  clock(): Date {
    return new Date(this.now() + this.device.clockOffsetMs);
  }

  uptime(): string {
    const minutes = Math.floor((this.now() - this.bootedAt) / 60000);
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h} hours, ${m} minutes`;
  }

  /** Execute one line and return the output to display. */
  execute(line: string): string[] {
    if (this.pending) {
      const p = this.pending;
      this.pending = null;
      const out = p.handle(line);
      this.refreshStandalone();
      return out;
    }
    const out: string[] = [];
    if (line.trim() === "") return out;
    this.pushHistory(line.trim());

    const promptLength = this.prompt.length;
    const { command, filter, filterOffset } = splitPipe(line);
    const target = this.resolve(command);
    let result: ParseResult = parse(target.root, target.text);

    // In a sub-mode (config-if...), global config commands are accepted too
    // and drop the session back to global config, as on IOS.
    let fellBack = false;
    if (!result.ok && !target.isDo && SUB_MODES.has(this.mode)) {
      const alt = parse(this.tree.root("config"), command);
      if (alt.ok) {
        result = alt;
        fellBack = true;
      }
    }

    if (!result.ok) {
      this.syntaxErrors++;
      out.push(...this.formatError(result, command, target, promptLength));
      return out;
    }

    let applyFilter: ((lines: string[]) => string[]) | null = null;
    if (filter !== null) {
      applyFilter = parseFilter(filter);
      if (!applyFilter) {
        this.syntaxErrors++;
        return [" ".repeat(promptLength + filterOffset) + "^", "% Invalid input detected at '^' marker.", ""];
      }
    }

    const before = this.snapshotStatuses();
    const produced: string[] = [];
    const ctx: CommandContext = {
      session: this,
      device: this.device,
      print: (...lines) => produced.push(...lines),
    };
    if (fellBack) this.exitSubMode("config");
    if (target.isDo) {
      // Run the exec command as if in privileged mode, keep current mode.
      const saved = { mode: this.mode, ifs: this.currentInterfaces, vlan: this.currentVlan, lines: this.currentLines };
      this.mode = "privileged";
      result.handler(ctx, result.args);
      if (this.mode === "privileged") this.mode = saved.mode;
      this.currentInterfaces = saved.ifs;
      this.currentVlan = saved.vlan;
      this.currentLines = saved.lines;
    } else {
      result.handler(ctx, result.args);
    }
    out.push(...(applyFilter ? applyFilter(produced) : produced));
    this.refreshStandalone();
    out.push(...this.statusChanges(before));
    return out;
  }

  /** `?` help. `line` is the text typed before the question mark. */
  help(line: string): string[] {
    const pipe = line.indexOf("|");
    if (pipe !== -1) {
      const after = line.slice(pipe + 1);
      if (after.trim() === "") return FILTERS.map(([w, h]) => `  ${w.padEnd(8)}  ${h}`);
      if (/^\s*\S+\s+$/.test(after)) return ["  LINE  Regular Expression"];
      const partial = after.trim().toLowerCase();
      const words = FILTERS.filter(([w]) => w.startsWith(partial)).map(([w]) => w);
      return words.length ? [words.join("  ")] : ["% Unrecognized command"];
    }
    const target = this.resolve(line);
    return help(target.root, target.text);
  }

  /** Tab completion; null means "nothing to complete" (ring the bell). */
  complete(line: string): string | null {
    if (line.includes("|")) return null;
    const target = this.resolve(line);
    const done = complete(target.root, target.text);
    if (done !== null) return target.prefix + done;
    if (!target.isDo && SUB_MODES.has(this.mode)) return complete(this.tree.root("config"), line);
    return null;
  }

  /**
   * Standalone use (no lab): plug/unplug a cable on a port. Returns the
   * syslog lines to print on the console.
   */
  setCarrier(interfaceName: string, carrier: boolean): string[] {
    const iface = this.device.interfaces.find((i) => i.name === interfaceName);
    if (!iface || iface.carrier === carrier) return [];
    const before = this.snapshotStatuses();
    iface.carrier = carrier;
    this.refreshStandalone();
    return this.statusChanges(before);
  }

  exitSubMode(to: CliMode): void {
    this.mode = to;
    this.currentInterfaces = [];
    this.currentVlan = null;
    this.currentLines = null;
  }

  /** Ask a question; the next line typed is passed to `handle`. */
  ask(prompt: string, handle: (input: string) => string[], secret = false): void {
    this.pending = { prompt, secret, handle };
  }

  /**
   * Password prompt with IOS retry semantics (3 attempts). `check` returns
   * true when the password is right.
   */
  askPassword(check: (pw: string) => boolean, onSuccess: () => string[], failure: string, attempts = 3): void {
    this.ask(
      "Password: ",
      (pw) => {
        if (check(pw)) return onSuccess();
        if (attempts > 1) this.askPassword(check, onSuccess, failure, attempts - 1);
        return attempts > 1 ? [] : [failure, ""];
      },
      true,
    );
  }

  /** Console login sequence (after logout / reload). */
  consoleStart(): string[] {
    const dev = this.device;
    const out: string[] = [];
    if (dev.banners.motd) out.push(...dev.banners.motd.split("\n"));
    const con = dev.lines.console;
    this.mode = "user";
    if (con.login === "line") {
      if (!con.password) {
        out.push("", "Password required, but none set", "");
        return [...out, ...this.pressReturn()];
      }
      out.push("", "User Access Verification", "");
      this.askPassword(
        (pw) => pw === con.password,
        () => (dev.banners.exec ? dev.banners.exec.split("\n") : []),
        "% Bad passwords",
      );
      return out;
    }
    if (con.login === "local") {
      out.push("", "User Access Verification", "");
      this.ask("Username: ", (username) => {
        const user = dev.users.get(username);
        this.askPassword(
          (pw) => !!user && (user.secret ? verifySecret(pw, user.secret) : user.password === pw),
          () => {
            if (user && user.privilege >= 15) this.mode = "privileged";
            return [];
          },
          "% Login invalid",
        );
        return [];
      });
      return out;
    }
    return out;
  }

  /** "Press RETURN to get started." then the console login sequence. */
  pressReturn(): string[] {
    this.ask("", () => this.consoleStart());
    return [`${this.device.hostname} con0 is now available`, "", "", "", "", "", "Press RETURN to get started."];
  }

  /** Apply configuration lines as if pasted in global config mode. */
  loadConfig(lines: string[]): void {
    const saved = { mode: this.mode, errors: this.syntaxErrors, history: [...this.history] };
    this.mode = "config";
    for (const line of lines) this.execute(line);
    this.pending = null;
    this.exitSubMode(saved.mode);
    this.syntaxErrors = saved.errors;
    this.history.splice(0, this.history.length, ...saved.history);
  }

  /** Reboot: running-config is replaced by startup-config. */
  reboot(): string[] {
    const old = this.device;
    const dev = createDevice(old.kind, undefined, this.seed);
    if (old.vlanDat) {
      dev.vlans = old.vlans;
      dev.vtp = old.vtp;
    }
    dev.startupConfig = old.startupConfig;
    dev.clockOffsetMs = old.clockOffsetMs;
    this.device = dev;
    this.bootedAt = this.now();
    this.exitSubMode("user");
    if (dev.startupConfig) this.loadConfig(dev.startupConfig);
    this.refreshStandalone();
    return [
      "",
      "System Bootstrap, Version 15.0(2r)EZ, RELEASE SOFTWARE",
      `${dev.model} starting...`,
      "Loading flash:/ios.bin...",
      dev.startupConfig ? "" : "--- System Configuration Dialog ---",
      "",
      ...this.pressReturn(),
    ];
  }

  runningConfigLines(): string[] {
    return runningConfig(this.device).slice(2);
  }

  private refreshStandalone(): void {
    if (this.attachedToLab) return;
    computeL2(new Map([["self", { id: "self", kind: this.device.kind, device: this.device, hostMac: null }]]), []);
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
          if (!this.device.domainLookup) {
            return [`Translating "${tokens[0]!.text}"`, "% Unknown command or computer name, or unable to find computer address"];
          }
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

  snapshotStatuses(): Map<InterfaceState, LinkStatus> {
    return new Map(this.device.interfaces.map((i) => [i, interfaceStatus(this.device, i)]));
  }

  /** Syslog messages for every interface whose line/protocol state changed. */
  statusChanges(before: Map<InterfaceState, LinkStatus>): string[] {
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

// ---------------------------------------------------------------------------
// Output filters: show ... | include/exclude/begin/section/count REGEX
// ---------------------------------------------------------------------------

function splitPipe(line: string): { command: string; filter: string | null; filterOffset: number } {
  // Only `show` output can be filtered; elsewhere "|" is plain text.
  if (!/^\s*(do\s+)?sh(o|ow)?\s/i.test(line)) return { command: line, filter: null, filterOffset: 0 };
  const i = line.indexOf("|");
  if (i === -1) return { command: line, filter: null, filterOffset: 0 };
  const after = line.slice(i + 1);
  return { command: line.slice(0, i), filter: after, filterOffset: i + 1 + (after.length - after.trimStart().length) };
}

function toRegex(text: string): RegExp {
  try {
    return new RegExp(text);
  } catch {
    return new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  }
}

function parseFilter(filter: string): ((lines: string[]) => string[]) | null {
  const m = /^\s*(\S+)\s+(.+?)\s*$/.exec(filter);
  if (!m) return null;
  const matches = FILTERS.filter(([w]) => w.startsWith(m[1]!.toLowerCase()));
  if (matches.length !== 1) return null;
  const re = toRegex(m[2]!);
  switch (matches[0]![0]) {
    case "include":
      return (lines) => lines.filter((l) => re.test(l));
    case "exclude":
      return (lines) => lines.filter((l) => !re.test(l));
    case "begin":
      return (lines) => {
        const start = lines.findIndex((l) => re.test(l));
        return start === -1 ? [] : lines.slice(start);
      };
    case "count":
      return (lines) => [`Number of lines which match regexp = ${lines.filter((l) => re.test(l)).length}`];
    case "section":
      return (lines) => {
        const out: string[] = [];
        let block: string[] = [];
        const flush = () => {
          if (block.some((l) => re.test(l))) out.push(...block);
          block = [];
        };
        for (const l of lines) {
          if (!/^\s/.test(l)) flush();
          block.push(l);
        }
        flush();
        return out;
      };
  }
  return null;
}
