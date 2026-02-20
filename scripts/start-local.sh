#!/usr/bin/env bash
#
# Start all local services for Open-Inspect.
# Run from the repository root.
#
# Startup order:
#   1. Local Sandbox Manager (FastAPI, port 8000)
#   2. Local Control Plane (Express, port 8787)
#   3. Web App (Next.js, port 3000)
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

cleanup() {
  echo ""
  echo "Shutting down all services..."
  kill $SANDBOX_PID $CONTROL_PID $WEB_PID 2>/dev/null || true
  wait $SANDBOX_PID $CONTROL_PID $WEB_PID 2>/dev/null || true
  echo "All services stopped."
}
trap cleanup EXIT

echo -e "${GREEN}=== Starting Open-Inspect Local Stack ===${NC}"

# ── 1. Sandbox Manager ──────────────────────────────────────────────────

echo -e "\n${YELLOW}[1/3] Starting Local Sandbox Manager (port 8000)...${NC}"
cd "$REPO_ROOT/packages/local-sandbox-manager"

if [ ! -d ".venv" ]; then
  echo "  Creating Python virtual environment..."
  python3 -m venv .venv
  .venv/bin/pip install -e ".[dev]" 2>/dev/null || .venv/bin/pip install -e .
fi

.venv/bin/uvicorn src.main:app --host 0.0.0.0 --port 8000 &
SANDBOX_PID=$!

# Wait for sandbox manager to be ready
echo "  Waiting for sandbox manager..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:8000/api/health > /dev/null 2>&1; then
    echo -e "  ${GREEN}Sandbox Manager ready.${NC}"
    break
  fi
  if [ $i -eq 30 ]; then
    echo "  WARNING: Sandbox manager not responding after 30s. Continuing anyway."
  fi
  sleep 1
done

# ── 2. Control Plane ─────────────────────────────────────────────────────

echo -e "\n${YELLOW}[2/3] Starting Local Control Plane (port 8787)...${NC}"
cd "$REPO_ROOT/packages/local-control-plane"

if [ ! -d "node_modules" ]; then
  echo "  Installing dependencies..."
  npm install
fi

npx tsx src/index.ts &
CONTROL_PID=$!

# Wait for control plane to be ready
echo "  Waiting for control plane..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:8787/health > /dev/null 2>&1; then
    echo -e "  ${GREEN}Control Plane ready.${NC}"
    break
  fi
  if [ $i -eq 30 ]; then
    echo "  WARNING: Control plane not responding after 30s. Continuing anyway."
  fi
  sleep 1
done

# ── 3. Web App ───────────────────────────────────────────────────────────

echo -e "\n${YELLOW}[3/3] Starting Web App (port 3000)...${NC}"
cd "$REPO_ROOT/packages/web"

if [ ! -d "node_modules" ]; then
  echo "  Installing dependencies..."
  npm install
fi

npm run dev &
WEB_PID=$!

echo ""
echo -e "${GREEN}=== All Services Started ===${NC}"
echo ""
echo "  Sandbox Manager:  http://localhost:8000"
echo "  Control Plane:    http://localhost:8787"
echo "  Web App:          http://localhost:3000"
echo ""
echo "  WebSocket:        ws://localhost:8787/sessions/:id/ws"
echo ""
echo "Press Ctrl+C to stop all services."

# Wait for any child to exit
wait
