/**
 * Command grammar: every CLI mode owns a trie of tokens. Keywords may be
 * abbreviated to any unambiguous prefix (IOS behaviour), parameters are
 * validated by type. The same trie drives execution, `?` help and Tab
 * completion so they can never disagree.
 */
import type { CliMode } from "./types";
import { isIpv4, isMask, parseMac, parseVlanList } from "./net";
import { parseInterfaceName } from "./device";
import type { CommandContext } from "./session";

export type Args = Record<string, string>;
export type Handler = (ctx: CommandContext, args: Args) => void;

export type ParamKind =
  | "word"
  | "line"
  | "ipv4"
  | "mask"
  | "number"
  | "if-number"
  | "if-name"
  | "mac"
  | "vlan-list"
  | "pattern";

export interface ParamSpec {
  kind: ParamKind;
  /** Text shown in the left column of `?` help, e.g. "A.B.C.D", "WORD", "<1-4094>". */
  label: string;
  help: string;
  min?: number;
  max?: number;
  /** Hidden params are accepted but never listed by `?` (e.g. "g0/1" shorthand). */
  hidden?: boolean;
  /** For kind "pattern". */
  re?: RegExp;
}

export type TokenSpec =
  | { type: "keyword"; word: string; help: string }
  | { type: "param"; name: string; spec: ParamSpec };

export interface Node {
  token: TokenSpec | null;
  children: Node[];
  handler?: Handler;
}

export const P = {
  word: (help: string, label = "WORD"): ParamSpec => ({ kind: "word", label, help }),
  line: (help: string, label = "LINE"): ParamSpec => ({ kind: "line", label, help }),
  ipv4: (help: string): ParamSpec => ({ kind: "ipv4", label: "A.B.C.D", help }),
  mask: (help = "IP subnet mask"): ParamSpec => ({ kind: "mask", label: "A.B.C.D", help }),
  number: (min: number, max: number, help: string): ParamSpec => ({
    kind: "number",
    label: `<${min}-${max}>`,
    help,
    min,
    max,
  }),
  ifNumber: (label: string, help: string): ParamSpec => ({ kind: "if-number", label, help }),
  ifName: (hidden = true): ParamSpec => ({ kind: "if-name", label: "IFNAME", help: "Interface name", hidden }),
  mac: (help = "48 bit mac address"): ParamSpec => ({ kind: "mac", label: "H.H.H", help }),
  vlanList: (help = "VLAN IDs of the allowed VLANs when this port is in trunking mode"): ParamSpec => ({
    kind: "vlan-list",
    label: "WORD",
    help,
  }),
  pattern: (re: RegExp, label: string, help: string): ParamSpec => ({ kind: "pattern", label, help, re }),
};

function paramAccepts(spec: ParamSpec, text: string): boolean {
  switch (spec.kind) {
    case "word":
    case "line":
      return text.length > 0;
    case "ipv4":
      return isIpv4(text);
    case "mask":
      return isMask(text);
    case "number": {
      if (!/^\d+$/.test(text)) return false;
      const n = Number(text);
      return n >= (spec.min ?? 0) && n <= (spec.max ?? Number.MAX_SAFE_INTEGER);
    }
    case "if-number":
      return /^\d+(\/\d+)*$/.test(text);
    case "if-name":
      return parseInterfaceName(text) !== null;
    case "mac":
      return parseMac(text) !== null;
    case "vlan-list":
      return parseVlanList(text) !== null;
    case "pattern":
      return spec.re!.test(text);
  }
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

export interface Token {
  text: string;
  /** Offset of the token in the original line. */
  start: number;
}

export function tokenize(line: string): Token[] {
  const tokens: Token[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) tokens.push({ text: m[0], start: m.index });
  return tokens;
}

// ---------------------------------------------------------------------------
// Tree construction
// ---------------------------------------------------------------------------

export interface AddOptions {
  /** Parameter specs referenced as `$name` in the pattern. */
  params?: Record<string, ParamSpec>;
  /** Help overrides for keywords in this pattern (default: KEYWORD_HELP). */
  help?: Record<string, string>;
}

export class CommandTree {
  private readonly roots = new Map<CliMode, Node>();

  constructor(private readonly keywordHelp: Record<string, string>) {}

  root(mode: CliMode): Node {
    let r = this.roots.get(mode);
    if (!r) {
      r = { token: null, children: [] };
      this.roots.set(mode, r);
    }
    return r;
  }

  /**
   * Register a command. Pattern: space-separated keywords and `$param`
   * references, e.g. `"ip address $ip $mask"`.
   */
  add(modes: CliMode | CliMode[], pattern: string, handler: Handler, opts: AddOptions = {}): this {
    for (const mode of Array.isArray(modes) ? modes : [modes]) {
      let node = this.root(mode);
      for (const part of pattern.split(/\s+/)) {
        const token = this.toToken(part, opts);
        let child = node.children.find((c) => sameToken(c.token!, token));
        if (!child) {
          child = { token, children: [] };
          node.children.push(child);
        }
        node = child;
      }
      node.handler = handler;
    }
    return this;
  }

  private toToken(part: string, opts: AddOptions): TokenSpec {
    if (part.startsWith("$")) {
      const name = part.slice(1);
      const spec = opts.params?.[name];
      if (!spec) throw new Error(`Missing param spec for ${part}`);
      return { type: "param", name, spec };
    }
    const help = opts.help?.[part] ?? this.keywordHelp[part] ?? "";
    return { type: "keyword", word: part, help };
  }
}

function sameToken(a: TokenSpec, b: TokenSpec): boolean {
  if (a.type === "keyword" && b.type === "keyword") return a.word === b.word;
  if (a.type === "param" && b.type === "param") return a.name === b.name && a.spec.kind === b.spec.kind;
  return false;
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

type StepResult =
  | { kind: "match"; node: Node }
  | { kind: "ambiguous" }
  | { kind: "none" };

function step(node: Node, text: string): StepResult {
  const lower = text.toLowerCase();
  const keywords = node.children.filter(
    (c) => c.token!.type === "keyword" && c.token!.word.toLowerCase().startsWith(lower),
  );
  const exact = keywords.find((c) => c.token!.type === "keyword" && c.token!.word.toLowerCase() === lower);
  if (exact) return { kind: "match", node: exact };
  if (keywords.length === 1) return { kind: "match", node: keywords[0]! };
  if (keywords.length > 1) return { kind: "ambiguous" };
  const param = node.children.find((c) => c.token!.type === "param" && paramAccepts(c.token!.spec, text));
  return param ? { kind: "match", node: param } : { kind: "none" };
}

export type ParseResult =
  | { ok: true; handler: Handler; args: Args }
  | { ok: false; error: "invalid"; offset: number }
  | { ok: false; error: "ambiguous" }
  | { ok: false; error: "incomplete" };

export interface WalkResult {
  node: Node;
  args: Args;
  /** Set when walking stopped early. */
  failure?: { error: "invalid"; offset: number } | { error: "ambiguous" };
  /** True when a `line` param swallowed the remaining tokens. */
  consumedRest: boolean;
}

export function walk(root: Node, line: string, tokens: Token[]): WalkResult {
  let node = root;
  const args: Args = {};
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;
    const r = step(node, tok.text);
    if (r.kind === "ambiguous") return { node, args, failure: { error: "ambiguous" }, consumedRest: false };
    if (r.kind === "none") return { node, args, failure: { error: "invalid", offset: tok.start }, consumedRest: false };
    node = r.node;
    const t = node.token!;
    if (t.type === "keyword") continue;
    if (t.spec.kind === "line") {
      args[t.name] = line.slice(tok.start).trimEnd();
      return { node, args, consumedRest: true };
    }
    args[t.name] = tok.text;
  }
  return { node, args, consumedRest: false };
}

export function parse(root: Node, line: string): ParseResult {
  const tokens = tokenize(line);
  const w = walk(root, line, tokens);
  if (w.failure) return { ok: false, ...w.failure };
  if (!w.node.handler) return { ok: false, error: "incomplete" };
  return { ok: true, handler: w.node.handler, args: w.args };
}

// ---------------------------------------------------------------------------
// Help (`?`) and completion (Tab)
// ---------------------------------------------------------------------------

function tokenLabel(t: TokenSpec): string {
  return t.type === "keyword" ? t.word : t.spec.label;
}

function tokenHelp(t: TokenSpec): string {
  return t.type === "keyword" ? t.help : t.spec.help;
}

function visible(n: Node): boolean {
  const t = n.token!;
  return !(t.type === "param" && t.spec.hidden);
}

/** Help for `line?` where `line` is what precedes the question mark. */
export function help(root: Node, line: string): string[] {
  const tokens = tokenize(line);
  const partial = line.length > 0 && !/\s$/.test(line) ? tokens.pop() : undefined;
  const w = walk(root, line, tokens);
  if (w.failure) {
    return w.failure.error === "ambiguous" ? [`% Ambiguous command:  "${line.trim()}"`] : ["% Unrecognized command"];
  }

  if (w.consumedRest) {
    // Inside free text (e.g. description): only <cr> makes sense.
    return ["  <cr>"];
  }

  if (partial) {
    // `sh?` => list keywords starting with the partial word.
    const lower = partial.text.toLowerCase();
    const words = w.node.children
      .filter((c) => c.token!.type === "keyword" && c.token!.word.toLowerCase().startsWith(lower))
      .map((c) => tokenLabel(c.token!));
    const params = w.node.children.filter(
      (c) => visible(c) && c.token!.type === "param" && paramAccepts(c.token!.spec, partial.text),
    );
    if (words.length === 0 && params.length === 0) return ["% Unrecognized command"];
    const out = words.length ? wrapWords(words.sort()) : [];
    for (const p of params) out.push(tokenLabel(p.token!));
    return out;
  }

  const entries = w.node.children.filter(visible).map((c) => [tokenLabel(c.token!), tokenHelp(c.token!)] as const);
  entries.sort((a, b) => a[0].localeCompare(b[0]));
  if (w.node.handler) entries.push(["<cr>", ""]);
  if (entries.length === 0) return ["% Unrecognized command"];
  const width = Math.max(...entries.map(([l]) => l.length));
  return entries.map(([label, h]) => `  ${label.padEnd(width)}  ${h}`.trimEnd());
}

function wrapWords(words: string[], width = 80): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur}  ${w}` : w;
    if (next.length > width && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = next;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/**
 * Tab completion. Returns the completed line, or null when the last word is
 * empty, unknown or ambiguous (the terminal should then ring the bell).
 */
export function complete(root: Node, line: string): string | null {
  if (line.length === 0 || /\s$/.test(line)) return null;
  const tokens = tokenize(line);
  const partial = tokens.pop()!;
  const w = walk(root, line, tokens);
  if (w.failure || w.consumedRest) return null;
  const lower = partial.text.toLowerCase();
  const matches = w.node.children.filter(
    (c) => c.token!.type === "keyword" && c.token!.word.toLowerCase().startsWith(lower),
  );
  const exact = matches.find((c) => c.token!.type === "keyword" && c.token!.word.toLowerCase() === lower);
  const pick = exact ?? (matches.length === 1 ? matches[0] : undefined);
  if (!pick) return null;
  return line.slice(0, partial.start) + tokenLabel(pick.token!) + " ";
}
