import { isIosKind, shortInterfaceName, findInterface, type Lab } from "@cpt/cli-engine";
import type { DeviceKind } from "@cpt/shared";

const KIND_LABEL: Record<DeviceKind, string> = {
  "switch-l2": "Switch L2",
  "switch-l3": "Switch L3",
  router: "Routeur",
  pc: "PC",
  server: "Serveur",
};

interface Props {
  lab: Lab;
  selected: string | null;
  onSelect: (deviceId: string) => void;
}

function portLabel(lab: Lab, deviceId: string, ifName: string): string {
  const dev = lab.device(deviceId);
  const iface = dev && findInterface(dev, ifName);
  return iface ? shortInterfaceName(iface) : ifName;
}

/** Read-only topology diagram; IOS devices are clickable to open their console. */
export function TopologyMap({ lab, selected, onSelect }: Props) {
  const devices = lab.topology.devices;
  const xs = devices.map((d) => d.position.x);
  const ys = devices.map((d) => d.position.y);
  const pad = 60;
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;
  const width = Math.max(...xs) - minX + pad;
  const height = Math.max(...ys) - minY + pad;
  const pos = new Map(devices.map((d) => [d.id, d.position]));

  return (
    <svg viewBox={`${minX} ${minY} ${width} ${height}`} className="h-full w-full" role="img" aria-label="Topologie">
      {lab.topology.links.map((l) => {
        const a = pos.get(l.a.deviceId)!;
        const b = pos.get(l.b.deviceId)!;
        const up = lab.linkUp(l.id);
        const la = { x: a.x + (b.x - a.x) * 0.28, y: a.y + (b.y - a.y) * 0.28 };
        const lb = { x: b.x + (a.x - b.x) * 0.28, y: b.y + (a.y - b.y) * 0.28 };
        const horizontal = Math.abs(b.x - a.x) > Math.abs(b.y - a.y);
        return (
          <g key={l.id}>
            <line
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={up ? "#34d399" : "#64748b"}
              strokeWidth={2}
              strokeDasharray={up ? undefined : "5 5"}
            />
            <circle cx={la.x} cy={la.y} r={4} fill={up ? "#34d399" : "#f43f5e"} />
            <circle cx={lb.x} cy={lb.y} r={4} fill={up ? "#34d399" : "#f43f5e"} />
            {(
              [
                [l.a, la],
                [l.b, lb],
              ] as const
            ).map(([end, p]) =>
              isIosKind(lab.nodes.get(end.deviceId)!.kind) ? (
                <text
                  key={end.deviceId}
                  // Horizontal-ish links: label above the dot; otherwise to its right.
                  x={horizontal ? p.x : p.x + 7}
                  y={horizontal ? p.y - 8 : p.y + 3}
                  textAnchor={horizontal ? "middle" : "start"}
                  className="fill-slate-400 font-mono text-[10px]"
                >
                  {portLabel(lab, end.deviceId, end.interface)}
                </text>
              ) : null,
            )}
          </g>
        );
      })}
      {devices.map((d) => {
        const ios = isIosKind(d.kind);
        const active = d.id === selected;
        const name = lab.device(d.id)?.hostname ?? d.hostname;
        return (
          <g
            key={d.id}
            transform={`translate(${d.position.x} ${d.position.y})`}
            className={ios ? "cursor-pointer" : undefined}
            onClick={ios ? () => onSelect(d.id) : undefined}
          >
            {ios ? (
              <rect
                x={-44}
                y={-20}
                width={88}
                height={40}
                rx={8}
                fill={active ? "#083344" : "#111821"}
                stroke={active ? "#22d3ee" : "#334155"}
                strokeWidth={active ? 2 : 1.5}
              />
            ) : (
              <rect x={-30} y={-16} width={60} height={32} rx={16} fill="#111821" stroke="#334155" strokeWidth={1.5} />
            )}
            <text textAnchor="middle" y={ios ? -2 : 4} className="fill-slate-100 text-[12px] font-semibold">
              {name}
            </text>
            {ios && (
              <text textAnchor="middle" y={12} className="fill-slate-500 text-[9px]">
                {KIND_LABEL[d.kind]}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
