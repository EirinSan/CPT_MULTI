import { CliTerminal } from "./components/CliTerminal";
import { ModeDiagram } from "./components/ModeDiagram";
import { PortPanel } from "./components/PortPanel";
import { useLab } from "./store/lab";

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

export function App() {
  const { devices, selectedId, select } = useLab();
  useLab((s) => s.revision);
  const selected = devices.find((d) => d.id === selectedId)!;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-lab-border px-5 py-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-lg font-semibold tracking-tight text-white">CPT Multi</h1>
          <span className="text-sm text-slate-500">Prototype CLI · machine à états IOS</span>
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
            <CliTerminal key={d.id} device={d} active={d.id === selectedId} />
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

function Panel({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-lab-border bg-lab-panel p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-300">{title}</h2>
        {hint && <span className="text-[11px] text-slate-500">{hint}</span>}
      </div>
      {children}
    </div>
  );
}
