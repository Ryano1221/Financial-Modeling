#!/usr/bin/env bash
# Fail if user-facing diagnostics/backend strings appear in production UI code (app/ and components/).
# Excluded: Diagnostics.tsx, BackendBanner.tsx (dev-only or removed from layout).
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

FORBIDDEN=("Not reachable" "Test backend connection" "Backend URL" "127.0.0.1")
EXCLUDE_FILES=("Diagnostics.tsx" "BackendBanner.tsx")

for needle in "${FORBIDDEN[@]}"; do
  FOUND=""
  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    skip=0
    for ex in "${EXCLUDE_FILES[@]}"; do [[ "$f" == *"$ex" ]] && skip=1 && break; done
    [[ $skip -eq 1 ]] && continue
    FOUND="$f"
    break
  done < <(grep -rln --include="*.tsx" --include="*.ts" -e "$needle" app components 2>/dev/null || true)
  if [[ -n "$FOUND" ]]; then
    echo "ERROR: Forbidden string '$needle' found in: $FOUND"
    echo "Remove or restrict to dev-only (e.g. Diagnostics.tsx)."
    exit 1
  fi
done

echo "OK: No forbidden diagnostics/backend strings in production UI code."
