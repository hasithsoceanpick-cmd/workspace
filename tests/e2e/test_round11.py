import os
_HERE = os.path.dirname(os.path.abspath(__file__))
os.makedirs(os.path.join(_HERE, 'shots'), exist_ok=True)
# Browser tests for round 11: Messages — chat button, announcements (Got it), team chat with @mentions, one-to-one
# chats (private, ticks), reply / edit / delete, pictures, Send as task / mini task / reminder, attach a task / note,
# Make it a …, Ctrl+K search, departments apart, phone layout.
import asyncio, subprocess, struct, zlib
from playwright.async_api import async_playwright

BASE = os.environ.get('APP_URL', 'http://localhost:4173')
DB = os.environ.get('DATABASE_URL', 'postgres://postgres@127.0.0.1:54322/postgres')
OUT = os.path.join(_HERE, 'shots')
results, errors = [], []
def check(c, m): c = bool(c); results.append(c); print(('PASS ' if c else 'FAIL ') + m, flush=True)
def sql(q): return subprocess.run(['psql', DB, '-At', '-c', q], capture_output=True, text=True).stdout.strip()

def png(path, w=60, h=40):
    raw = b''.join(b'\x00' + bytes([30, 120, 200] * w) for _ in range(h))
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b''))

async def page_for(b, email, w=1360, h=860):
    ctx = await b.new_context(viewport={'width': w, 'height': h}, timezone_id='Asia/Colombo')
    await ctx.grant_permissions(['clipboard-read', 'clipboard-write'])
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
    await pg.click('.bell .icon-btn'); await pg.wait_for_timeout(200)
    return t

async def chat_count(pg):
    d = pg.locator('.chat-btn .dot-count')
    return int((await d.inner_text()).strip()) if await d.count() else 0

async def open_thread(pg, name):
    if '#/messages' not in pg.url:
        await pg.click('.chat-btn .icon-btn'); await pg.wait_for_timeout(1200)
    await pg.click(f'.msg-thread[aria-label="{name}"]'); await pg.wait_for_timeout(1200)

async def write(pg, text):
    await pg.fill('.composer textarea', text)
    await pg.click('.composer-send'); await pg.wait_for_timeout(1000)

async def menu(pg, bubble, item):
    await bubble.hover(); await bubble.locator('.msg-more').first.click(); await pg.wait_for_timeout(200)
    await pg.click(f'.msg-menu .menu-item:has-text("{item}")'); await pg.wait_for_timeout(300)

async def main():
    sql("insert into department_apps (department_id, app_key) select id, 'messages' from departments on conflict do nothing")
    async with async_playwright() as p:
        b = await p.chromium.launch()
        h = await page_for(b, 'hasith@demo.lk')
        await to_finance(h)

        # =============== the chat button ===============
        check(await h.locator('.chat-btn .icon-btn').count() == 1, 'a chat button sits in the top bar')
        await h.click('.app-switch .switcher'); await h.wait_for_timeout(300)
        apps = await h.locator('.app-switch .drop-item').all_inner_texts()
        await h.keyboard.press('Escape'); await h.mouse.click(700, 500)
        check(not any('Messages' in a for a in apps), 'Messages is not cluttering the Apps menu')
        await h.click('.chat-btn .icon-btn'); await h.wait_for_timeout(1500)
        names = await h.locator('.msg-thread .msg-thread-name').all_inner_texts()
        check('#/messages' in h.url and names[:2] == ['Announcements', 'Team chat'], f'it opens Messages: Announcements and Team chat ({names})')
        check('Team chat' in await h.locator('.convo-title').inner_text(), 'on a computer the team chat opens straight away')
        check('4 people' in await h.locator('.convo-title').inner_text(), 'the team chat is everyone in Finance with Messages (4 people)')

        # =============== announcements ===============
        await open_thread(h, 'Announcements')
        await write(h, 'Month-end close starts Monday 8 am')
        a1 = h.locator('.msg:has-text("Month-end close starts Monday 8 am")')
        check(await a1.count() == 1 and 'Got it: 0 of 3' in await a1.inner_text(), 'Hasith announces; it shows "Got it: 0 of 3"')
        k = await page_for(b, 'kasun@demo.lk')
        check('Announcement from Hasith Ranaweera: Month-end close starts Monday 8 am' in await bell(k), "Kasun's bell has the announcement")
        check(await chat_count(k) >= 1, f'and his chat button shows unread ({await chat_count(k)})')
        await open_thread(k, 'Announcements')
        check('Only managers post announcements' in await k.locator('.msg-closed').inner_text(), 'members can read but not post announcements')
        await k.click('.msg:has-text("Month-end close") button:has-text("Got it")'); await k.wait_for_timeout(800)
        check('You pressed Got it' in await k.locator('.msg:has-text("Month-end close")').inner_text(), 'Kasun presses Got it')
        await h.wait_for_timeout(4500)
        check('Got it: 1 of 3' in await a1.inner_text(), 'Hasith sees 1 of 3 (without reloading)')
        await a1.locator('button:has-text("Got it:")').click(); await h.wait_for_timeout(300)
        info = await h.locator('.msg-info').inner_text()
        check('Kasun Silva' in info and 'Amaya Fernando' in info.split('Not yet')[1], f'…and who has, and who not yet')
        await h.mouse.click(5, 300)

        # =============== team chat and @mentions ===============
        await open_thread(h, 'Team chat')
        await h.click('.composer textarea'); await h.keyboard.type('Bank rec due Friday @Kas')
        pop = await h.locator('.mention-pop').inner_text()
        check('Kasun Silva' in pop and 'Amaya' not in pop, 'typing @Kas suggests Kasun')
        await h.keyboard.press('Enter'); await h.keyboard.type('please check the OD')
        v = await h.input_value('.composer textarea')
        check(v == 'Bank rec due Friday @Kasun Silva please check the OD', f'Enter puts his full name in ({v!r})')
        await h.click('.composer-send'); await h.wait_for_timeout(1000)
        tm = h.locator('.msg:has-text("Bank rec due Friday")')
        check(await tm.locator('.mention').inner_text() == '@Kasun Silva', 'the mention is highlighted')
        check(sql("select count(*) from notifications n join profiles p on p.id = n.user_id where kind = 'mention' and p.full_name = 'Kasun Silva'") == '1'
              and sql("select count(*) from notifications n join profiles p on p.id = n.user_id where kind = 'mention' and p.full_name <> 'Kasun Silva'") == '0',
              'only Kasun is alerted')
        await k.goto(BASE + '/#/messages'); await k.wait_for_timeout(1500)
        trow = k.locator('.msg-thread[aria-label="Team chat"]')
        check(await trow.locator('.msg-at').count() == 1 and await trow.locator('.msg-unread').count() == 1, 'his list marks the team chat unread, with @')
        check('mentioned you in the team chat' in await bell(k), '…and his bell says he was mentioned')
        await open_thread(k, 'Team chat')
        check(await k.locator('.convo-new').count() == 1, 'a "New messages" line shows where he got to')
        unread_marks = sql("select count(*) from notifications n join profiles p on p.id = n.user_id where p.full_name = 'Kasun Silva' and app_key = 'messages' and read_at is null")
        check(unread_marks == '0', f'opening it marks its alerts read ({unread_marks} left)')

        # =============== one-to-one ===============
        await k.click('.msg-new .btn'); await k.fill('.msg-people input', 'Ama'); await k.wait_for_timeout(200)
        await k.click('.msg-person:has-text("Amaya Fernando")'); await k.wait_for_timeout(1500)
        check('only the two of you can read this' in await k.locator('.convo-title').inner_text(), 'Kasun starts a private chat with Amaya')
        await write(k, 'Can you send me the Sampath statement?')
        km = k.locator('.msg.mine:has-text("Sampath statement")')
        t0 = await km.locator('.ticks').get_attribute('class')
        check('t-seen' not in t0, f'one tick or two, not yet seen ({t0})')
        a = await page_for(b, 'amaya@demo.lk')
        await a.wait_for_timeout(1500)
        check(await chat_count(a) >= 1, f"Amaya's chat button shows it ({await chat_count(a)})")
        check('Sampath' not in await bell(a), "one-to-one messages don't fill the bell (the chat button counts them)")
        check(sql("select message from notifications n join profiles p on p.id = n.user_id where kind = 'message' and p.full_name = 'Amaya Fernando'") ==
              'Kasun Silva: Can you send me the Sampath statement?', '…but her phone is alerted ("Kasun Silva: …")')
        await k.wait_for_timeout(4500)
        check('t-delivered' in await km.locator('.ticks').get_attribute('class'), "Kasun sees two grey ticks: delivered to Amaya's app")
        await open_thread(a, 'Kasun Silva')
        await k.wait_for_timeout(4500)
        check('t-seen' in await km.locator('.ticks').get_attribute('class'), 'when she opens it, his ticks turn blue (seen)')
        await h.goto(BASE + '/#/messages'); await h.wait_for_timeout(1500)
        hn = await h.locator('.msg-thread .msg-thread-name').all_inner_texts()
        check('Amaya Fernando' not in hn and 'Kasun Silva' not in hn, f"not even Hasith (admin) sees their chat ({hn})")

        # reply, edit, delete
        await menu(a, a.locator('.msg:has-text("Sampath statement")'), 'Reply')
        check('Replying to' in await a.locator('.composer-bar').inner_text(), 'Amaya replies to that message')
        await write(a, 'Sent it this morning')
        rep = a.locator('.msg.mine:has-text("Sent it this morning")')
        check('Can you send me the Sampath' in await rep.locator('.msg-quote').inner_text(), 'her reply quotes his message')
        await menu(a, rep, 'Edit')
        await a.fill('.composer textarea', 'Sent it at 9 this morning'); await a.click('.composer-send'); await a.wait_for_timeout(900)
        rep = a.locator('.msg.mine:has-text("Sent it at 9 this morning")')
        check(await rep.count() == 1 and 'edited' in await rep.inner_text(), 'she edits it (marked edited)')
        await write(k, 'oops wrong chat')
        await menu(k, k.locator('.msg.mine:has-text("oops wrong chat")'), 'Delete')
        await k.click('.msg-menu .menu-item:has-text("Yes, delete")'); await k.wait_for_timeout(900)
        check(await k.locator('.msg:has-text("oops wrong chat")').count() == 0 and await k.locator('.msg-gone').count() == 1, 'Kasun deletes one ("This message was deleted")')
        sql("select set_config('app.system', 'on', true); update msg_messages set created_at = now() - interval '20 minutes' where body like 'Sent it at 9%'")
        await a.reload(); await a.wait_for_timeout(1800)
        rep = a.locator('.msg.mine:has-text("Sent it at 9 this morning")')
        await rep.hover(); await rep.locator('.msg-more').click(); await a.wait_for_timeout(200)
        mi = await a.locator('.msg-menu').inner_text()
        check('Edit' not in mi and 'Delete' not in mi and 'Reply' in mi, 'after 15 minutes there is no Edit or Delete')
        await a.keyboard.press('Escape')

        # a picture
        pic = os.path.join(OUT, 'r11-shot.png'); png(pic)
        await k.set_input_files('.composer input[type=file]', pic); await k.wait_for_timeout(300)
        check('r11-shot.png' in await k.locator('.composer-chips').inner_text(), 'a picture waits in the box before sending')
        await k.fill('.composer textarea', 'Here is the screen'); await k.click('.composer-send'); await k.wait_for_timeout(1500)
        await a.wait_for_timeout(4500)
        img = a.locator('.msg:has-text("Here is the screen") .msg-img img')
        ok = await img.count() == 1 and await img.evaluate('i => i.complete && i.naturalWidth > 0')
        check(ok, 'Amaya sees the picture in the chat')

        # =============== Send as task / mini task / reminder ===============
        await open_thread(h, 'Team chat')
        await h.click('.msg-new .btn'); await h.click('.msg-person:has-text("Kasun Silva")'); await h.wait_for_timeout(1500)
        await h.fill('.composer textarea', 'Prepare the VAT schedule for October')
        await h.click('.composer button:has-text("Send as")'); await h.click('.composer-menu .menu-item:has-text("Task")')
        await h.wait_for_selector('.msg-work')
        check(await h.locator('.msg-work select[aria-label="For"] option:checked').inner_text() == 'Kasun Silva', 'Send as → Task: for Kasun (the other person)')
        await h.click('.msg-work button:has-text("Send")'); await h.wait_for_timeout(1500)
        tid = sql("select id from tasks where title = 'Prepare the VAT schedule for October' and assignee_id = (select id from profiles where full_name = 'Kasun Silva')")
        check(tid and sql(f"select relation from msg_items where kind = 'task' and ref_id = {tid}") == 'sent', 'a real task for Kasun, sent in the chat')
        card = h.locator('.msg:has-text("Prepare the VAT schedule") .wcard.k-task')
        check(await card.count() == 1 and 'Task for Kasun' in await card.inner_text(), 'the message carries a task card (for Kasun, with its deadline)')
        await h.fill('.composer textarea', 'Call the bank about the OD')
        await h.click('.composer button:has-text("Send as")'); await h.click('.composer-menu .menu-item:has-text("Mini task")')
        await h.click('.msg-work button:has-text("Send")'); await h.wait_for_timeout(1500)
        check(sql("select p.full_name from task_minis m join profiles p on p.id = m.user_id where body = 'Call the bank about the OD'") == 'Kasun Silva', 'Send as → Mini task: on Kasun\'s Today')

        await open_thread(k, 'Hasith Ranaweera')
        kc = k.locator('.msg:has-text("Prepare the VAT schedule") .wcard.k-task')
        await kc.click(); await k.wait_for_timeout(1500)
        ti = k.locator('.drawer .title-input')
        check('#/tasks' in k.url and await ti.count() == 1 and await ti.input_value() == 'Prepare the VAT schedule for October',
              'Kasun opens the task straight from the message')
        await k.go_back(); await k.wait_for_timeout(1500)
        await open_thread(k, 'Hasith Ranaweera')
        mc = k.locator('.msg:has-text("Call the bank about the OD") .wcard.k-mini')
        await mc.locator('.check').click(); await k.wait_for_timeout(800)
        check(sql("select done_at is not null from task_minis where body = 'Call the bank about the OD'") == 't', 'he ticks the mini task right in the chat')

        # reminder to someone in the team chat, and "Remind me too"
        await open_thread(h, 'Team chat')
        await h.click('.composer textarea'); await h.keyboard.type('Timesheets by 4 pm @Ama'); await h.keyboard.press('Enter')
        await h.click('.composer button:has-text("Send as")'); await h.click('.composer-menu .menu-item:has-text("Reminder")')
        check(await h.locator('.msg-work select[aria-label="For"] option:checked').inner_text() == 'Amaya Fernando', 'in the team chat, Send as suggests the person @mentioned')
        await h.click('.msg-work button:has-text("Send")'); await h.wait_for_timeout(1500)
        check(sql("select p.full_name from task_reminders r join profiles p on p.id = r.user_id where body like 'Timesheets by 4 pm%'") == 'Amaya Fernando', 'a reminder set for Amaya')
        await open_thread(k, 'Team chat')
        rc = k.locator('.msg:has-text("Timesheets by 4 pm") .wcard.k-reminder')
        check('Reminder for Amaya' in await rc.inner_text(), 'everyone sees whom it is for, and when')
        await rc.locator('button:has-text("Remind me too")').click()
        t = await toast(k)
        check('Reminder set' in t and sql("select count(*) from task_reminders r join profiles p on p.id = r.user_id where p.full_name = 'Kasun Silva' and body like 'Timesheets by 4 pm%'") == '1',
              f'Kasun presses Remind me too ({t})')

        # =============== Make it a … ===============
        await k.wait_for_timeout(3000)
        await menu(k, k.locator('.msg:has-text("Bank rec due Friday")'), 'Make it a mini task')
        await k.wait_for_selector('.msg-work')
        check('(me)' in await k.locator('.msg-work select[aria-label="For"] option:checked').inner_text(), 'Make it a mini task: for himself')
        await k.click('.msg-work button:has-text("Make mini task")'); await k.wait_for_timeout(1500)
        check('You made this a mini task' in await k.locator('.msg:has-text("Bank rec due Friday")').inner_text(), 'the message shows he made it a mini task')
        check(sql("select count(*) from task_minis where body like 'Bank rec due Friday%' and user_id = (select id from profiles where full_name='Kasun Silva')") == '1', '…which is on his Today')
        await h.wait_for_timeout(4500)
        check('Kasun made this a mini task' in await h.locator('.msg:has-text("Bank rec due Friday")').inner_text(), 'Hasith sees that Kasun has taken it on')

        # =============== attach a task and a note ===============
        await open_thread(k, 'Amaya Fernando')
        await k.click('.composer .icon-btn[aria-label="Attach"]'); await k.click('.composer-menu .menu-item:has-text("Task")')
        await k.fill('.msg-pick input', 'Bank reconciliation'); await k.wait_for_timeout(300)
        await k.click('.msg-pick .pick-row:has-text("Bank reconciliation")')
        check('Bank reconciliation' in await k.locator('.composer-chips').inner_text(), 'Kasun attaches one of his tasks')
        await k.fill('.composer textarea', 'Still waiting on this one'); await k.click('.composer-send'); await k.wait_for_timeout(1200)
        await a.wait_for_timeout(4500)
        ac = a.locator('.msg:has-text("Still waiting on this one") .wcard.k-task')
        check(await ac.count() == 1 and 'Bank reconciliation' in await ac.inner_text(), 'Amaya sees the task card')
        await ac.click()
        check("Only people working on this task can open it" in await toast(a), "…but it's not hers, so it says she can't open it")

        sql("insert into notes_pages (owner_id, title) select id, 'Month-end checklist' from profiles where full_name = 'Hasith Ranaweera'")
        await open_thread(h, 'Kasun Silva')
        await h.click('.composer .icon-btn[aria-label="Attach"]'); await h.click('.composer-menu .menu-item:has-text("Note")')
        await h.click('.msg-pick .pick-row:has-text("Month-end checklist")')
        check('Let Kasun open it' in await h.locator('.msg-pick').inner_text(), 'attaching his private note offers to share it with Kasun')
        await h.click('.msg-pick button:has-text("Attach")'); await h.wait_for_timeout(600)
        await h.click('.composer-send'); await h.wait_for_timeout(1200)
        check(sql("select s.access from notes_shares s join notes_pages n on n.id = s.note_id join profiles p on p.id = s.user_id where n.title = 'Month-end checklist' and p.full_name = 'Kasun Silva'") == 'view',
              'shared with Kasun (view only)')
        await open_thread(k, 'Hasith Ranaweera')
        nc = k.locator('.wcard.k-note:has-text("Month-end checklist")')
        await nc.click(); await k.wait_for_timeout(2000)
        check('#/notes' in k.url and 'Month-end checklist' in await k.locator('.main').inner_text(), 'Kasun opens the note from the message')

        # =============== Ctrl+K search ===============
        await k.goto(BASE + '/#/tasks'); await k.wait_for_timeout(1200)
        await k.keyboard.press('Control+k'); await k.fill('.search-box input', 'Sampath'); await k.wait_for_timeout(1200)
        res = await k.locator('.search-box').inner_text()
        check('MESSAGES' in res.upper() and 'Chat with Amaya Fernando' in res and 'Sampath statement' in res, 'Ctrl+K finds words in his messages')
        await k.click('.search-hit:has-text("Chat with Amaya Fernando")'); await k.wait_for_timeout(1800)
        check('#/messages' in k.url and await k.locator('.msg.flash').count() >= 1, '…and opens the chat at that message')
        await h.keyboard.press('Control+k'); await h.fill('.search-box input', 'Sampath'); await h.wait_for_timeout(1200)
        check('Chat with' not in await h.locator('.search-box').inner_text(), "Hasith's search can't find words from their private chat")
        await h.keyboard.press('Escape')

        # =============== departments apart ===============
        pr = await page_for(b, 'priya@demo.lk')
        await pr.click('.chat-btn .icon-btn'); await pr.wait_for_timeout(1500)
        body = await pr.locator('.convo-body').inner_text()
        check('Bank rec' not in body and 'Month-end' not in body, "HR's team chat has none of Finance's messages")
        sql("delete from department_apps where app_key = 'messages' and department_id = (select id from departments where name = 'HR')")
        await pr.reload(); await pr.wait_for_timeout(1800)
        check(await pr.locator('.chat-btn').count() == 0, 'switched off for HR: no chat button there')

        # =============== phone ===============
        ph = await page_for(b, 'amaya@demo.lk', 390, 844)
        await ph.click('.chat-btn .icon-btn'); await ph.wait_for_timeout(1500)
        check(await ph.locator('.msg-side').is_visible() and not await ph.locator('.msg-pane').is_visible(), 'phone: the list first')
        await ph.click('.msg-thread[aria-label="Kasun Silva"]'); await ph.wait_for_timeout(1500)
        check(await ph.locator('.convo-back').is_visible() and await ph.locator('.composer textarea').is_visible(), 'phone: one chat at a time, with a back button')
        sw = await ph.evaluate('document.documentElement.scrollWidth')
        check(sw <= 392, f'phone: nothing sticks out sideways ({sw})')
        await ph.screenshot(path=os.path.join(OUT, 'r11-phone-chat.png'))
        await ph.click('.convo-back'); await ph.wait_for_timeout(600)
        check(await ph.locator('.msg-side').is_visible(), 'phone: back to the list')

        await h.goto(BASE + '/#/messages'); await h.wait_for_timeout(1500)
        await open_thread(h, 'Team chat')
        await h.screenshot(path=os.path.join(OUT, 'r11-team-chat.png'))
        await open_thread(h, 'Announcements')
        await h.screenshot(path=os.path.join(OUT, 'r11-announcements.png'))
        await open_thread(k, 'Amaya Fernando')
        await k.screenshot(path=os.path.join(OUT, 'r11-direct.png'))

        real = [e for e in errors if 'Failed to fetch' not in e]
        check(not real, f'no browser errors ({real[:3]})')
        await b.close()
    print(f'\n{sum(results)} passed, {len(results) - sum(results)} failed')
    raise SystemExit(0 if all(results) else 1)

asyncio.run(main())
