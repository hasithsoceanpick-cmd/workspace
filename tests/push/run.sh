#!/bin/bash
# Tests the phone-alert sender (supabase/functions/workspace-push/index.ts) in real Deno — the same
# runtime Supabase uses. Needs Node/npm (Deno and the reference decoder are fetched from npm into a temp folder).
set -e
cd "$(dirname "$0")"
HERE="$(pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
(cd "$WORK" && npm init -y > /dev/null && npm install --silent deno http_ece@1.2.1 && echo '{"nodeModulesDir":"manual"}' > deno.json)
export DENO_NO_UPDATE_CHECK=1
cp ../../supabase/functions/workspace-push/index.ts "$WORK/index.ts"
# the test imports the code without starting the web server
grep -v "^if ('Deno' in globalThis) Deno.serve(handle);$" "$WORK/index.ts" > "$WORK/push.ts"
cp "$HERE/test_push.ts" "$WORK/"
cd "$WORK"
echo "== type-check the function exactly as deployed"
./node_modules/.bin/deno check index.ts
echo "== run the tests"
./node_modules/.bin/deno run --allow-read --allow-env --allow-net test_push.ts
