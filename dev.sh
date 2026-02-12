#!/usr/bin/env bash
# Start backend (FastAPI) and frontend (Next.js) with one command.
# Backend: 127.0.0.1:8010. Frontend: reads NEXT_PUBLIC_BACKEND_URL (default 127.0.0.1:8010).
# Frees ports 8010 and 3000 if in use. Waits for backend health before starting frontend.

set -e
REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND_PORT=8010
FRONTEND_PORT=3000
BACKEND_URL="http://127.0.0.1:${BACKEND_PORT}"
HEALTH_URL="${BACKEND_URL}/health"
MAX_HEALTH_ATTEMPTS=30
HEALTH_INTERVAL=1

kill_port() {
  local port="$1"
  local pids
  pids=$(lsof -ti :"$port" 2>/dev/null) || true
  if [ -n "$pids" ]; then
    echo "[dev] Freeing port ${port} (PIDs: ${pids})..."
    echo "$pids" | xargs kill -9 2>/dev/null || true
    sleep 1
  fi
}

echo "[dev] Using repo root: ${REPO_ROOT}"
cd "$REPO_ROOT"

# Free ports so we can bind
kill_port "$BACKEND_PORT"
kill_port "$FRONTEND_PORT"

# Ensure frontend/.env.local has NEXT_PUBLIC_BACKEND_URL
ENV_LOCAL="${REPO_ROOT}/frontend/.env.local"
if [ ! -f "$ENV_LOCAL" ]; then
  echo "NEXT_PUBLIC_BACKEND_URL=${BACKEND_URL}" > "$ENV_LOCAL"
  echo "[dev] Created ${ENV_LOCAL} with NEXT_PUBLIC_BACKEND_URL=${BACKEND_URL}"
else
  if ! grep -q 'NEXT_PUBLIC_BACKEND_URL=' "$ENV_LOCAL" 2>/dev/null; then
    echo "NEXT_PUBLIC_BACKEND_URL=${BACKEND_URL}" >> "$ENV_LOCAL"
    echo "[dev] Appended NEXT_PUBLIC_BACKEND_URL to ${ENV_LOCAL}"
  fi
fi

# Start backend in background (with venv if present)
(
  cd "${REPO_ROOT}/backend"
  if [ -f .venv/bin/activate ]; then
    set +u
    source .venv/bin/activate
    set -u
  elif [ -f venv/bin/activate ]; then
    set +u
    source venv/bin/activate
    set -u
  elif [ -f "${REPO_ROOT}/.venv/bin/activate" ]; then
    set +u
    source "${REPO_ROOT}/.venv/bin/activate"
    set -u
  fi
  exec uvicorn main:app --reload --host 127.0.0.1 --port "$BACKEND_PORT"
) &
BACKEND_PID=$!

cleanup() {
  echo "[dev] Shutting down..."
  kill "$BACKEND_PID" 2>/dev/null || true
  exit 0
}
trap cleanup INT TERM

# Wait for backend health
echo "[dev] Waiting for backend at ${HEALTH_URL}..."
attempt=1
while [ "$attempt" -le "$MAX_HEALTH_ATTEMPTS" ]; do
  if curl -sf "$HEALTH_URL" >/dev/null 2>&1; then
    echo "[dev] Backend healthy (${BACKEND_URL})"
    break
  fi
  if [ "$attempt" -eq "$MAX_HEALTH_ATTEMPTS" ]; then
    echo "[dev] Backend did not become healthy after ${MAX_HEALTH_ATTEMPTS} attempts. Check backend logs." >&2
    kill "$BACKEND_PID" 2>/dev/null || true
    exit 1
  fi
  sleep "$HEALTH_INTERVAL"
  attempt=$((attempt + 1))
done

# Start frontend in foreground (script exits when user Ctrl+C or frontend exits)
echo "[dev] Starting frontend (Next.js)..."
cd "${REPO_ROOT}/frontend"
npm run dev
