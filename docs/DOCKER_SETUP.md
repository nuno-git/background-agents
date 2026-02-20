# Docker Compose Local Development Setup

Run the full Open-Inspect stack locally with a single command using Docker Compose.

## Architecture

```
Browser ──localhost:3000──► web (Next.js)
Browser ──localhost:8787──► control-plane (WebSocket)
                            │
web ──http://control-plane:8787──► control-plane (server-side)
control-plane ──http://sandbox-manager:8000──► sandbox-manager
sandbox-manager ──docker.sock──► host Docker daemon
  spawns sandbox containers on `open-inspect` network
  sandbox ──http://control-plane:8787──► control-plane (WebSocket bridge)
```

All services and sandbox containers share a Docker network named `open-inspect`.

## Prerequisites

- Docker Engine 24+ (or Docker Desktop)
- Docker Compose v2+
- ~10 GB disk space (sandbox image includes Node.js, Python, Playwright, etc.)

## Quick Start

### 1. Build the sandbox image (one-time, ~5 min)

```bash
docker build -t open-inspect-sandbox:latest -f packages/local-sandbox-manager/Dockerfile.sandbox .
```

### 2. Configure environment

```bash
cp .env.docker .env
```

Edit `.env` and add at least one LLM API key (`ANTHROPIC_API_KEY`, `ZHIPU_API_KEY`, or `GLM_API_KEY`).

### 3. Start all services

```bash
docker compose up --build -d
```

### 4. Verify

```bash
# Health checks
curl http://localhost:8787/health
curl http://localhost:8000/api/health

# Open the web UI
open http://localhost:3000
```

### 5. View logs

```bash
docker compose logs -f              # all services
docker compose logs -f web           # single service
docker compose logs -f control-plane
docker compose logs -f sandbox-manager
```

## Services

| Service | Port | Description |
|---------|------|-------------|
| `web` | 3000 | Next.js frontend |
| `control-plane` | 8787 | Express + WebSocket server, SQLite database |
| `sandbox-manager` | 8000 | FastAPI server, manages Docker sandbox containers |

## Networking

- All three services and spawned sandbox containers share the `open-inspect` Docker network.
- The sandbox manager sets `--network=open-inspect` on spawned containers (via the `DOCKER_NETWORK` env var), so sandbox containers can reach the control plane at `http://control-plane:8787` using Docker DNS.
- Browser WebSocket connections go through the host port mapping: `ws://localhost:8787`.

## Data Persistence

Docker volumes preserve data across restarts:

| Volume | Mounted at | Contents |
|--------|-----------|----------|
| `control-plane-data` | `/data` in control-plane | SQLite session database |
| `sandbox-snapshots` | `/data/snapshots` in sandbox-manager | Container snapshots |

To reset all data:

```bash
docker compose down -v
```

## Rebuilding

After code changes:

```bash
docker compose up --build -d
```

To rebuild the sandbox image (after changes to `Dockerfile.sandbox` or sandbox code):

```bash
docker build -t open-inspect-sandbox:latest -f packages/local-sandbox-manager/Dockerfile.sandbox .
```

## Stopping

```bash
docker compose down        # stop and remove containers
docker compose down -v     # also remove volumes (data)
```

## Troubleshooting

### Sandbox containers can't reach the control plane

Verify the `open-inspect` network exists and the sandbox manager is using it:

```bash
docker network ls | grep open-inspect
docker inspect <sandbox-container-id> | grep NetworkMode
```

### Permission denied on Docker socket

The sandbox manager needs access to `/var/run/docker.sock`. On Linux, ensure your user is in the `docker` group or run with appropriate permissions.

### Port already in use

If ports 3000, 8787, or 8000 are already occupied, stop the conflicting process or adjust the port mappings in `docker-compose.yml`.
