#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -x "backend/.venv/bin/python" ]; then
  echo "backend/.venv not found. Run: npm run setup:backend-dev"
  exit 1
fi

backend/.venv/bin/python -m pytest -q backend/tests "$@"
