#!/usr/bin/env bash
# Trigger a Render deploy for financial-modeling-docker and wait until /health returns the new shape.
# Requires: RENDER_DEPLOY_HOOK_URL (from Render Dashboard → financial-modeling-docker → Settings → Deploy Hook)
# Optional: BACKEND_URL (default https://financial-modeling-docker.onrender.com) for health polling.
set -e
HOOK_URL="${RENDER_DEPLOY_HOOK_URL:-}"
BACKEND="${BACKEND_URL:-https://financial-modeling-docker.onrender.com}"
HEALTH_URL="${BACKEND%/}/health"
MAX_WAIT="${RENDER_DEPLOY_WAIT:-300}"

if [[ -z "$HOOK_URL" ]]; then
  echo "Missing RENDER_DEPLOY_HOOK_URL."
  echo "1. Open Render Dashboard → financial-modeling-docker → Settings"
  echo "2. Find 'Deploy Hook' and copy the URL"
  echo "3. Run: RENDER_DEPLOY_HOOK_URL=<url> $0"
  exit 1
fi

echo "Triggering deploy..."
curl -sS -X POST "$HOOK_URL" || true
echo ""
echo "Deploy triggered. Waiting up to ${MAX_WAIT}s for $HEALTH_URL to return new shape (ok + ai_enabled)..."
start=$(date +%s)
while true; do
  now=$(date +%s)
  if (( now - start > MAX_WAIT )); then
    echo "Timeout. Check Render dashboard and $HEALTH_URL"
    exit 1
  fi
  body=$(curl -sS "$HEALTH_URL" 2>/dev/null || true)
  if echo "$body" | grep -q '"ok"\s*:\s*true' && echo "$body" | grep -q '"ai_enabled"'; then
    echo "OK: $body"
    exit 0
  fi
  echo "  ... still old or unreachable ($(echo "$body" | head -c 80))"
  sleep 15
done
