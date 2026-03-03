# Traiders

Stock screener complet avec donnees historiques, fondamentales et scoring qualite.
Frontend SPA + API REST + worker de synchronisation, le tout en TypeScript strict.

## Stack technique

| Couche | Technologie |
|--------|------------|
| **Monorepo** | PNPM workspaces + TypeScript strict |
| **Frontend** | React 19 + Vite 6 + React Router 7 |
| **API** | Fastify 5 + Zod validation |
| **ORM / DB** | Prisma 6 + PostgreSQL 16 |
| **Worker** | Node.js cron (library `cron`) + Nodemailer |
| **Donnees** | EODHD API (EOD, fondamentaux, tickers) |
| **Auth** | JWT (@fastify/jwt) + scrypt hashing |
| **Deploiement** | Docker Compose / Railway |

## Structure du monorepo

```
traiders/
├── apps/
│   ├── web/                 # SPA React (Vite, port 5173)
│   ├── api/                 # API Fastify (port 4000)
│   └── worker/              # Cron jobs de synchronisation EODHD
├── packages/
│   ├── shared/              # Types TS, schemas Zod, presets, formatage
│   └── eodhd-client/        # Client HTTP type pour l'API EODHD
├── nginx/                   # Config reverse proxy (prod)
├── Dockerfile.api
├── Dockerfile.worker
├── Dockerfile.web
├── docker-compose.yml       # Dev (avec PostgreSQL local)
├── docker-compose.prod.yml  # Prod (DB externe type Neon)
└── railway.toml             # Config Railway
```

## Fonctionnalites

### Screener multicriteres

- **35+ filtres** : valorisation (P/E, PEG, P/B, P/S, EV/EBITDA), profitabilite (ROE, ROA, marges), croissance, dividendes, endettement, cash-flow, position 52 semaines, ownership, etc.
- **Logique AND / OR** : combiner les criteres en mode "tous" ou "au moins un"
- **Tri dynamique** sur n'importe quelle colonne
- **Pagination cursor-based** pour les grands resultats
- **Recherche par lettre** de ticker (A, B, C...)
- **Export CSV** des resultats filtres
- **Colonnes configurables** : choisir quelles metriques afficher

### Presets de screening

9 strategies pre-configurees :

| Preset | Strategie |
|--------|-----------|
| Value + Quality | P/E bas + ROE elevee + dette maitrisee |
| GARP | Croissance a prix raisonnable (PEG < 1.5) |
| Deep Value (Ben Graham) | Sous la valeur comptable, P/E < 12 |
| Dividend Aristocrats | Rendement dividende + profits stables |
| Free Cash Flow Machines | FCF yield eleve + marges solides |
| Decote 52 semaines | 15-40% sous le plus haut, fondamentaux intacts |
| Small Cap Value | Petites caps sous-evaluees |
| EV/EBITDA Bargains | Valeur d'entreprise attractive |
| Pikpik Investment Fund | Anomalies via CF operationnel + dette nette |

Les utilisateurs peuvent aussi sauvegarder leurs propres presets (prives ou publics).

### Quality Score (methodologie Pikpik)

Score composite 0-100 calcule sur 5 categories (chacune 0-20 points) :

1. **Rentabilite** — ROE + marge nette
2. **Croissance** — croissance revenus + CAGR 5 ans
3. **Sante financiere** — dette/equity + current ratio
4. **Valorisation** — P/E + FCF yield
5. **Cash-flow** — prix/OCF + dette nette/OCF

Necessite au minimum 3 categories de donnees disponibles pour etre calcule.

### Fiche action detaillee

- Resume avec toutes les metriques fondamentales
- Graphique historique des prix (OHLCV)
- Historique trimestriel des fondamentaux (income statement, bilan, cash-flow)

### Comparaison d'actions

- Comparer jusqu'a N actions cote-a-cote sur toutes les metriques

### Favoris (Bookmarks)

- Watchlist personnelle par utilisateur
- Marquage rapide depuis le screener

### Alertes prix / fondamentaux

- Alertes sur 22 metriques differentes (prix, P/E, dividende, ROE, qualityScore, etc.)
- Operateurs "above" et "below"
- Notification par email quand le seuil est franchi
- Maximum 50 alertes par utilisateur
- Rearmement / toggle / suppression

### Email Digests

- Rapports periodiques par email bases sur des filtres screener sauvegardes
- Frequence configurable : quotidien ou hebdomadaire
- Les filtres du digest sont un snapshot des filtres screener

### Administration

- Gestion des utilisateurs (CRUD, roles, activation/desactivation)
- Declenchement manuel des syncs (EOD, tickers, fondamentaux)
- Arret des syncs en cours (mecanisme abort via DB polling)
- Statut temps-reel des jobs de synchronisation
- Configuration du mode EODHD (daily / full) sans redemarrage

### Authentification & roles

| Role | Droits |
|------|--------|
| `super_admin` | Acces admin complet + gestion utilisateurs |
| `admin` | A definir (extensible) |
| `viewer` | Screener, bookmarks, alertes, presets, digests |

Le premier utilisateur inscrit obtient automatiquement le role `super_admin`.

## Modele de donnees

```
Exchange (1) ──→ (N) Stock
                       ├──→ (N) DailyPrice      (OHLCV quotidien)
                       ├──→ (N) Fundamentals     (trimestriel/annuel)
                       ├──→ (N) Bookmark
                       └──→ (N) Alert

User (1) ──→ (N) ScreenerPreset
          ──→ (N) EmailDigest
          ──→ (N) Bookmark
          ──→ (N) Alert

SyncJob          (tracking des jobs : duree, erreurs, nb tickers)
SystemConfig     (key-value : SYNC_MODE, PENDING_SYNC, ABORT_SYNC)
```

Le modele `Stock` est **fortement denormalise** (~50 colonnes fondamentales) pour des requetes screener en single-table scan, sans jointures.

## Worker — Synchronisation EODHD

Le worker execute 3 types de synchronisation + envoi d'emails :

| Job | Frequence | API calls | Description |
|-----|-----------|-----------|-------------|
| `sync-tickers` | 1er du mois, 3h | ~1/exchange | Sync liste des tickers, ajout/desactivation |
| `sync-eod` | Lun-Ven, 22h ET | 1/exchange | Prix EOD bulk + recalcul % 52 semaines |
| `sync-fundamentals` | Samedi, 6h ET | ~10/stock | Fondamentaux complets + quality score |
| `check-alerts` | Apres chaque sync EOD/fundamentals | 0 | Evaluation des alertes + envoi emails |
| `send-email-digests` | Lundi 8h Paris | 0 | Envoi des digests hebdomadaires |

### Mode EODHD (optimisation cout)

```
┌──────────────────────────────────────────────────────────────────┐
│  SYNC_MODE=daily  →  All World plan ($19.99/mo)                  │
│    - sync-eod           ✓ quotidien L-V                          │
│    - sync-tickers       ✓ mensuel                                │
│    - sync-fundamentals  ✗ IGNORE                                 │
│                                                                  │
│  SYNC_MODE=full   →  All-in-One plan ($99.99/mo)                 │
│    - sync-eod           ✓ quotidien L-V                          │
│    - sync-tickers       ✓ mensuel                                │
│    - sync-fundamentals  ✓ hebdomadaire samedi                    │
└──────────────────────────────────────────────────────────────────┘

Strategie cout : 8 mois "daily" + 4 mois "full" = ~$560/an vs $1000/an
```

Le mode est configurable depuis l'admin UI sans redemarrage du worker.

### Mecanisme d'arret (abort)

L'admin peut arreter une sync en cours depuis l'UI. Fonctionnement :
1. L'API ecrit `ABORT_SYNC=requested` dans `SystemConfig`
2. Le worker poll cette table toutes les 2 secondes
3. Le flag `shouldAbort` est active
4. Chaque job verifie le flag entre chaque stock et yielde l'event loop
5. Arret gracieux avec sauvegarde de l'etat dans `SyncJob`

### Budget API

La sync fondamentaux respecte un budget configurable :
- **10 API calls par stock** (fondamentaux + donnees associees)
- **Budget max** : `SYNC_MAX_API_CALLS` (defaut 90 000, limite EODHD 100K/jour)
- **Filtre market cap** : stocks < `SYNC_MIN_MARKET_CAP` (defaut 50M) ignores
- **Limite par exchange** : 1500 stocks max par run

## API Endpoints

### Publics

| Methode | Route | Description |
|---------|-------|-------------|
| `GET` | `/health` | Health check |

### Authentification

| Methode | Route | Description |
|---------|-------|-------------|
| `POST` | `/auth/register` | Inscription (1er user = super_admin) |
| `POST` | `/auth/login` | Connexion → JWT |
| `GET` | `/auth/me` | Profil utilisateur courant |

### Screener & Stocks (auth requise)

| Methode | Route | Description |
|---------|-------|-------------|
| `POST` | `/screener` | Recherche multicriteres |
| `GET` | `/stocks/:ticker` | Detail d'une action |
| `GET` | `/stocks/:ticker/prices` | Historique OHLCV |
| `GET` | `/stocks/:ticker/fundamentals` | Fondamentaux trimestriels/annuels |
| `GET` | `/filters/options` | Options pour les dropdowns (secteurs, industries, exchanges) |

### Presets (auth requise)

| Methode | Route | Description |
|---------|-------|-------------|
| `GET` | `/presets` | Liste presets user + publics |
| `POST` | `/presets` | Creer un preset |
| `PUT` | `/presets/:id` | Modifier un preset |
| `DELETE` | `/presets/:id` | Supprimer un preset |

### Bookmarks (auth requise)

| Methode | Route | Description |
|---------|-------|-------------|
| `GET` | `/bookmarks` | Liste des favoris |
| `GET` | `/bookmarks/ids` | IDs des favoris (lookup rapide) |
| `POST` | `/bookmarks/:stockId` | Ajouter un favori |
| `DELETE` | `/bookmarks/:stockId` | Retirer un favori |

### Alertes (auth requise)

| Methode | Route | Description |
|---------|-------|-------------|
| `GET` | `/alerts` | Liste des alertes |
| `GET` | `/alerts/metrics` | Metriques disponibles |
| `POST` | `/alerts` | Creer une alerte |
| `PUT` | `/alerts/:id/toggle` | Activer/desactiver |
| `PUT` | `/alerts/:id/rearm` | Rearmer une alerte declenchee |
| `DELETE` | `/alerts/:id` | Supprimer |

### Email Digests (auth requise)

| Methode | Route | Description |
|---------|-------|-------------|
| `GET` | `/email-digests` | Liste des digests |
| `POST` | `/email-digests` | Creer un digest |
| `PUT` | `/email-digests/:id` | Modifier |
| `DELETE` | `/email-digests/:id` | Supprimer |

### Administration (super_admin)

| Methode | Route | Description |
|---------|-------|-------------|
| `GET` | `/admin/users` | Liste utilisateurs |
| `POST` | `/admin/users` | Creer un utilisateur |
| `PUT` | `/admin/users/:id` | Modifier (role, mdp, actif) |
| `DELETE` | `/admin/users/:id` | Supprimer |
| `GET` | `/admin/sync-status` | Statut des jobs de sync |
| `POST` | `/admin/sync-trigger/:jobName` | Lancer un sync manuellement |
| `POST` | `/admin/sync-abort` | Arreter le sync en cours |
| `GET` | `/admin/config` | Lire la config systeme |
| `PUT` | `/admin/config` | Modifier (ex: SYNC_MODE) |

## Demarrage local

### Prerequis

- Node.js >= 20
- PNPM >= 9 (`corepack enable`)
- PostgreSQL 16 (ou Docker)

### Installation

```bash
pnpm install
```

### Configuration

```bash
cp .env.example .env
```

Variables cles a configurer :

| Variable | Description | Defaut |
|----------|-------------|--------|
| `DATABASE_URL` | URL PostgreSQL | `postgresql://traiders:changeme@localhost:5432/traiders` |
| `EODHD_API_KEY` | Cle API EODHD | (obligatoire) |
| `JWT_SECRET` | Secret pour les tokens JWT | (obligatoire) |
| `SYNC_MODE` | `daily` ou `full` | `daily` |
| `SYNC_EXCHANGES` | Exchanges a synchroniser (virgules) | `US` |
| `SMTP_HOST` | Serveur SMTP (vide = emails desactives) | (vide) |

### Base de donnees

```bash
# Avec Docker (demarre PostgreSQL)
docker compose up postgres -d

# Generer le client Prisma
pnpm db:generate

# Appliquer le schema
pnpm db:push

# Ou creer une migration
pnpm db:migrate

# Interface Prisma Studio
pnpm db:studio
```

### Lancer en developpement

```bash
# Terminal 1 — API (port 4000)
pnpm dev:api

# Terminal 2 — Worker (sync EODHD → PostgreSQL)
pnpm dev:worker

# Terminal 3 — Frontend (port 5173)
pnpm dev:web
```

Au premier demarrage, le worker effectue automatiquement la synchronisation initiale (tickers → EOD → fondamentaux si mode full).

### Build

```bash
# Build tous les packages
pnpm build

# Build individuel
pnpm build:api
pnpm build:worker
pnpm build:web
```

## Deploiement

### Docker Compose (VPS / self-hosted)

**Developpement** (avec PostgreSQL local) :

```bash
docker compose up -d --build
# → API sur :4000, Frontend sur :80 (nginx)
```

**Production** (DB externe type Neon/Supabase) :

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
# → Frontend + API sur :3080 (derriere nginx)
```

Architecture prod :
```
Internet → Reverse Proxy (Caddy/Nginx) → :3080
                                            ├── /api/*  → Fastify (:4000)
                                            └── /*      → SPA React (nginx static)

Worker → EODHD API → PostgreSQL (Neon)
```

### Railway

Le fichier `railway.toml` est pre-configure. Creer 3 services :
1. **PostgreSQL** — service Railway
2. **API** — `Dockerfile.api`, health check sur `/health`
3. **Worker** — `Dockerfile.worker`

## Pages frontend

| Page | Route | Description |
|------|-------|-------------|
| Login | `/login` | Connexion |
| Register | `/register` | Inscription |
| Screener | `/` | Screener principal avec filtres, tri, export CSV |
| Stock Detail | `/stock/:ticker` | Fiche detaillee + graphique + fondamentaux |
| Compare | `/compare` | Comparaison multi-actions |
| Presets | `/presets` | Gestion des presets de screening |
| Alertes | `/alerts` | Gestion des alertes prix/fondamentaux |
| Email Digests | `/digests` | Configuration des rapports email |
| Admin | `/admin` | Gestion utilisateurs, syncs, config |

## Scripts disponibles

| Script | Description |
|--------|-------------|
| `pnpm dev:api` | API en mode watch |
| `pnpm dev:worker` | Worker en mode watch |
| `pnpm dev:web` | Frontend Vite dev server |
| `pnpm build` | Build tous les packages |
| `pnpm db:generate` | Generer le client Prisma |
| `pnpm db:push` | Appliquer le schema sans migration |
| `pnpm db:migrate` | Creer et appliquer une migration |
| `pnpm db:studio` | Ouvrir Prisma Studio |
| `pnpm lint` | Lint tous les packages |
| `pnpm typecheck` | Type-check tous les packages |
| `pnpm clean` | Supprimer les dossiers dist |
