import { Lab, isIosKind, type LineDiscipline } from "@cpt/cli-engine";
import type { CommandEntry, MissionObjective, Topology } from "@cpt/shared";
import { useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { CliTerminal } from "./CliTerminal";
import { ObjectiveList } from "./ObjectiveList";
import { TopologyMap } from "./TopologyMap";
import { Panel } from "./ui";

interface Props {
  topology: Topology;
  objectives: MissionObjective[];
  /** Objective results computed by the server (null = not evaluated yet). */
  results: boolean[] | null;
  onCommand: (deviceId: string, line: string) => void;
  locked?: boolean;
  /** Commands to replay into the local lab (reconnecting to a match). */
  replay?: CommandEntry[];
  /** Extra panels shown above the objectives. */
  aside?: ReactNode;
}

/**
 * Multi-device mission workspace: topology map, one console per IOS device
 * and the objective checklist. The local Lab gives instant feedback; the
 * server replays the same commands to decide the objectives.
 */
export function MissionWorkspace({ topology, objectives, results, onCommand, locked, replay, aside }: Props) {
  const lab = useMemo(() => {
    const l = new Lab(topology);
    for (const c of replay ?? []) l.execute(c.deviceId, c.line);
    return l;
    // The lab lives as long as the topology object.
  }, [topology]);
  const consoles = useRef(new Map<string, LineDiscipline>());
  const iosDevices = topology.devices.filter((d) => isIosKind(d.kind));
  const [selected, setSelected] = useState(iosDevices[0]?.id ?? null);
  // Re-render after each command so link state on the map refreshes.
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const commandRef = useRef(onCommand);
  commandRef.current = onCommand;

  const executeOn = (deviceId: string) => (line: string) => {
    const { output, syslog } = lab.execute(deviceId, line);
    for (const [id, lines] of syslog) consoles.current.get(id)?.printAsync(lines);
    if (line.trim()) commandRef.current(deviceId, line);
    bump();
    return output;
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 xl:flex-row">
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="flex flex-wrap gap-1">
          {iosDevices.map((d) => (
            <button
              key={d.id}
              type="button"
              data-device={d.id}
              onClick={() => setSelected(d.id)}
              className={`rounded-md px-3 py-1.5 font-mono text-sm ${
                d.id === selected ? "bg-cyan-400/15 text-cyan-200" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {lab.device(d.id)?.hostname ?? d.id}
            </button>
          ))}
          {locked && <span className="ml-auto self-center text-xs text-slate-500">Consoles verrouillées</span>}
        </div>
        <section className="min-h-[380px] flex-1 overflow-hidden rounded-lg border border-lab-border bg-lab-bg p-3">
          {iosDevices.map((d) => {
            const session = lab.session(d.id);
            return (
              <CliTerminal
                key={d.id}
                session={session}
                banner={`${d.id} ${session.device.model} — console 9600 8N1`}
                active={d.id === selected}
                locked={locked}
                execute={executeOn(d.id)}
                onReady={(ld) => {
                  consoles.current.set(d.id, ld);
                  return () => consoles.current.delete(d.id);
                }}
              />
            );
          })}
        </section>
      </div>

      <aside className="flex w-full shrink-0 flex-col gap-4 xl:w-96">
        {aside}
        <Panel title="Objectifs" hint={results ? `${results.filter(Boolean).length}/${objectives.length}` : undefined}>
          <ObjectiveList objectives={objectives} results={results} />
        </Panel>
        <Panel title="Topologie" hint="clic = ouvrir la console">
          <div className="h-56">
            <TopologyMap lab={lab} selected={selected} onSelect={setSelected} />
          </div>
        </Panel>
      </aside>
    </div>
  );
}
