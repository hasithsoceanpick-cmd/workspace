import os
_HERE = os.path.dirname(os.path.abspath(__file__))
os.makedirs(os.path.join(_HERE, 'shots'), exist_ok=True)
import asyncio
from playwright.async_api import async_playwright
BASE = os.environ.get('APP_URL', 'http://localhost:4173')
res = []
def check(c, m): res.append(c); print(('PASS ' if c else 'FAIL ') + m, flush=True)
async def login(b, email):
    ctx = await b.new_context(viewport={'width': 1360, 'height': 860}); pg = await ctx.new_page()
    await pg.goto(BASE); await pg.fill('input[type=email]', email); await pg.fill('input[type=password]', 'password1')
    await pg.click('button:has-text("Sign in")'); await pg.wait_for_timeout(1500); return pg
async def apps(pg):
    await pg.click('.app-switch .switcher'); await pg.wait_for_timeout(200)
    items = await pg.locator('.drop-item .drop-label').all_inner_texts(); await pg.keyboard.press('Escape'); return items
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        h = await login(b, 'hasith@demo.lk')
        await h.goto(BASE + '/#/admin/departments'); await h.wait_for_timeout(1000)
        hr = h.locator('.dept-card:has(.dept-name:has-text("HR"))')
        if not await hr.count(): hr = h.locator('.dept-card').filter(has_text='HR')
        await hr.locator('.dept-app:has-text("Notes") input[type=checkbox]').click(); await h.wait_for_timeout(900)
        await hr.locator('select[aria-label="Who can use Notes"]').select_option('some'); await h.wait_for_timeout(900)
        await hr.locator('.dept-app:has-text("Notes") .pchip:has-text("Dilan")').click(); await h.wait_for_timeout(900)
        d = await login(b, 'dilan@demo.lk'); s = await login(b, 'sachini@demo.lk')
        check('Notes' in await apps(d), 'admin gives Notes to one HR person')
        check('Notes' not in await apps(s), 'others in HR still without Notes')
        await d.goto(BASE + '/#/notes'); await d.wait_for_timeout(1500)
        check(await d.locator('.tree-item').count() == 0, 'HR person sees no Finance pages')
        await d.click('.notes-side-head button:has-text("New page")'); await d.wait_for_timeout(1200)
        await d.fill('.note-title', 'HR handbook'); await d.wait_for_timeout(1500)
        await d.click('.share-btn'); await d.click('.share-opt:has-text("Selected people")'); await d.wait_for_timeout(500)
        opts = await d.locator('.share-people select[aria-label="Add a person"] option').all_inner_texts()
        check(opts == ['+ Add a person…'] or 'Sachini Rajapaksa' not in opts, f'can only share with people who have Notes ({opts})')
        await b.close()
    print(f'{sum(res)} passed, {len(res) - sum(res)} failed')
asyncio.run(main())
