#!/usr/bin/env bash
# Starts the API (http://localhost:3000) and the web app (http://localhost:5173)
# together. Ctrl-C stops both. Works with the old bash 3.2 that ships on macOS.
#   bun run dev          # uses OPENROUTER_API_KEY from server/.env if set, else mock AI
#   bun run dev --mock   # always use canned AI responses
set -eo pipefail
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

# Prefix each output line with a tag, without relying on GNU sed flags.
tag() { while IFS= read -r line; do printf '[%s] %s\n' "$1" "$line"; done; }

# On exit stop everything this script started (its whole process group).
cleanup() {
  trap - INT TERM EXIT
  kill 0 2>/dev/null || true
}
trap cleanup INT TERM EXIT

if [ $mock = 1 ]; then api_script=dev:mock; else api_script=dev; fi
(cd server && bun run "$api_script" 2>&1 | tag api) &
api=$!
(cd web && bun run dev 2>&1 | tag web) &
web=$!

echo "Starting… open http://localhost:5173 once [web] says ready (Ctrl-C to stop)"
# Run until either server exits.
while kill -0 "$api" 2>/dev/null && kill -0 "$web" 2>/dev/null; do sleep 1; done
echo "A server stopped; shutting down the other."
