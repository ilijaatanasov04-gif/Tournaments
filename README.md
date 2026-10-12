# Tournament Manager

A self-hosted web app for running football (soccer) tournaments — group stage through knockout bracket to champion — with automatic fixture generation, standings, and bracket progression. The organizer only enters team names, match dates, and results; everything else happens automatically.

Built with **FastAPI + PostgreSQL** on the backend and **React (Vite)** on the frontend. Ships with Docker Compose for one-command deployment, Alembic database migrations, a pytest test suite, GitHub Actions CI, and Kubernetes manifests.

## Features

**Tournament flow**
- World-Cup-style format: group stage → knockout bracket → final
- Brackets adapt to tournament size: 2, 4 or 8 groups seed straight into semi-finals, quarter-finals, or a Round of 16 — every bracket ends with a crowned champion
- Group-stage fixtures are generated automatically as teams are added (round-robin per group)
- Standings update automatically from results (points, goal difference, goals scored)
- Knockout rounds seed themselves as soon as the groups feeding them are complete, with cross-group pairings (1A–2B, 1B–2A, …)
- Knockout draws are resolved by penalty shootouts; ties are rejected with clear validation
- Results can be edited after the fact — standings recalculate, and results lock automatically once later rounds depend on them
- Champion is detected and displayed automatically after the final

**Access control**
- JWT authentication with two roles: `user` (viewer) and `organizer`
- Per-tournament permissions: the creator has full control and can invite other organizers as collaborators by email
- Only the creator can edit tournament details, manage collaborators, or delete the tournament
- Unscheduled matches are hidden from the public until a date is set

**Presentation**
- Tournament cards with status filters (upcoming / ongoing / completed), search, and location filters
- Live group tables, fixtures & results views, and a visual knockout bracket
- Team logos, player rosters, prize pool breakdown, match dates and kick-off times
- Fully responsive: swipeable bracket, condensed standings, mobile-tuned navigation
- Toast notifications and loading states throughout

## Tech stack

| Layer      | Technology |
|------------|------------|
| Backend    | FastAPI, SQLAlchemy 2, Alembic, PostgreSQL 16 |
| Auth       | OAuth2 password flow, JWT (python-jose), bcrypt |
| Frontend   | React 19, Vite, React Router 7, Axios |
| Serving    | nginx (serves the built frontend and proxies `/api/` to the backend) |
| Ops        | Docker Compose, GitHub Actions CI, Kubernetes manifests |
| Tests      | pytest + FastAPI TestClient (29 API tests) |

## Quick start (Docker)

Requirements: Docker with the Compose plugin.

```bash
cp .env.example .env    # required — docker-compose.yml holds no values itself
docker compose up -d --build
```

- Frontend: http://localhost:3000
- API: http://localhost:8000 (interactive docs at http://localhost:8000/docs)

Database migrations run automatically when the backend container starts.

Create an account via **Create account** and choose the *organizer* role to be able to create tournaments; plain *user* accounts get a read-only view.

**Optional demo data** — populate three example tournaments (finished with a full bracket, mid-season, and upcoming) plus a demo organizer account (`demo@tournamentmanager.app` / `demo1234`):

```bash
docker compose exec backend python seed_demo.py
```

## Configuration

`docker-compose.yml` contains no configuration values. Every setting lives in
`.env` (copied from `.env.example`) and is injected into the containers with
`env_file`, so credentials are never committed — `.env` is gitignored.

| Variable | Example | Purpose |
|----------|---------|---------|
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `tournament_user` / `tournament_pass` / `tournament_db` | Database credentials |
| `SECRET_KEY` | dev-only fallback | JWT signing key — **required in production** (`openssl rand -hex 32`) |
| `ENV` | `dev` | Set to `production` to make the backend refuse to start without a real `SECRET_KEY` |
| `DATABASE_URL` | `postgresql://tournament_user:tournament_pass@db:5432/tournament_db` | Backend connection string — must match the `POSTGRES_*` values |
| `CORS_ORIGINS` | `http://localhost:5173` | Only needed for the Vite dev server; the Docker/k8s frontend is same-origin |
| `BACKEND_PORT` / `FRONTEND_PORT` | `8000` / `3000` | Host ports |
| `VITE_API_URL` (frontend build, `frontend/.env.production`) | `/api` | API base URL baked into the frontend image; relative so nginx proxies it |

## Local development

**Backend** (Python 3.12):

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
export DATABASE_URL=postgresql://tournament_user:tournament_pass@localhost:5432/tournament_db
python migrate.py            # bring the schema up to date
uvicorn app.main:app --reload
```

**Frontend**:

```bash
cd frontend
npm install
npm run dev                  # http://localhost:5173
```

The dev frontend talks to the API at `http://localhost:8000` (see `src/api.js`).

## Tests

```bash
cd backend
pip install -r requirements-dev.txt
python -m pytest
```

The suite runs against an in-memory SQLite database — no services needed. It covers authentication, tournament CRUD, the permission/collaborator model, automatic fixture generation, standings, penalty-shootout rules, and the full group → R16 → QF auto-advance flow.

## Database migrations

Schema changes are managed with Alembic (`backend/alembic/`).

```bash
cd backend
alembic revision --autogenerate -m "describe your change"   # after editing models.py
alembic upgrade head
```

`python migrate.py` (run automatically in Docker) upgrades to the latest revision, and transparently adopts databases created before Alembic was introduced.

## Kubernetes

Plain manifests live in `k8s/`: `namespace`, a Postgres **StatefulSet** with a
`volumeClaimTemplate` behind a headless Service, backend/frontend Deployments +
Services, a ConfigMap for non-secret config, a Secret for `SECRET_KEY` and
`POSTGRES_PASSWORD`, and an Ingress.

The images are pushed to Docker Hub by CI as `ile04/tournament-backend` and
`ile04/tournament-frontend`. Change the values in `k8s/secrets.yaml` before any
real deployment, then:

```bash
kubectl apply -f k8s/
kubectl -n tournament rollout status statefulset/db
kubectl -n tournament rollout status deployment/backend
kubectl -n tournament rollout status deployment/frontend
```

`00-namespace.yaml` sorts first on purpose: `kubectl apply -f` walks the
directory alphabetically and everything else needs the namespace to exist.

Requires an ingress controller (`minikube addons enable ingress`) and a hosts
entry for `tournament.local`. Where it points depends on the minikube driver:

```bash
# macOS / Windows with the Docker driver — the node IP is not reachable from
# the host, so the ingress is published on localhost through a tunnel:
echo "127.0.0.1 tournament.local" | sudo tee -a /etc/hosts
sudo minikube tunnel            # leave running in its own terminal

# Linux, or a VM driver — the node IP is reachable directly:
echo "$(minikube ip) tournament.local" | sudo tee -a /etc/hosts
```

Then open <http://tournament.local>.

Only the frontend is exposed through the Ingress. Its nginx serves the static
build and proxies `/api/` to the `backend` Service, so the browser talks to a
single origin — the same arrangement as under Docker Compose, and no CORS
configuration is needed in the cluster.

## Project structure

```
backend/
  app/
    main.py          # FastAPI app + CORS + routers
    models.py        # SQLAlchemy models
    schemas.py       # Pydantic request/response schemas
    formats.py       # Tournament format definition (phases, groups)
    routers/         # auth, tournaments, matches, formats
    services/        # auth helpers, bracket/advance logic
  alembic/           # database migrations
  migrate.py         # migration runner (used by the Docker image)
  tests/             # pytest API test suite
frontend/
  src/
    pages/           # Tournaments, TournamentDetail, Login, Register
    components/      # Toast provider + helpers
    api.js           # Axios instance (token header, base URL)
k8s/                 # Kubernetes manifests
docker-compose.yml
```

## Customization tips

- **Branding**: the app name lives in `frontend/src/App.jsx` (header/footer), `frontend/index.html` (title), and `backend/app/main.py` (API title).
- **Location suggestions** in the create-tournament form: `LOCATION_SUGGESTIONS` in `frontend/src/pages/Tournaments.jsx`.
- **Card imagery**: `TOURNAMENT_IMAGES` in the same file.
- **Tournament format**: `backend/app/formats.py` defines the phase structure; the cross-group seeding pairs live in `backend/app/services/advance.py`.
