# CPT_MULTI

Plateforme web de simulation réseau **interactive et compétitive** : éditeur
de topologies, CLI type Cisco IOS, défis chronométrés classés (ELO) et
intégration Discord Rich Presence.

> État actuel : comptes joueurs, **missions solo chronométrées**, **ranked 1v1
> en temps réel** avec ELO, classements et profil, sur une CLI IOS jouable dans
> le navigateur. Le moteur de paquets (ping, ARP…) est la prochaine étape.

## Structure du monorepo

Monorepo **pnpm workspaces + Turborepo**, TypeScript partout.

| Paquet | Rôle |
|---|---|
| `apps/web` | Client React 19 + React Router + Tailwind 4 + Zustand + xterm.js : menu, compte, missions, ranked, classements, lab libre |
| `apps/server` | API Fastify 5 (auth JWT, profil, missions, classements) + Socket.io (matchmaking et matchs ranked) |
| `packages/cli-engine` | Machine à états CLI IOS, `Lab` multi-équipements (état des câbles), table de routage, évaluateur d'assertions |
| `packages/missions` | Catalogue des missions avec objectifs et solutions de référence (côté serveur uniquement) |
| `packages/shared` | Types partagés : topologie, assertions de validation, ELO / rangs, payload Discord |
| `packages/db` | Schéma Prisma 7 (PostgreSQL) + client |
| `docs/architecture` | [Moteur de simulation à événements discrets](docs/architecture/simulation-engine.md) |

## Démarrage

Prérequis : Node ≥ 22, pnpm 10.

```bash
pnpm install
pnpm --filter @cpt/web dev        # http://localhost:5173 — console CLI
pnpm test                         # tests unitaires (vitest)
pnpm typecheck
```

Stack complète (compte, missions, ranked) — il faut un PostgreSQL :

```bash
cp packages/db/.env.example packages/db/.env       # DATABASE_URL
cp apps/server/.env.example apps/server/.env       # DATABASE_URL + JWT_SECRET
openssl rand -hex 32                               # à coller dans JWT_SECRET (32 caractères min.)
pnpm db:migrate                                    # crée les tables
pnpm --filter @cpt/server seed                     # charge les missions
pnpm --filter @cpt/server dev                      # API + Socket.io sur :3001
pnpm --filter @cpt/web dev                         # :5173 (proxy /api et /socket.io)
```

Pour tester le ranked seul, ouvre deux fenêtres (dont une en navigation
privée) avec deux comptes différents et lance la recherche dans les deux.

## Menu et modes de jeu

| Page | Contenu |
|---|---|
| **Accueil** | Rang actuel, progression vers le rang suivant, prochaine mission à faire |
| **Ranked 1v1** | File de matchmaking (l'écart d'ELO accepté s'élargit avec l'attente) → même mission pour les deux joueurs → progression de l'adversaire en direct → résultat et variation d'ELO |
| **Missions** | 11 scénarios (VLAN, trunk, routage, inter-VLAN, sécurisation SSH, port-security, STP, EtherChannel, dépannage) : briefing, chrono, objectifs cochés en direct, record personnel, top 10 |
| **Classement** | Top ELO ranked et meilleurs temps par mission |
| **Profil** | ELO, record d'ELO, stats (V/D/N, séries, missions réussies), historique des parties |
| **Lab libre** | Topologie complète (routeur, switch L3, deux switches en boucle, postes) sans objectif |
| **Commandes** | Référence de toutes les commandes simulées, avec recherche |

**Validation côté serveur** : les objectifs visibles ne sont que des libellés.
Les assertions exactes restent sur le serveur, qui rejoue chaque commande sur
son propre `Lab` pour décider si un objectif est atteint. En ranked, c'est le
serveur qui mesure le temps et désigne le vainqueur.

**Rangs** : Bronze (< 1150) → Silver → Gold (1300) → Platinum (1450) →
Diamond (1650) → Master (1850) → CCIE (2100), en divisions III/II/I jusqu'à
Diamond. Nouveau compte : 1000 ELO, Bronze II. K = 40 pendant les 20 premiers
matchs, puis 24 (16 à partir de Master).

## CLI Cisco IOS simulée

La page **Commandes** du site liste toutes les commandes reconnues, générées
depuis la grammaire du simulateur (≈ 370 sur un switch L2, 380 sur un L3,
190 sur un routeur). Abréviations (`sh run`, `conf t`, `int g0/1`), `?`,
Tab, historique, `do`, `| include / exclude / begin / section / count`.

| Domaine | Commandes principales |
|---|---|
| Modes | `enable` (avec mot de passe), `disable`, `configure terminal`, `interface`, `interface range fa0/1 - 12`, `vlan`, `line console 0`, `line vty 0 15`, `exit`, `end`, Ctrl+Z |
| Fichiers | `write memory`, `copy running-config startup-config` (et l'inverse), `erase startup-config`, `reload`, `delete flash:vlan.dat`, `dir flash:` |
| Sécurité d'accès | `enable secret/password`, `service password-encryption` (type 7), `username … privilege 15 secret`, `password` / `login` / `login local`, `transport input ssh`, `exec-timeout`, `banner motd`, `ip domain-name`, `crypto key generate rsa`, `ip ssh version 2` |
| VLAN / trunk | `vlan`, `name`, `switchport mode access/trunk/dynamic auto/dynamic desirable`, `switchport access vlan`, `switchport voice vlan`, `switchport trunk native vlan`, `switchport trunk allowed vlan add/remove/except`, `switchport nonegotiate`, `switchport trunk encapsulation` (L3) |
| VTP | `vtp mode server/client/transparent/off`, `vtp domain`, `vtp password`, `vtp version` |
| Spanning tree | `spanning-tree mode pvst/rapid-pvst/mst`, `spanning-tree vlan … priority / root primary/secondary`, `portfast` (port et `default`), `bpduguard`, `cost`, `port-priority` |
| Sécurité L2 | `switchport port-security` (maximum, violation, mac-address sticky/statique, aging), `ip dhcp snooping`, `ip arp inspection`, `errdisable recovery` |
| EtherChannel | `channel-group N mode active/passive/on/desirable/auto`, `interface port-channel` |
| IP | `ip address`, `ip default-gateway`, `ip routing`, `ip route`, `ip helper-address`, `no switchport` (L3) |
| Divers | `hostname`, `description`, `speed`, `duplex`, `cdp run/enable`, `lldp run`, `mac address-table static/aging-time`, `ntp server`, `logging host`, `clock set`, `terminal length`, `clear mac address-table/port-security/counters` |
| show | `running-config [interface]`, `startup-config`, `version`, `interfaces [status/trunk/switchport/description]`, `ip interface brief`, `vlan [brief/id]`, `mac address-table […]`, `spanning-tree [vlan/summary]`, `port-security [interface/address]`, `etherchannel summary`, `vtp status`, `cdp neighbors [detail]`, `ip route`, `ip ssh`, `arp`, `clock`, `flash:`, `users`, `logging`, `history`… |

**Ce que le lab calcule vraiment** après chaque commande (`packages/cli-engine/src/l2.ts`) :
état des câbles, négociation DTP, bundling EtherChannel (LACP/PAgP/on),
synchronisation VTP (y compris le piège de la révision plus haute),
élection spanning-tree par VLAN (rôles Root/Desg/Altn, ports bloqués),
BPDU guard et port-security (passage en err-disabled avec les messages
syslog IOS), apprentissage des adresses MAC le long de l'arbre STP, voisins
CDP et détection de VLAN natif différent.

**Limites** : pas encore de moteur de paquets. `ping`, `traceroute`,
`telnet` et `ssh` répondent qu'ils ne sont pas simulés, les compteurs de
trafic restent à 0, et les protocoles sont résolus « à convergence » (pas de
timers ni d'états listening/learning). Les postes sont supposés émettre du
trafic dès que leur lien est up, ce qui fait apprendre leur MAC.
