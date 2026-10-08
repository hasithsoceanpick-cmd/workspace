"""Builds the copy-paste SQL page (workspace-sql-setup.html) from the files in supabase/.

    python3 tools/sql-page/build.py

Edit the three step lists below for each new update: put the new update file in
`steps_update` with badge='now', move the previous one to `steps_done`.
The page's look and its script come from template.html (a previous build).
Publish the result as an Artifact (or open it in a browser) for Hasith.
"""
import re, html, os
HERE = os.path.dirname(os.path.abspath(__file__))
SP = HERE
WS = os.path.join(HERE, '..', '..', 'supabase')
old = open(os.path.join(HERE, 'template.html')).read()
head = old[:old.index('<div class="wrap">')]
if '.badge-done' not in head: head = head.replace('.badge-now {', '.badge-done { display: inline-block; font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; background: var(--accent-soft); color: var(--accent); border-radius: 6px; padding: 2px 7px; margin-left: 8px; vertical-align: 2px; }\n.badge-now {')
COPY_ICON = '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><rect x="6.5" y="6.5" width="10" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M13.5 6.5V4.5a2 2 0 0 0-2-2h-6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h1" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>'
OK = 'Success. No rows returned'

steps_update = [
  dict(key='u4', num='U4', title='Phone alerts, sign-off, Got it, compliance calendar, trends, search', badge='now',
       file='updates/004_alerts_signoff_compliance_search.sql',
       desc='Adds phone alerts, checker sign-off, "Got it" for new tasks, early reminders, the Compliance calendar feature (off until you tick it for Finance), Trends and search. <b>It also includes everything from U3</b>, so run this one even if U3 was never run. Keeps all your data; safe to run again; doesn\'t touch your older app\'s tables.',
       expect=OK, note='Supabase will warn about "destructive operations" — click <b>Run this query</b>. It only replaces older versions of the app\'s own rules.', cls='step-update'),
]
steps_done = [
  dict(key='u3', num='U3', title='Deadline history, repeating tasks, month-end declaration', badge='done',
       file='updates/003_history_repeat_month_end.sql',
       desc='Included in U4 — no need to run it separately.', expect=OK, cls='is-done static-done'),
  dict(key='u2', num='U2', title='Helpers, checklists, files, Today planner, Notes', badge='done',
       file='updates/002_helpers_checklist_files_today_notes.sql',
       desc='Already run on your database (6 Oct). No need to run again.', expect='a small report table', cls='is-done static-done'),
  dict(key='u1', num='U1', title='Decline / delete people', badge='done', file='updates/001_delete_people.sql',
       desc='Already run on your database. No need to run again.', expect=OK, cls='is-done static-done'),
]
steps_fresh = [
  dict(key='0', num='0', title='Clean slate', file='00_reset.sql', cls='step-reset',
       desc="Only for a brand-new or broken setup. It removes everything the app created, <b>including all data and files' records</b>. Don't run it on the live system.", expect=OK),
  dict(key='1', num='1', title='Platform', file='01_platform.sql', desc='Departments, people, the admin account, app access and notifications.', expect=OK),
  dict(key='2', num='2', title='Tasks app', file='02_app_tasks.sql', desc='Tasks, helpers, checklists, files, Today time blocks, comments, history, deadline alerts and who-can-see-what rules. Also creates the private file storage.', expect=OK),
  dict(key='3', num='3', title='Daily notes feature', file='03_feature_daily_notes.sql', desc='The example department-only feature. Stays off until you tick it for a department.', expect=OK),
  dict(key='4', num='4', title='Morning deadline check', file='04_daily_check.sql', desc='Schedules the 7:00 am missed-deadline and due-today alerts.',
       expect='Success, with one row showing a number (the job id)', note='If it shows an error mentioning <code>pg_cron</code>: left menu → <b>Integrations</b> → <b>Cron</b> → enable it, then run this one again.'),
  dict(key='5', num='5', title='Notes app', file='05_app_notes.sql', desc='Pages and sub-pages, private or shared, with files and links to tasks. Off until you switch it on for a department.', expect=OK),
  dict(key='6', num='6', title='Month-end declaration feature', file='06_feature_month_end.sql', desc='The monthly self-declaration checklist. Off until you tick it for a department.', expect=OK),
  dict(key='7', num='7', title='Phone alerts', file='07_push.sql', desc='Sends whatever lands in the bell to people\'s phones (with the workspace-push Edge Function). Set up in Admin console → Phone alerts.', expect=OK),
  dict(key='8', num='8', title='Compliance calendar feature', file='08_feature_compliance.sql', desc='Recurring statutory deadlines with owners and an on-time record. Off until you tick it for a department.', expect=OK),
]

def section(s):
    sql = open(f"{WS}/{s['file']}").read()
    lines = sql.count('\n') + (0 if sql.endswith('\n') else 1)
    badge = '<span class="badge-now">Run now</span>' if s.get('badge') == 'now' else '<span class="badge-done">Done</span>' if s.get('badge') == 'done' else ''
    toggle = '' if s.get('badge') == 'done' else f'<label class="done-toggle"><input type="checkbox" id="done-{s["key"]}"> Ran it</label>'
    note = f'\n      <p class="note">{s["note"]}</p>' if s.get('note') else ''
    fname = s['file'].split('/')[-1]
    return f'''  <section class="step {s.get('cls','')}" id="step-{s['key']}">
    <div class="step-num" aria-hidden="true">{s['num']}</div>
    <div class="step-body">
      <div class="step-head">
        <div class="step-titles">
          <h2>{html.escape(s['title'])}{badge}</h2>
          <p class="file"><code>{fname}</code> · {lines} lines</p>
        </div>
        {toggle}
      </div>
      <p class="desc">{s['desc']}</p>
      <div class="actions">
        <button class="copy" type="button" id="copy-{s['key']}" data-key="{s['key']}" data-label="{s['num']}">{COPY_ICON}<span>Copy SQL {s['num']}</span></button>
        <span class="expect">Expect: <b>{s['expect']}</b></span>
      </div>{note}
      <details>
        <summary>Show the SQL</summary>
        <textarea readonly id="view-{s['key']}" spellcheck="false" aria-label="SQL {html.escape(s['title'])}"></textarea>
      </details>
    </div>
  </section>'''

all_steps = steps_update + steps_done + steps_fresh
body = f'''<div class="wrap">
  <header>
    <h1>Workspace SQL setup</h1>
    <p>Copy a script, paste it into Supabase, run it. Your database is already set up, so only <b>U4</b> at the top is needed now.</p>
  </header>

  <div class="how">
    <div><b>For each script:</b> Copy SQL → Supabase → <b>SQL Editor</b> → <b>New query</b> → paste (Ctrl+V) → <b>Run</b>.</div>
    <div class="warn">If Supabase warns about "destructive operations", click <b>Run this query</b>. The scripts replace older versions of their own rules, which is safe.</div>
  </div>

  <div class="group-title">Run now on your live system</div>
  <div class="steps">
{chr(10).join(section(s) for s in steps_update)}
  </div>

  <div class="group-title">Already run</div>
  <div class="steps">
{chr(10).join(section(s) for s in steps_done)}
  </div>

  <div class="group-title">First-time setup (already done)</div>
  <p class="group-note">For a fresh install only: run 1 → 8 in order (updates are already included). Steps 1–8 are safe to re-run; step 0 is not.</p>
  <div class="steps">
{chr(10).join(section(s) for s in steps_fresh)}
  </div>

  <footer>After U4: deploy the <b>workspace-push</b> Edge Function and switch phone alerts on in the app (Admin console → <b>Phone alerts</b> shows each step), then Admin console → <b>Departments &amp; apps</b> → under Finance, tick <b>Compliance calendar</b> (and <b>Month-end declaration</b> if it isn't ticked yet). After a fresh install: Authentication → Sign In / Providers → Email → turn <b>Confirm email</b> off, and copy the Project URL and Publishable key from <b>Connect</b>.</footer>
</div>

<div class="toast" id="toast" hidden></div>

'''
scripts = ''.join(f'<script type="text/plain" id="sql-{s["key"]}">{open(WS + "/" + s["file"]).read().replace("</", "<\\/")}</script>' for s in all_steps)
js = old[old.index('<script>\n(function () {'):]
js = js.replace("var KEY = 'workspace-sql-done-v2'", "var KEY = 'workspace-sql-done-v3'")
if 'keys.filter' not in js:
    js = js.replace("  keys.forEach(function (k) {\n    var cb = document.getElementById('done-' + k);", "  keys = keys.filter(function (k) { return document.getElementById('done-' + k); });\n  keys.forEach(function (k) {\n    var cb = document.getElementById('done-' + k);")
assert 'keys.filter' in js
# viewing textareas are filled before filtering, so done-only steps still show their SQL
out = head + body + scripts + '\n\n' + js
# the browser reads script text as-is, so undo the escaping when filling in
if 'split(' not in out: out = out.replace("function sql(k) { return document.getElementById('sql-' + k).textContent; }",
                  "function sql(k) { return document.getElementById('sql-' + k).textContent.split('<\\\\/').join('</'); }")
open(os.path.join(SP, 'workspace-sql-setup.html'), 'w').write(out)

# verify every embedded script matches its file exactly
for s in all_steps:
    m = re.search(r'<script type="text/plain" id="sql-' + re.escape(s['key']) + r'">(.*?)</script>', out, re.S)
    assert m and m.group(1).replace('<\\/', '</') == open(WS + '/' + s['file']).read(), s['key']
print('ok', len(out), [s['key'] for s in all_steps])
