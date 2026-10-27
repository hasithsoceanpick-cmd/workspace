import os
_HERE = os.path.dirname(os.path.abspath(__file__))
os.makedirs(os.path.join(_HERE, 'shots'), exist_ok=True)
# Browser tests for round 10: "+ New" with Task · Mini task · Project, mini tasks given to a team member,
# projects (stages with their own people, status flag, Projects tab, project page with timeline), missed stages.
import asyncio, subprocess
from playwright.async_api import async_playwright

BASE = os.environ.get('APP_URL', 'http://localhost:4173')
DB = os.environ.get('DATABASE_URL', 'postgres://postgres@127.0.0.1:54322/postgres')
OUT = os.path.join(_HERE, 'shots')
results, errors = [], []
def check(c, m): c = bool(c); results.append(c); print(('PASS ' if c else 'FAIL ') + m, flush=True)
def sql(q): return subprocess.run(['psql', DB, '-At', '-c', q], capture_output=True, text=True).stdout.strip()

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

async def bell(pg):
    await pg.click('.bell .icon-btn'); await pg.wait_for_timeout(400)
    t = await pg.locator('.bell-pop').inner_text()
    await pg.keyboard.press('Escape'); await pg.mouse.click(5, 700)
    return t

def day(n): return sql(f"select (public.app_today() + {n})::text")

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        h = await page_for(b, 'hasith@demo.lk')
        await to_finance(h)
        await h.goto(BASE + '/#/tasks'); await h.wait_for_timeout(900)

        # =============== + New: three kinds ===============
        await h.click('.subnav .btn.primary'); await h.wait_for_selector('.drawer')
        kinds = await h.locator('.drawer .nature-switch .seg-btn').all_inner_texts()
        check(kinds == ['Task', 'Mini task', 'Project'], f'+ New offers Task · Mini task · Project ({kinds})')

        # =============== mini task for Kasun ===============
        await h.click('.drawer .nature-switch .seg-btn:has-text("Mini task")')
        await h.fill('.drawer input[aria-label="Mini task"]', 'Call Sampath re limits')
        await h.select_option('.drawer select[aria-label="Mini task for"]', label='Kasun Silva')
        check('Kasun gets one alert' in await h.locator('.drawer .field-note').inner_text(), 'it says Kasun will be told')
        await h.click('.drawer button:has-text("Give mini task")'); await h.wait_for_timeout(900)
        t = await toast(h)
        check("Given to Kasun" in t and sql("select p.full_name from task_minis m join profiles p on p.id = m.created_by where body = 'Call Sampath re limits'") == 'Hasith Ranaweera',
              f'a mini task given to Kasun ({t})')
        await h.goto(BASE + '/#/tasks'); await h.wait_for_timeout(1200)
        gv = h.locator('.mini-given')
        check(await gv.count() == 1 and 'Call Sampath re limits' in await gv.inner_text() and 'Kasun' in await gv.inner_text(),
              'Hasith sees it on his Today under "Given to others"')
        k = await page_for(b, 'kasun@demo.lk')
        km = k.locator('.mini:has-text("Call Sampath re limits")')
        check(await km.count() == 1 and 'from Hasith' in await km.inner_text(), 'it is on Kasun\'s Today, marked "from Hasith"')
        check('Hasith Ranaweera gave you a mini task: Call Sampath re limits' in await bell(k), 'Kasun got one alert')
        await km.locator('.check').click(); await k.wait_for_timeout(600)
        await h.reload(); await h.wait_for_timeout(1500)
        await h.click('.tab:has-text("Today")'); await h.wait_for_timeout(1000)   # managers open on Home
        g = h.locator('.mini-given .mini:has-text("Call Sampath re limits")')
        check('done' in (await g.get_attribute('class')) and await g.locator('.mini-act.x').count() == 0, 'Hasith sees it ticked (and can no longer take it back)')
        # change and take back an unticked one
        await h.click('.subnav .btn.primary'); await h.wait_for_selector('.drawer')
        await h.click('.drawer .nature-switch .seg-btn:has-text("Mini task")')
        await h.fill('.drawer input[aria-label="Mini task"]', 'Scan GRNs')
        await h.select_option('.drawer select[aria-label="Mini task for"]', label='Amaya Fernando')
        await h.click('.drawer button:has-text("Give mini task")'); await h.wait_for_timeout(900)
        await h.locator('.mini-given .mini-text:has-text("Scan GRNs")').click()
        await h.fill('.mini-given .mini-edit', 'Scan and file GRNs'); await h.press('.mini-given .mini-edit', 'Enter'); await h.wait_for_timeout(500)
        check(sql("select count(*) from task_minis where body = 'Scan and file GRNs'") == '1', 'the giver can change the words before it is ticked')
        await h.locator('.mini-given .mini:has-text("Scan and file GRNs") .mini-act.x').click(); await h.wait_for_timeout(500)
        check(sql("select count(*) from task_minis where body like 'Scan%'") == '0', 'and take it back')

        # =============== a project ===============
        await h.click('.subnav .btn.primary'); await h.wait_for_selector('.drawer')
        await h.click('.drawer .nature-switch .seg-btn:has-text("Project")')
        check(await h.locator('.drawer select[aria-label="Repeat"]').count() == 0 and 'End date' in await h.locator('.drawer').inner_text(),
              'a project has an end date and no repeat')
        await h.fill('.drawer .title-input', 'DFCC account restructure')
        await h.select_option('.drawer .field:has(span:text-is("Owner")) select', label='Kasun Silva')
        await h.fill('.drawer .field:has(span:has-text("End date")) input[type=date]', day(20))
        for name, n, who in [('Collect board resolutions', 5, 'Amaya Fernando'), ('Bank sign-off', 10, 'Nadeesha Perera'), ('Update iConnect', 15, '')]:
            await h.fill('.drawer input[aria-label="New stage"]', name)
            await h.fill('.drawer input[aria-label="New stage date"]', day(n))
            if who: await h.select_option('.drawer select[aria-label="New stage person"]', label=who)
            await h.click('.drawer button:has-text("Add stage")'); await h.wait_for_timeout(200)
        check(await h.locator('.drawer .stage').count() == 3, 'three stages queued, each with a date and person')
        await h.click('.drawer button:has-text("Create task")'); await h.wait_for_timeout(1200)
        t = await toast(h)
        pid = sql("select id from tasks where title = 'DFCC account restructure' and nature = 'project'")
        st = sql(f"select string_agg(c.body || ':' || coalesce(p.full_name, 'owner'), ', ' order by c.due_date) from task_checklist c left join profiles p on p.id = c.assignee_id where c.task_id = {pid or 0}")
        check(pid and st == 'Collect board resolutions:Amaya Fernando, Bank sign-off:Nadeesha Perera, Update iConnect:owner', f'the project is saved with its stages ({t})')

        # =============== Projects tab ===============
        await h.click('.tab:has-text("Projects")'); await h.wait_for_timeout(900)
        card = h.locator('.pj-card:has-text("DFCC account restructure")')
        ct = await card.inner_text()
        check('0/3 stages' in ct and 'No status yet' in ct and 'Next: Collect board resolutions' in ct, 'the Projects tab shows progress, status and the next stage')

        # =============== a stage person ===============
        a = await page_for(b, 'amaya@demo.lk')
        check('gave you a stage in "DFCC account restructure": Collect board resolutions' in await bell(a), 'Amaya is told about her stage')
        await a.goto(BASE + '/#/tasks/list'); await a.wait_for_timeout(1000)
        sg = a.locator('.stages-group')
        check(await sg.count() == 1 and 'Collect board resolutions' in await sg.inner_text() and 'DFCC account restructure' in await sg.inner_text(),
              'her Tasks list has "Your project stages"')
        await sg.locator('.stage-row .check').first.click(); await a.wait_for_timeout(800)
        check(sql(f"select done from task_checklist where task_id = {pid} and body = 'Collect board resolutions'") == 't', 'she ticks it there')
        await a.goto(BASE + f'/#/tasks/project?id={pid}'); await a.wait_for_timeout(1200)
        boxes = a.locator('.stages .stage input[type=checkbox]')
        en = [await boxes.nth(i).is_enabled() for i in range(await boxes.count())]
        check(en == [True, False, False] and await a.locator('.stage-add').count() == 0, 'on the project page she can only tick her own stage, and add none')

        # =============== the owner sets the status ===============
        await k.goto(BASE + f'/#/tasks/project?id={pid}'); await k.wait_for_timeout(1200)
        check('33%' in await k.locator('.pj-big').inner_text(), 'the project page shows progress (1 of 3)')
        check(await k.locator('.tl2-row').count() == 3 and await k.locator('.tl2-dot.done').count() >= 1, 'and a timeline of the stages')
        await k.click('.project-status .seg-btn:has-text("At risk")')
        await k.fill('.project-status input[aria-label="Status note"]', 'Bank wants a fresh board resolution')
        await k.click('.project-status button:has-text("Update status")'); await k.wait_for_timeout(900)
        check('At risk' in await k.locator('.pj-history').inner_text() and 'fresh board resolution' in await k.locator('.pj-history').inner_text(),
              'Kasun sets At risk with a note; it is in the status history')
        await k.screenshot(path=f'{OUT}/p1_project_page.png', full_page=True)
        await h.reload(); await h.wait_for_timeout(1800)
        hb = await bell(h)
        check('marked "DFCC account restructure" At risk: Bank wants a fresh board resolution' in hb, 'Hasith is alerted')
        await h.goto(BASE + '/#/tasks/projects'); await h.wait_for_timeout(900)
        check('At risk' in await h.locator('.pj-card:has-text("DFCC account restructure")').inner_text(), 'the Projects tab shows At risk')
        await h.screenshot(path=f'{OUT}/p2_projects.png')
        await h.goto(BASE + '/#/tasks/list?who=all'); await h.wait_for_timeout(900)
        row = h.locator('.task-row:has-text("DFCC account restructure")')
        rt = await row.inner_text()
        check('Project' in rt and 'At risk' in rt and '1/3' in rt, 'it shows in the normal list with a Project badge, the flag and progress')
        await row.click(); await h.wait_for_selector('.drawer')
        dt = await h.locator('.drawer').inner_text()
        check('Project #' in dt and 'Open the project page' in dt and await h.locator('.drawer .stages').count() == 1, 'its panel says Project, with the stages and a link to the page')
        await h.click('.drawer button:has-text("Open the project page")'); await h.wait_for_timeout(900)
        check(f'#/tasks/project?id={pid}' in h.url and await h.locator('.tab.active').inner_text() == 'Projects', 'the link opens the project page')
        await h.locator('.stages .stage:has-text("Update iConnect") select').select_option(label='Amaya Fernando'); await h.wait_for_timeout(800)
        check(sql(f"select p.full_name from task_checklist c join profiles p on p.id = c.assignee_id where c.task_id = {pid} and c.body = 'Update iConnect'") == 'Amaya Fernando',
              'the giver can hand a stage to someone else')

        # =============== a missed stage ===============
        sql(f"update task_checklist set due_date = public.app_today() - 1, overdue_notified_on = null where task_id = {pid} and body = 'Bank sign-off'")
        n = await page_for(b, 'nadeesha@demo.lk')
        await n.goto(BASE + '/#/tasks'); await n.wait_for_timeout(1200)
        check('Missed stage: "Bank sign-off" in "DFCC account restructure"' in await bell(n), 'a missed stage alerts the person doing it')
        await n.goto(BASE + '/#/tasks'); await n.wait_for_timeout(1000)
        tg = n.locator('.plan-group:has(h3:has-text("Project stages"))')
        check(await tg.count() == 1 and 'Bank sign-off' in await tg.inner_text() and '1d late' in await tg.inner_text(), 'and it waits on her Today')

        # =============== phone ===============
        m = await page_for(b, 'kasun@demo.lk', 390, 844)
        await m.goto(BASE + f'/#/tasks/project?id={pid}'); await m.wait_for_timeout(1200)
        sw = await m.evaluate('document.documentElement.scrollWidth')
        check(sw <= 392, f'the project page fits a phone ({sw}px)')
        await m.screenshot(path=f'{OUT}/p3_project_phone.png', full_page=True)

        check(not errors, f'no browser errors ({errors[:3]})')
        await b.close()
    print(f'\n{sum(results)} passed, {len(results) - sum(results)} failed')

asyncio.run(main())
