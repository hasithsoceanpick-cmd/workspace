import os
_HERE = os.path.dirname(os.path.abspath(__file__))
os.makedirs(os.path.join(_HERE, 'shots'), exist_ok=True)
# Browser tests for round 7: mini tasks on Today (private; left-overs: do today / make task / delete),
# Today shows only this day's work, "Assigned by" at the top of task cards, daily and weekday repeats.
import asyncio, subprocess
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

async def add_mini(pg, text):
    await pg.fill('.mini-add', text); await pg.press('.mini-add', 'Enter'); await pg.wait_for_timeout(500)

async def main():
    K = uid('kasun@demo.lk')
    async with async_playwright() as p:
        b = await p.chromium.launch()

        # =============== Today shows only this day's work ===============
        k = await page_for(b, 'kasun@demo.lk')
        check(await k.locator('.tab.active').inner_text() == 'Today', 'Kasun opens on Today')
        plan = await k.locator('.plan-list').inner_text()
        check('Petty cash count' in plan, 'work due today is listed')
        check('Fixed asset register update' not in plan.split('+ Plan a task due later')[0], 'work due later is no longer listed')
        check('Clear unreconciled items list' not in plan, 'new work he has not opened stays in the New tab')
        check(await k.locator('.late-toggle').count() == 1 and await k.locator('.plan-item:has-text("Bank reconciliation")').count() == 0,
              'overdue work is one short folded line')
        await k.click('.late-toggle'); await k.wait_for_timeout(200)
        check('2d late' in await k.locator('.plan-item:has-text("Bank reconciliation")').inner_text(), 'opening it shows the overdue work, with how late')
        check(await k.locator('.plan-group h3:has-text("Next 7 days")').count() == 0 and await k.locator('.plan-group h3:has-text("Later")').count() == 0,
              'no "Next 7 days" or "Later" groups')
        # pull work due later into the day
        await k.select_option('select.plan-more', label=[o for o in await k.locator('select.plan-more option').all_inner_texts() if 'Fixed asset' in o][0])
        await k.wait_for_timeout(900)
        check(await k.locator('.tl-block:has-text("Fixed asset register update")').count() == 1, 'a task due later can be pulled into the day from the picker')
        grp = k.locator('.plan-group:has(h3:has-text("Planned for today"))')
        check(await grp.count() == 1 and 'Fixed asset register update' in await grp.inner_text(), 'it then shows under "Planned for today"')

        # =============== Mini tasks ===============
        check(await k.locator('.minis .section-title').inner_text() == 'MINI TASKS' or (await k.locator('.minis .section-title').inner_text()).lower() == 'mini tasks',
              'a Mini tasks list sits at the top of Today')
        await add_mini(k, 'Call Sampath bank about charges')
        await add_mini(k, 'Email the auditors the TB')
        await add_mini(k, 'Print cheque list')
        check(await k.locator('.mini').count() == 3, 'he adds three mini tasks with Enter')
        await k.locator('.mini:has-text("Call Sampath") .check').click(); await k.wait_for_timeout(500)
        check(await k.locator('.mini.done:has-text("Call Sampath")').count() == 1 and '1/3 done' in await k.locator('.mini-head').inner_text(),
              'ticking one crosses it out (1/3 done)')
        await k.locator('.mini-text:has-text("Print cheque list")').click()
        await k.fill('.mini-edit', 'Print cheque list for Pubudu'); await k.press('.mini-edit', 'Enter'); await k.wait_for_timeout(500)
        check(await k.locator('.mini-text:has-text("Print cheque list for Pubudu")').count() == 1, 'click one to change its words')
        await k.reload(); await k.wait_for_timeout(1500)
        check(await k.locator('.mini').count() == 3 and await k.locator('.mini.done').count() == 1, 'mini tasks are saved (still there after reload)')
        # turn one into a real task
        m = k.locator('.mini:has-text("Email the auditors")')
        await m.hover(); await m.locator('.mini-act:has-text("Task")').click(); await k.wait_for_timeout(900)
        t = await toast(k)
        check(await k.locator('.drawer').count() == 1 and await k.locator('.drawer .title-input').input_value() == 'Email the auditors the TB',
              f'"→ Task" makes it a real task and opens it ({t})')
        await k.keyboard.press('Escape'); await k.wait_for_timeout(400)
        check(await k.locator('.mini:has-text("Email the auditors")').count() == 0 and await k.locator('.plan-item:has-text("Email the auditors the TB")').count() == 1,
              'it leaves the mini list and shows under Due today')
        await k.locator('.mini:has-text("Print cheque")').hover(); await k.locator('.mini:has-text("Print cheque") .mini-act.x').click(); await k.wait_for_timeout(500)
        check(await k.locator('.mini').count() == 1, '✕ deletes a mini task')
        await k.screenshot(path=f'{OUT}/r1_today_minis.png')

        # =============== Left from earlier ===============
        sql(f"""insert into task_minis (department_id, user_id, day, body, done_at)
                select department_id, id, public.app_today() - 1, b, d from profiles,
                (values ('Chase Lanka Tiles payment', null::timestamptz), ('Update fixed asset tags', null), ('Book meeting room', null), ('Done yesterday', now())) v(b, d)
                where id = '{K}'""")
        sql(f"""insert into task_minis (department_id, user_id, day, body) select department_id, id, public.app_today() - 3, 'Old one from Friday' from profiles where id = '{K}'""")
        await k.reload(); await k.wait_for_timeout(1500)
        left = k.locator('.mini-left')
        lt = await left.inner_text() if await left.count() else ''
        check(await left.count() == 1 and await left.locator('.mini-left-item').count() == 4 and 'Done yesterday' not in lt,
              f'unfinished mini tasks from earlier days wait in "Left from earlier" ({await left.locator(".mini-left-item").count()})')
        await left.locator('.mini-left-item:has-text("Chase Lanka Tiles") button:has-text("Do today")').click(); await k.wait_for_timeout(600)
        check(await k.locator('.mini:has-text("Chase Lanka Tiles")').count() == 1 and await left.locator('.mini-left-item:has-text("Chase Lanka")').count() == 0,
              '"Do today" moves it onto today\'s list')
        await left.locator('.mini-left-item:has-text("Update fixed asset tags") button:has-text("Make task")').click(); await k.wait_for_timeout(900)
        check(await k.locator('.drawer .title-input').input_value() == 'Update fixed asset tags', '"Make task" turns it into a task (opened)')
        due = sql("select due_date = public.app_today() and assignee_id = created_by from tasks where title = 'Update fixed asset tags'")
        check(due == 't', 'the new task is his, due today')
        await k.keyboard.press('Escape'); await k.wait_for_timeout(400)
        await left.locator('.mini-left-item:has-text("Book meeting room") button:has-text("Delete")').click(); await k.wait_for_timeout(500)
        await left.locator('.mini-left-item:has-text("Old one from Friday") button:has-text("Delete")').click(); await k.wait_for_timeout(500)
        check(await k.locator('.mini-left').count() == 0, '"Delete" removes them; the box goes away when empty')
        check(sql(f"select count(*) from task_minis where user_id='{K}' and day < public.app_today() and done_at is null") == '0', 'nothing left over in the database')

        # =============== Private ===============
        n = await page_for(b, 'nadeesha@demo.lk')
        await n.goto(BASE + '/#/tasks'); await n.wait_for_timeout(900)
        await n.select_option('.filters select', label="Kasun Silva's day"); await n.wait_for_timeout(900)
        check(await n.locator('.minis').count() == 0 and 'Chase Lanka' not in await n.locator('.page').inner_text(),
              "his senior executive viewing his day doesn't see his mini tasks")
        await n.select_option('.filters select', label='My day'); await n.wait_for_timeout(900)
        check(await n.locator('.minis').count() == 1 and await n.locator('.mini').count() == 0, 'she has her own (empty) list')

        # =============== Assigned by ===============
        await k.goto(BASE + '/#/tasks/list'); await k.wait_for_timeout(900)
        row = k.locator('.task-row:has-text("Petty cash count")')
        check((await row.locator('.assigned-by .ab-text').inner_text()).strip() == 'Assigned by Hasith' and await row.locator('.assigned-by .avatar').count() == 1,
              f'the owner sees who assigned it, at the top of the card ({await row.locator(".assigned-by .ab-text").inner_text()!r})')
        check(await k.locator('.task-row:has-text("Update fixed asset tags") .assigned-by').count() == 0, 'no line on his own tasks')
        await row.click(); await k.wait_for_selector('.drawer')
        check((await k.locator('.drawer .assigned-by.big .ab-text').inner_text()).strip() == 'Assigned by Hasith Ranaweera', 'and at the top of the opened task')
        await k.keyboard.press('Escape')
        h = await page_for(b, 'hasith@demo.lk')
        await to_finance(h)
        await h.goto(BASE + '/#/tasks/list?who=all'); await h.wait_for_timeout(900)
        hrow = h.locator('.task-row:has-text("Petty cash count")')
        check('Assigned by you → Kasun' in (await hrow.locator('.assigned-by').inner_text()).replace('\n', ' '), 'whoever gave it sees "Assigned by you → Kasun"')
        check(await h.locator('.task-row:has-text("Board pack") .assigned-by').count() == 0, 'not on his own tasks')
        await n.goto(BASE + '/#/tasks/list?who=all'); await n.wait_for_timeout(900)
        nrow = n.locator('.task-row:has-text("Clear unreconciled items list")')
        check('Assigned by you → Kasun' in (await nrow.locator('.assigned-by').inner_text()).replace('\n', ' '), 'a senior giving work sees it too')
        nb = n.locator('.task-row:has-text("Petty cash count") .assigned-by')
        check(await nb.count() == 1 and 'Assigned by Hasith → Kasun' in (await nb.inner_text()).replace('\n', ' '), 'someone looking on sees giver → owner')
        await h.goto(BASE + '/#/tasks/team'); await h.wait_for_timeout(900)
        check(await h.locator('.bcard:has-text("Petty cash count") .assigned-by').count() == 1, "it's on the Who's on what cards too")
        await h.screenshot(path=f'{OUT}/r2_assigned_by.png')

        # =============== Daily repeats ===============
        await h.goto(BASE + '/#/tasks/list'); await h.wait_for_timeout(700)
        await h.click('.subnav .btn.primary'); await h.wait_for_selector('.drawer')
        opts = await h.locator('.drawer select[aria-label="Repeat"] option').all_inner_texts()
        check(opts[:3] == ["Doesn't repeat", 'Every day', 'Weekdays (Mon–Fri)'] and 'Every week' in opts and 'Every year' in opts,
              f'the Repeat menu adds Every day and Weekdays to the existing options ({opts})')
        await h.fill('.drawer .title-input', 'Daily bank balance summary')
        await h.select_option('.drawer .field:has(span:text-is("Owner")) select', label='Kasun Silva')
        await h.select_option('.drawer select[aria-label="Repeat"]', label='Every day')
        check(await h.locator('.drawer .field:has(span:text-is("Early reminder"))').count() == 0, 'no early reminder for daily work')
        note = await h.locator('.drawer .field-note').first.inner_text()
        check('every day morning' in note and 'missed day stays overdue' in note, f'the note explains how daily work appears ({note[:60]}…)')
        await h.click('.drawer button:has-text("Create task")')
        await h.wait_for_timeout(900)
        did = sql("select id from tasks where title = 'Daily bank balance summary'")
        check(did and sql(f"select repeat from tasks where id={did}") == 'daily', 'a daily task is saved')
        # pretend it was given yesterday and nobody did it
        housekeeping(f"update tasks set due_date = public.app_today() - 1, original_due = public.app_today() - 1, repeat_anchor = public.app_today() - 1, acknowledged_at = now(), created_at = now() - interval '1 day' where id = {did}")
        await k.goto(BASE + '/#/tasks'); await k.reload(); await k.wait_for_timeout(1800)
        due_grp = k.locator('.plan-group:has(h3:has-text("Due today"))')
        dt = await due_grp.inner_text()
        check('Daily bank balance summary' in dt and 'Daily' in dt, "next morning, today's copy is in Due today (⟳ Daily)")
        await k.click('.late-toggle'); await k.wait_for_timeout(200)
        check(await k.locator('.late-fold .plan-item:has-text("Daily bank balance summary")').count() == 1, "yesterday's missed one stays overdue")
        check(sql(f"select count(*) from tasks where series_id = {did}") == '2', 'two in the series: yesterday and today')
        await k.goto(BASE + '/#/tasks/list'); await k.wait_for_timeout(900)
        r = k.locator('.task-row:has-text("Daily bank balance summary")').first
        check('Daily' in await r.inner_text() and 'Assigned by Hasith' in await r.inner_text(), 'the list shows it repeats daily, given by Hasith')
        await k.screenshot(path=f'{OUT}/r3_daily.png')
        # his own weekday task
        await k.click('.subnav .btn.primary'); await k.wait_for_selector('.drawer')
        await k.fill('.drawer .title-input', 'Cash book update')
        await k.select_option('.drawer select[aria-label="Repeat"]', label='Weekdays (Mon–Fri)')
        check('weekday (Monday to Friday)' in await k.locator('.drawer .field-note').first.inner_text(), 'Weekdays explains Monday to Friday')
        await k.press('.drawer .title-input', 'Enter'); await k.wait_for_timeout(900)
        check(sql("select repeat from tasks where title = 'Cash book update'") == 'weekdays', 'a weekday task is saved')

        # =============== Phone size ===============
        mk = await page_for(b, 'kasun@demo.lk', 390, 844)
        await mk.wait_for_timeout(600)
        mb = await mk.locator('.minis').bounding_box()
        sw = await mk.evaluate('document.documentElement.scrollWidth')
        check(mb and mb['y'] < 400 and sw <= 392, f'on a phone the mini tasks are near the top and nothing spills sideways ({sw}px)')
        await mk.screenshot(path=f'{OUT}/r4_phone_today.png', full_page=True)

        check(not errors, f'no browser errors ({errors[:3]})')
        await b.close()
    print(f'\n{sum(results)} passed, {len(results) - sum(results)} failed')

asyncio.run(main())
