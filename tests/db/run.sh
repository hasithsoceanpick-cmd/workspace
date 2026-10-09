#!/bin/bash
# Runs the database isolation tests against a THROWAWAY local Postgres (never your live Supabase).
#   DATABASE_URL=postgres://postgres@127.0.0.1:5432/scratch ./tests/db/run.sh
# The database should be empty; this script loads a minimal stand-in for Supabase's auth schema first.
set -e
cd "$(dirname "$0")/../.."
URL="${DATABASE_URL:-postgres://postgres@127.0.0.1:54322/postgres}"
export PGOPTIONS="${PGOPTIONS:--c client_min_messages=warning}"   # hide "does not exist, skipping" notices
psql "$URL" -q -v ON_ERROR_STOP=1 -f tests/db/mock_supabase.sql
# like the live project: a table left by an older app that Workspace must never touch
psql "$URL" -q -v ON_ERROR_STOP=1 -c "create table if not exists public.notes (id uuid primary key default gen_random_uuid(), title text);
  insert into public.notes (title) select 'older app' where not exists (select 1 from public.notes);"
for f in supabase/01_platform.sql supabase/02_app_tasks.sql supabase/03_feature_daily_notes.sql supabase/05_app_notes.sql supabase/06_feature_month_end.sql supabase/07_push.sql supabase/08_feature_compliance.sql; do
  psql "$URL" -q -v ON_ERROR_STOP=1 -f "$f" > /dev/null
done
DATABASE_URL="$URL" node tests/db/isolation.test.mjs && DATABASE_URL="$URL" node tests/db/features.test.mjs \
  && DATABASE_URL="$URL" node tests/db/round3.test.mjs && DATABASE_URL="$URL" node tests/db/round5.test.mjs && DATABASE_URL="$URL" node tests/db/round6.test.mjs
