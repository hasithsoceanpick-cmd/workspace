#!/bin/bash
# Runs the database isolation tests against a THROWAWAY local Postgres (never your live Supabase).
#   DATABASE_URL=postgres://postgres@127.0.0.1:5432/scratch ./tests/db/run.sh
# The database should be empty; this script loads a minimal stand-in for Supabase's auth schema first.
set -e
cd "$(dirname "$0")/../.."
URL="${DATABASE_URL:-postgres://postgres@127.0.0.1:54322/postgres}"
psql "$URL" -q -v ON_ERROR_STOP=1 -f tests/db/mock_supabase.sql 2>/dev/null || true
for f in supabase/01_platform.sql supabase/02_app_tasks.sql supabase/03_feature_daily_notes.sql; do
  psql "$URL" -q -v ON_ERROR_STOP=1 -f "$f" > /dev/null
done
DATABASE_URL="$URL" node tests/db/isolation.test.mjs
