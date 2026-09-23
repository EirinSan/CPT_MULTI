import { CliSession, createDevice, type IosDeviceKind, type LineDiscipline } from "@cpt/cli-engine";
import { create } from "zustand";

export interface LabDevice {
  id: string;
  label: string;
  kind: IosDeviceKind;
  session: CliSession;
}

interface LabState {
  devices: LabDevice[];
  selectedId: string;
  /**
   * Sessions are mutable objects owned by the engine; bumping the revision
   * after each command tells React to re-read them.
   */
  revision: number;
  select: (id: string) => void;
  bump: () => void;
  toggleCarrier: (deviceId: string, interfaceName: string) => void;
}

function device(id: string, kind: IosDeviceKind, label: string): LabDevice {
  return { id, label, kind, session: new CliSession(createDevice(kind, id)) };
}

/** Console line disciplines, keyed by device id, for async syslog output. */
const consoles = new Map<string, LineDiscipline>();

export function registerConsole(deviceId: string, ld: LineDiscipline): () => void {
  consoles.set(deviceId, ld);
  return () => {
    if (consoles.get(deviceId) === ld) consoles.delete(deviceId);
  };
}

export const useLab = create<LabState>((set, get) => ({
  devices: [
    device("SW1", "switch-l2", "Switch L2"),
    device("DSW1", "switch-l3", "Switch L3"),
    device("R1", "router", "Routeur"),
  ],
  selectedId: "SW1",
  revision: 0,
  select: (id) => set({ selectedId: id }),
  bump: () => set((s) => ({ revision: s.revision + 1 })),
  toggleCarrier: (deviceId, interfaceName) => {
    const dev = get().devices.find((d) => d.id === deviceId);
    if (!dev) return;
    const iface = dev.session.device.interfaces.find((i) => i.name === interfaceName);
    if (!iface) return;
    // Stand-in for the simulation engine: plugging a cable raises carrier.
    const lines = dev.session.setCarrier(interfaceName, !iface.carrier);
    consoles.get(deviceId)?.printAsync(lines);
    get().bump();
  },
}));
