import os
_HERE = os.path.dirname(os.path.abspath(__file__))
os.makedirs(os.path.join(_HERE, 'shots'), exist_ok=True)
import asyncio, datetime
from playwright.async_api import async_playwright
BASE = os.environ.get('APP_URL', 'http://localhost:4173')
OUT = os.path.join(_HERE, 'shots')
results, errors = [], []
def check(c, m): results.append(('PASS' if c else 'FAIL', m))
def day(n): return (datetime.date.today() + datetime.timedelta(days=n)).isoformat()

async def page_for(b, email):
    ctx = await b.new_context(viewport={'width': 1360, 'height': 860}, timezone_id='Asia/Colombo')
    pg = await ctx.new_page()
    pg.on('pageerror', lambda e: errors.append(f'{email}: {e}'))
    pg.on('console', lambda m: errors.append(f'{email}: {m.text}') if m.type == 'error' else None)
    await pg.goto(BASE); await pg.fill('input[type=email]', email); await pg.fill('input[type=password]', 'password1')
    await pg.click('button:has-text("Sign in")'); await pg.wait_for_timeout(1500)
    await pg.goto(BASE + '/#/tasks/list'); await pg.wait_for_timeout(600)
    return pg

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        k = await page_for(b, 'kasun@demo.lk')
        await k.fill('.qa-title', 'Call the bank about statement'); await k.press('.qa-title', 'Enter'); await k.wait_for_timeout(700)
        check(await k.locator('.task-row:has-text("Call the bank about statement")').count() == 1, 'member quick-adds own task')
        await k.click('.task-row:has-text("Fixed asset register update")'); await k.wait_for_selector('.drawer')
        await k.fill('.drawer input[type=date]', day(10)); await k.click('button:has-text("Save changes")'); await k.wait_for_timeout(700)
        await k.click('.subtabs button:has-text("History")'); await k.wait_for_timeout(300)
        check('moved deadline' in await k.locator('.history').inner_text(), 'deadline move shows in history')
        await k.keyboard.press('Escape')
        await k.locator('.task-row:has-text("Petty cash count") .check').click(); await k.wait_for_timeout(700)
        await k.click('.seg-btn:has-text("Done")'); await k.wait_for_timeout(300)
        check(await k.locator('.task-row:has-text("Petty cash count")').count() == 1, 'ticked task appears under Done')
        await k.goto(BASE + '/#/tasks/calendar'); await k.wait_for_timeout(700)
        whos = set(await k.locator('.chip').evaluate_all('els => els.map(e => e.title.split(" — ").pop().replace(" (overdue)",""))'))
        check(whos == {'Kasun Silva'}, f'member calendar shows only own work: {whos}')

        h = await page_for(b, 'hasith@demo.lk')
        if 'Finance' not in await h.locator('.dept-switch .switcher').inner_text():
            await h.click('.dept-switch .switcher'); await h.click('.drop-item:has-text("Finance")'); await h.wait_for_timeout(1000)
        await h.click('.bell .icon-btn'); await h.wait_for_timeout(300)
        bell = await h.locator('.bell-pop').inner_text()
        check('Kasun Silva moved the deadline for "Fixed asset register update"' in bell, 'manager told about deadline move')
        check('completed "Petty cash count & top-up"' in bell, 'manager told about completion')
        await h.keyboard.press('Escape'); await h.mouse.click(10, 500)

        await h.goto(BASE + f'/#/tasks/calendar?view=week&d={day(1)}'); await h.wait_for_timeout(900)
        persons = await h.locator('.week-person .strong').all_inner_texts()
        cells = h.locator('.wcell')
        days = await h.locator('.week-dow').all_inner_texts()
        col = lambda iso: [i for i, t in enumerate(days) if t.split()[-1] == str(int(iso[-2:]))][0]
        ki, ai = persons.index('Kasun Silva'), persons.index('Amaya Fernando')
        src_day = day(1); tgt_day = day(2) if col(day(2)) > col(day(1)) else day(0)
        await h.locator('.chip:has-text("Clear unreconciled items list")').drag_to(cells.nth(ki * 7 + col(tgt_day))); await h.wait_for_timeout(900)
        check('Clear unreconciled items list' in await cells.nth(ki * 7 + col(tgt_day)).inner_text(), 'drag moves the deadline')
        await h.locator('.chip:has-text("Clear unreconciled items list")').drag_to(cells.nth(ai * 7 + col(tgt_day))); await h.wait_for_timeout(900)
        check('Clear unreconciled items list' in await cells.nth(ai * 7 + col(tgt_day)).inner_text(), 'drag into another row hands the task over')
        await h.screenshot(path=f'{OUT}/c1_week.png')

        await h.goto(BASE + '/#/tasks/calendar'); await h.wait_for_timeout(700)
        await h.locator('.mcell').nth(20).click(); await h.wait_for_selector('.drawer')
        await h.fill('.title-input', 'Quarter-end stock count')
        await h.locator('.drawer select').first.select_option(label='Amaya Fernando')
        await h.click('button:has-text("Create task")'); await h.wait_for_timeout(700)
        check(await h.locator('.chip:has-text("Quarter-end stock count")').count() == 1, 'task created from a calendar day')
        await h.screenshot(path=f'{OUT}/c2_month.png')

        n = await page_for(b, 'nadeesha@demo.lk')
        opts = await n.locator('select[aria-label="Whose tasks"] option').all_inner_texts()
        check('Hasith Ranaweera' not in opts and 'Kasun Silva' in opts and 'Priya Wickramasinghe' not in opts, f'senior filter: {opts}')
        await n.goto(BASE + '/#/tasks/list?who=all'); await n.wait_for_timeout(700)
        t = await n.locator('main').inner_text()
        check('Board pack' not in t and 'payroll' not in t.lower(), "senior can't see manager's own tasks or other departments")
        await b.close()
    for r in results: print(r[0], r[1])
    print('ERRORS:', errors or 'none')
    print(sum(r[0] == 'PASS' for r in results), 'passed,', sum(r[0] == 'FAIL' for r in results), 'failed')
asyncio.run(main())
