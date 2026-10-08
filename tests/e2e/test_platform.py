import os
_HERE = os.path.dirname(os.path.abspath(__file__))
os.makedirs(os.path.join(_HERE, 'shots'), exist_ok=True)
import asyncio
from playwright.async_api import async_playwright
BASE = os.environ.get('APP_URL', 'http://localhost:4173')
OUT = os.path.join(_HERE, 'shots')
results, errors = [], []
def check(c, m): results.append(('PASS' if c else 'FAIL', m))

async def page_for(b, email, w=1360, h=860, mobile=False):
    ctx = await b.new_context(viewport={'width': w, 'height': h}, timezone_id='Asia/Colombo', is_mobile=mobile, has_touch=mobile)
    pg = await ctx.new_page()
    pg.on('pageerror', lambda e: errors.append(f'{email}: {e}'))
    pg.on('console', lambda m: errors.append(f'{email}: {m.text}') if m.type == 'error' else None)
    await pg.goto(BASE)
    await pg.fill('input[type=email]', email)
    await pg.fill('input[type=password]', 'password1')
    await pg.click('button:has-text("Sign in")')
    await pg.wait_for_timeout(1500)
    if '#/tasks' in pg.url:   # Tasks now opens on Today; these checks are about the list
        await pg.goto(BASE + '/#/tasks/list'); await pg.wait_for_timeout(600)
    return pg

async def titles(pg):
    return await pg.locator('.task-row .tr-title').all_inner_texts()

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()

        # ---------- admin ----------
        h = await page_for(b, 'hasith@demo.lk')
        await h.click('.app-switch .switcher'); await h.wait_for_timeout(200)
        items = await h.locator('.drop-item .drop-label').all_inner_texts()
        check(items == ['Tasks', 'Notes', 'Admin console'], f'admin app dropdown: {items}')
        await h.keyboard.press('Escape')
        check(await h.locator('.dept-switch').count() == 1, 'admin has a department switcher')
        await h.goto(BASE + '/#/tasks/list?who=all'); await h.wait_for_timeout(700)
        fin = await titles(h)
        check('Bank reconciliation — Commercial Bank' in fin and not any('payroll' in t.lower() for t in fin), 'Finance view shows only Finance tasks')
        await h.click('.dept-switch .switcher'); await h.click('.drop-item:has-text("HR")'); await h.wait_for_timeout(1000)
        hr = await titles(h)
        check('Collect October payroll inputs' in hr and 'Bank reconciliation — Commercial Bank' not in hr, 'HR view shows only HR tasks')
        opts = await h.locator('select[aria-label="Whose tasks"] option').all_inner_texts()
        check('My tasks' not in opts and 'Kasun Silva' not in opts and 'Dilan Gunasekara' in opts, f'HR person filter has HR people only: {opts}')
        # admin assigns in HR
        await h.fill('.qa-title', 'Exit interview summary')
        await h.locator('.quick-add select').select_option(label='Sachini Rajapaksa')
        await h.press('.qa-title', 'Enter'); await h.wait_for_timeout(800)
        check(await h.locator('.task-row:has-text("Exit interview summary")').count() == 1, 'admin can assign work inside HR')
        # department choice is remembered
        await h.reload(); await h.wait_for_timeout(1500)
        check('HR' in await h.locator('.dept-switch .switcher').inner_text(), 'admin\'s chosen department is remembered')
        # Day review: HR has no Daily notes
        await h.goto(BASE + '/#/tasks/day'); await h.wait_for_timeout(900)
        check(await h.locator('.feature-card:has-text("Daily notes")').count() == 0, 'HR day review has no Daily notes (feature off)')
        await h.click('.dept-switch .switcher'); await h.click('.drop-item:has-text("Finance")'); await h.wait_for_timeout(1200)
        await h.goto(BASE + '/#/tasks/day'); await h.wait_for_timeout(900)
        dn = h.locator('.feature-card:has-text("Daily notes")')
        check(await dn.count() == 1 and 'Bank rec waiting' in await dn.inner_text(), 'Finance day review shows Daily notes with the team\'s notes')
        await h.screenshot(path=f'{OUT}/b1_finance_day_notes.png', full_page=True)

        # admin approves Ruwan into HR
        await h.goto(BASE + '/#/admin/people'); await h.wait_for_timeout(800)
        row = h.locator('.approve-row:has-text("Ruwan")')
        await row.locator('select[aria-label="Department"]').select_option(label='HR')
        await row.locator('button:has-text("Approve")').click(); await h.wait_for_timeout(900)
        check(await h.locator('.approve-row').count() == 0, 'admin approved Ruwan into HR')

        # create a new department
        await h.goto(BASE + '/#/admin/departments'); await h.wait_for_timeout(700)
        await h.fill('input[aria-label="New department name"]', 'Operations')
        await h.click('button:has-text("Add department")'); await h.wait_for_timeout(900)
        ops = h.locator('.dept-card:has-text("Operations")')
        check(await ops.count() == 1 and await ops.locator('input[type=checkbox]').first.is_checked(), 'new department created with Tasks switched on')

        # HR Tasks → only selected people (Priya)
        hrcard = h.locator('.dept-card:has(.dept-name:text-is("HR"))')
        await hrcard.locator('select[aria-label="Who can use Tasks"]').select_option('some'); await h.wait_for_timeout(700)
        await hrcard.locator('.pchip:has-text("Priya")').click(); await h.wait_for_timeout(700)
        await h.screenshot(path=f'{OUT}/b2_depts_selected.png', full_page=True)

        # ---------- HR people ----------
        d = await page_for(b, 'dilan@demo.lk')
        txt = await d.locator('main').inner_text()
        check('No apps yet' in txt, 'Dilan (not on the access list) sees no apps')
        pr = await page_for(b, 'priya@demo.lk')
        prt = await titles(pr)
        check(len(prt) >= 1, 'Priya (on the list) still has Tasks')
        check(await pr.locator('.dept-switch').count() == 0 and 'HR' in await pr.locator('.dept-label').inner_text(), 'manager has no department switcher, just a label')
        await pr.click('.app-switch .switcher'); await pr.wait_for_timeout(200)
        pitems = await pr.locator('.drop-item .drop-label').all_inner_texts()
        check('Admin console' not in pitems, f'manager has no Admin console: {pitems}')
        await pr.keyboard.press('Escape')
        await pr.goto(BASE + '/#/admin/people'); await pr.wait_for_timeout(800)
        check(await pr.locator('h1:has-text("People")').count() == 0, 'typing the admin URL does nothing for a manager')
        await pr.goto(BASE + '/#/tasks/team?view=table'); await pr.wait_for_timeout(700)
        team_txt = await pr.locator('.team-table').inner_text()
        check('Kasun' not in team_txt and 'Hasith' not in team_txt and 'Dilan' not in team_txt, 'HR team page lists only HR people with the app')
        await pr.click('.bell .icon-btn'); await pr.wait_for_timeout(300)
        bell = await pr.locator('.bell-pop').inner_text()
        check('Bank rec' not in bell and 'VAT' not in bell, 'HR manager sees no Finance notifications')
        # restore everyone
        await hrcard.locator('select[aria-label="Who can use Tasks"]').select_option('everyone'); await h.wait_for_timeout(700)
        await d.goto(BASE + '/#/tasks/list'); await d.reload(); await d.wait_for_timeout(1500)
        check(len(await titles(d)) >= 1, 'Dilan regains Tasks when access goes back to everyone')

        # ---------- Finance member ----------
        k = await page_for(b, 'kasun@demo.lk')
        check(await k.locator('.dept-switch').count() == 0, 'member has no department switcher')
        await k.click('.app-switch .switcher'); await k.wait_for_timeout(200)
        kitems = await k.locator('.drop-item .drop-label').all_inner_texts()
        check(kitems == ['Tasks', 'Notes'], f'member app list: {kitems}')
        await k.keyboard.press('Escape')
        kt = await titles(k)
        check(all(t in ['Bank reconciliation — Commercial Bank', 'Petty cash count & top-up', 'Fixed asset register update', 'Clear unreconciled items list'] for t in kt), f'member sees own Finance tasks only: {kt}')
        await k.goto(BASE + '/#/tasks/day'); await k.wait_for_timeout(900)
        card = k.locator('.feature-card:has-text("Daily notes")')
        check(await card.count() == 1, 'member sees Daily notes in Finance')
        ktxt = await card.inner_text()
        check('Invoices' not in ktxt and 'September supplier' not in ktxt, "member doesn't see colleagues' notes")
        await card.locator('textarea').fill('Bank rec done after statement arrived.')
        await card.locator('button:has-text("Save note")').click(); await k.wait_for_timeout(800)
        check('Saved' in await card.inner_text(), 'member saves own note')

        # ---------- notification hop for admin ----------
        await h.goto(BASE + '/#/tasks/list'); await h.wait_for_timeout(800)
        # Sachini completes the admin's HR task -> admin gets notified with HR department
        s = await page_for(b, 'sachini@demo.lk')
        await s.locator('.task-row:has-text("Exit interview summary") .check').click(); await s.wait_for_timeout(800)
        await h.reload(); await h.wait_for_timeout(1500)
        if 'Finance' not in await h.locator('.dept-switch .switcher').inner_text():
            await h.click('.dept-switch .switcher'); await h.click('.drop-item:has-text("Finance")'); await h.wait_for_timeout(1000)
        await h.click('.bell .icon-btn'); await h.wait_for_timeout(300)
        await h.screenshot(path=f'{OUT}/b3_bell_admin.png')
        await h.locator('.notice-row:has-text("finished \\"Exit interview summary\\"")').first.click()
        await h.wait_for_timeout(1500)
        title_val = await h.locator('.drawer .title-input').input_value() if await h.locator('.drawer .title-input').count() else ''
        check('HR' in await h.locator('.dept-switch .switcher').inner_text() and title_val == 'Exit interview summary',
              'clicking an HR notification switches the admin to HR and opens the task')

        # ---------- mobile ----------
        m = await page_for(b, 'hasith@demo.lk', 390, 844, True)
        await m.screenshot(path=f'{OUT}/b4_mobile.png')
        sw = await m.evaluate('document.documentElement.scrollWidth')
        check(sw <= 390, f'no sideways scroll on phone ({sw})')
        await m.click('.dept-switch .switcher'); await m.wait_for_timeout(200)
        await m.screenshot(path=f'{OUT}/b5_mobile_dept.png')
        await b.close()

    for r in results: print(r[0], r[1])
    print('ERRORS:', errors or 'none')
    print(sum(r[0] == 'PASS' for r in results), 'passed,', sum(r[0] == 'FAIL' for r in results), 'failed')

asyncio.run(main())
