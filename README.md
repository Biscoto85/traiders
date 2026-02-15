# Stock Screener

Application de screening d'actions avec données historiques et fondamentales.

## Stack

- **TypeScript** (strict mode) + **PNPM** workspaces (monorepo)
- **Fastify** — API REST
- **Prisma** + **PostgreSQL** — Base de données
- **Next.js** — Frontend (Phase 3)
- **Railway** — Déploiement
- **EODHD** — Source de données boursières

## Structure

```
stock-screener/
├── packages/
│   ├── shared/          # Types, validations Zod, utils de formatage
│   └── eodhd-client/    # Client HTTP typé pour l'API EODHD
├── apps/
│   ├── api/             # Serveur Fastify + Prisma
│   ├── worker/          # Cron jobs de synchronisation
│   └── web/             # Frontend Next.js (à venir)
├── Dockerfile.api
├── Dockerfile.worker
└── railway.toml
```

## Démarrage local

### Prérequis

- Node.js ≥ 20
- PNPM ≥ 9 (`corepack enable`)
- PostgreSQL (ou Docker)

### Installation

```bash
pnpm install
```

### Configuration

```bash
cp .env.example .env
# Éditer .env avec votre clé EODHD et URL PostgreSQL
```

### Base de données

```bash
# Générer le client Prisma
pnpm db:generate

# Appliquer le schéma (dev)
pnpm db:push

# Ou créer une migration
pnpm db:migrate
```

### Lancer en développement

```bash
# API (port 4000)
pnpm dev:api

# Worker (sync EODHD → PostgreSQL)
pnpm dev:worker
```

## API Endpoints

| Méthode | Route | Description |
|---------|-------|-------------|
| `GET` | `/health` | Health check |
| `POST` | `/api/v1/screener` | Filtrage multicritères |
| `GET` | `/api/v1/stocks/:ticker` | Détail d'une action |
| `GET` | `/api/v1/stocks/:ticker/prices` | Historique OHLCV |
| `GET` | `/api/v1/stocks/:ticker/fundamentals` | Données fondamentales |
| `GET` | `/api/v1/filters/options` | Options pour les dropdowns |

## Déploiement Railway

1. Créer un projet Railway avec un service PostgreSQL
2. Ajouter les services `api` et `worker` avec les Dockerfiles respectifs
3. Configurer les variables d'environnement (voir `.env.example`)
4. Le worker effectue la synchronisation initiale au premier démarrage
