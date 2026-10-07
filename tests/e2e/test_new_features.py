import os
_HERE = os.path.dirname(os.path.abspath(__file__))
os.makedirs(os.path.join(_HERE, 'shots'), exist_ok=True)
import asyncio, base64, datetime, io, os
from PIL import Image, ImageDraw
from playwright.async_api import async_playwright

BASE = os.environ.get('APP_URL', 'http://localhost:4173')
OUT = os.path.join(_HERE, 'shots')
os.makedirs(OUT, exist_ok=True)
results, errors = [], []
def check(c, m): results.append(('PASS' if c else 'FAIL', m)); print(('PASS ' if c else 'FAIL ') + m, flush=True)

def png_b64(color=(37, 99, 235), text='Screenshot'):
    im = Image.new('RGB', (360, 200), color); d = ImageDraw.Draw(im); d.rectangle([20, 20, 340, 180], outline='white', width=4); d.text((40, 90), text, fill='white')
    b = io.BytesIO(); im.save(b, 'PNG'); return base64.b64encode(b.getvalue()).decode()

PASTE_JS = """([sel, b64, name]) => {
  const el = document.querySelector(sel);
  const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const dt = new DataTransfer(); dt.items.add(new File([bin], name, { type: 'image/png' }));
  el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}"""

async def page_for(b, email, w=1360, h=860):
    ctx = await b.new_context(viewport={'width': w, 'height': h}, timezone_id='Asia/Colombo')
    pg = await ctx.new_page()
    pg.on('pageerror', lambda e: errors.append(f'{email}: {e}'))
    pg.on('console', lambda m: errors.append(f'{email}: {m.text}') if m.type == 'error' and 'favicon' not in m.text else None)
    await pg.goto(BASE); await pg.fill('input[type=email]', email); await pg.fill('input[type=password]', 'password1')
    await pg.click('button:has-text("Sign in")'); await pg.wait_for_timeout(1500)
    return pg

async def to_finance(h):
    if 'Finance' not in await h.locator('.dept-switch .switcher').inner_text():
        await h.click('.dept-switch .switcher'); await h.click('.drop-item:has-text("Finance")'); await h.wait_for_timeout(1000)

async def toast_text(pg):
    try:
        await pg.wait_for_selector('.toast', timeout=3000)
        return ' | '.join(await pg.locator('.toast').all_inner_texts())
    except Exception:
        return ''

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()

        # ================= Today page =================
        k = await page_for(b, 'kasun@demo.lk')
        check(await k.locator('.tab.active').inner_text() == 'Today', 'Today is the first tab and opens by default')
        check(await k.locator('h1').first.inner_text() == 'Today', 'Today heading')
        hours = await k.locator('.tl-hour').all_inner_texts()
        check(hours[0] == '07:00' and hours[-1] == '20:30', f'timeline runs 07:00–20:30 ({hours[0]}…{hours[-1]})')
        check(await k.locator('.plan-item:has-text("Bank reconciliation")').count() == 1, 'own open tasks listed to plan')
        await k.evaluate("document.querySelector('.timeline-wrap').scrollTop = 0")
        await k.wait_for_timeout(200)
        # drop "Bank reconciliation" at 10:00 (y = (615-420) * 44/30 → snapped to 10:00)
        y = (615 - 420) * 44 / 30
        await k.locator('.plan-item:has-text("Bank reconciliation")').drag_to(k.locator('.tl-grid'), target_position={'x': 200, 'y': y})
        await k.wait_for_timeout(900)
        blk = k.locator('.tl-block:has-text("Bank reconciliation")')
        check(await blk.count() == 1, 'drag a task onto the timeline')
        check('10:00–11:00' in await blk.inner_text(), f'dropped at 10:00 for an hour ({await blk.inner_text() if await blk.count() else ""})')
        check('⏱ 10:00' in await k.locator('.plan-item:has-text("Bank reconciliation")').inner_text(), 'list shows it is planned')
        # move it down an hour with the mouse
        bb = await blk.bounding_box()
        await k.mouse.move(bb['x'] + 60, bb['y'] + 20); await k.mouse.down()
        await k.mouse.move(bb['x'] + 60, bb['y'] + 40, steps=4); await k.mouse.move(bb['x'] + 60, bb['y'] + 20 + 88, steps=6); await k.mouse.up()
        await k.wait_for_timeout(800)
        check('11:00–12:00' in await blk.inner_text(), f'drag a block to move it ({await blk.inner_text()})')
        # resize: pull the bottom edge down 30 minutes
        bb = await blk.bounding_box()
        await k.mouse.move(bb['x'] + 60, bb['y'] + bb['height'] - 3); await k.mouse.down()
        await k.mouse.move(bb['x'] + 60, bb['y'] + bb['height'] + 10, steps=3); await k.mouse.move(bb['x'] + 60, bb['y'] + bb['height'] + 41, steps=5); await k.mouse.up()
        await k.wait_for_timeout(800)
        check('11:00–12:30' in await blk.inner_text(), f'drag the bottom edge to resize ({await blk.inner_text()})')
        # own block: click an empty slot at 13:00
        gb = await k.locator('.tl-grid').bounding_box()
        await k.evaluate("document.querySelector('.timeline-wrap').scrollTop = 300"); await k.wait_for_timeout(200)
        gb = await k.locator('.tl-grid').bounding_box()
        await k.mouse.click(gb['x'] + 300, gb['y'] + (13 * 60 + 10 - 420) * 44 / 30)
        await k.wait_for_selector('.tl-block.draft input'); await k.fill('.tl-block.draft input', 'Lunch'); await k.press('.tl-block.draft input', 'Enter')
        await k.wait_for_timeout(800)
        own = k.locator('.tl-block.own:has-text("Lunch")')
        check(await own.count() == 1 and '13:00–13:30' in await own.inner_text(), 'click an empty slot to add your own block (Lunch 13:00)')
        # + button plans into the next free hour
        await k.locator('.plan-item:has-text("Petty cash") .plan-add').click(); await k.wait_for_timeout(800)
        check(await k.locator('.tl-block:has-text("Petty cash")').count() == 1, '+ adds a task to the next free hour')
        await k.reload(); await k.wait_for_timeout(1500)
        check(await k.locator('.tl-block').count() == 3, 'blocks are saved (still there after reload)')
        await k.screenshot(path=f'{OUT}/t1_today.png')
        # any day: tomorrow is empty, then come back
        await k.click('button[aria-label="Next day"]'); await k.wait_for_timeout(800)
        check(await k.locator('.tl-block').count() == 0 and 'In 1 day' in await k.locator('.page-head').inner_text(), 'next day can be planned separately')
        await k.click('.cal-nav button:has-text("Today")'); await k.wait_for_timeout(800)
        # remove a block
        await k.locator('.tl-block:has-text("Petty cash")').hover(); await k.locator('.tl-block:has-text("Petty cash") .tl-x').click(); await k.wait_for_timeout(700)
        check(await k.locator('.tl-block:has-text("Petty cash")').count() == 0, 'remove a block with ✕')

        # lead sees Kasun's day read-only
        n = await page_for(b, 'nadeesha@demo.lk')
        await n.select_option('.filters select', label="Kasun Silva's day"); await n.wait_for_timeout(900)
        check(await n.locator('.readonly-note').count() == 1, "senior views a member's day (read-only note)")
        check(await n.locator('.tl-block').count() == 2, "senior sees the member's blocks")
        check(await n.locator('.plan-add').count() == 0 and await n.locator('.tl-x').count() == 0, 'no editing controls on someone else\'s day')
        await n.screenshot(path=f'{OUT}/t2_lead_view.png')
        a = await page_for(b, 'amaya@demo.lk')
        check(await a.locator('.page-head select').count() == 0, "members don't get a person picker")

        # ================= Helpers + checklist + files =================
        h = await page_for(b, 'hasith@demo.lk')
        await to_finance(h)
        await h.goto(BASE + '/#/tasks/list?who=all'); await h.wait_for_timeout(900)
        await h.click('.task-row:has-text("Bank reconciliation")'); await h.wait_for_selector('.drawer')
        await h.select_option('.helper-add', label='Amaya Fernando'); await h.wait_for_timeout(800)
        check(await h.locator('.helper-chip:has-text("Amaya")').count() == 1, 'manager adds a helper')
        for s in ['Download statement', 'Match receipts', 'Post adjustments']:
            await h.fill('.step-add input', s); await h.press('.step-add input', 'Enter'); await h.wait_for_timeout(400)
        check(await h.locator('.steps li').count() == 3, 'manager adds checklist steps')
        await h.keyboard.press('Escape'); await h.wait_for_timeout(400)
        row = h.locator('.task-row:has-text("Bank reconciliation")')
        check('☑ 0/3' in await row.inner_text(), 'task row shows checklist progress 0/3')
        check(await row.locator('.tr-helpers .avatar').count() == 1, 'task row shows helper avatar')

        await a.reload(); await a.wait_for_timeout(1200)
        await a.click('.bell .icon-btn'); await a.wait_for_timeout(300)
        check('added you as a helper on "Bank reconciliation' in await a.locator('.bell-pop').inner_text(), 'helper is notified')
        await a.keyboard.press('Escape'); await a.mouse.click(10, 500)
        check(await a.locator('.plan-item:has-text("Bank reconciliation")').count() == 1 and 'helping' in await a.locator('.plan-item:has-text("Bank reconciliation")').inner_text(), 'helper can plan it on Today ("helping Kasun")')
        await a.goto(BASE + '/#/tasks/list'); await a.wait_for_timeout(900)
        check(await a.locator('.helping-group .task-row:has-text("Bank reconciliation")').count() == 1, '"Helping on" group lists it')
        await a.locator('.helping-group .task-row:has-text("Bank reconciliation") .check').click()
        t = await toast_text(a)
        check('Only Kasun can mark this done' in t, f'helper cannot mark done from the list ({t})')
        await a.wait_for_timeout(500)
        await a.click('.helping-group .task-row:has-text("Bank reconciliation")'); await a.wait_for_selector('.drawer')
        check(await a.locator('.helper-banner').count() == 1, 'helper sees "You\'re helping" banner')
        check(await a.locator('.drawer .seg-btn:has-text("Done")').is_disabled(), 'Done button disabled for helper')
        check(await a.locator('.drawer input[type=date]').is_disabled(), 'helper cannot move the deadline')
        check(await a.locator('.helper-add').count() == 0, 'helper cannot add helpers')
        await a.locator('.steps li:has-text("Download statement") input').check(); await a.wait_for_timeout(700)
        check('1/3' in await a.locator('.checklist .section-title').inner_text(), 'helper ticks a step (1/3)')
        await a.evaluate(PASTE_JS, ['.drawer', png_b64((22, 163, 74), 'Amaya paste'), 'image.png']); await a.wait_for_timeout(1800)
        img = a.locator('.file-grid img').first
        check(await img.count() == 1, 'helper pastes a screenshot (Ctrl+V)')
        if await img.count():
            ok_img = await img.evaluate('i => i.complete && i.naturalWidth > 0')
            check(ok_img, 'screenshot thumbnail loads from private storage')
            check((await a.locator('.file-grid .file-name').first.inner_text()).startswith('Screenshot '), 'pasted image gets a friendly name')
        await a.click('button:has-text("Add link")'); await a.fill('.link-form input[aria-label="Link name"]', 'Bank portal'); await a.fill('.link-form input[aria-label="Link address"]', 'online.combank.lk')
        await a.click('.link-form button:has-text("Add")'); await a.wait_for_timeout(800)
        check(await a.locator('.file-item.link:has-text("Bank portal")').count() == 1, 'helper adds a link')
        await a.fill('.reply textarea', 'Downloaded the statement.'); await a.click('.reply button'); await a.wait_for_timeout(700)
        check(await a.locator('.comment:has-text("Downloaded the statement.")').count() == 1, 'helper comments')
        await a.click('.subtabs button:has-text("History")'); await a.wait_for_timeout(400)
        hist = await a.locator('.history').inner_text()
        check('added helper' in hist and 'ticked a step' in hist, 'history shows helper and checklist events')
        await a.screenshot(path=f'{OUT}/h1_helper_drawer.png')
        await a.keyboard.press('Escape')
        await a.goto(BASE + '/#/tasks/calendar'); await a.wait_for_timeout(900)
        check(await a.locator('.chip.helper:has-text("Bank reconciliation")').count() == 1, 'helper task shows dashed on the calendar')
        check(await a.locator('.chip.helper:has-text("Bank reconciliation")').get_attribute('draggable') == 'false', "helper can't drag it to another day")

        # owner side
        await k.goto(BASE + '/#/tasks/list'); await k.wait_for_timeout(1000)
        await k.click('.task-row:has-text("Bank reconciliation")'); await k.wait_for_selector('.drawer'); await k.wait_for_timeout(1200)
        check(await k.locator('.file-item').count() == 2, 'owner sees the helper\'s screenshot and link')
        await k.locator('input[type=file]').first.set_input_files(files=[{'name': 'statement.csv', 'mimeType': 'text/csv', 'buffer': b'date,amount\n2026-10-01,100\n'}])
        await k.wait_for_timeout(1200)
        check(await k.locator('.file-item:has-text("statement.csv")').count() == 1, 'owner attaches a file')
        await k.locator('input[type=file]').first.set_input_files(files=[{'name': 'huge.zip', 'mimeType': 'application/zip', 'buffer': b'0' * (11 * 1024 * 1024)}])
        t = await toast_text(k)
        check('larger than 10 MB' in t, f'files over 10 MB are refused ({t})')
        await k.wait_for_timeout(500)
        await k.locator('.file-item:has-text("statement.csv")').hover(); await k.locator('.file-item:has-text("statement.csv") .file-x').click(); await k.wait_for_timeout(700)
        check(await k.locator('.file-item:has-text("statement.csv")').count() == 0, 'owner removes a file')
        check(not await k.locator('.drawer .seg-btn:has-text("Done")').is_disabled(), 'owner can still mark done')
        await k.keyboard.press('Escape')

        # new task with queued steps, helper and screenshot
        await h.click('.subnav button:has-text("New task")'); await h.wait_for_selector('.drawer')
        await h.fill('.title-input', 'Month-end close checklist')
        await h.select_option('.drawer .field select', label='Nadeesha Perera')
        for s in ['Accruals', 'Prepayments']:
            await h.fill('.step-add input', s); await h.press('.step-add input', 'Enter'); await h.wait_for_timeout(200)
        await h.select_option('.helper-add', label='Kasun Silva'); await h.wait_for_timeout(200)
        await h.evaluate(PASTE_JS, ['.drawer', png_b64((220, 38, 38), 'New task'), 'image.png']); await h.wait_for_timeout(500)
        check(await h.locator('.file-item.pending').count() == 1, 'screenshot queued before the task exists')
        await h.click('button:has-text("Create task")'); await h.wait_for_timeout(2500)
        await h.click('.task-row:has-text("Month-end close checklist")'); await h.wait_for_selector('.drawer'); await h.wait_for_timeout(900)
        check(await h.locator('.steps li').count() == 2, 'queued steps saved on create')
        check(await h.locator('.helper-chip:has-text("Kasun")').count() == 1, 'queued helper saved on create')
        check(await h.locator('.file-grid img').count() == 1, 'queued screenshot saved on create')
        await h.screenshot(path=f'{OUT}/h2_new_task.png')
        await h.keyboard.press('Escape')

        # ================= Notes =================
        await k.goto(BASE + '/#/notes'); await k.wait_for_timeout(2000)
        check(await k.locator('.notes-side').count() == 1, 'Notes app opens from the app list')
        await k.click('.notes-side-head button:has-text("New page")'); await k.wait_for_timeout(1200)
        await k.fill('.note-title', 'Bank reconciliation steps'); await k.press('.note-title', 'Enter')
        await k.keyboard.type('How we reconcile each month.')
        await k.keyboard.press('Enter')
        await k.click('.tb[title="Medium heading"]'); await k.keyboard.type('Checklist')
        await k.keyboard.press('Enter')
        await k.click('.tb[title="Tickbox list"]'); await k.keyboard.type('Download statement'); await k.keyboard.press('Enter'); await k.keyboard.type('Match receipts')
        await k.keyboard.press('Enter'); await k.keyboard.press('Enter')
        await k.evaluate(PASTE_JS, ['.note-doc', png_b64((124, 58, 237), 'Note image'), 'image.png']); await k.wait_for_timeout(2000)
        check(await k.locator('.note-doc .note-img img').count() == 1, 'screenshot pasted into the page')
        await k.keyboard.type('Statement above.')
        check(await k.locator('.note-doc .note-img img').count() == 1, 'typing after a pasted image keeps the image')
        await k.keyboard.press('Enter')
        await k.click('.tb[title="Insert a table"]'); await k.wait_for_timeout(300)
        check(await k.locator('.note-doc table').count() == 1, 'table inserted')
        await k.keyboard.type('Bank')
        await k.wait_for_timeout(2200)
        check(await k.locator('.save-state').inner_text() == 'Saved', f'autosaves ({await k.locator(".save-state").inner_text()})')
        check(await k.locator('.tree-item.on:has-text("Bank reconciliation steps")').count() == 1, 'page appears in My pages')
        await k.reload(); await k.wait_for_timeout(2500)
        doc = await k.locator('.note-doc').inner_text()
        check('How we reconcile' in doc and 'Match receipts' in doc and 'Bank' in doc, 'content is kept after reload')
        check(await k.locator('.note-doc h2').count() == 1 and await k.locator('.note-doc ul[data-type=taskList] li').count() == 2, 'heading and tickboxes kept')
        img = k.locator('.note-doc .note-img img')
        check(await img.count() == 1 and await img.evaluate('i => i.complete && i.naturalWidth > 0'), 'pasted image shows after reload')
        await k.locator('.note-doc ul[data-type=taskList] li').first.locator('input').check(); await k.wait_for_timeout(1500)
        check(await k.locator('.share-btn').inner_text() == '🔒 Private', 'new pages start private')
        await k.screenshot(path=f'{OUT}/n1_page.png')

        # sub-page + linked task
        await k.click('.note-actions button:has-text("Sub-page")'); await k.wait_for_timeout(1200)
        await k.fill('.note-title', 'Commercial Bank'); await k.wait_for_timeout(1500)
        check('Bank reconciliation steps' in await k.locator('.crumbs').inner_text(), 'sub-page shows its path')
        check('Sharing follows' in (await k.locator('.share-tag').get_attribute('title') or ''), 'sub-page follows the top-level page sharing')
        await k.click('.crumbs .link'); await k.wait_for_timeout(1200)
        check(await k.locator('.subpages:has-text("Commercial Bank")').count() == 1, 'sub-page listed on the parent')
        await k.click('button:has-text("+ Link a task")'); await k.fill('.picker input', 'Bank rec'); await k.wait_for_timeout(400)
        await k.locator('.picker li button').first.click(); await k.wait_for_timeout(900)
        check(await k.locator('.linked-list:has-text("Bank reconciliation")').count() == 1, 'task linked to the page')

        # private: others can't see; admin can (labelled Private, read-only)
        await a.goto(BASE + '/#/notes'); await a.wait_for_timeout(1500)
        check(await a.locator('.tree-item:has-text("Bank reconciliation steps")').count() == 0, 'private page hidden from colleagues')
        await h.goto(BASE + '/#/notes'); await h.wait_for_timeout(1500)
        check(await h.locator('.tree-head:has-text("Kasun Silva")').count() == 1, 'admin sees pages grouped by owner')
        await h.click('.tree-item:has-text("Bank reconciliation steps") .tree-link'); await h.wait_for_timeout(1500)
        check(await h.locator('.share-tag').inner_text() == '🔒 Private', 'admin sees the label "Private"')
        check(await h.locator('.note-toolbar').count() == 0 and await h.locator('.save-state').inner_text() == 'View only', 'admin reads it but cannot edit')

        # share with the department (view)
        await k.click('.share-btn'); await k.click('.share-opt:has-text("Whole department")'); await k.wait_for_timeout(700)
        await k.click('.modal-foot button:has-text("Done")'); await k.wait_for_timeout(500)
        check('Department · can view' in await k.locator('.share-btn').inner_text(), 'shared with the department (view)')
        await a.reload(); await a.wait_for_timeout(2000)
        check(await a.locator('.tree-head:has-text("Shared with me")').count() == 1, 'colleague sees "Shared with me"')
        await a.click('.tree-item:has-text("Bank reconciliation steps") .tree-link'); await a.wait_for_timeout(1500)
        check(await a.locator('.note-toolbar').count() == 0 and await a.locator('.note-title').get_attribute('readonly') is not None, 'view access is read-only')
        check(await a.locator('.subpages:has-text("Commercial Bank")').count() == 1, 'sub-pages are shared too')
        # task panel shows the linked page (Amaya is a helper on that task)
        await a.goto(BASE + '/#/tasks/list'); await a.wait_for_timeout(900)
        await a.click('.helping-group .task-row:has-text("Bank reconciliation")'); await a.wait_for_selector('.drawer'); await a.wait_for_timeout(900)
        check(await a.locator('.linked-notes .linked-list:has-text("Bank reconciliation steps")').count() == 1, 'task panel lists the linked Notes page')
        await a.click('.linked-notes .linked-open'); await a.wait_for_timeout(2000)
        check('#/notes' in a.url and await a.locator('.note-title').input_value() == 'Bank reconciliation steps', 'click opens the page in Notes')

        # edit access + conflict protection
        await k.click('.share-btn'); await k.select_option('.share-opt select', 'edit'); await k.wait_for_timeout(600)
        await k.click('.modal-foot button:has-text("Done")'); await k.wait_for_timeout(300)
        await a.reload(); await a.wait_for_timeout(2200)
        check(await a.locator('.note-toolbar').count() == 1, 'edit access gets the toolbar')
        await a.click('.note-doc p >> nth=0'); await a.keyboard.press('End'); await a.keyboard.type(' (Amaya)'); await a.wait_for_timeout(2000)
        check(await a.locator('.save-state').inner_text() == 'Saved', 'editor saves their change')
        await k.click('.note-doc p >> nth=0'); await k.keyboard.press('End'); await k.keyboard.type(' (Kasun)'); await k.wait_for_timeout(2000)
        check(await k.locator('.conflict-bar').count() == 1, 'overlapping edit is caught instead of overwriting')
        await k.click('.conflict-bar button:has-text("Show their version")'); await k.wait_for_timeout(1200)
        check('(Amaya)' in await k.locator('.note-doc').inner_text(), "showing their version brings in the other person's change")

        # share with one person → bell → opens page
        await k.click('.notes-side-head button:has-text("New page")'); await k.wait_for_timeout(1200)
        await k.fill('.note-title', 'For Nadeesha'); await k.wait_for_timeout(1500)
        await k.click('.share-btn'); await k.click('.share-opt:has-text("Selected people")'); await k.wait_for_timeout(500)
        await k.select_option('.share-people select[aria-label="Add a person"]', label='Nadeesha Perera'); await k.wait_for_timeout(900)
        check(await k.locator('.share-person:has-text("Nadeesha")').count() == 1, 'shared with a chosen person')
        await k.click('.modal-foot button:has-text("Done")')
        await n.goto(BASE + '/#/tasks'); await n.reload(); await n.wait_for_timeout(1500)
        await n.click('.bell .icon-btn'); await n.wait_for_timeout(300)
        await n.click('.notice-row:has-text("shared \\"For Nadeesha\\"")'); await n.wait_for_timeout(2500)
        check('#/notes' in n.url and await n.locator('.note-title').input_value() == 'For Nadeesha', 'share notification opens the page')
        check(await n.locator('.tree-item:has-text("Bank reconciliation steps")').count() == 1, 'department pages visible to the senior too')
        await a.goto(BASE + '/#/notes'); await a.wait_for_timeout(1500)
        check(await a.locator('.tree-item:has-text("For Nadeesha")').count() == 0, 'people not chosen do not see it')

        # HR has no Notes
        pr = await page_for(b, 'priya@demo.lk')
        await pr.click('.app-switch .switcher'); await pr.wait_for_timeout(300)
        check('Notes' not in await pr.locator('.drop-pop').inner_text(), "HR doesn't get Notes unless the admin turns it on")
        await pr.keyboard.press('Escape')

        # delete a page with its sub-page
        await k.click('.tree-item:has-text("Bank reconciliation steps") .tree-link'); await k.wait_for_timeout(1500)
        await k.click('.note-actions button:has-text("Delete")'); await k.click('.confirm-inline button:has-text("Delete")'); await k.wait_for_timeout(1500)
        check(await k.locator('.tree-item:has-text("Bank reconciliation steps")').count() == 0 and await k.locator('.tree-item:has-text("Commercial Bank")').count() == 0, 'deleting a page removes its sub-pages')

        # mobile layout sanity
        m = await page_for(b, 'kasun@demo.lk', 390, 800)
        await m.goto(BASE + '/#/tasks'); await m.wait_for_timeout(1200)
        await m.screenshot(path=f'{OUT}/m1_today_mobile.png', full_page=True)
        sw = await m.evaluate('document.documentElement.scrollWidth')
        check(sw <= 392, f'Today fits a phone screen (scrollWidth {sw})')
        await m.goto(BASE + '/#/notes'); await m.wait_for_timeout(1500)
        await m.screenshot(path=f'{OUT}/m2_notes_mobile.png')
        sw = await m.evaluate('document.documentElement.scrollWidth')
        check(sw <= 392, f'Notes fits a phone screen (scrollWidth {sw})')

        await b.close()

    bad = [r for r in results if r[0] == 'FAIL']
    print(f'\n{len(results) - len(bad)} passed, {len(bad)} failed')
    errs = [e for e in errors if 'Failed to load resource' not in e]
    if errs: print('Browser errors:\n  ' + '\n  '.join(errs[:20]))

asyncio.run(main())
