# CPT_MULTI

Plateforme web de simulation réseau **interactive et compétitive** : éditeur
de topologies, CLI type Cisco IOS, défis chronométrés classés (ELO) et
intégration Discord Rich Presence.

> État actuel : **fondations**. Monorepo, modèle de données, prototype de CLI
> IOS jouable dans le navigateur et architecture du moteur de simulation.

## Structure du monorepo

Monorepo **pnpm workspaces + Turborepo**, TypeScript partout.

| Paquet | Rôle |
|---|---|
| `apps/web` | Client React 19 + Vite + Tailwind 4 + Zustand + xterm.js (prototype de console) |
| `apps/server` | API Fastify 5 (challenges, leaderboards) — Socket.io à venir pour les matchs |
| `packages/cli-engine` | Machine à états CLI IOS : grammaire en trie, abréviations, `?`, Tab, historique, commandes `show`/config |
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

Base de données (optionnel pour le prototype CLI) :

```bash
cp packages/db/.env.example packages/db/.env   # renseigner DATABASE_URL
pnpm db:migrate
pnpm --filter @cpt/server dev                  # http://localhost:3001
```

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
