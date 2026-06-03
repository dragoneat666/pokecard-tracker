# PokeCard Tracker

Personal Pokemon card collection tracker. Self-hosted via Docker/Dockge.

## Stack
- **Frontend** — React + Vite (port 14000)
- **Backend** — Node.js + Express (port 14001)
- **Database** — PostgreSQL 16

## First-time setup

### 1. Clone the repo on your server
```
cd C:\Docker
git clone https://github.com/YOUR_USERNAME/pokecard-tracker.git Pokemon
```
The folder must be named `Pokemon` so Dockge names volumes correctly (`Pokemon_db_data` etc.)

### 2. Create your .env file
```
cd C:\Docker\Pokemon
copy .env.example .env
```
Then edit `.env` and fill in:
- `DB_PASSWORD` — make this something strong
- `TCG_API_KEY` — your PokéWallet API key from pokewallet.io

### 3. Deploy in Dockge
- Open Dockge at port 5001
- The `Pokemon` stack should appear automatically
- Hit Deploy

The database tables are created automatically on first boot via `db/init.sql`.

## Updating
```
cd C:\Docker\Pokemon
git pull
```
Then in Dockge: restart the `backend` and `frontend` containers.
The database container never needs restarting for code changes.

## Ports
| Service  | Port  |
|----------|-------|
| Frontend | 14000 |
| Backend  | 14001 |

## Folder structure
```
C:\Docker\Pokemon\
├── docker-compose.yml
├── .env                  ← you create this, never committed
├── .env.example          ← template, safe to commit
├── db/
│   └── init.sql
├── backend/
│   ├── Dockerfile
│   ├── package.json
│   └── src/
└── frontend/
    ├── Dockerfile
    ├── package.json
    └── src/
```
