/**
 * Mission catalog. Seeded into the `Challenge` table; never bundled into the
 * web client (it contains assertions and solutions).
 */
import type { Topology, TopologyDevice } from "@cpt/shared";
import type { MissionDefinition } from "./types";

const at = (x: number, y: number) => ({ x, y });

function pc(id: string, x: number, y: number): TopologyDevice {
  return { id, kind: "pc", hostname: id, position: at(x, y) };
}

let linkSeq = 0;
function link(a: string, ai: string, b: string, bi: string, cable: Topology["links"][number]["cable"] = "copper-straight") {
  return { id: `l${++linkSeq}`, cable, a: { deviceId: a, interface: ai }, b: { deviceId: b, interface: bi } };
}

const PRIV = ["enable", "configure terminal"];

export const MISSIONS: MissionDefinition[] = [
  {
    slug: "premiers-pas",
    title: "Premiers pas",
    summary: "Nommer un switch et lui donner une IP de management.",
    briefing:
      "Un switch d'accès vient d'être posé dans la baie. Donne-lui son nom définitif puis configure son interface de management (SVI VLAN 1) pour qu'il soit joignable.",
    difficulty: "EASY",
    category: "SWITCHING",
    modes: ["SPEEDRUN", "RANKED_1V1"],
    tags: ["hostname", "svi"],
    timeLimit: 300,
    parTimeSec: 45,
    topology: {
      version: 1,
      devices: [
        { id: "SW1", kind: "switch-l2", hostname: "Switch", position: at(260, 120) },
        pc("PC1", 260, 300),
      ],
      links: [link("SW1", "FastEthernet0/1", "PC1", "eth0")],
    },
    assertions: {
      all: [
        { label: "Le switch s'appelle SW-ACCES", type: "hostname", device: "SW1", value: "SW-ACCES" },
        {
          label: "Interface Vlan1 en 192.168.1.2/24",
          type: "interface",
          device: "SW1",
          interface: "Vlan1",
          ipv4: "192.168.1.2/24",
        },
        { label: "Interface Vlan1 up/up", type: "interface", device: "SW1", interface: "Vlan1", status: "up" },
      ],
    },
    solution: {
      SW1: [...PRIV, "hostname SW-ACCES", "interface vlan 1", "ip address 192.168.1.2 255.255.255.0", "no shutdown", "end"],
    },
  },
  {
    slug: "vlans-departements",
    title: "VLANs par département",
    summary: "Segmenter un switch en deux VLANs nommés.",
    briefing:
      "Les postes des Ventes (Fa0/1-2) et de la Compta (Fa0/3-4) partagent le même domaine de broadcast. Crée le VLAN 10 VENTES et le VLAN 20 COMPTA, puis place chaque port dans son VLAN en mode access.",
    difficulty: "EASY",
    category: "SWITCHING",
    modes: ["SPEEDRUN", "RANKED_1V1"],
    tags: ["vlan", "access"],
    timeLimit: 420,
    parTimeSec: 90,
    topology: {
      version: 1,
      devices: [
        { id: "SW1", kind: "switch-l2", hostname: "SW1", position: at(260, 110) },
        pc("PC1", 80, 300),
        pc("PC2", 200, 300),
        pc("PC3", 320, 300),
        pc("PC4", 440, 300),
      ],
      links: [
        link("SW1", "FastEthernet0/1", "PC1", "eth0"),
        link("SW1", "FastEthernet0/2", "PC2", "eth0"),
        link("SW1", "FastEthernet0/3", "PC3", "eth0"),
        link("SW1", "FastEthernet0/4", "PC4", "eth0"),
      ],
    },
    assertions: {
      all: [
        { label: "VLAN 10 nommé VENTES", type: "vlan", device: "SW1", vlanId: 10, name: "VENTES" },
        { label: "VLAN 20 nommé COMPTA", type: "vlan", device: "SW1", vlanId: 20, name: "COMPTA" },
        { label: "Fa0/1 et Fa0/2 dans le VLAN 10", type: "vlan", device: "SW1", vlanId: 10, accessPorts: ["Fa0/1", "Fa0/2"] },
        { label: "Fa0/3 et Fa0/4 dans le VLAN 20", type: "vlan", device: "SW1", vlanId: 20, accessPorts: ["Fa0/3", "Fa0/4"] },
      ],
    },
    solution: {
      SW1: [
        ...PRIV,
        "vlan 10",
        "name VENTES",
        "vlan 20",
        "name COMPTA",
        "interface fa0/1",
        "switchport mode access",
        "switchport access vlan 10",
        "interface fa0/2",
        "switchport access vlan 10",
        "interface fa0/3",
        "switchport access vlan 20",
        "interface fa0/4",
        "switchport access vlan 20",
        "end",
      ],
    },
  },
  {
    slug: "adressage-routeur",
    title: "Adressage d'un routeur",
    summary: "Activer et adresser les deux LANs d'un routeur.",
    briefing:
      "R1 relie deux LANs mais toutes ses interfaces sont éteintes. Adresse Gi0/0/0 en 10.0.10.1/24 et Gi0/0/1 en 10.0.20.1/24, puis active-les : les deux réseaux doivent apparaître comme directement connectés.",
    difficulty: "MEDIUM",
    category: "ROUTING",
    modes: ["SPEEDRUN", "RANKED_1V1"],
    tags: ["ip address", "no shutdown", "connected"],
    timeLimit: 420,
    parTimeSec: 75,
    topology: {
      version: 1,
      devices: [
        { id: "R1", kind: "router", hostname: "R1", position: at(260, 90) },
        { id: "SW1", kind: "switch-l2", hostname: "SW1", position: at(120, 250) },
        { id: "SW2", kind: "switch-l2", hostname: "SW2", position: at(400, 250) },
      ],
      links: [
        link("R1", "GigabitEthernet0/0/0", "SW1", "GigabitEthernet0/1"),
        link("R1", "GigabitEthernet0/0/1", "SW2", "GigabitEthernet0/1"),
      ],
    },
    assertions: {
      all: [
        { label: "Gi0/0/0 en 10.0.10.1/24 et up", type: "interface", device: "R1", interface: "Gi0/0/0", ipv4: "10.0.10.1/24", status: "up" },
        { label: "Gi0/0/1 en 10.0.20.1/24 et up", type: "interface", device: "R1", interface: "Gi0/0/1", ipv4: "10.0.20.1/24", status: "up" },
        { label: "Route connectée 10.0.10.0/24", type: "route", device: "R1", prefix: "10.0.10.0/24", protocol: "connected" },
        { label: "Route connectée 10.0.20.0/24", type: "route", device: "R1", prefix: "10.0.20.0/24", protocol: "connected" },
      ],
    },
    solution: {
      R1: [
        ...PRIV,
        "interface g0/0/0",
        "ip address 10.0.10.1 255.255.255.0",
        "no shutdown",
        "interface g0/0/1",
        "ip address 10.0.20.1 255.255.255.0",
        "no shutdown",
        "end",
      ],
    },
  },
  {
    slug: "routes-statiques",
    title: "Routes statiques",
    summary: "Relier deux sites par un lien /30 et des routes statiques.",
    briefing:
      "Les LANs de R1 (192.168.1.0/24) et R2 (192.168.2.0/24) sont déjà configurés. Monte le lien inter-sites en 10.0.12.0/30 (R1 = .1, R2 = .2) sur Gi0/0/0, puis ajoute sur chaque routeur la route statique vers le LAN distant.",
    difficulty: "MEDIUM",
    category: "ROUTING",
    modes: ["SPEEDRUN", "RANKED_1V1"],
    tags: ["ip route", "/30"],
    timeLimit: 600,
    parTimeSec: 120,
    topology: {
      version: 1,
      devices: [
        {
          id: "R1",
          kind: "router",
          hostname: "R1",
          position: at(140, 120),
          startupConfig: ["interface g0/0/1", "ip address 192.168.1.1 255.255.255.0", "no shutdown"],
        },
        {
          id: "R2",
          kind: "router",
          hostname: "R2",
          position: at(380, 120),
          startupConfig: ["interface g0/0/1", "ip address 192.168.2.1 255.255.255.0", "no shutdown"],
        },
        pc("PC1", 140, 300),
        pc("PC2", 380, 300),
      ],
      links: [
        link("R1", "GigabitEthernet0/0/0", "R2", "GigabitEthernet0/0/0", "copper-crossover"),
        link("R1", "GigabitEthernet0/0/1", "PC1", "eth0"),
        link("R2", "GigabitEthernet0/0/1", "PC2", "eth0"),
      ],
    },
    assertions: {
      all: [
        { label: "R1 Gi0/0/0 en 10.0.12.1/30 et up", type: "interface", device: "R1", interface: "Gi0/0/0", ipv4: "10.0.12.1/30", status: "up" },
        { label: "R2 Gi0/0/0 en 10.0.12.2/30 et up", type: "interface", device: "R2", interface: "Gi0/0/0", ipv4: "10.0.12.2/30", status: "up" },
        { label: "R1 route vers 192.168.2.0/24 via 10.0.12.2", type: "route", device: "R1", prefix: "192.168.2.0/24", protocol: "static", nextHop: "10.0.12.2" },
        { label: "R2 route vers 192.168.1.0/24 via 10.0.12.1", type: "route", device: "R2", prefix: "192.168.1.0/24", protocol: "static", nextHop: "10.0.12.1" },
      ],
    },
    solution: {
      R1: [...PRIV, "interface g0/0/0", "ip address 10.0.12.1 255.255.255.252", "no shutdown", "exit", "ip route 192.168.2.0 255.255.255.0 10.0.12.2", "end"],
      R2: [...PRIV, "interface g0/0/0", "ip address 10.0.12.2 255.255.255.252", "no shutdown", "exit", "ip route 192.168.1.0 255.255.255.0 10.0.12.1", "end"],
    },
  },
  {
    slug: "inter-vlan-l3",
    title: "Routage inter-VLAN",
    summary: "Passerelles SVI sur un switch L3 et uplink routé.",
    briefing:
      "DSW1 doit devenir la passerelle des VLANs 10 (Fa0/1) et 20 (Fa0/2) : SVI en 10.10.0.1/24 et 10.20.0.1/24. Son port Gi0/1 vers R1 doit devenir un port routé en 172.16.0.2/30, avec une route par défaut vers R1 (172.16.0.1).",
    difficulty: "HARD",
    category: "ROUTING",
    modes: ["SPEEDRUN", "RANKED_1V1"],
    tags: ["svi", "no switchport", "default route"],
    timeLimit: 900,
    parTimeSec: 210,
    topology: {
      version: 1,
      devices: [
        {
          id: "R1",
          kind: "router",
          hostname: "R1",
          position: at(260, 60),
          startupConfig: ["interface g0/0/0", "ip address 172.16.0.1 255.255.255.252", "no shutdown"],
        },
        { id: "DSW1", kind: "switch-l3", hostname: "DSW1", position: at(260, 190) },
        pc("PC10", 140, 320),
        pc("PC20", 380, 320),
      ],
      links: [
        link("R1", "GigabitEthernet0/0/0", "DSW1", "GigabitEthernet0/1"),
        link("DSW1", "FastEthernet0/1", "PC10", "eth0"),
        link("DSW1", "FastEthernet0/2", "PC20", "eth0"),
      ],
    },
    assertions: {
      all: [
        { label: "Fa0/1 dans le VLAN 10", type: "vlan", device: "DSW1", vlanId: 10, accessPorts: ["Fa0/1"] },
        { label: "Fa0/2 dans le VLAN 20", type: "vlan", device: "DSW1", vlanId: 20, accessPorts: ["Fa0/2"] },
        { label: "SVI Vlan10 en 10.10.0.1/24 et up", type: "interface", device: "DSW1", interface: "Vlan10", ipv4: "10.10.0.1/24", status: "up" },
        { label: "SVI Vlan20 en 10.20.0.1/24 et up", type: "interface", device: "DSW1", interface: "Vlan20", ipv4: "10.20.0.1/24", status: "up" },
        { label: "Gi0/1 routé en 172.16.0.2/30", type: "interface", device: "DSW1", interface: "Gi0/1", mode: "routed", ipv4: "172.16.0.2/30", status: "up" },
        { label: "Route par défaut via 172.16.0.1", type: "route", device: "DSW1", prefix: "0.0.0.0/0", protocol: "static", nextHop: "172.16.0.1" },
      ],
    },
    solution: {
      DSW1: [
        ...PRIV,
        "interface fa0/1",
        "switchport access vlan 10",
        "interface fa0/2",
        "switchport access vlan 20",
        "interface vlan 10",
        "ip address 10.10.0.1 255.255.255.0",
        "interface vlan 20",
        "ip address 10.20.0.1 255.255.255.0",
        "interface g0/1",
        "no switchport",
        "ip address 172.16.0.2 255.255.255.252",
        "exit",
        "ip route 0.0.0.0 0.0.0.0 172.16.0.1",
        "end",
      ],
    },
  },
  {
    slug: "depannage-agence",
    title: "Dépannage d'agence",
    summary: "Trois erreurs de config cassent l'agence. Trouve-les.",
    briefing:
      "Depuis la dernière intervention, l'agence est coupée du siège. Le routeur R1 doit avoir son WAN Gi0/0/0 en 10.1.0.1/24 et actif, le serveur branché sur SW1 Fa0/5 doit être dans le VLAN 30 SERVEURS, et une route statique parasite vers 0.0.0.0/0 doit disparaître. Utilise les commandes show pour trouver ce qui cloche.",
    difficulty: "HARD",
    category: "TROUBLESHOOTING",
    modes: ["SPEEDRUN", "RANKED_1V1"],
    tags: ["show", "troubleshooting"],
    timeLimit: 900,
    parTimeSec: 180,
    topology: {
      version: 1,
      devices: [
        {
          id: "R1",
          kind: "router",
          hostname: "R1-AGENCE",
          position: at(260, 70),
          startupConfig: [
            "interface g0/0/0",
            "ip address 10.1.1.1 255.255.255.0",
            "shutdown",
            "interface g0/0/1",
            "ip address 192.168.50.1 255.255.255.0",
            "no shutdown",
            "exit",
            "ip route 0.0.0.0 0.0.0.0 192.168.50.254",
          ],
        },
        {
          id: "SW1",
          kind: "switch-l2",
          hostname: "SW1-AGENCE",
          position: at(260, 210),
          startupConfig: ["vlan 30", "name SERVEURS", "interface fa0/5", "switchport access vlan 1"],
        },
        { id: "SRV1", kind: "server", hostname: "SRV1", position: at(420, 330) },
        { id: "WAN", kind: "pc", hostname: "WAN", position: at(460, 70) },
      ],
      links: [
        link("R1", "GigabitEthernet0/0/0", "WAN", "eth0"),
        link("R1", "GigabitEthernet0/0/1", "SW1", "GigabitEthernet0/1"),
        link("SW1", "FastEthernet0/5", "SRV1", "eth0"),
      ],
    },
    assertions: {
      all: [
        { label: "R1 Gi0/0/0 en 10.1.0.1/24 et up", type: "interface", device: "R1", interface: "Gi0/0/0", ipv4: "10.1.0.1/24", status: "up" },
        { label: "SRV1 (Fa0/5) dans le VLAN 30", type: "vlan", device: "SW1", vlanId: 30, name: "SERVEURS", accessPorts: ["Fa0/5"] },
        { label: "Plus de route par défaut parasite", type: "route", device: "R1", prefix: "0.0.0.0/0", absent: true },
      ],
    },
    solution: {
      R1: [
        ...PRIV,
        "interface g0/0/0",
        "ip address 10.1.0.1 255.255.255.0",
        "no shutdown",
        "exit",
        "no ip route 0.0.0.0 0.0.0.0 192.168.50.254",
        "end",
      ],
      SW1: [...PRIV, "interface fa0/5", "switchport access vlan 30", "end"],
    },
  },
];

export function missionBySlug(slug: string): MissionDefinition | undefined {
  return MISSIONS.find((m) => m.slug === slug);
}
