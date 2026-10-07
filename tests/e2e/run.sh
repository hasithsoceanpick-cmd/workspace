#!/bin/bash
# Browser tests for Workspace, run against a THROWAWAY local Postgres and a small
# stand-in for Supabase (mock-supabase.mjs). Never point this at your live project.
#
#   DATABASE_URL=postgres://postgres@127.0.0.1:5432/scratch ./tests/e2e/run.sh
#
# Needs: Node 20+, Python 3 with `pip install playwright pillow openpyxl` and `playwright install chromium`,
# and the Postgres client (psql). Screenshots land in tests/e2e/shots/.
set -e
cd "$(dirname "$0")"
ROOT="$(cd ../.. && pwd)"
export DATABASE_URL="${DATABASE_URL:-postgres://postgres@127.0.0.1:54322/postgres}"
export MOCK_PORT="${MOCK_PORT:-54321}"
export MOCK_URL="http://localhost:$MOCK_PORT"
APP_PORT="${APP_PORT:-4173}"
export APP_URL="http://localhost:$APP_PORT"

[ -d node_modules ] || npm install --silent
[ -d "$ROOT/node_modules" ] || (cd "$ROOT" && npm install --silent)

# show failures and a pass count, hide the long list of passes
summary() { awk '/^PASS/{p++; next} /^FAIL/{f++} /passed, [0-9]+ failed/{s=1} /^[0-9][0-9]:[0-9][0-9]|^✕\)/{next} {print} END{if(!s) print p+0 " passed, " f+0 " failed"}'; }

echo "== database: load the SQL files and run the security tests"
bash "$ROOT/tests/db/run.sh" | grep -E "passed|FAIL"

echo "== build the app pointed at the stand-in"
(cd "$ROOT" && VITE_SUPABASE_URL="$MOCK_URL" VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_test \
  npx vite build --outDir tests/e2e/.dist --emptyOutDir > /dev/null)

node mock-supabase.mjs > .mock.log 2>&1 & MOCK=$!
python3 -m http.server "$APP_PORT" --directory .dist > .web.log 2>&1 & WEB=$!
trap 'kill $MOCK $WEB 2>/dev/null' EXIT
sleep 2

for t in test_platform test_tasks test_delete_people test_admin_notes test_new_features test_round3; do
  node seed.mjs > /dev/null
  echo "== $t"
  python3 -W ignore "$t.py" 2>&1 | summary
done

psql "$DATABASE_URL" -q -f wipe.sql
echo "== test_first_run (empty database)"
python3 test_first_run.py 2>&1 | summary
