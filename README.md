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
| **Missions** | 6 scénarios (switching, routage, inter-VLAN, dépannage) : briefing, chrono, objectifs cochés en direct, record personnel, top 10 |
| **Classement** | Top ELO ranked et meilleurs temps par mission |
| **Profil** | ELO, record d'ELO, stats (V/D/N, séries, missions réussies), historique des parties |
| **Lab libre** | Switch L2, switch L3 et routeur sans objectif |

**Validation côté serveur** : les objectifs visibles ne sont que des libellés.
Les assertions exactes restent sur le serveur, qui rejoue chaque commande sur
son propre `Lab` pour décider si un objectif est atteint. En ranked, c'est le
serveur qui mesure le temps et désigne le vainqueur.

**Rangs** : Bronze (< 1150) → Silver → Gold (1300) → Platinum (1450) →
Diamond (1650) → Master (1850) → CCIE (2100), en divisions III/II/I jusqu'à
Diamond. Nouveau compte : 1000 ELO, Bronze II. K = 40 pendant les 20 premiers
matchs, puis 24 (16 à partir de Master).

## Prototype CLI

Trois équipements sont disponibles (switch L2, switch L3, routeur). Ce qui
est implémenté :

- **Modes** : `>` User EXEC, `#` Privileged EXEC, `(config)#`, `(config-if)#`,
  `(config-vlan)#`, avec `enable`, `disable`, `configure terminal`, `exit`,
  `end`, `Ctrl+Z`, et `do <cmd>` depuis les modes config. Une commande globale
  tapée en sous-mode (ex. `hostname` dans `config-if`) repasse en `(config)#`,
  comme sur IOS.
- **Parsing IOS** : abréviations non ambiguës (`conf t`, `sh ip int br`,
  `int g0/1`), erreurs `% Invalid input detected at '^' marker.` avec le
  caret sous le mot fautif, `% Ambiguous command`, `% Incomplete command.`
- **Aide & édition** : `?` contextuel (liste complète ou mots commençant par…),
  `Tab` pour compléter, historique ↑/↓, Ctrl+A/E/U/C.
- **Commandes** : `hostname`, `interface`, `ip address` (contrôle des adresses
  réseau et des chevauchements), `shutdown`/`no shutdown`, `description`,
  `vlan`/`name`, `switchport mode|access vlan`, `no switchport` (L3),
  `ip route`, `write memory`, `show ip interface brief`, `show vlan brief`,
  `show ip route`, `show mac address-table`, `show running-config`,
  `show startup-config`, `show version`, `show history`.
- **Syslog** : `%LINK-3-UPDOWN` / `%LINEPROTO-5-UPDOWN` quand un port change
  d'état. Le panneau « Ports physiques » simule le branchement d'un câble
  (en attendant le canvas de topologie).
