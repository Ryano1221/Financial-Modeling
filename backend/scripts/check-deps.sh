#!/usr/bin/env bash
# Sanity check: from /backend, install deps and confirm fastapi + uvicorn import.
# Run from repo root: bash backend/scripts/check-deps.sh
# Or from backend: bash scripts/check-deps.sh
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$BACKEND_DIR"

echo "Installing dependencies from $BACKEND_DIR/requirements.txt ..."
python3 -m pip install -r requirements.txt -q

echo "Checking imports: fastapi, uvicorn ..."
python3 -c "import fastapi, uvicorn; print('OK')"
