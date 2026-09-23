import { commandCatalog, type CliMode, type IosDeviceKind } from "@cpt/cli-engine";
import { useMemo, useState } from "react";
import { PageHeader } from "../components/Layout";
import { Panel } from "../components/ui";

const KINDS: Array<[IosDeviceKind, string]> = [
  ["switch-l2", "Switch L2 (2960)"],
  ["switch-l3", "Switch L3 (3560)"],
  ["router", "Routeur (ISR4331)"],
];

const MODES: Array<[CliMode, string, string]> = [
  ["user", "User EXEC", ">"],
  ["privileged", "Privileged EXEC", "#"],
  ["config", "Configuration globale", "(config)#"],
  ["config-if", "Interface", "(config-if)#"],
  ["config-if-range", "Plage d'interfaces", "(config-if-range)#"],
  ["config-vlan", "VLAN", "(config-vlan)#"],
  ["config-line", "Ligne (console / vty)", "(config-line)#"],
];

/** Command reference generated from the simulator's own grammar. */
export function CommandsPage() {
  const [kind, setKind] = useState<IosDeviceKind>("switch-l2");
  const [query, setQuery] = useState("");
  const sections = useMemo(
    () =>
      MODES.map(([mode, label, prompt]) => ({
        mode,
        label,
        prompt,
        entries: commandCatalog(kind, mode).filter((e) => {
          const q = query.trim().toLowerCase();
          return !q || e.syntax.toLowerCase().includes(q) || e.help.toLowerCase().includes(q);
        }),
      })).filter((s) => s.entries.length > 0),
    [kind, query],
  );
  const total = sections.reduce((n, s) => n + s.entries.length, 0);

  return (
    <>
      <PageHeader
        title="Commandes"
        subtitle="Toutes les commandes reconnues par le simulateur, générées depuis sa grammaire. Les abréviations (sh run, conf t, int g0/1…) fonctionnent."
      />
      <div className="space-y-4 p-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1">
            {KINDS.map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={`rounded-md px-3 py-1.5 text-sm ${k === kind ? "bg-cyan-400/15 text-cyan-200" : "text-slate-400 hover:text-slate-200"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher : trunk, port-security, spanning-tree…"
            aria-label="Rechercher une commande"
            className="min-w-64 flex-1 rounded-md border border-lab-border bg-lab-bg px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400"
          />
          <span className="text-sm text-slate-500">{total} commandes</span>
        </div>
        {sections.map((s) => (
          <Panel key={s.mode} title={`${s.label}  ${s.prompt}`} hint={`${s.entries.length}`}>
            <table className="w-full text-left text-sm">
              <tbody className="divide-y divide-lab-border">
                {s.entries.map((e) => (
                  <tr key={e.syntax}>
                    <td className="py-1.5 pr-4 align-top font-mono text-[13px] text-slate-100">{e.syntax}</td>
                    <td className="py-1.5 align-top text-slate-400">{e.help}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        ))}
      </div>
    </>
  );
}
