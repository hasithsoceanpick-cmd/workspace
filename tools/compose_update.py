"""Builds a cumulative live-database update from the numbered setup files.

    python3 tools/compose_update.py 005_reminders_home_escalation "update 5: quick reminders, ..."

Since update 4, each update contains everything a database needs after update 2, so Hasith only
ever runs the newest one. It is made of:
  - the ensure_profile part of 01_platform.sql (between the  -- >>> / -- <<<  markers)
  - 02_app_tasks.sql (whole file)
  - the notes_search part of 05_app_notes.sql
  - 06_feature_month_end.sql, 07_push.sql, 08_feature_compliance.sql (whole files)
All of these are re-runnable, and none touches tables other apps created.
If a new round changes another file, add it (or a marked part of it) to PARTS below.
"""
import os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SB = os.path.join(HERE, '..', 'supabase')

def part(file, marker=None):
    s = open(os.path.join(SB, file)).read()
    if not marker:
        return s
    a, b = s.index(f'-- >>> {marker}'), s.index(f'-- <<< {marker}') + len(f'-- <<< {marker}')
    return s[a:b]

PARTS = [
    ('-- ---------- Logins made before Workspace get a profile on first sign-in ----------', part('01_platform.sql', 'ensure_profile')),
    ('', part('02_app_tasks.sql')),
    ('-- ---------- Notes: search ----------', part('05_app_notes.sql', 'notes_search')),
    ('', part('06_feature_month_end.sql')),
    ('', part('07_push.sql')),
    ('', part('08_feature_compliance.sql')),
]

def main():
    name, title = sys.argv[1], sys.argv[2]
    header = f"""-- =====================================================================
--  WORKSPACE — {title}
--  For a database set up BEFORE this update (after update 2 or later).
--  Run once in the SQL Editor. Safe to run again. Keeps all your data.
--  It contains everything from the earlier updates too, so only the newest
--  update ever needs to be run.
--  (Built by tools/compose_update.py from the ensure_profile part of
--   01_platform.sql + 02_app_tasks.sql + the notes_search part of
--   05_app_notes.sql + 06_feature_month_end.sql + 07_push.sql
--   + 08_feature_compliance.sql.)
--  Nothing here touches tables or rules that other apps created.
-- =====================================================================

"""
    body = header + '\n\n'.join((h + '\n' + p) if h else p for h, p in PARTS)
    out = os.path.join(SB, 'updates', f'{name}.sql')
    open(out, 'w').write(body)
    print(out, body.count('\n'), 'lines')

if __name__ == '__main__':
    main()
