import os
_HERE = os.path.dirname(os.path.abspath(__file__))
os.makedirs(os.path.join(_HERE, 'shots'), exist_ok=True)
# Browser tests for round 6: managers' Home screen, quick reminders (me or my team), the New tab,
# escalation of long-overdue work, pin & follow, and turning a note line into a task.
import asyncio, datetime, json, subprocess
from playwright.async_api import async_playwright

BASE = os.environ.get('APP_URL', 'http://localhost:4173')
DB = os.environ.get('DATABASE_URL', 'postgres://postgres@127.0.0.1:54322/postgres')
OUT = os.path.join(_HERE, 'shots')
results, errors = [], []
def check(c, m): c = bool(c); results.append(c); print(('PASS ' if c else 'FAIL ') + m, flush=True)
def sql(q): return subprocess.run(['psql', DB, '-At', '-c', q], capture_output=True, text=True).stdout.strip()
def uid(email): return sql(f"select id from profiles where email='{email}'")
def housekeeping(q): return sql(f"do $$ begin perform set_config('app.system','on',true); {q}; perform set_config('app.system','off',true); end $$")

async def page_for(b, email, w=1360, h=860):
    ctx = await b.new_context(viewport={'width': w, 'height': h}, timezone_id='Asia/Colombo')
    pg = await ctx.new_page()
    pg.on('pageerror', lambda e: errors.append(f'{email}: {e}'))
    pg.on('console', lambda m: errors.append(f'{email}: {m.text}') if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    await pg.goto(BASE); await pg.fill('input[type=email]', email); await pg.fill('input[type=password]', 'password1')
    await pg.click('button:has-text("Sign in")'); await pg.wait_for_timeout(1800)
    return pg

async def to_finance(h):
    if 'Finance' not in await h.locator('.dept-switch .switcher').inner_text():
        await h.click('.dept-switch .switcher'); await h.click('.drop-item:has-text("Finance")'); await h.wait_for_timeout(1000)

async def toast(pg):
    try:
        await pg.wait_for_selector('.toast', timeout=4000)
        return ' | '.join(await pg.locator('.toast').all_inner_texts())
    except Exception:
        return ''

async def main():
    # a task 4 days late, so this morning's check escalates it
    housekeeping("update tasks set due_date = public.app_today() - 4, escalated_at = null where title = 'Follow up debtor statements'")
    async with async_playwright() as p:
        b = await p.chromium.launch()

        # =============== Home ===============
        h = await page_for(b, 'hasith@demo.lk')
        await to_finance(h)
        await h.goto(BASE + '/'); await h.reload(); await h.wait_for_timeout(2000)
        check('#/tasks/home' in h.url and await h.locator('.tab.active').inner_text() == 'Home', f'a manager opens the app on Home ({h.url})')
        check((await h.locator('h1').inner_text()).startswith(('Good morning', 'Good afternoon', 'Good evening')), 'Home greets him')
        tiles = await h.locator('.tile').all_inner_texts()
        check(len(tiles) == 5 and any('waiting for your sign-off' in t for t in tiles), f'five summary tiles ({len(tiles)})')
        so = await h.locator('.home-panel:has(h2:has-text("Waiting for your sign-off"))').inner_text()
        check('Post September supplier invoices' in so, 'Home lists work waiting for his sign-off')
        od = await h.locator('.home-panel:has(h2:has-text("Overdue by person"))').inner_text()
        check('Amaya' in od and 'escalated' in od, f'overdue by person, with escalations ({od[:80]!r})')
        un = await h.locator('#home-unopened').inner_text()
        check('Clear unreconciled items list' in un, 'Home shows work not opened yet')
        await h.screenshot(path=f'{OUT}/q1_home.png', full_page=True)
        await h.click('.tab:has-text("Today")'); await h.wait_for_timeout(800)
        check(await h.locator('.tab.active').inner_text() == 'Today', 'Today is one tab away')
        k = await page_for(b, 'kasun@demo.lk')
        check('home' not in k.url and await k.locator('.tab:has-text("Home")').count() == 0, 'members still open on Today (no Home)')

        # =============== escalation ===============
        await h.click('.bell .icon-btn'); await h.wait_for_timeout(300)
        bell = await h.locator('.bell-pop').inner_text()
        check('Escalated: Amaya Fernando\'s "Follow up debtor statements" is 4 days past its deadline' in bell, 'the manager is told about work 3+ days late')
        await h.keyboard.press('Escape'); await h.mouse.click(10, 600)
        await h.goto(BASE + '/#/tasks/list?who=all'); await h.wait_for_timeout(900)
        row = h.locator('.task-row:has-text("Follow up debtor statements")')
        check(await row.locator('.pill.esc').count() == 1, 'the card carries a red Escalated flag')
        await h.goto(BASE + '/#/tasks/team'); await h.wait_for_timeout(900)
        check(await h.locator('.bcard.escalated:has-text("Follow up debtor statements")').count() == 1, '…on the board too')
        a = await page_for(b, 'amaya@demo.lk')
        await a.click('.bell .icon-btn'); await a.wait_for_timeout(300)
        check('Escalated to your manager' in await a.locator('.bell-pop').inner_text(), 'the owner knows it went to the manager')
        await a.keyboard.press('Escape')

        # =============== New tab ===============
        await k.goto(BASE + '/#/tasks/list'); await k.wait_for_timeout(1000)
        check(await k.locator('.tab:has-text("New")').count() == 1 and '1' in await k.locator('.tab:has-text("New") .badge').inner_text(), 'Kasun has a "New 1" tab')
        check(await k.locator('.task-row:has-text("Clear unreconciled items list")').count() == 0, 'unopened work is not in his list yet')
        check(await k.locator('.new-banner').count() == 1, 'a banner points him to it')
        await k.goto(BASE + '/#/tasks'); await k.wait_for_timeout(900)
        check(await k.locator('.plan-list').count() == 1 and 'Clear unreconciled items list' not in await k.locator('.plan-list').inner_text(),
              'nor on his Today plan')
        await k.goto(BASE + '/#/tasks/calendar'); await k.wait_for_timeout(900)
        check(await k.locator('.chip:has-text("Clear unreconciled items list")').count() == 0, 'nor on his calendar')
        await k.goto(BASE + '/#/tasks/new'); await k.wait_for_timeout(900)
        card = k.locator('.new-card:has-text("Clear unreconciled items list")')
        check(await card.count() == 1 and 'Nadeesha Perera' in await card.inner_text(), 'the New tab shows it with who gave it')
        await k.screenshot(path=f'{OUT}/q2_new_tab.png')
        await card.locator('button:has-text("Got it")').click(); await k.wait_for_timeout(900)
        check('in your list now' in await toast(k), 'Got it moves it into his list')
        await k.goto(BASE + '/#/tasks/list'); await k.wait_for_timeout(900)
        check(await k.locator('.task-row:has-text("Clear unreconciled items list")').count() == 1 and await k.locator('.tab:has-text("New")').count() == 0,
              'it is in his list now, and the New tab is gone')
        n = await page_for(b, 'nadeesha@demo.lk')
        await n.goto(BASE + '/#/tasks/list?who=byme'); await n.wait_for_timeout(900)
        check(await n.locator('.task-row:has-text("Clear unreconciled items list") .pill.unseen').count() == 0, 'whoever gave it no longer sees "Not opened yet"')

        # =============== reminders ===============
        await k.click('.rem-btn .icon-btn'); await k.wait_for_timeout(300)
        check(await k.locator('.rem-pop select[aria-label="For"]').count() == 0, 'a member sets reminders only for himself')
        await k.fill('.rem-pop .rem-text', 'Call Sampath bank about the charges')
        await k.click('.rem-pop .chip-btn:has-text("Tomorrow 9 am")')
        await k.click('.rem-pop button:has-text("Set reminder")'); await k.wait_for_timeout(800)
        check('Reminder set for Tomorrow 09:00' in await toast(k), 'quick reminder: one line and one tap')
        check(await k.locator('.rem-pop .rem-item:has-text("Call Sampath bank")').count() == 1, 'it shows under Coming up')
        await k.keyboard.press('Escape')
        await n.click('.rem-btn .icon-btn'); await n.wait_for_timeout(300)
        opts = await n.locator('.rem-pop select[aria-label="For"] option').all_inner_texts()
        check('For Kasun Silva' in opts and 'For Hasith Ranaweera' not in opts, f'a senior can remind members, not the manager ({opts})')
        await n.fill('.rem-pop .rem-text', 'Send me the bank rec')
        await n.locator('.rem-pop select[aria-label="For"]').select_option(label='For Kasun Silva')
        await n.click('.rem-pop button:has-text("Set reminder")'); await n.wait_for_timeout(800)
        check('Reminder set for Kasun' in await toast(n), 'she sets one for Kasun')
        await n.keyboard.press('Escape')
        # time passes: both are due now
        housekeeping("update task_reminders set remind_at = now() - interval '1 minute'")
        await k.reload(); await k.wait_for_timeout(2500)
        await k.click('.bell .icon-btn'); await k.wait_for_timeout(300)
        bell = await k.locator('.bell-pop').inner_text()
        check('Reminder: Call Sampath bank about the charges' in bell and 'Reminder from Nadeesha Perera: Send me the bank rec' in bell,
              'at their time both pop up in his bell (and on his phone)')
        await k.keyboard.press('Escape'); await k.mouse.click(10, 600)
        check(await k.locator('.rem-btn .dot-count').inner_text() == '2', 'the reminder button shows 2 due')
        await k.goto(BASE + '/#/tasks/reminders'); await k.wait_for_timeout(1000)
        due = k.locator('.group:has(h2:has-text("Due now"))')
        check(await due.locator('.rem-item').count() == 2 and 'from Nadeesha' in await due.inner_text(), 'the Reminders page lists what is due, and who set it')
        await due.locator('.rem-item:has-text("Call Sampath") button:has-text("Snooze")').click()
        await k.click('.rem-item:has-text("Call Sampath") button:has-text("1 hour")'); await k.wait_for_timeout(800)
        check('Snoozed until' in await toast(k), 'snooze for an hour')
        await k.locator('.rem-item:has-text("Send me the bank rec") button:has-text("Make it a task")').click(); await k.wait_for_timeout(1500)
        check(await k.locator('.drawer .title-input').count() == 1 and await k.locator('.drawer .title-input').input_value() == 'Send me the bank rec',
              'a reminder can be turned into a task')
        await k.keyboard.press('Escape')
        await k.screenshot(path=f'{OUT}/q3_reminders.png')
        await n.goto(BASE + '/#/tasks/reminders'); await n.wait_for_timeout(1000)
        check('Set by you for others' not in await n.locator('main').inner_text(), 'once done it leaves her "set for others" list')

        # =============== pin & follow ===============
        await h.goto(BASE + '/#/tasks/list?who=all'); await h.wait_for_timeout(900)
        await h.click('.task-row:has-text("Scan & file GRNs")'); await h.wait_for_selector('.drawer')
        await h.click('.drawer-tools button:has-text("Follow")'); await h.wait_for_timeout(500)
        await h.click('.drawer-tools button:has-text("Pin")'); await h.wait_for_timeout(500)
        tools = await h.locator('.drawer-tools').inner_text()
        check('Following' in tools and 'Pinned' in tools, 'he follows and pins a task someone else gave')
        await h.keyboard.press('Escape')
        await h.goto(BASE + '/#/tasks/list'); await h.wait_for_timeout(900)
        check(await h.locator('.pinned-group .task-row:has-text("Scan & file GRNs")').count() == 1, 'pinned tasks sit at the top of his list')
        await h.select_option('select[aria-label="Whose tasks"]', 'following'); await h.wait_for_timeout(500)
        check(await h.locator('.task-row:has-text("Scan & file GRNs")').count() == 1, 'a "Following" filter shows what he follows')
        aid = sql("select id from tasks where title = 'Scan & file GRNs'")
        sql(f"""begin; set local role authenticated; select set_config('request.jwt.claims', '{{"sub":"{uid('amaya@demo.lk')}"}}', true);
            insert into task_comments (task_id, body) values ({aid}, 'Half of the GRNs filed'); commit;""")
        check(sql(f"select count(*) from notifications where user_id='{uid('hasith@demo.lk')}' and kind='comment' and ref_id={aid}") == '1',
              'following brings him its alerts')

        # =============== notes → task ===============
        hid = uid('hasith@demo.lk')
        nid = sql(f"""begin; set local role authenticated; select set_config('request.jwt.claims', '{{"sub":"{hid}"}}', true);
            insert into notes_pages (title, content, share_scope) values ('Close meeting 9 Oct',
            '{{"type":"doc","content":[{{"type":"paragraph","content":[{{"type":"text","text":"Chase HNB for the September statement"}}]}}]}}', 'department') returning id; commit;""").splitlines()
        nid = [x for x in nid if x.strip().isdigit()][0]
        await h.goto(BASE + f'/#/notes?note={nid}'); await h.wait_for_timeout(2000)
        await h.click('.note-doc p:has-text("Chase HNB")'); await h.keyboard.press('End')
        await h.click('.note-toolbar button:has-text("→ Task")'); await h.wait_for_timeout(300)
        check(await h.locator('.note-task-form input[aria-label="Task title"]').input_value() == 'Chase HNB for the September statement', 'the line becomes the task title')
        await h.locator('.note-task-form select[aria-label="Owner"]').select_option(label='Kasun Silva')
        await h.click('.note-task-form button:has-text("Create task")'); await h.wait_for_timeout(1500)
        check('Task given to Kasun and linked' in await toast(h), 'one click turns a note line into a task')
        tid = sql("select id from tasks where title = 'Chase HNB for the September statement'")
        check(tid and await h.locator(f'.note-doc a:has-text("Task #{tid}")').count() == 1, 'the line now links to the task')
        check(await h.locator('.linked-list:has-text("Chase HNB for the September statement")').count() == 1, 'and it is listed under Linked tasks')
        check(sql(f"select assignee_id='{uid('kasun@demo.lk')}' from tasks where id={tid or 0}") == 't', 'it is Kasun\'s task')
        await h.wait_for_timeout(1500)   # let the note save
        await h.screenshot(path=f'{OUT}/q4_note_to_task.png')
        await h.click(f'.note-doc a:has-text("Task #{tid}")', modifiers=['Control']); await h.wait_for_timeout(1500)
        check(await h.locator('.drawer .title-input').count() == 1, 'Ctrl+click on the link opens the task')

        # =============== phones ===============
        m = await page_for(b, 'hasith@demo.lk', 390, 844)
        await to_finance(m)
        for path in ['/#/tasks/home', '/#/tasks/reminders', '/#/tasks/list']:
            await m.goto(BASE + path); await m.wait_for_timeout(1000)
            sw = await m.evaluate('document.documentElement.scrollWidth')
            check(sw <= 392, f'{path} fits a phone screen ({sw}px)')
        await m.goto(BASE + '/#/tasks/home'); await m.wait_for_timeout(800)
        await m.screenshot(path=f'{OUT}/q5_home_phone.png', full_page=True)
        await m.click('.rem-btn .icon-btn'); await m.wait_for_timeout(300)
        await m.screenshot(path=f'{OUT}/q6_reminder_phone.png')
        await b.close()
    print('ERRORS:', errors or 'none')
    print(sum(results), 'passed,', len(results) - sum(results), 'failed')

if __name__ == '__main__':
    asyncio.run(main())
