/** User / privileged EXEC commands. */
import { P, type CommandTree } from "../grammar";
import { parseVlanList } from "../net";
import { verifySecret } from "../passwords";
import type { CommandContext } from "../session";
import { showIpInterfaceBrief, showIpRoute, showMacAddressCount, showMacAddressTable, showVersion } from "../show/basic";
import { interfaceRunningConfig, runningConfig } from "../show/config";
import {
  showInterfaceSwitchport,
  showInterfaces,
  showInterfacesDescription,
  showInterfacesStatus,
  showInterfacesTrunk,
} from "../show/interfaces";
import {
  showCdp,
  showCdpNeighbors,
  showEtherchannelSummary,
  showPortSecurity,
  showPortSecurityAddress,
  showPortSecurityInterface,
  showSpanningTree,
  showSpanningTreeSummary,
  showVlan,
  showVlanBrief,
  showVtpStatus,
} from "../show/switching";
import {
  formatClock,
  parseMonth,
  showArp,
  showDhcpSnooping,
  showErrdisableRecovery,
  showFlash,
  showIpSsh,
  showLogging,
  showUsers,
} from "../show/system";
import { shortInterfaceName } from "../device";
import type { IosDeviceKind } from "../types";
import { EXEC, addIfCommand } from "./helpers";

const confirm = (input: string) => input.trim() === "" || /^y/i.test(input.trim());

function logout(ctx: CommandContext): void {
  ctx.session.mode = "user";
  ctx.print("", ...ctx.session.pressReturn());
}

function saveConfig(ctx: CommandContext): string[] {
  ctx.device.startupConfig = ctx.session.runningConfigLines();
  return ["Building configuration...", "[OK]"];
}

export function registerExec(t: CommandTree, kind: IosDeviceKind): void {
  const isSwitch = kind !== "router";
  const routes = kind !== "switch-l2";

  // ----- Mode changes -----
  t.add(EXEC, "enable", (ctx) => {
    const dev = ctx.device;
    if (ctx.session.mode === "privileged") return;
    if (!dev.enableSecret && !dev.enablePassword) {
      ctx.session.mode = "privileged";
      return;
    }
    ctx.session.askPassword(
      (pw) => (dev.enableSecret ? verifySecret(pw, dev.enableSecret) : pw === dev.enablePassword),
      () => {
        ctx.session.mode = "privileged";
        return [];
      },
      "% Bad secrets",
    );
  });
  t.add("privileged", "disable", (ctx) => {
    ctx.session.mode = "user";
  });
  t.add(EXEC, "exit", logout);
  t.add(EXEC, "logout", logout);
  t.add("privileged", "configure terminal", (ctx) => {
    ctx.session.mode = "config";
    ctx.print("Enter configuration commands, one per line.  End with CNTL/Z.");
  });
  t.add("privileged", "configure", (ctx) => {
    ctx.session.ask("Configuring from terminal, memory, or network [terminal]? ", (input) => {
      if (input.trim() === "" || /^t/i.test(input.trim())) {
        ctx.session.mode = "config";
        return ["Enter configuration commands, one per line.  End with CNTL/Z."];
      }
      return ["?Must be \"terminal\", \"memory\" or \"network\""];
    });
  });

  // ----- Configuration files -----
  t.add("privileged", "write memory", (ctx) => ctx.print(...saveConfig(ctx)));
  t.add("privileged", "write", (ctx) => ctx.print(...saveConfig(ctx)));
  t.add("privileged", "write terminal", (ctx) => ctx.print(...runningConfig(ctx.device)));
  const erase = (ctx: CommandContext) =>
    ctx.session.ask("Erasing the nvram filesystem will remove all configuration files! Continue? [confirm]", (input) => {
      if (!confirm(input)) return [];
      ctx.device.startupConfig = null;
      return ["[OK]", "Erase of nvram: complete", "%SYS-7-NV_BLOCK_INIT: Initialized the geometry of nvram"];
    });
  t.add("privileged", "write erase", erase);
  t.add("privileged", "erase startup-config", erase);
  t.add("privileged", "erase nvram:", erase);
  t.add("privileged", "copy running-config startup-config", (ctx) => {
    ctx.session.ask("Destination filename [startup-config]? ", (input) => {
      if (input.trim() !== "" && input.trim() !== "startup-config") return ["%Error: only startup-config is supported"];
      return saveConfig(ctx);
    });
  });
  t.add("privileged", "copy startup-config running-config", (ctx) => {
    ctx.session.ask("Destination filename [running-config]? ", () => {
      const cfg = ctx.device.startupConfig;
      if (!cfg) return ["%Error opening nvram:/startup-config (File not found)"];
      ctx.session.loadConfig(cfg);
      return [`${cfg.join("\n").length} bytes copied in 0.312 secs`];
    });
  });
  t.add("privileged", "reload", (ctx) => {
    const proceed = () =>
      ctx.session.ask("Proceed with reload? [confirm]", (input) => (confirm(input) ? ctx.session.reboot() : []));
    const running = ctx.session.runningConfigLines().slice(1).join("\n");
    const startup = ctx.device.startupConfig?.slice(1).join("\n") ?? null;
    if (running !== startup) {
      ctx.session.ask("System configuration has been modified. Save? [yes/no]: ", (input) => {
        const out: string[] = [];
        if (/^y/i.test(input.trim())) out.push(...saveConfig(ctx));
        else if (!/^n/i.test(input.trim())) return ["% Please answer 'yes' or 'no'."];
        proceed();
        return out;
      });
    } else proceed();
  });
  if (isSwitch) {
    const deleteVlanDat = (ctx: CommandContext) =>
      ctx.session.ask("Delete filename [vlan.dat]? ", () => {
        ctx.session.ask("Delete flash:/vlan.dat? [confirm]", (input) => {
          if (!confirm(input)) return [];
          if (!ctx.device.vlanDat) return ["%Error deleting flash:/vlan.dat (No such file or directory)"];
          ctx.device.vlanDat = false;
          return [];
        });
        return [];
      });
    t.add("privileged", "delete flash:vlan.dat", deleteVlanDat);
    t.add("privileged", "delete vlan.dat", deleteVlanDat);
  }
  t.add(EXEC, "dir", (ctx) => ctx.print(...showFlash(ctx.device)));
  t.add(EXEC, "dir flash:", (ctx) => ctx.print(...showFlash(ctx.device)));

  // ----- Terminal / clock / clear -----
  t.add(EXEC, "terminal length $n", (ctx, { n }) => {
    ctx.device.terminal.length = Number(n);
  }, { params: { n: P.number(0, 512, "Number of lines on screen (0 for no pausing)") } });
  t.add(EXEC, "terminal width $n", (ctx, { n }) => {
    ctx.device.terminal.width = Number(n);
  }, { params: { n: P.number(0, 512, "Number of characters on a screen line") } });
  t.add(EXEC, "terminal monitor", (ctx) => {
    ctx.device.terminal.monitor = true;
  });
  t.add(EXEC, "terminal no monitor", (ctx) => {
    ctx.device.terminal.monitor = false;
  });
  const clockSet = (ctx: CommandContext, time: string, day: string, month: string, year: string) => {
    const m = parseMonth(month);
    const [hh, mm, ss] = time.split(":").map(Number);
    if (m === null) {
      ctx.print("% Invalid month");
      return;
    }
    const target = Date.UTC(Number(year), m, Number(day), hh, mm, ss);
    ctx.device.clockOffsetMs = target - (ctx.session.clock().getTime() - ctx.device.clockOffsetMs);
  };
  const clockParams = {
    params: {
      time: P.pattern(/^([01]?\d|2[0-3]):[0-5]\d:[0-5]\d$/, "hh:mm:ss", "Current Time"),
      day: P.number(1, 31, "Day of the month"),
      month: P.pattern(/^[a-z]{3,9}$/i, "MONTH", "Month of the year"),
      year: P.number(1993, 2035, "Year"),
    },
  };
  t.add("privileged", "clock set $time $day $month $year", (ctx, a) => clockSet(ctx, a.time!, a.day!, a.month!, a.year!), clockParams);
  t.add("privileged", "clock set $time $month $day $year", (ctx, a) => clockSet(ctx, a.time!, a.day!, a.month!, a.year!), clockParams);

  t.add("privileged", "clear counters", (ctx) =>
    ctx.session.ask('Clear "show interface" counters on all interfaces [confirm]', () => []),
  );
  t.add("privileged", "clear arp-cache", () => {});
  if (isSwitch) {
    t.add("privileged", "clear mac address-table dynamic", (ctx) => {
      ctx.device.macTable = ctx.device.macTable.filter((e) => e.type === "STATIC");
    });
    t.add("privileged", "clear port-security sticky", (ctx) => {
      for (const i of ctx.device.interfaces) i.portSecurity.stickyMacs = [];
    });
    t.add("privileged", "clear port-security all", (ctx) => {
      for (const i of ctx.device.interfaces) {
        i.portSecurity.stickyMacs = [];
        i.portSecurity.violationCount = 0;
      }
    });
    addIfCommand(t, kind, "privileged", "clear port-security sticky interface", "", (_ctx, i) => {
      i.portSecurity.stickyMacs = [];
    });
    addIfCommand(t, kind, "privileged", "clear errdisable interface", "", (ctx, i) => {
      if (i.errDisabled) i.errDisabled = null;
      else ctx.print(`% ${i.name} is not err-disabled`);
    });
  }

  const notSimulated = (what: string) => (ctx: CommandContext) =>
    ctx.print(`% ${what} : le moteur de paquets n'est pas encore simulé dans ce lab.`);
  t.add(EXEC, "ping $target", notSimulated("ping"), { params: { target: P.word("Ping destination address or hostname") } });
  t.add(EXEC, "traceroute $target", notSimulated("traceroute"), { params: { target: P.word("Trace route to destination address or hostname") } });
  t.add(EXEC, "telnet $target", notSimulated("telnet"), { params: { target: P.word("IP address or hostname of a remote system") } });
  t.add(EXEC, "ssh -l $user $target", notSimulated("ssh"), {
    params: { user: P.word("Login name"), target: P.word("IP address or hostname of a remote system") },
  });

  // ----- show -----
  const show = (pattern: string, fn: (ctx: CommandContext) => string[], privOnly = false) =>
    t.add(privOnly ? "privileged" : EXEC, `show ${pattern}`, (ctx) => ctx.print(...fn(ctx)));

  show("running-config", (ctx) => runningConfig(ctx.device), true);
  addIfCommand(t, kind, "privileged", "show running-config interface", "", (ctx, i) =>
    ctx.print(...interfaceRunningConfig(ctx.device, i)),
  );
  show("startup-config", (ctx) => {
    const cfg = ctx.device.startupConfig;
    return cfg ? [`Using ${cfg.join("\n").length} out of 65536 bytes`, ...cfg] : ["startup-config is not present"];
  }, true);
  show("version", (ctx) => showVersion(ctx.device, ctx.session.uptime()));
  show("history", (ctx) => ctx.session.history.map((h) => `  ${h}`));
  show("clock", (ctx) => [formatClock(ctx.session.clock(), ctx.device.clockOffsetMs !== 0 || ctx.device.ntpServers.length > 0)]);
  show("users", () => showUsers());
  show("flash:", (ctx) => showFlash(ctx.device));
  show("privilege", (ctx) => [`Current privilege level is ${ctx.session.mode === "user" ? 1 : 15}`]);
  show("ip interface brief", (ctx) => showIpInterfaceBrief(ctx.device));
  show("ip ssh", (ctx) => showIpSsh(ctx.device));
  show("ssh", () => ["%No SSHv2 server connections running."]);
  show("ip arp", (ctx) => showArp(ctx.device));
  show("arp", (ctx) => showArp(ctx.device));
  show("logging", (ctx) => showLogging(ctx.device));
  show("cdp", (ctx) => showCdp(ctx.device));
  show("cdp neighbors", (ctx) => showCdpNeighbors(ctx.device, false));
  show("cdp neighbors detail", (ctx) => showCdpNeighbors(ctx.device, true));
  if (routes) show("ip route", (ctx) => showIpRoute(ctx.device));
  show("interfaces", (ctx) => ctx.device.interfaces.flatMap((i) => showInterfaces(ctx.device, i)));
  show("interfaces description", (ctx) => showInterfacesDescription(ctx.device));
  addIfCommand(t, kind, EXEC, "show interfaces", "", (ctx, i) => ctx.print(...showInterfaces(ctx.device, i)));

  if (isSwitch) {
    show("interfaces status", (ctx) => showInterfacesStatus(ctx.device));
    show("interfaces status err-disabled", (ctx) => [
      "",
      "Port      Name               Status       Reason               Err-disabled Vlans",
      ...ctx.device.interfaces
        .filter((i) => i.errDisabled)
        .map((i) => `${shortInterfaceName(i).padEnd(10)}${(i.description ?? "").padEnd(19)}${"err-disabled".padEnd(13)}${i.errDisabled}`),
    ]);
    show("interfaces trunk", (ctx) => showInterfacesTrunk(ctx.device));
    show("interfaces switchport", (ctx) =>
      ctx.device.interfaces.filter((i) => i.switchport).flatMap((i) => [...showInterfaceSwitchport(ctx.device, i), ""]),
    );
    addIfCommand(t, kind, EXEC, "show interfaces", "switchport", (ctx, i) => ctx.print(...showInterfaceSwitchport(ctx.device, i)));
    addIfCommand(t, kind, EXEC, "show interfaces", "status", (ctx, i) => ctx.print(...showInterfacesStatus(ctx.device, [i])));

    show("vlan", (ctx) => showVlan(ctx.device));
    show("vlan brief", (ctx) => showVlanBrief(ctx.device), false);
    t.add(EXEC, "show vlan id $id", (ctx, { id }) => ctx.print(...showVlan(ctx.device, Number(id))), {
      params: { id: P.number(1, 4094, "A VLAN ID") },
      help: { id: "VTP VLAN status by VLAN id" },
    });

    show("mac address-table", (ctx) => showMacAddressTable(ctx.device));
    show("mac address-table dynamic", (ctx) => showMacAddressTable(ctx.device, (e) => e.type === "DYNAMIC"));
    show("mac address-table static", (ctx) => showMacAddressTable(ctx.device, (e) => e.type === "STATIC"));
    show("mac address-table count", (ctx) => showMacAddressCount(ctx.device));
    show("mac address-table aging-time", (ctx) => ["Global Aging Time: " + String(ctx.device.macAgingTime).padStart(4)]);
    t.add(EXEC, "show mac address-table vlan $id", (ctx, { id }) =>
      ctx.print(...showMacAddressTable(ctx.device, (e) => e.vlan === Number(id))),
    { params: { id: P.number(1, 4094, "VLAN number") } });
    addIfCommand(t, kind, EXEC, "show mac address-table interface", "", (ctx, i) =>
      ctx.print(...showMacAddressTable(ctx.device, (e) => e.port === shortInterfaceName(i))),
    );

    show("spanning-tree", (ctx) => showSpanningTree(ctx.device));
    show("spanning-tree summary", (ctx) => showSpanningTreeSummary(ctx.device));
    t.add(EXEC, "show spanning-tree vlan $id", (ctx, { id }) => {
      const list = parseVlanList(id!) ?? [];
      ctx.print(...list.flatMap((v) => showSpanningTree(ctx.device, v)));
    }, { params: { id: P.vlanList("vlan range, example: 1,3-5,7,9-11") } });

    show("port-security", (ctx) => showPortSecurity(ctx.device));
    show("port-security address", (ctx) => showPortSecurityAddress(ctx.device));
    addIfCommand(t, kind, EXEC, "show port-security interface", "", (ctx, i) => ctx.print(...showPortSecurityInterface(ctx.device, i)));
    show("etherchannel summary", (ctx) => showEtherchannelSummary(ctx.device));
    show("vtp status", (ctx) => showVtpStatus(ctx.device));
    show("vtp password", (ctx) => [ctx.device.vtp.password ? `VTP Password: ${ctx.device.vtp.password}` : "The VTP password is not configured."]);
    show("errdisable recovery", (ctx) => showErrdisableRecovery(ctx.device));
    show("ip dhcp snooping", (ctx) => showDhcpSnooping(ctx.device));
  }
}
