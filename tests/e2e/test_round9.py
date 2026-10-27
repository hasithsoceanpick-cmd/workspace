import os
_HERE = os.path.dirname(os.path.abspath(__file__))
os.makedirs(os.path.join(_HERE, 'shots'), exist_ok=True)
# Browser tests for round 9: people outside the app (no login) — adding them, giving them tasks, the Follow-ups page
# (open / overdue / last note / finished record), removing them, who sees them, the Excel column, phone layout.
import asyncio, subprocess
import openpyxl
from playwright.async_api import async_playwright

BASE = os.environ.get('APP_URL', 'http://localhost:4173')
DB = os.environ.get('DATABASE_URL', 'postgres://postgres@127.0.0.1:54322/postgres')
OUT = os.path.join(_HERE, 'shots')
results, errors = [], []
def check(c, m): c = bool(c); results.append(c); print(('PASS ' if c else 'FAIL ') + m, flush=True)
def sql(q): return subprocess.run(['psql', DB, '-At', '-c', q], capture_output=True, text=True).stdout.strip()

async def page_for(b, email, w=1360, h=860):
    ctx = await b.new_context(viewport={'width': w, 'height': h}, timezone_id='Asia/Colombo', accept_downloads=True)
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

def card(pg, name): return pg.locator(f'.fu-card:has(.fu-name:has-text("{name}"))')

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        h = await page_for(b, 'hasith@demo.lk')
        await to_finance(h)

        # =============== from the admin console ===============
        await h.goto(BASE + '/#/admin/people'); await h.wait_for_timeout(900)
        hint = h.locator('.outside-hint')
        check(await hint.count() == 1 and 'Tasks → Follow-ups' in await hint.inner_text(), 'Admin → People points to Follow-ups for people without a login')
        await hint.locator('button:has-text("Open Follow-ups")').click(); await h.wait_for_timeout(1200)
        check('#/tasks/followups' in h.url and await h.locator('h1').inner_text() == 'Follow-ups', 'and opens it')
        check('Nobody yet' in await h.locator('.followups').inner_text(), 'empty to start with')

        # =============== add someone ===============
        await h.click('button:has-text("+ Add person")')
        await h.fill('.fu-add input[placeholder="e.g. Sampath Perera"]', 'Sampath Perera')
        await h.fill('.fu-add input[placeholder^="e.g. DFCC Bank"]', 'DFCC Bank')
        await h.fill('.fu-add input[inputmode="tel"]', '077 123 4567')
        await h.click('.fu-add button:has-text("Add person")'); await h.wait_for_timeout(800)
        sc = card(h, 'Sampath Perera')
        st = await sc.inner_text() if await sc.count() else ''
        check(await sc.count() == 1 and 'DFCC Bank' in st and '0 open' in st and 'Nothing given to them yet' in st, 'Sampath is added (no login)')
        check(await sc.locator('a[href="tel:0771234567"]').count() == 1, 'his phone number is a tap-to-call link')
        check(sql("select count(*) from profiles where full_name like 'Sampath%'") == '0', 'no login or app user is created for him')

        # =============== give him a task ===============
        await sc.locator('button:has-text("+ Task for Sampath")').click(); await h.wait_for_selector('.drawer')
        sel = h.locator('.drawer select[aria-label="Given to (outside the app)"]')
        check(await sel.evaluate('e => e.options[e.selectedIndex].text') == 'Sampath Perera · DFCC Bank', 'the new task already says it is given to Sampath')
        check('You follow up with Sampath Perera' in await h.locator('.drawer .field-note').first.inner_text(), 'and that Hasith follows up')
        await h.fill('.drawer .title-input', 'DFCC new bank accounts on iConnect')
        await h.fill('.drawer input[type=date]', sql("select (public.app_today() - 2)::text"))
        await h.click('.drawer button:has-text("Create task")'); await h.wait_for_timeout(1000)
        st = await sc.inner_text()
        check('1 open' in st and '1 overdue' in st and 'DFCC new bank accounts on iConnect' in st, 'his card shows the open, overdue task')
        row = sc.locator('.task-row:has-text("DFCC new bank accounts")')
        check('Given to Sampath Perera · DFCC Bank — you follow up' in (await row.locator('.outside-with').inner_text()).replace('\n', ''), 'the task card says who it was given to')

        # =============== someone new, straight from a task ===============
        await h.goto(BASE + '/#/tasks/list'); await h.wait_for_timeout(700)
        await h.click('.subnav .btn.primary'); await h.wait_for_selector('.drawer')
        await h.fill('.drawer .title-input', 'Get Lanka Tiles statement')
        await h.select_option('.drawer .field:has(span:text-is("Owner")) select', label='Kasun Silva')
        await h.select_option('.drawer select[aria-label="Given to (outside the app)"]', value='new')
        await h.fill('.drawer .contact-form input[placeholder="e.g. Sampath Perera"]', 'Ruwan Silva')
        await h.fill('.drawer .contact-form input[placeholder^="e.g. DFCC Bank"]', 'Lanka Tiles')
        await h.click('.drawer .contact-form button:has-text("Add person")'); await h.wait_for_timeout(700)
        sel = h.locator('.drawer select[aria-label="Given to (outside the app)"]')
        check(await sel.evaluate('e => e.options[e.selectedIndex].text') == 'Ruwan Silva · Lanka Tiles', '"+ Add someone new…" adds Ruwan right inside the task')
        check('Kasun follows up with Ruwan Silva' in await h.locator('.drawer .field-note').first.inner_text(), 'Kasun will follow up')
        await h.click('.drawer button:has-text("Create task")'); await h.wait_for_timeout(1000)
        check(sql("select p.full_name || '|' || c.name from tasks t join profiles p on p.id=t.assignee_id join task_contacts c on c.id=t.contact_id where t.title='Get Lanka Tiles statement'") == 'Kasun Silva|Ruwan Silva',
              'saved: owner Kasun, given to Ruwan')

        # =============== the record ===============
        await h.goto(BASE + '/#/tasks/followups'); await h.wait_for_timeout(900)
        await card(h, 'Sampath Perera').locator('.task-row').click(); await h.wait_for_selector('.drawer')
        check('Given to Sampath Perera' in await h.locator('.drawer .outside-with.big').inner_text(), 'the opened task says it at the top')
        await h.fill('.reply textarea', 'Called Sampath — accounts will be live by Friday'); await h.click('.reply button:has-text("Send")'); await h.wait_for_timeout(700)
        await h.keyboard.press('Escape'); await h.wait_for_timeout(500)
        await h.reload(); await h.wait_for_timeout(1500)
        last = card(h, 'Sampath Perera').locator('.fu-last')
        check(await last.count() == 1 and 'accounts will be live by Friday' in await last.inner_text(), 'the card shows the last follow-up note')
        rc = card(h, 'Ruwan Silva')
        check('Nothing given to them yet' in await rc.inner_text() or '0 open' in await rc.inner_text(), '"I follow up" leaves out Kasun\'s task')
        await h.select_option('select[aria-label="Whose follow-ups"]', label="Everyone's"); await h.wait_for_timeout(600)
        check('Get Lanka Tiles statement' in await card(h, 'Ruwan Silva').inner_text(), "\"Everyone's\" shows what Kasun is chasing")
        await h.screenshot(path=f'{OUT}/f1_followups.png', full_page=True)
        # finish it: it moves to the finished record
        await card(h, 'Sampath Perera').locator('.task-row .check').click(); await h.wait_for_timeout(900)
        sc = card(h, 'Sampath Perera')
        check('Nothing open' in await sc.inner_text(), 'finished: nothing open for Sampath')
        await sc.locator('button:has-text("Show 1 finished")').click(); await h.wait_for_timeout(300)
        check('DFCC new bank accounts on iConnect' in await sc.locator('.fu-done').inner_text(), 'the finished task stays on his record')

        # =============== edit / remove ===============
        await sc.locator('button:has-text("Edit")').click()
        ed = h.locator('.fu-card:has(.contact-form)')
        await ed.locator('input[inputmode="tel"]').fill('011 234 5678'); await ed.locator('button:has-text("Save")').click(); await h.wait_for_timeout(600)
        check(await card(h, 'Sampath Perera').locator('a[href="tel:0112345678"]').count() == 1, 'details can be changed')
        await card(h, 'Ruwan Silva').locator('button:has-text("Remove")').click(); await h.wait_for_timeout(700)
        t = await toast(h)
        rc = card(h, 'Ruwan Silva')
        check('taken off the list' in t and await rc.count() == 1 and 'removed from list' in await rc.inner_text(),
              f'removing someone with open work keeps them on the page, marked removed ({t})')
        await h.click('.subnav .btn.primary'); await h.wait_for_selector('.drawer')
        opts = await h.locator('.drawer select[aria-label="Given to (outside the app)"] option').all_inner_texts()
        check(not any('Ruwan' in o for o in opts) and any('Sampath' in o for o in opts), 'and new tasks can\'t pick them any more')
        await h.keyboard.press('Escape')

        # =============== Excel ===============
        await h.goto(BASE + '/#/tasks/list?who=all'); await h.wait_for_timeout(900)
        async with h.expect_download() as dl:
            await h.click('button:has-text("Export to Excel")')
        path = os.path.join(OUT, 'f_tasks.xlsx'); await (await dl.value).save_as(path)
        ws = openpyxl.load_workbook(path)['Tasks']
        heads = [c.value for c in ws[1]]
        col = heads.index('Given to (outside the app)') if 'Given to (outside the app)' in heads else -1
        vals = {r[1]: r[col] for r in ws.iter_rows(min_row=2, values_only=True)} if col >= 0 else {}
        check(col == 3 and vals.get('Get Lanka Tiles statement') == 'Ruwan Silva (Lanka Tiles)', 'the Excel export has a "Given to (outside the app)" column')

        # =============== who sees them ===============
        k = await page_for(b, 'kasun@demo.lk')
        await k.goto(BASE + '/#/tasks/followups'); await k.wait_for_timeout(1200)
        kc = card(k, 'Ruwan Silva')
        check(await kc.count() == 1 and 'Get Lanka Tiles statement' in await kc.inner_text(), 'Kasun sees Ruwan and the task he chases')
        check('you follow up' in await kc.locator('.outside-with').first.inner_text(), '"you follow up" from his side')
        check(await card(k, 'Sampath Perera').count() == 1, "and Finance's whole list")
        p_ = await page_for(b, 'priya@demo.lk')
        await p_.goto(BASE + '/#/tasks/followups'); await p_.wait_for_timeout(1000)
        check(await p_.locator('.fu-card').count() == 0, "HR doesn't see Finance's people")

        # =============== phone ===============
        m = await page_for(b, 'hasith@demo.lk', 390, 844)
        await to_finance(m)
        await m.goto(BASE + '/#/tasks/followups?show=all'); await m.wait_for_timeout(1200)
        sw = await m.evaluate('document.documentElement.scrollWidth')
        check(await m.locator('.fu-card').count() >= 1 and sw <= 392, f'Follow-ups fits a phone ({sw}px)')
        await m.screenshot(path=f'{OUT}/f2_followups_phone.png', full_page=True)

        check(not errors, f'no browser errors ({errors[:3]})')
        await b.close()
    print(f'\n{sum(results)} passed, {len(results) - sum(results)} failed')

asyncio.run(main())
