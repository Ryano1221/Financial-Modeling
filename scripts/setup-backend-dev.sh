#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

PYTHON_BIN="${PYTHON_BIN:-python3}"
if [ ! -x "backend/.venv/bin/python" ]; then
  "$PYTHON_BIN" -m venv backend/.venv
fi

backend/.venv/bin/python -m pip install --upgrade pip
backend/.venv/bin/pip install -r backend/requirements-dev.txt

echo "Backend dev environment ready at backend/.venv"
