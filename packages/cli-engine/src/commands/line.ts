/** (config-line)# and (config-vlan)# */
import { P, type CommandTree, type Handler } from "../grammar";
import type { CommandContext } from "../session";
import type { LineConfig } from "../types";
import { plainOrType7 } from "./secrets";

function eachLine(fn: (ctx: CommandContext, line: LineConfig, args: Record<string, string>) => void): Handler {
  return (ctx, args) => {
    const sel = ctx.session.currentLines;
    if (!sel) return;
    const lines = sel.kind === "console" ? [ctx.device.lines.console] : ctx.device.lines.vty.slice(sel.from, sel.to + 1);
    for (const l of lines) fn(ctx, l, args);
  };
}

export function registerLine(t: CommandTree): void {
  const m = "config-line";
  t.add(m, "password $text", (ctx, args) => {
    const plain = plainOrType7(ctx, args.text!);
    if (plain === null) return;
    eachLine((_c, l) => {
      l.password = plain;
    })(ctx, args);
  }, { params: { text: P.line("The UNENCRYPTED (cleartext) line password") } });
  t.add(m, "no password", eachLine((_ctx, l) => {
    l.password = null;
  }));
  t.add(m, "login", (ctx, args) => {
    const sel = ctx.session.currentLines;
    eachLine((_c, l) => {
      l.login = "line";
    })(ctx, args);
    const lines = sel?.kind === "console" ? [ctx.device.lines.console] : ctx.device.lines.vty.slice(sel?.from ?? 0, (sel?.to ?? 0) + 1);
    if (lines.some((l) => !l.password)) {
      ctx.print(`% Login disabled on line ${sel?.kind === "console" ? 0 : (sel?.from ?? 0) + 1}, until 'password' is set`);
    }
  });
  t.add(m, "login local", eachLine((_ctx, l) => {
    l.login = "local";
  }));
  t.add(m, "no login", eachLine((_ctx, l) => {
    l.login = "none";
  }));
  t.add(m, "transport input $protocols", (ctx, args) => {
    const words = args.protocols!.toLowerCase().split(/\s+/);
    let value: LineConfig["transportInput"];
    if (words.includes("all")) value = "all";
    else if (words.includes("none")) value = "none";
    else if (words.every((w) => w === "ssh" || w === "telnet")) value = [...new Set(words)] as Array<"ssh" | "telnet">;
    else {
      ctx.print("% Invalid input detected: expected ssh, telnet, all or none");
      return;
    }
    eachLine((_c, l) => {
      l.transportInput = value;
    })(ctx, args);
  }, { params: { protocols: P.line("ssh | telnet | all | none", "LINE") } });
  const timeout = { params: { min: P.number(0, 35791, "Timeout in minutes"), sec: P.number(0, 2147483, "Timeout in seconds") } };
  t.add(m, "exec-timeout $min", eachLine((_ctx, l, { min }) => {
    l.execTimeout = [Number(min), 0];
  }), timeout);
  t.add(m, "exec-timeout $min $sec", eachLine((_ctx, l, { min, sec }) => {
    l.execTimeout = [Number(min), Number(sec)];
  }), timeout);
  t.add(m, "no exec-timeout", eachLine((_ctx, l) => {
    l.execTimeout = [10, 0];
  }));
  t.add(m, "logging synchronous", eachLine((_ctx, l) => {
    l.loggingSynchronous = true;
  }));
  t.add(m, "no logging synchronous", eachLine((_ctx, l) => {
    l.loggingSynchronous = false;
  }));
  t.add(m, "history size $n", eachLine((_ctx, l, { n }) => {
    l.historySize = Number(n);
  }), { params: { n: P.number(0, 256, "Size of history buffer") } });
  t.add(m, "privilege level $n", eachLine((_ctx, l, { n }) => {
    l.privilegeLevel = Number(n);
  }), { params: { n: P.number(0, 15, "Default privilege level for line") } });
}

export function registerVlanMode(t: CommandTree): void {
  t.add("config-vlan", "name $name", (ctx, { name }) => {
    const id = ctx.session.currentVlan;
    if (id === null) return;
    if (id === 1) {
      ctx.print("Default VLAN 1 may not have its name changed.");
      return;
    }
    const vlan = ctx.device.vlans.get(id);
    if (vlan && vlan.name !== name!.slice(0, 32)) {
      vlan.name = name!.slice(0, 32);
      if (ctx.device.vtp.mode === "server") ctx.device.vtp.revision++;
    }
  }, { params: { name: P.word("The ascii name for the VLAN") } });
  t.add("config-vlan", "no name", (ctx) => {
    const id = ctx.session.currentVlan;
    const vlan = id === null ? undefined : ctx.device.vlans.get(id);
    if (vlan && id !== 1) vlan.name = `VLAN${String(id).padStart(4, "0")}`;
  });
}
