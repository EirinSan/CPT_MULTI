import type { CliMode } from "@cpt/cli-engine";

const MODES: Array<{ mode: CliMode; name: string; prompt: string; enter: string }> = [
  { mode: "user", name: "User EXEC", prompt: ">", enter: "(connexion)" },
  { mode: "privileged", name: "Privileged EXEC", prompt: "#", enter: "enable" },
  { mode: "config", name: "Global Config", prompt: "(config)#", enter: "configure terminal" },
  { mode: "config-if", name: "Interface Config", prompt: "(config-if)#", enter: "interface <type><n>" },
  { mode: "config-vlan", name: "VLAN Config", prompt: "(config-vlan)#", enter: "vlan <id>" },
];

/** State machine of the CLI with the current mode highlighted. */
export function ModeDiagram({ current, hasVlans }: { current: CliMode; hasVlans: boolean }) {
  return (
    <ol className="space-y-1.5">
      {MODES.filter((m) => hasVlans || m.mode !== "config-vlan").map((m, i) => {
        const active = m.mode === current;
        const indent = m.mode === "config-if" || m.mode === "config-vlan" ? "ml-6" : "";
        return (
          <li key={m.mode} className={indent}>
            {i > 0 && (
              <div className="ml-3 font-mono text-[11px] text-slate-500">↓ {m.enter}</div>
            )}
            <div
              className={`flex items-center justify-between rounded-md border px-3 py-1.5 text-sm transition-colors ${
                active
                  ? "border-lab-accent bg-cyan-400/10 text-cyan-200"
                  : "border-lab-border text-slate-400"
              }`}
            >
              <span>{m.name}</span>
              <code className="font-mono text-xs">{m.prompt}</code>
            </div>
          </li>
        );
      })}
      <li className="pt-2 font-mono text-[11px] leading-5 text-slate-500">
        exit : remonte d'un niveau · end / Ctrl+Z : retour en #<br />
        disable : retour en &gt; · do &lt;cmd&gt; : exec depuis config
      </li>
    </ol>
  );
}
