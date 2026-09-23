import { CliTerminal } from "../components/CliTerminal";
import { ModeDiagram } from "../components/ModeDiagram";
import { PortPanel } from "../components/PortPanel";
import { Panel } from "../components/ui";
import { registerConsole, useLab } from "../store/lab";

const CHEATSHEET = [
  "enable",
  "configure terminal",
  "hostname SW-CORE",
  "interface g0/1",
  "ip address 10.0.0.1 255.255.255.0",
  "no shutdown",
  "vlan 10 / name SALES",
  "switchport access vlan 10",
  "show ip interface brief",
  "show vlan brief",
  "show running-config",
];

export function SandboxPage() {
  const { devices, selectedId, select, bump } = useLab();
  useLab((s) => s.revision);
  const selected = devices.find((d) => d.id === selectedId)!;

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-lab-border px-5 py-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-lg font-semibold tracking-tight text-white">Lab libre</h1>
          <span className="text-sm text-slate-500">Sans objectif ni chrono · machine à états IOS</span>
        </div>
        <nav className="flex gap-1">
          {devices.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => select(d.id)}
              className={`rounded-md px-3 py-1.5 text-sm ${
                d.id === selectedId ? "bg-cyan-400/15 text-cyan-200" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {d.session.device.hostname}
              <span className="ml-1.5 text-xs text-slate-500">{d.label}</span>
            </button>
          ))}
        </nav>
      </header>

      <main className="flex min-h-0 flex-1 flex-col gap-4 p-4 lg:flex-row">
        <section className="min-h-[420px] flex-1 overflow-hidden rounded-lg border border-lab-border bg-lab-bg p-3">
          {devices.map((d) => (
            <CliTerminal
              key={d.id}
              session={d.session}
              banner={`${d.label} ${d.session.device.model} — console 9600 8N1`}
              active={d.id === selectedId}
              onExecute={bump}
              onReady={(ld) => registerConsole(d.id, ld)}
            />
          ))}
        </section>

        <aside className="flex w-full shrink-0 flex-col gap-4 overflow-y-auto lg:w-80">
          <Panel title="Mode CLI">
            <ModeDiagram current={selected.session.mode} hasVlans={selected.kind !== "router"} />
          </Panel>
          <Panel title="Ports physiques" hint="clic = brancher / débrancher">
            <PortPanel device={selected} />
          </Panel>
          <Panel title="Aide-mémoire" hint="Tab · ? · ↑↓">
            <ul className="space-y-0.5 font-mono text-xs text-slate-400">
              {CHEATSHEET.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </Panel>
        </aside>
      </main>
    </div>
  );
}
