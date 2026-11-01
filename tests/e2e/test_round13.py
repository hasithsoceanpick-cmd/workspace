import os
_HERE = os.path.dirname(os.path.abspath(__file__))
os.makedirs(os.path.join(_HERE, 'shots'), exist_ok=True)
# Browser tests for round 13: work given without a deadline — "Kasun picks the date" with an optional latest date,
# the "No date yet" group and board column, the New tab's Pick your date + Got it, picking from the task panel,
# the giver's alert, setting the date yourself after all, Excel, phone.
import asyncio, subprocess
import openpyxl
from playwright.async_api import async_playwright

BASE = os.environ.get('APP_URL', 'http://localhost:4173')
DB = os.environ.get('DATABASE_URL', 'postgres://postgres@127.0.0.1:54322/postgres')
OUT = os.path.join(_HERE, 'shots')
results, errors = [], []
def check(c, m): c = bool(c); results.append(c); print(('PASS ' if c else 'FAIL ') + m, flush=True)
def sql(q): return subprocess.run(['psql', DB, '-At', '-c', q], capture_output=True, text=True).stdout.strip()
def day(n): return sql(f"select (public.app_today() + {n})::text")
def fmt(d): return sql(f"select public.fmt_date('{d}'::date)")

async def page_for(b, email, w=1360, h=860):
    ctx = await b.new_context(viewport={'width': w, 'height': h}, timezone_id='Asia/Colombo', accept_downloads=True)
    pg = await ctx.new_page()
    pg.on('pageerror', lambda e: errors.append(f'{email}: {e}'))
    pg.on('console', lambda m: errors.append(f'{email}: {m.text}') if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    await pg.goto(BASE); await pg.fill('input[type=email]', email); await pg.fill('input[type=password]', 'password1')
    await pg.click('button:has-text("Sign in")'); await pg.wait_for_timeout(1800)
    return pg

async def toast(pg):
    try:
        await pg.wait_for_selector('.toast', timeout=4000)
        return ' | '.join(await pg.locator('.toast').all_inner_texts())
    except Exception:
        return ''

async def bell(pg):
    await pg.click('.bell .icon-btn'); await pg.wait_for_timeout(400)
    t = await pg.locator('.bell-pop').inner_text()
    await pg.click('.bell .icon-btn'); await pg.wait_for_timeout(200)
    return t

async def last_toast(pg):
    try:
        await pg.wait_for_selector('.toast', timeout=4000)
        await pg.wait_for_timeout(300)
        return (await pg.locator('.toast').all_inner_texts())[-1]
    except Exception:
        return ''

async def new_task(pg, title, owner):
    if await pg.locator('.drawer').count(): await pg.keyboard.press('Escape'); await pg.wait_for_timeout(300)
    await pg.goto(BASE + '/#/tasks/list'); await pg.wait_for_timeout(900)
    await pg.click('.subnav .btn.primary'); await pg.wait_for_selector('.drawer')
    await pg.fill('.drawer .title-input', title)
    await pg.select_option('.drawer .fields select >> nth=0', label=owner)
    await pg.wait_for_timeout(200)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        h = await page_for(b, 'hasith@demo.lk')
        await h.goto(BASE + '/#/tasks/list'); await h.wait_for_timeout(1200)

        # =============== giving work without a deadline ===============
        await h.click('.subnav .btn.primary'); await h.wait_for_selector('.drawer')
        check(await h.locator('.drawer .let-pick').count() == 0, 'no "picks the date" option for your own task')
        await h.click('.drawer .nature-switch .seg-btn:has-text("Project")')
        await h.select_option('.drawer .fields select >> nth=0', label='Kasun Silva')
        check(await h.locator('.drawer .let-pick').count() == 0, 'nor for a project')
        await h.click('.drawer .nature-switch .seg-btn:has-text("Task")')
        await h.fill('.drawer .title-input', 'Prepare the October VAT workings')
        lp = h.locator('.drawer .let-pick')
        check(await lp.count() == 1 and 'Kasun picks the date' in await lp.inner_text(), 'giving it to Kasun offers "Kasun picks the date"')
        await lp.locator('input').check(); await h.wait_for_timeout(200)
        check('No date yet — Kasun picks it' in await h.locator('.drawer .deadline-field').inner_text(), 'the deadline becomes "No date yet — Kasun picks it"')
        latest = day(10)
        await h.fill('.drawer input[aria-label="Latest date"]', latest)
        note = await h.locator('.drawer .latest-row .field-note').inner_text()
        check(f'any day up to {fmt(latest)}' in note.replace('\n', ' '), f'an optional latest date ({note.strip()})')
        await h.screenshot(path=os.path.join(OUT, 'r13-give-no-deadline.png'))
        await h.click('.drawer button:has-text("Create task")')
        await h.wait_for_timeout(1200)
        row = sql("select coalesce(due_date::text,'none')||'|'||latest_by||'|'||(acknowledged_at is null) from tasks where title='Prepare the October VAT workings'")
        check(row == f'none|{latest}|true', f'saved with no deadline and the latest date ({row})')

        # the giver's list and the board
        await h.goto(BASE + '/#/tasks/list?who=me'); await h.wait_for_timeout(1200)
        grp = h.locator('.nodate-group')
        gt = await grp.inner_text() if await grp.count() else ''
        check('No date yet' in gt and 'Prepare the October VAT workings' in gt and f'by {fmt(latest)}' in gt and 'Not opened yet' in gt,
              'Hasith\'s list shows it under "No date yet" (with the limit, not opened yet)')
        await h.goto(BASE + '/#/tasks/team'); await h.wait_for_timeout(1200)
        col = h.locator('.bcol:has(.bcol-name:has-text("Kasun Silva"))')
        check('No date yet' in await col.inner_text() and await col.locator('.bcard.undated').count() == 1, "Who's on what: a No date yet card in Kasun's column")
        check('1 waiting for a date' in await h.locator('.board-sum').inner_text(), '…and counted at the top')
        await h.goto(BASE + '/#/tasks/team?view=table'); await h.wait_for_timeout(800)
        heads = await h.locator('.team-table th').all_inner_texts()
        krow = await h.locator('.team-table tr:has-text("Kasun Silva") td').all_inner_texts()
        check('No date yet' in heads and krow[heads.index('No date yet')] == '1', 'and a "No date yet" column in the table')

        # Excel
        await h.goto(BASE + '/#/tasks/list?who=all'); await h.wait_for_timeout(1000)
        async with h.expect_download() as dl:
            await h.click('button:has-text("Export to Excel")')
        path = os.path.join(OUT, 'r13-tasks.xlsx'); await (await dl.value).save_as(path)
        ws = openpyxl.load_workbook(path)['Tasks']
        r = [x for x in ws.iter_rows(min_row=2, values_only=True) if x[1] == 'Prepare the October VAT workings']
        check(r and r[0][5].startswith('No date yet — owner picks') and r[0][7] is None, f'the Excel export lists it with no deadline ({r[0][5] if r else None})')

        # a second one, no limit, for Kasun
        await new_task(h, 'Collect fixed asset tags', 'Kasun Silva')
        await h.locator('.drawer .let-pick input').check()
        await h.click('.drawer button:has-text("Create task")'); await h.wait_for_timeout(1000)

        # =============== Kasun picks his date ===============
        k = await page_for(b, 'kasun@demo.lk')
        alerts = await bell(k)
        check(f'assigned you "Prepare the October VAT workings" — pick your own date (by {fmt(latest)})' in alerts, 'Kasun is told to pick his own date, and by when')
        await k.goto(BASE + '/#/tasks/new'); await k.wait_for_timeout(1200)
        card = k.locator('.new-card:has-text("Prepare the October VAT workings")')
        check('No deadline — you pick the date' in await card.inner_text() and f'any day up to {fmt(latest)}' in await card.locator('.new-pick').inner_text(),
              'the New tab shows it with a date box (and the limit)')
        check(await card.locator('button:has-text("Got it")').is_disabled(), 'Got it waits for a date')
        n_before = int(sql("select count(*) from tasks t join profiles p on p.id=t.assignee_id where p.full_name='Kasun Silva' and acknowledged_at is null"))
        await k.click('button:has-text("Got it for all")'); await k.wait_for_timeout(1500)
        t = await toast(k)
        check('2 still need your date' in t and int(sql("select count(*) from tasks t join profiles p on p.id=t.assignee_id where p.full_name='Kasun Silva' and acknowledged_at is null")) == 2,
              f'Got it for all takes the dated ones and leaves those needing a date ({t}; {n_before} → 2)')
        await k.wait_for_timeout(3500)   # let the earlier messages go
        await card.locator('input[type=date]').fill(day(15))
        await card.locator('button:has-text("Got it")').click()
        t = await last_toast(k)
        check('on or before' in t and sql("select acknowledged_at is null from tasks where title='Prepare the October VAT workings'") == 't', f'a date after the limit is refused ({t})')
        picked = day(6)
        await k.wait_for_timeout(3500)
        await card.locator('input[type=date]').fill(picked)
        await card.locator('button:has-text("Got it")').click()
        t = await last_toast(k)
        got = sql("select due_date||'|'||(acknowledged_at is not null)||'|'||due_moves from tasks where title='Prepare the October VAT workings'")
        check(got == f'{picked}|true|0' and 'Hasith has been told' in t,
              f'he picks a date and presses Got it: it becomes the deadline, not a move ({got}; {t})')
        await k.screenshot(path=os.path.join(OUT, 'r13-new-tab.png'))
        await k.goto(BASE + '/#/tasks/list'); await k.wait_for_timeout(1200)
        check(await k.locator('.task-row:has-text("Prepare the October VAT workings")').count() == 1, 'it is in his list now, with his date')

        await h.reload(); await h.wait_for_timeout(1800)
        al = await bell(h)
        check(f'Kasun Silva set the deadline for "Prepare the October VAT workings": {fmt(picked)}' in al, 'Hasith is told the date Kasun picked')
        await h.goto(BASE + '/#/tasks/list?who=me'); await h.wait_for_timeout(1200)
        check('Prepare the October VAT workings' not in (await h.locator('.nodate-group').inner_text() if await h.locator('.nodate-group').count() else ''),
              'it leaves the No date yet group')
        await h.goto(BASE + '/#/tasks/list?who=all'); await h.wait_for_timeout(1000)
        await h.click('.task-row:has-text("Prepare the October VAT workings")'); await h.wait_for_selector('.drawer')
        await h.click('.drawer button:has-text("History")'); await h.wait_for_timeout(500)
        check('set the deadline' in await h.locator('.drawer').inner_text(), 'the task history shows Kasun set the deadline')
        await h.keyboard.press('Escape')

        # =============== picking from the task panel ===============
        await k.goto(BASE + '/#/tasks/new'); await k.wait_for_timeout(1000)
        await k.click('.new-card:has-text("Collect fixed asset tags") .new-title'); await k.wait_for_selector('.drawer')
        ban = k.locator('.drawer .ack-banner.pick')
        check(await ban.count() == 1 and 'pick your date' in await ban.inner_text(), 'opening it shows "pick your date, then press Got it"')
        await ban.locator('input[type=date]').fill(day(3))
        await ban.locator('button:has-text("Got it")').click(); await k.wait_for_timeout(1200)
        check(sql("select due_date from tasks where title='Collect fixed asset tags'") == day(3), 'he picks it right in the task panel')
        await k.keyboard.press('Escape')

        # =============== the giver sets it after all ===============
        await new_task(h, 'Bank confirmations for EY', 'Amaya Fernando')
        await h.locator('.drawer .let-pick input').check()
        await h.click('.drawer button:has-text("Create task")'); await h.wait_for_timeout(1000)
        await h.goto(BASE + '/#/tasks/list?who=me'); await h.wait_for_timeout(1000)
        await h.click('.nodate-group .task-row:has-text("Bank confirmations for EY")'); await h.wait_for_selector('.drawer')
        lp = h.locator('.drawer .let-pick input')
        check(await lp.is_checked(), 'Hasith can open it while it waits')
        await lp.uncheck()
        await h.fill('.drawer input[aria-label="Deadline"]', day(4))
        await h.click('.drawer button:has-text("Save changes")'); await h.wait_for_timeout(1000)
        check(sql("select due_date||'|'||(acknowledged_at is null) from tasks where title='Bank confirmations for EY'") == f'{day(4)}|true',
              'and set the date himself after all (it still waits for her Got it)')
        check(f'Hasith Ranaweera set the deadline for "Bank confirmations for EY": {fmt(day(4))}' in
              sql("select string_agg(message, ' | ') from notifications n join profiles p on p.id=n.user_id where p.full_name='Amaya Fernando'"),
              'Amaya is told the date')

        # =============== phone ===============
        await new_task(h, 'Phone check', 'Kasun Silva')
        await h.locator('.drawer .let-pick input').check()
        await h.click('.drawer button:has-text("Create task")'); await h.wait_for_timeout(800)
        ph = await page_for(b, 'kasun@demo.lk', 390, 844)
        await ph.goto(BASE + '/#/tasks/new'); await ph.wait_for_timeout(1500)
        sw = await ph.evaluate('document.documentElement.scrollWidth')
        check(sw <= 390 and await ph.locator('.new-card:has-text("Phone check") .new-pick input').is_visible(), f'phone: the New tab date box fits ({sw})')
        await ph.screenshot(path=os.path.join(OUT, 'r13-phone.png'))

        real = [e for e in errors if 'Failed to fetch' not in e]
        check(not real, f'no browser errors ({real[:3]})')
        await b.close()
    print(f'\n{sum(results)} passed, {len(results) - sum(results)} failed')
    raise SystemExit(0 if all(results) else 1)

asyncio.run(main())
