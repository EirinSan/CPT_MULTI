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

/** Trunks toward the other switches + VLANs 10 and 20 (STP mission). */
const trunkStartup = ["vlan 10", "vlan 20", "interface range g0/1 - 2", "switchport mode trunk"];

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
  {
    slug: "trunk-inter-switch",
    title: "Trunk entre deux switches",
    summary: "VLANs sur deux switches reliés par un trunk 802.1Q propre.",
    briefing:
      "Les VLANs 10 ADMIN et 20 PROD doivent exister sur SW1 et SW2, avec Fa0/1 en VLAN 10 et Fa0/2 en VLAN 20 sur chaque switch (mode access). Le lien Gi0/1 entre les deux doit devenir un trunk forcé (pas de DTP dynamique), avec le VLAN natif 99 (NATIVE) et seulement les VLANs 10, 20 et 99 autorisés.",
    difficulty: "MEDIUM",
    category: "SWITCHING",
    modes: ["SPEEDRUN", "RANKED_1V1"],
    tags: ["trunk", "native vlan", "allowed vlan"],
    timeLimit: 900,
    parTimeSec: 240,
    topology: {
      version: 1,
      devices: [
        { id: "SW1", kind: "switch-l2", hostname: "SW1", position: at(140, 120) },
        { id: "SW2", kind: "switch-l2", hostname: "SW2", position: at(400, 120) },
        pc("PC1", 60, 300),
        pc("PC2", 200, 300),
        pc("PC3", 340, 300),
        pc("PC4", 480, 300),
      ],
      links: [
        link("SW1", "GigabitEthernet0/1", "SW2", "GigabitEthernet0/1", "copper-crossover"),
        link("SW1", "FastEthernet0/1", "PC1", "eth0"),
        link("SW1", "FastEthernet0/2", "PC2", "eth0"),
        link("SW2", "FastEthernet0/1", "PC3", "eth0"),
        link("SW2", "FastEthernet0/2", "PC4", "eth0"),
      ],
    },
    assertions: {
      all: [
        { label: "SW1 : Fa0/1 dans le VLAN 10 ADMIN", type: "vlan", device: "SW1", vlanId: 10, name: "ADMIN", accessPorts: ["Fa0/1"] },
        { label: "SW1 : Fa0/2 dans le VLAN 20 PROD", type: "vlan", device: "SW1", vlanId: 20, name: "PROD", accessPorts: ["Fa0/2"] },
        { label: "SW2 : Fa0/1 dans le VLAN 10 ADMIN", type: "vlan", device: "SW2", vlanId: 10, name: "ADMIN", accessPorts: ["Fa0/1"] },
        { label: "SW2 : Fa0/2 dans le VLAN 20 PROD", type: "vlan", device: "SW2", vlanId: 20, name: "PROD", accessPorts: ["Fa0/2"] },
        { label: "SW1 Gi0/1 : trunk, natif 99, VLANs 10,20,99", type: "trunk", device: "SW1", interface: "Gi0/1", nativeVlan: 99, allowedVlans: [10, 20, 99] },
        { label: "SW2 Gi0/1 : trunk, natif 99, VLANs 10,20,99", type: "trunk", device: "SW2", interface: "Gi0/1", nativeVlan: 99, allowedVlans: [10, 20, 99] },
        { label: "Trunk forcé (mode trunk) des deux côtés", type: "running-config", device: "SW1", section: "^interface GigabitEthernet0/1$", pattern: "^ switchport mode trunk$" },
      ],
    },
    solution: Object.fromEntries(
      ["SW1", "SW2"].map((id) => [
        id,
        [
          ...PRIV,
          "vlan 10",
          "name ADMIN",
          "vlan 20",
          "name PROD",
          "vlan 99",
          "name NATIVE",
          "interface fa0/1",
          "switchport mode access",
          "switchport access vlan 10",
          "interface fa0/2",
          "switchport mode access",
          "switchport access vlan 20",
          "interface g0/1",
          "switchport mode trunk",
          "switchport trunk native vlan 99",
          "switchport trunk allowed vlan 10,20,99",
          "end",
        ],
      ]),
    ),
  },
  {
    slug: "securiser-switch",
    title: "Sécuriser l'accès au switch",
    summary: "Mots de passe, SSH v2, comptes locaux : le durcissement de base.",
    briefing:
      "Un switch neuf arrive avec la configuration d'usine. Nomme-le SW-SEC, protège le mode privilégié par un enable secret, protège la console par un mot de passe, crée le compte admin (privilège 15, secret) et n'autorise l'administration à distance qu'en SSH v2 avec les comptes locaux, sur toutes les lignes VTY. Chiffre les mots de passe en clair et ajoute une bannière MOTD. Domaine : lab.local.",
    difficulty: "MEDIUM",
    category: "SECURITY",
    modes: ["SPEEDRUN", "RANKED_1V1"],
    tags: ["enable secret", "ssh", "vty", "service password-encryption"],
    timeLimit: 900,
    parTimeSec: 210,
    topology: {
      version: 1,
      devices: [
        { id: "SW1", kind: "switch-l2", hostname: "Switch", position: at(260, 120) },
        pc("ADMIN-PC", 260, 300),
      ],
      links: [link("SW1", "FastEthernet0/1", "ADMIN-PC", "eth0")],
    },
    assertions: {
      all: [
        { label: "Le switch s'appelle SW-SEC", type: "hostname", device: "SW1", value: "SW-SEC" },
        { label: "Enable secret configuré", type: "running-config", device: "SW1", pattern: "^enable secret " },
        { label: "Console protégée par mot de passe", type: "running-config", device: "SW1", section: "^line con 0$", pattern: "^ login$" },
        { label: "Compte admin (privilège 15, secret)", type: "running-config", device: "SW1", pattern: "^username admin privilege 15 secret " },
        { label: "SSH version 2 activé", type: "running-config", device: "SW1", pattern: "^ip ssh version 2$" },
        { label: "Toutes les VTY : SSH uniquement", type: "running-config", device: "SW1", section: "^line vty", pattern: "^ transport input ssh$", every: true },
        { label: "Toutes les VTY : login local", type: "running-config", device: "SW1", section: "^line vty", pattern: "^ login local$", every: true },
        { label: "Mots de passe chiffrés", type: "running-config", device: "SW1", pattern: "^service password-encryption$" },
        { label: "Bannière MOTD présente", type: "running-config", device: "SW1", pattern: "^banner motd" },
      ],
    },
    solution: {
      SW1: [
        ...PRIV,
        "hostname SW-SEC",
        "enable secret Cl4ss3!",
        "line console 0",
        "password c0ns0le",
        "login",
        "exit",
        "username admin privilege 15 secret Adm1n!",
        "ip domain-name lab.local",
        "crypto key generate rsa general-keys modulus 1024",
        "ip ssh version 2",
        "line vty 0 15",
        "transport input ssh",
        "login local",
        "exit",
        "service password-encryption",
        "banner motd #Acces reserve au personnel autorise#",
        "end",
      ],
    },
  },
  {
    slug: "port-security",
    title: "Port-security et ports inutilisés",
    summary: "Verrouiller les ports utilisateurs, éteindre le reste.",
    briefing:
      "Trois postes sont branchés sur Fa0/1 à Fa0/3. Sur ces ports : mode access, port-security avec apprentissage sticky de l'adresse MAC du poste, et violation en mode restrict. Tous les ports inutilisés Fa0/4 à Fa0/24 doivent être désactivés.",
    difficulty: "MEDIUM",
    category: "SECURITY",
    modes: ["SPEEDRUN", "RANKED_1V1"],
    tags: ["port-security", "sticky", "hardening"],
    timeLimit: 600,
    parTimeSec: 120,
    topology: {
      version: 1,
      devices: [
        { id: "SW1", kind: "switch-l2", hostname: "SW1", position: at(260, 110) },
        pc("PC1", 120, 300),
        pc("PC2", 260, 300),
        pc("PC3", 400, 300),
      ],
      links: [
        link("SW1", "FastEthernet0/1", "PC1", "eth0"),
        link("SW1", "FastEthernet0/2", "PC2", "eth0"),
        link("SW1", "FastEthernet0/3", "PC3", "eth0"),
      ],
    },
    assertions: {
      all: [
        { label: "Fa0/1-3 : port-security activé", type: "running-config", device: "SW1", section: "^interface FastEthernet0/[1-3]$", pattern: "^ switchport port-security$", every: true },
        { label: "Fa0/1-3 : MAC du poste apprise en sticky", type: "running-config", device: "SW1", section: "^interface FastEthernet0/[1-3]$", pattern: "^ switchport port-security mac-address sticky [0-9a-f.]+$", every: true },
        { label: "Fa0/1-3 : violation en restrict", type: "running-config", device: "SW1", section: "^interface FastEthernet0/[1-3]$", pattern: "^ switchport port-security violation restrict$", every: true },
        { label: "Fa0/4 à Fa0/24 désactivés", type: "interface", device: "SW1", interface: "Fa0/4-24", status: "administratively down" },
      ],
    },
    solution: {
      SW1: [
        ...PRIV,
        "interface range fa0/1 - 3",
        "switchport mode access",
        "switchport port-security",
        "switchport port-security mac-address sticky",
        "switchport port-security violation restrict",
        "interface range fa0/4 - 24",
        "shutdown",
        "end",
      ],
    },
  },
  {
    slug: "racine-stp",
    title: "Maîtriser le spanning-tree",
    summary: "Choisir la racine, passer en Rapid-PVST, protéger les ports d'accès.",
    briefing:
      "Trois switches forment une boucle (trunks déjà en place). DSW1 doit être le pont racine des VLANs 1, 10 et 20, et ASW1 la racine de secours. Passe les trois switches en rapid-pvst. Sur les ports des postes (ASW1 Fa0/1 et ASW2 Fa0/1), active portfast et BPDU guard.",
    difficulty: "HARD",
    category: "SWITCHING",
    modes: ["SPEEDRUN", "RANKED_1V1"],
    tags: ["stp", "root bridge", "rapid-pvst", "bpduguard"],
    timeLimit: 900,
    parTimeSec: 240,
    topology: {
      version: 1,
      devices: [
        { id: "DSW1", kind: "switch-l2", hostname: "DSW1", position: at(260, 60), startupConfig: trunkStartup },
        { id: "ASW1", kind: "switch-l2", hostname: "ASW1", position: at(120, 220), startupConfig: [...trunkStartup, "interface fa0/1", "switchport mode access", "switchport access vlan 10"] },
        { id: "ASW2", kind: "switch-l2", hostname: "ASW2", position: at(400, 220), startupConfig: [...trunkStartup, "interface fa0/1", "switchport mode access", "switchport access vlan 20"] },
        pc("PC10", 120, 340),
        pc("PC20", 400, 340),
      ],
      links: [
        link("DSW1", "GigabitEthernet0/1", "ASW1", "GigabitEthernet0/1", "copper-crossover"),
        link("DSW1", "GigabitEthernet0/2", "ASW2", "GigabitEthernet0/1", "copper-crossover"),
        link("ASW1", "GigabitEthernet0/2", "ASW2", "GigabitEthernet0/2", "copper-crossover"),
        link("ASW1", "FastEthernet0/1", "PC10", "eth0"),
        link("ASW2", "FastEthernet0/1", "PC20", "eth0"),
      ],
    },
    assertions: {
      all: [
        { label: "DSW1 racine du VLAN 1", type: "stp-root", device: "DSW1", vlan: 1 },
        { label: "DSW1 racine du VLAN 10", type: "stp-root", device: "DSW1", vlan: 10 },
        { label: "DSW1 racine du VLAN 20", type: "stp-root", device: "DSW1", vlan: 20 },
        { label: "ASW1 racine de secours (priorité 28672)", type: "running-config", device: "ASW1", pattern: "^spanning-tree vlan \\S+ priority 28672$" },
        { label: "DSW1 en rapid-pvst", type: "running-config", device: "DSW1", pattern: "^spanning-tree mode rapid-pvst$" },
        { label: "ASW1 en rapid-pvst", type: "running-config", device: "ASW1", pattern: "^spanning-tree mode rapid-pvst$" },
        { label: "ASW2 en rapid-pvst", type: "running-config", device: "ASW2", pattern: "^spanning-tree mode rapid-pvst$" },
        { label: "Postes : portfast + BPDU guard (ASW1)", type: "running-config", device: "ASW1", section: "^interface FastEthernet0/1$", pattern: "^ spanning-tree bpduguard enable$" },
        { label: "Postes : portfast + BPDU guard (ASW2)", type: "running-config", device: "ASW2", section: "^interface FastEthernet0/1$", pattern: "^ spanning-tree bpduguard enable$" },
      ],
    },
    solution: {
      DSW1: [...PRIV, "spanning-tree mode rapid-pvst", "spanning-tree vlan 1,10,20 root primary", "end"],
      ASW1: [...PRIV, "spanning-tree mode rapid-pvst", "spanning-tree vlan 1,10,20 root secondary", "interface fa0/1", "spanning-tree portfast", "spanning-tree bpduguard enable", "end"],
      ASW2: [...PRIV, "spanning-tree mode rapid-pvst", "interface fa0/1", "spanning-tree portfast", "spanning-tree bpduguard enable", "end"],
    },
  },
  {
    slug: "etherchannel-lacp",
    title: "EtherChannel LACP",
    summary: "Agréger deux liens en un port-channel trunk.",
    briefing:
      "SW1 et SW2 sont reliés par deux câbles (Fa0/23 et Fa0/24) : aujourd'hui le spanning-tree en bloque un. Regroupe-les dans un EtherChannel LACP (groupe 1) et fais du Port-channel1 un trunk des deux côtés.",
    difficulty: "HARD",
    category: "SWITCHING",
    modes: ["SPEEDRUN", "RANKED_1V1"],
    tags: ["etherchannel", "lacp", "port-channel"],
    timeLimit: 600,
    parTimeSec: 150,
    topology: {
      version: 1,
      devices: [
        { id: "SW1", kind: "switch-l2", hostname: "SW1", position: at(140, 150) },
        { id: "SW2", kind: "switch-l2", hostname: "SW2", position: at(400, 150) },
      ],
      links: [
        link("SW1", "FastEthernet0/23", "SW2", "FastEthernet0/23", "copper-crossover"),
        link("SW1", "FastEthernet0/24", "SW2", "FastEthernet0/24", "copper-crossover"),
      ],
    },
    assertions: {
      all: [
        { label: "SW1 : Po1 LACP avec 2 liens", type: "etherchannel", device: "SW1", group: 1, protocol: "lacp", minMembers: 2 },
        { label: "SW2 : Po1 LACP avec 2 liens", type: "etherchannel", device: "SW2", group: 1, protocol: "lacp", minMembers: 2 },
        { label: "SW1 : Port-channel1 en trunk", type: "trunk", device: "SW1", interface: "Port-channel1" },
        { label: "SW2 : Port-channel1 en trunk", type: "trunk", device: "SW2", interface: "Port-channel1" },
      ],
    },
    solution: {
      SW1: [...PRIV, "interface range fa0/23 - 24", "channel-group 1 mode active", "interface port-channel 1", "switchport mode trunk", "end"],
      SW2: [...PRIV, "interface range fa0/23 - 24", "channel-group 1 mode passive", "interface port-channel 1", "switchport mode trunk", "end"],
    },
  },
];

export function missionBySlug(slug: string): MissionDefinition | undefined {
  return MISSIONS.find((m) => m.slug === slug);
}
