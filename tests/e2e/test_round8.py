import os
_HERE = os.path.dirname(os.path.abspath(__file__))
os.makedirs(os.path.join(_HERE, 'shots'), exist_ok=True)
# Browser tests for round 8: "Daily update needed" on tasks (the morning catch-up screen, the update box, badges),
# the My output page (own, and a manager / senior executive looking at a team member), other-work lines,
# and the managers' morning summary.
import asyncio, subprocess
from playwright.async_api import async_playwright

BASE = os.environ.get('APP_URL', 'http://localhost:4173')
DB = os.environ.get('DATABASE_URL', 'postgres://postgres@127.0.0.1:54322/postgres')
OUT = os.path.join(_HERE, 'shots')
results, errors = [], []
def check(c, m): c = bool(c); results.append(c); print(('PASS ' if c else 'FAIL ') + m, flush=True)
def sql(q): return subprocess.run(['psql', DB, '-At', '-c', q], capture_output=True, text=True).stdout.strip()
def raw(q): return sql(f"begin; set local session_replication_role = replica; {q}; commit;")

async def page_for(b, email, w=1360, h=860, wait=1800):
    ctx = await b.new_context(viewport={'width': w, 'height': h}, timezone_id='Asia/Colombo')
    pg = await ctx.new_page()
    pg.on('pageerror', lambda e: errors.append(f'{email}: {e}'))
    pg.on('console', lambda m: errors.append(f'{email}: {m.text}') if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    await pg.goto(BASE); await pg.fill('input[type=email]', email); await pg.fill('input[type=password]', 'password1')
    await pg.click('button:has-text("Sign in")'); await pg.wait_for_timeout(wait)
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
    weekday = sql("select extract(isodow from public.app_today()) < 6") == 't'
    prev = sql("select public.task_prev_workday(public.app_today())")
    prev_label = sql("select to_char(public.task_prev_workday(public.app_today()), 'FMDay, FMDD FMMonth YYYY')")
    # two of Kasun's tasks have needed daily updates since well before the last weekday; nothing was written
    raw("update tasks set daily_update = true, daily_update_from = public.task_prev_workday(public.app_today()) - 7 "
        "where title in ('Petty cash count & top-up', 'Bank reconciliation — Commercial Bank')")
    async with async_playwright() as p:
        b = await p.chromium.launch()

        # =============== the morning catch-up ===============
        k = await page_for(b, 'kasun@demo.lk')
        gate = k.locator('.gate')
        check(await gate.count() == 1, 'Kasun opens the app: a screen asks for yesterday\'s daily updates first')
        gt = await gate.inner_text()
        check('Petty cash count & top-up' in gt and 'Bank reconciliation' in gt and prev_label in gt,
              f'it lists both tasks and the day ({prev_label})')
        check(await k.locator('.gate button:has-text("Save and continue")').is_disabled(), 'it can\'t be skipped: Save is off until every update is written')
        check(await k.locator('.gate button:has-text("Skip"), .gate button:has-text("Close")').count() == 0, 'no skip or close button')
        try:
            await k.click('.tab:has-text("Tasks")', timeout=1500); blocked = False
        except Exception:
            blocked = True
        check(blocked, 'the app behind it can\'t be used')
        await k.screenshot(path=f'{OUT}/u1_morning_gate.png')
        await k.fill('.gate textarea[aria-label="Update for Petty cash count & top-up"]', 'Counted the float, top-up request with Pubudu')
        check(await k.locator('.gate button:has-text("Save and continue")').is_disabled(), 'one written is not enough')
        await k.fill('.gate textarea[aria-label^="Update for Bank reconciliation"]', 'On leave')
        await k.click('.gate button:has-text("Save and continue")'); await k.wait_for_timeout(1200)
        t = await toast(k)
        check(await k.locator('.gate').count() == 0, f'once written, the app opens ({t})')
        check(sql(f"select count(*) from task_comments where daily_for = '{prev}'") == '2', 'both saved as daily updates for the last weekday')
        await k.reload(); await k.wait_for_timeout(1500)
        check(await k.locator('.gate').count() == 0, 'and it doesn\'t come back')

        # =============== the update box in the task ===============
        await k.goto(BASE + '/#/tasks/list'); await k.wait_for_timeout(900)
        pc = k.locator('.task-row:has-text("Petty cash count")')
        br = k.locator('.task-row:has-text("Bank reconciliation")')
        if weekday:
            check('Update due' in await pc.inner_text() and 'Update due' in await br.inner_text(), 'his list shows "Update due" on both')
        await pc.click(); await k.wait_for_selector('.drawer')
        box = k.locator('.daily-box')
        check(await box.count() == 1 and ('Needed today' in await box.inner_text() or not weekday), 'the task has a Daily update box')
        check(await k.locator('.drawer select[aria-label="Daily update"]').is_disabled(), "he can't switch daily updates off (Hasith gave it)")
        await k.fill('.daily-box textarea', 'Top-up received, float balanced at 25,000')
        await k.click('.daily-box button:has-text("Post update")'); await k.wait_for_timeout(900)
        check("Today's is in" in await k.locator('.daily-box').inner_text(), 'after posting: "Today\'s is in"')
        dc = k.locator('.comment.daily')
        dct = ' '.join(await dc.all_inner_texts())
        check(await dc.count() == 2 and 'Daily update ·' in dct and '(written later)' in dct and 'Top-up received' in dct,
              'both updates show in the comments, the catch-up one marked "written later"')
        await k.click('.drawer .subtabs button:has-text("History")'); await k.wait_for_timeout(300)
        check('posted a daily update' in await k.locator('.history').inner_text() or 'posted the daily update' in await k.locator('.history').inner_text(),
              'and in the history')
        await k.keyboard.press('Escape'); await k.wait_for_timeout(400)
        check('Updated today' in await pc.inner_text(), 'the row now shows "✓ Updated today"')
        await k.screenshot(path=f'{OUT}/u2_update_badges.png')

        # =============== My output ===============
        # tick a mini task and finish a task first
        await k.goto(BASE + '/#/tasks'); await k.wait_for_timeout(900)
        await k.fill('.mini-add', 'Call Sampath bank'); await k.press('.mini-add', 'Enter'); await k.wait_for_timeout(500)
        await k.locator('.mini:has-text("Call Sampath bank") .check').click(); await k.wait_for_timeout(500)
        await k.goto(BASE + '/#/tasks/list'); await k.wait_for_timeout(800)
        await k.locator('.task-row:has-text("Fixed asset register update") .check').click(); await k.wait_for_timeout(900)
        await k.click('.tab:has-text("My output")'); await k.wait_for_timeout(1200)
        check(await k.locator('h1').inner_text() == 'My output', 'a My output tab for everyone')
        fin = await k.locator('.out-section:has(h2:has-text("Tasks finished"))').inner_text()
        check('Fixed asset register update' in fin and ('early' in fin or 'on time' in fin) and 'Waiting for sign-off' in fin,
              'tasks finished today, with on time / early and sign-off status')
        upd = await k.locator('.out-section:has(h2:has-text("Daily updates"))').inner_text()
        check('Top-up received' in upd and 'Petty cash count' in upd, "today's daily update is there")
        mt = await k.locator('.out-section:has(h2:has-text("Mini tasks"))').inner_text()
        check('Call Sampath bank' in mt, 'the ticked mini task is there')
        if weekday:
            w = await k.locator('.out-waiting').inner_text()
            check('Bank reconciliation' in w and 'Petty cash' not in w, 'a box lists tasks still waiting for today\'s update')
        for line in ['Processed 12 supplier payments', 'Answered 9 supplier emails', 'Typo line']:
            await k.fill('input[aria-label="Add other work"]', line); await k.press('input[aria-label="Add other work"]', 'Enter'); await k.wait_for_timeout(400)
        await k.locator('.out-title:has-text("Processed 12")').click()
        await k.fill('.out-section .mini-edit', 'Processed 14 supplier payments'); await k.press('.out-section .mini-edit', 'Enter'); await k.wait_for_timeout(500)
        await k.locator('.out-row:has-text("Typo line") .mini-act.x').click(); await k.wait_for_timeout(500)
        ow = await k.locator('.out-section:has(h2:has-text("Other work"))').inner_text()
        check('Processed 14 supplier payments' in ow and 'Answered 9 supplier emails' in ow and 'Typo line' not in ow,
              'other work: add free-text lines, change one, delete one')
        tiles = await k.locator('.out-tile').all_inner_texts()
        check(len(tiles) == 5 and tiles[3].startswith('2') and 'focus time' in tiles[4], f'counts at the top ({[x.replace(chr(10), " ") for x in tiles]})')
        await k.screenshot(path=f'{OUT}/u3_my_output.png', full_page=True)
        # the last weekday
        await k.goto(BASE + f'/#/tasks/output?d={prev}'); await k.wait_for_timeout(1000)
        pu = await k.locator('.out-section:has(h2:has-text("Daily updates"))').inner_text()
        check('On leave' in pu and 'written next morning' in pu, 'the last weekday shows the catch-up updates, marked "written next morning"')
        check(await k.locator('input[aria-label="Add other work"]').count() == 0 and "can't be filled in afterwards" in await k.locator('.output-page').inner_text(),
              'earlier days can\'t be filled in')

        # =============== managers looking at a team member ===============
        h = await page_for(b, 'hasith@demo.lk')
        await to_finance(h)
        if weekday:
            await h.click('.bell .icon-btn'); await h.wait_for_timeout(400)
            bell = await h.locator('.bell-pop').inner_text()
            check('Team output' in bell or ('Kasun' in bell and 'Missed daily updates: Kasun' in bell),
                  'the manager\'s morning summary is in the bell, naming who missed a daily update')
            check("Kasun Silva's daily update on \"Petty cash count & top-up\"" in bell, 'and each daily update Kasun wrote')
            await h.locator('.notice-row.k-output_summary').first.click(); await h.wait_for_timeout(1200)
            check(f'#/tasks/output' in h.url and f'd={prev}' in h.url, f'tapping the summary opens the output page for that day ({h.url.split("#")[1]})')
        await h.goto(BASE + '/#/tasks/output'); await h.wait_for_timeout(900)
        await h.select_option('select[aria-label="Whose output"]', label='Kasun Silva'); await h.wait_for_timeout(1000)
        check(await h.locator('h1').inner_text() == "Kasun Silva's output", 'a manager picks a person')
        ht = await h.locator('.output-page').inner_text()
        check('Processed 14 supplier payments' in ht and 'Call Sampath bank' in ht and 'Top-up received' in ht and 'Fixed asset register update' in ht,
              "and sees everything Kasun did today")
        check(await h.locator('input[aria-label="Add other work"]').count() == 0 and await h.locator('.out-section .mini-act').count() == 0,
              "but can't add or change Kasun's lines")
        await h.screenshot(path=f'{OUT}/u4_manager_view.png', full_page=True)
        n = await page_for(b, 'nadeesha@demo.lk')
        await n.goto(BASE + '/#/tasks/output'); await n.wait_for_timeout(900)
        opts = await n.locator('select[aria-label="Whose output"] option').all_inner_texts()
        check('Kasun Silva' in opts and 'Hasith Ranaweera' not in opts, f'a senior executive can pick members only ({opts})')
        a = await page_for(b, 'amaya@demo.lk')
        await a.goto(BASE + '/#/tasks/output'); await a.wait_for_timeout(900)
        check(await a.locator('select[aria-label="Whose output"]').count() == 0 and 'Processed 14' not in await a.locator('.output-page').inner_text(),
              "a member sees only her own")

        # =============== switching it on ===============
        await h.goto(BASE + '/#/tasks/list'); await h.wait_for_timeout(700)
        await h.click('.subnav .btn.primary'); await h.wait_for_selector('.drawer')
        await h.fill('.drawer .title-input', 'Supplier statement reconciliations')
        await h.select_option('.drawer .field:has(span:text-is("Owner")) select', label='Amaya Fernando')
        await h.select_option('.drawer select[aria-label="Daily update"]', label='Every weekday')
        note = ' '.join(await h.locator('.drawer .field-note').all_inner_texts())
        check('Amaya writes a short Daily update' in note and 'next morning before the app opens' in note, 'the note explains what Amaya will have to do')
        await h.click('.drawer button:has-text("Create task")'); await h.wait_for_timeout(900)
        check(sql("select daily_update::text || ' ' || (daily_update_from > public.app_today())::text from tasks where title = 'Supplier statement reconciliations'") == 'true true',
              'saved; updates start from the next weekday')
        await h.goto(BASE + '/#/tasks/list?who=all'); await h.wait_for_timeout(900)
        row = h.locator('.task-row:has-text("Supplier statement reconciliations")')
        check('Daily update' in await row.inner_text(), 'the row shows it needs daily updates')

        # =============== phone ===============
        raw("update tasks set daily_update_from = public.task_prev_workday(public.app_today()) - 3 where title = 'Supplier statement reconciliations'")
        ma = await page_for(b, 'amaya@demo.lk', 390, 844)
        sw = await ma.evaluate('document.documentElement.scrollWidth')
        gb = await ma.locator('.gate-card').bounding_box()
        check(await ma.locator('.gate').count() == 1 and gb and gb['width'] <= 390 and sw <= 392, f'on a phone the catch-up screen fits ({sw}px)')
        await ma.screenshot(path=f'{OUT}/u5_phone_gate.png')
        await ma.fill('.gate textarea', 'Matched 3 of 5 statements'); await ma.click('.gate button:has-text("Save and continue")'); await ma.wait_for_timeout(1200)
        await ma.goto(BASE + '/#/tasks/output'); await ma.wait_for_timeout(900)
        sw = await ma.evaluate('document.documentElement.scrollWidth')
        check(await ma.locator('.gate').count() == 0 and sw <= 392, f'and My output fits a phone ({sw}px)')
        await ma.screenshot(path=f'{OUT}/u6_phone_output.png', full_page=True)

        check(not errors, f'no browser errors ({errors[:3]})')
        await b.close()
    print(f'\n{sum(results)} passed, {len(results) - sum(results)} failed')

asyncio.run(main())
