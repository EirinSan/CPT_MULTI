import { interfaceStatus, shortInterfaceName } from "@cpt/cli-engine";
import { useLab, type LabDevice } from "../store/lab";

const DOT = {
  up: "bg-emerald-400",
  down: "bg-rose-500",
  "administratively down": "bg-slate-600",
} as const;

/**
 * Temporary stand-in for the topology canvas: toggling a port simulates
 * plugging a cable, which the simulation engine will do for real.
 */
export function PortPanel({ device }: { device: LabDevice }) {
  useLab((s) => s.revision);
  const toggle = useLab((s) => s.toggleCarrier);
  const dev = device.session.device;
  const physical = dev.interfaces.filter((i) => i.type === "FastEthernet" || i.type === "GigabitEthernet");

  return (
    <div className="grid grid-cols-4 gap-1.5">
      {physical.map((i) => {
        const { status } = interfaceStatus(dev, i);
        return (
          <button
            key={i.name}
            type="button"
            onClick={() => toggle(device.id, i.name)}
            title={`${i.name} — ${status}${i.carrier ? " (câble branché)" : ""}`}
            className={`flex items-center gap-1.5 rounded border px-1.5 py-1 font-mono text-[11px] ${
              i.carrier ? "border-cyan-700 bg-cyan-950/40" : "border-lab-border hover:border-slate-500"
            }`}
          >
            <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[status]}`} />
            {shortInterfaceName(i)}
          </button>
        );
      })}
    </div>
  );
}
