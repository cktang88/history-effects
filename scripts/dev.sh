#!/usr/bin/env bash
# Starts the API (http://localhost:3000) and the web app (http://localhost:5173)
# together. Ctrl-C stops both.
#   bun run dev          # uses OPENROUTER_API_KEY from server/.env if set, else mock AI
#   bun run dev --mock   # always use canned AI responses
set -euo pipefail
cd "$(dirname "$0")/.."

for dir in . server web; do
  [ -d "$dir/node_modules" ] || (echo "Installing dependencies in $dir…" && cd "$dir" && bun install)
done

mock=0
[ "${1:-}" = "--mock" ] && mock=1
if [ $mock = 0 ] && [ -z "${OPENROUTER_API_KEY:-}" ] && ! grep -qs '^OPENROUTER_API_KEY=..' server/.env; then
  echo "No OPENROUTER_API_KEY found (server/.env): using mock AI responses. The atlas works fully."
  mock=1
fi

pids=()
cleanup() {
  trap - INT TERM EXIT
  kill "${pids[@]}" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

(cd server && if [ $mock = 1 ]; then exec bun run dev:mock; else exec bun run dev; fi) 2>&1 | sed -u 's/^/[api] /' &
pids+=($!)
(cd web && exec bun run dev) 2>&1 | sed -u 's/^/[web] /' &
pids+=($!)

echo "Open http://localhost:5173  (Ctrl-C to stop)"
wait -n "${pids[@]}"
