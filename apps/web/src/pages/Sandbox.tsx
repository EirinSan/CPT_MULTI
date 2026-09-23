import type { Topology } from "@cpt/shared";
import { useState } from "react";
import { PageHeader } from "../components/Layout";
import { MissionWorkspace } from "../components/MissionWorkspace";
import { Button, Panel } from "../components/ui";

const at = (x: number, y: number) => ({ x, y });
const cable = (id: string, a: string, ai: string, b: string, bi: string) => ({
  id,
  cable: "copper-straight" as const,
  a: { deviceId: a, interface: ai },
  b: { deviceId: b, interface: bi },
});

/**
 * Free lab: a switched triangle (for STP / trunks / EtherChannel), a
 * distribution L3 switch and a router, with a few hosts.
 */
const LAB_TOPOLOGY: Topology = {
  version: 1,
  devices: [
    { id: "R1", kind: "router", hostname: "R1", position: at(300, 30) },
    { id: "DSW1", kind: "switch-l3", hostname: "DSW1", position: at(300, 140) },
    { id: "SW1", kind: "switch-l2", hostname: "SW1", position: at(150, 260) },
    { id: "SW2", kind: "switch-l2", hostname: "SW2", position: at(450, 260) },
    { id: "PC1", kind: "pc", hostname: "PC1", position: at(80, 380) },
    { id: "PC2", kind: "pc", hostname: "PC2", position: at(220, 380) },
    { id: "PC3", kind: "pc", hostname: "PC3", position: at(380, 380) },
    { id: "SRV1", kind: "server", hostname: "SRV1", position: at(520, 380) },
  ],
  links: [
    cable("r1-dsw1", "R1", "GigabitEthernet0/0/0", "DSW1", "GigabitEthernet0/1"),
    cable("dsw1-sw1", "DSW1", "FastEthernet0/1", "SW1", "GigabitEthernet0/1"),
    cable("dsw1-sw2", "DSW1", "FastEthernet0/2", "SW2", "GigabitEthernet0/1"),
    cable("sw1-sw2-a", "SW1", "FastEthernet0/23", "SW2", "FastEthernet0/23"),
    cable("sw1-sw2-b", "SW1", "FastEthernet0/24", "SW2", "FastEthernet0/24"),
    cable("pc1", "SW1", "FastEthernet0/1", "PC1", "eth0"),
    cable("pc2", "SW1", "FastEthernet0/2", "PC2", "eth0"),
    cable("pc3", "SW2", "FastEthernet0/1", "PC3", "eth0"),
    cable("srv1", "SW2", "FastEthernet0/2", "SRV1", "eth0"),
  ],
};

const IDEAS = [
  "Trunks : switchport mode trunk sur les liens entre switches, puis show interfaces trunk",
  "STP : show spanning-tree, puis spanning-tree vlan 1 root primary sur DSW1",
  "EtherChannel : channel-group 1 mode active sur Fa0/23-24 de SW1 et SW2",
  "Port-security : switchport port-security mac-address sticky sur SW1 Fa0/1",
  "BPDU guard : spanning-tree bpduguard enable sur un lien entre switches",
  "Découverte : show cdp neighbors detail",
  "Fichiers : write memory, reload, delete flash:vlan.dat",
];

export function SandboxPage() {
  const [run, setRun] = useState(0);
  return (
    <>
      <PageHeader title="Lab libre" subtitle="Sans objectif ni chrono. Tout ce que tu tapes est simulé localement.">
        <Button variant="ghost" onClick={() => setRun((r) => r + 1)}>
          Réinitialiser le lab
        </Button>
      </PageHeader>
      <div className="flex min-h-0 flex-1 flex-col p-4">
        <MissionWorkspace
          key={run}
          topology={LAB_TOPOLOGY}
          objectives={[]}
          results={null}
          onCommand={() => {}}
          showModes
          aside={
            <Panel title="Idées d'exercices" hint="Tab · ? · ↑↓">
              <ul className="space-y-1.5 text-xs text-slate-400">
                {IDEAS.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            </Panel>
          }
        />
      </div>
    </>
  );
}
