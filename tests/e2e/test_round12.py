import os
_HERE = os.path.dirname(os.path.abspath(__file__))
os.makedirs(os.path.join(_HERE, 'shots'), exist_ok=True)
# Browser tests for round 12: the focus timer (Pomodoro) in the top bar — adjustable lengths, a task to work on,
# focus → break → focus → long break, pause, stop early, "ended while you were away", the pop-up, My output (own and
# the manager's view), phone layout — and reminders: Change (words, date, time), Snooze → Pick date & time, and
# changing a reminder you set for someone else.
import asyncio, json, subprocess, time
from playwright.async_api import async_playwright

BASE = os.environ.get('APP_URL', 'http://localhost:4173')
DB = os.environ.get('DATABASE_URL', 'postgres://postgres@127.0.0.1:54322/postgres')
OUT = os.path.join(_HERE, 'shots')
results, errors = [], []
def check(c, m): c = bool(c); results.append(c); print(('PASS ' if c else 'FAIL ') + m, flush=True)
def sql(q): return subprocess.run(['psql', DB, '-At', '-c', q], capture_output=True, text=True).stdout.strip()
def housekeeping(q): return sql(f"do $$ begin perform set_config('app.system','on',true); {q}; perform set_config('app.system','off',true); end $$")
def uid(name): return sql(f"select id from profiles where full_name = '{name}'")

async def page_for(b, email, w=1360, h=860, clock=False):
    ctx = await b.new_context(viewport={'width': w, 'height': h}, timezone_id='Asia/Colombo')
    pg = await ctx.new_page()
    if clock: await pg.clock.install()
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

async def pop(pg):
    if await pg.locator('.focus-pop').count() == 0:
        await pg.click('.focus-btn > .icon-btn'); await pg.wait_for_timeout(500)

async def set_num(pg, label, v):
    box = pg.locator(f'.focus-pop input[aria-label="{label}"]')
    await box.fill(str(v)); await box.press('Enter'); await pg.wait_for_timeout(250)

def kasun_focus(): return sql("select count(*)||'/'||coalesce(sum(minutes),0)||'/'||coalesce(sum(completed::int),0) from task_focus f join profiles p on p.id=f.user_id where p.full_name='Kasun Silva'")

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        k = await page_for(b, 'kasun@demo.lk', clock=True)

        # =============== the button and the panel ===============
        btns = await k.locator('.topbar-right > div').evaluate_all('els => els.map(e => e.className)')
        check(any('focus-btn' in c for c in btns), f'a focus timer sits in the top bar ({btns})')
        await pop(k)
        check(await k.locator('.focus-big').inner_text() == '25:00', 'it starts at 25:00 (the usual Pomodoro)')
        tabs = await k.locator('.focus-phases .seg-btn').all_inner_texts()
        check(tabs == ['Focus', 'Short break', 'Long break'], f'focus, short break, long break ({tabs})')
        opts = await k.locator('.focus-pop select[aria-label="Working on"] option').all_inner_texts()
        check(opts[0] == 'No particular task' and 'Bank reconciliation — Commercial Bank' in opts and 'Board pack — management accounts' not in opts,
              'he can pick one of his own open tasks to work on')

        # lengths
        await k.click('.focus-pop .pop-head .link:has-text("Lengths")')
        await k.click('.focus-presets .chip-btn:has-text("50 / 10")'); await k.wait_for_timeout(400)
        check(sql("select focus_min||'/'||short_min||'/'||long_min from task_focus_settings s join profiles p on p.id=s.user_id where p.full_name='Kasun Silva'") == '50/10/20',
              'one tap on 50 / 10 saves 50 / 10 / 20')
        await set_num(k, 'Focus (min)', 1); await set_num(k, 'Short break (min)', 1); await set_num(k, 'Long break (min)', 2)
        await set_num(k, 'Long break after (focus slots)', 2)
        check(sql("select focus_min||'/'||short_min||'/'||long_min||'/'||rounds from task_focus_settings s join profiles p on p.id=s.user_id where p.full_name='Kasun Silva'") == '1/1/2/2',
              'any length can be typed in (saved for him on every device)')
        await set_num(k, 'Focus (min)', 500)
        check(await k.locator('.focus-pop input[aria-label="Focus (min)"]').input_value() == '1', 'silly lengths are refused')
        await k.click('.focus-pop .pop-head .link:has-text("Done")')
        check(await k.locator('.focus-big').inner_text() == '1:00', 'the clock shows the new length')

        # =============== focus → break ===============
        await k.select_option('.focus-pop select[aria-label="Working on"]', label='Bank reconciliation — Commercial Bank')
        await k.click('.focus-acts button:has-text("Start focus")'); await k.wait_for_timeout(1200)
        live = k.locator('.focus-btn > .icon-btn')
        check('focus-live' in await live.get_attribute('class') and ':' in await live.inner_text(), f'the button turns into a running clock ({await live.inner_text()})')
        check((await k.title()).startswith('▶ '), f'the countdown shows in the browser tab too ({await k.title()})')
        check('Focus 1 of 2' in await k.locator('.focus-sub').inner_text() and 'Bank reconciliation' in await k.locator('.focus-sub').inner_text(), 'Focus 1 of 2, on the bank rec')
        await k.mouse.click(700, 600)   # close the panel; the timer keeps going
        await k.goto(BASE + '/#/notes'); await k.wait_for_timeout(300)
        await k.goto(BASE + '/#/tasks/list'); await k.wait_for_timeout(500)
        check('focus-live' in await live.get_attribute('class'), 'it keeps running while he moves around the app')
        await k.clock.fast_forward('01:02'); await k.wait_for_timeout(1500)
        al = k.locator('.focus-alert')
        check(await al.count() == 1 and 'Focus done — 1m on “Bank reconciliation — Commercial Bank”' in await al.inner_text() and '1-minute break' in await al.inner_text(),
              'when time is up a pop-up says so and offers the break')
        check(kasun_focus() == '1/1/1' and sql("select t.title from task_focus f join tasks t on t.id=f.task_id") == 'Bank reconciliation — Commercial Bank',
              'the finished focus is recorded against the task')
        await al.locator('button:has-text("Start break")').click(); await k.wait_for_timeout(600)
        check('brk' in await live.get_attribute('class'), 'the break runs (green)')
        await k.clock.fast_forward('01:02'); await k.wait_for_timeout(1500)
        check("Break's over" in await al.inner_text(), "then: break's over")
        await al.locator('button:has-text("Start focus")').click(); await k.wait_for_timeout(600)
        await pop(k)
        check('Focus 2 of 2' in await k.locator('.focus-sub').inner_text(), 'Focus 2 of 2')
        await k.click('.focus-acts button:has-text("Pause")'); await k.wait_for_timeout(300)
        t1 = await k.locator('.focus-big').inner_text()
        await k.clock.fast_forward('00:20'); await k.wait_for_timeout(600)
        check(await k.locator('.focus-big').inner_text() == t1 and 'paused' in await live.get_attribute('class'), f'pause holds the clock ({t1})')
        await k.click('.focus-acts button:has-text("Resume")')
        await k.clock.fast_forward('01:05'); await k.wait_for_timeout(1500)
        check('long break (2 min)' in await al.inner_text(), 'after 2 focus slots it offers the long break')
        await al.locator('button:has-text("Later")').click(); await k.wait_for_timeout(300)
        check(await al.count() == 0 and 'on' in (await k.locator('.focus-phases .seg-btn:has-text("Long break")').get_attribute('class')),
              '"Later" closes the pop-up; the long break waits in the panel')
        check(kasun_focus() == '2/2/2', f'two finished focus slots recorded ({kasun_focus()})')

        # stop early: minutes done still count
        await k.click('.focus-pop .pop-head .link:has-text("Lengths")'); await set_num(k, 'Focus (min)', 5); await k.click('.focus-pop .pop-head .link:has-text("Done")')
        await k.click('.focus-phases .seg-btn:has-text("Focus")')
        await k.select_option('.focus-pop select[aria-label="Working on"]', label='No particular task')
        await k.click('.focus-acts button:has-text("Start focus")')
        await k.clock.fast_forward('02:10'); await k.wait_for_timeout(400)
        await k.click('.focus-acts button:has-text("Stop")'); await k.wait_for_timeout(1200)
        check(sql("select minutes||'/'||completed||'/'||planned_min||'/'||(task_id is null) from task_focus order by id desc limit 1") in ('1/false/5/true', '2/false/5/true'),
              f'stopped early: the minutes done are kept, marked not finished ({sql("select minutes, completed from task_focus order by id desc limit 1")})')
        check(await k.locator('.focus-big').inner_text() == '5:00' and 'focus-live' not in await live.get_attribute('class'), 'and the timer resets')
        check('3 focus sessions' in await k.locator('.focus-today').inner_text(), f'the panel counts today ({await k.locator(".focus-today").inner_text()})')
        await k.screenshot(path=os.path.join(OUT, 'r12-focus-panel.png'))

        # =============== ended while the app was closed ===============
        a = await page_for(b, 'amaya@demo.lk')
        now = int(time.time() * 1000)
        st = {'phase': 'focus', 'status': 'running', 'endsAt': now - 10 * 60_000, 'leftMs': 0, 'startedAt': now - 35 * 60_000, 'focusedMs': 0,
              'runFrom': now - 35 * 60_000, 'done': 0, 'plannedMin': 25, 'taskId': None, 'taskTitle': '',
              'settings': {'focus_min': 25, 'short_min': 5, 'long_min': 15, 'rounds': 4, 'sound': True}, 'ended': None}
        await a.evaluate('([k, v]) => localStorage.setItem(k, v)', [f'workspace.focus.v1.{uid("Amaya Fernando")}', json.dumps(st)])
        await a.reload(); await a.wait_for_timeout(2500)
        check('while you were away' in await a.locator('.focus-alert').inner_text(), 'a focus that ended while the app was closed pops up when she comes back')
        check(sql("select minutes||'/'||completed from task_focus f join profiles p on p.id=f.user_id where p.full_name='Amaya Fernando'") == '25/true', '…and is recorded')
        await a.click('.focus-alert button:has-text("Later")')

        # =============== My output ===============
        await k.goto(BASE + '/#/tasks/output'); await k.wait_for_timeout(1500)
        tile = await k.locator('.out-tile.focus').inner_text()
        sec = k.locator('.out-section:has(h2:has-text("Focus time"))')
        st_txt = await sec.inner_text()
        check('focus time' in tile and ('3m' in tile or '4m' in tile), f'My output has a focus-time tile ({tile.split()})')
        check('3 sessions' in st_txt and 'Bank reconciliation — Commercial Bank · 2m' in st_txt and 'stopped early' in st_txt, 'and a Focus time section: per task, each session, stopped early marked')
        h = await page_for(b, 'hasith@demo.lk')
        await h.goto(BASE + f'/#/tasks/output?who={uid("Kasun Silva")}'); await h.wait_for_timeout(1800)
        check('3 sessions' in await h.locator('.out-section:has(h2:has-text("Focus time"))').inner_text(), "Hasith sees Kasun's focus time on his My output")
        check(await h.locator('.out-section:has(h2:has-text("Focus time")) .mini-act.x').count() == 0, "…but can't remove it")
        await k.locator('.out-section:has(h2:has-text("Focus time")) .out-row:has-text("stopped early") .mini-act.x').click(); await k.wait_for_timeout(800)
        check(kasun_focus().startswith('2/'), 'Kasun can remove a mistaken session from today')
        await k.screenshot(path=os.path.join(OUT, 'r12-my-output.png'), full_page=True)

        # =============== reminders: Change (words, date, time) ===============
        await k.click('.rem-btn .icon-btn'); await k.wait_for_timeout(300)
        await k.fill('.rem-pop .rem-text', 'Call Sampath')
        await k.click('.rem-pop .chip-btn:has-text("Tomorrow 9 am")')
        await k.click('.rem-pop button:has-text("Set reminder")'); await k.wait_for_timeout(800)
        item = k.locator('.rem-pop .rem-item:has-text("Call Sampath")')
        await item.locator('button:has-text("Change")').click(); await k.wait_for_timeout(300)
        ed = k.locator('.rem-pop .rem-edit')
        check(await ed.locator('input[type=date]').count() == 1 and await ed.locator('input[type=time]').count() == 1, 'Change shows the words, a date and a time')
        d2 = sql("select (public.app_today() + 2)::text")
        await ed.locator('.rem-text').fill('Call Sampath about the limits')
        await ed.locator('input[type=date]').fill(d2); await ed.locator('input[type=time]').fill('14:30')
        await ed.locator('button:has-text("Save")').click()
        t = await toast(k)
        got = sql("select body||'|'||to_char(remind_at at time zone 'Asia/Colombo', 'YYYY-MM-DD HH24:MI') from task_reminders where body like 'Call Sampath%'")
        check(got == f'Call Sampath about the limits|{d2} 14:30', f'saved: new words, the chosen date and time ({got}; {t})')
        await k.keyboard.press('Escape')

        # due → Snooze → Pick date & time
        housekeeping("update task_reminders set remind_at = now() - interval '2 minutes', sent_at = now() where body like 'Call Sampath%'")
        a2 = await page_for(b, 'kasun@demo.lk')
        await a2.goto(BASE + '/#/tasks/reminders'); await a2.wait_for_timeout(1500)
        it = a2.locator('.rem-item:has-text("Call Sampath about the limits")')
        await it.locator('button:has-text("Snooze")').click()
        opts = await it.locator('.rem-actions button').all_inner_texts()
        check('Pick date & time…' in opts and '10 min' in opts, f'Snooze now also offers Pick date & time ({opts})')
        await it.locator('button:has-text("Pick date & time")').click()
        await it.locator('input[type=time]').fill('00:01'); await it.locator('input[type=date]').fill(sql("select public.app_today()::text"))
        await it.locator('button:has-text("Save")').click()
        check('later than now' in await toast(a2), 'a time already gone is refused')
        d3 = sql("select (public.app_today() + 3)::text")
        await it.locator('input[type=date]').fill(d3); await it.locator('input[type=time]').fill('09:15')
        await it.locator('button:has-text("Save")').click(); await a2.wait_for_timeout(900)
        got = sql("select to_char(remind_at at time zone 'Asia/Colombo', 'YYYY-MM-DD HH24:MI')||'|'||(sent_at is null) from task_reminders where body like 'Call Sampath%'")
        check(got == f'{d3} 09:15|true', f'snoozed to the exact date and time picked (it will alert again) ({got})')

        # a reminder Hasith set for Kasun: Hasith can change it
        await h.click('.rem-btn .icon-btn'); await h.wait_for_timeout(300)
        await h.fill('.rem-pop .rem-text', 'Send the bank confirmations')
        await h.locator('.rem-pop select[aria-label="For"]').select_option(label='For Kasun Silva')
        await h.click('.rem-pop button:has-text("Set reminder")'); await h.wait_for_timeout(800)
        await h.goto(BASE + '/#/tasks/reminders'); await h.wait_for_timeout(1500)
        hi = h.locator('.rem-item:has-text("Send the bank confirmations")')
        check(await hi.locator('button:has-text("Change")').count() == 1 and await hi.locator('button:has-text("Done")').count() == 0,
              'Hasith can Change the reminder he set for Kasun (only Kasun ticks it done)')
        await hi.locator('button:has-text("Change")').click()
        await hi.locator('input[type=date]').fill(d2); await hi.locator('input[type=time]').fill('11:00')
        await hi.locator('button:has-text("Save")').click(); await h.wait_for_timeout(900)
        check(sql("select to_char(remind_at at time zone 'Asia/Colombo', 'YYYY-MM-DD HH24:MI') from task_reminders where body = 'Send the bank confirmations'") == f'{d2} 11:00',
              'moved to the date and time he picked')
        await a2.reload(); await a2.wait_for_timeout(2000)
        ki = a2.locator('.rem-item:has-text("Send the bank confirmations")')
        check(await ki.count() == 1 and '11:00' in await ki.inner_text() and await ki.locator('button:has-text("Change")').count() == 1, 'Kasun sees the new time (and can change it too)')
        await a2.screenshot(path=os.path.join(OUT, 'r12-reminders.png'))

        # =============== phone ===============
        ph = await page_for(b, 'amaya@demo.lk', 390, 844)
        await ph.click('.focus-btn > .icon-btn'); await ph.wait_for_timeout(500)
        box = await ph.locator('.focus-pop').bounding_box()
        check(box and box['x'] >= 0 and box['x'] + box['width'] <= 390, 'phone: the timer panel fits the screen')
        await ph.click('.focus-acts button:has-text("Start focus")'); await ph.wait_for_timeout(1200)
        await ph.mouse.click(200, 700)
        sw = await ph.evaluate('document.documentElement.scrollWidth')
        check(sw <= 392 and 'focus-live' in await ph.locator('.focus-btn > .icon-btn').get_attribute('class'), f'phone: the running clock fits in the top bar ({sw})')
        await ph.screenshot(path=os.path.join(OUT, 'r12-phone.png'))
        await ph.click('.focus-btn > .icon-btn'); await ph.click('.focus-acts button:has-text("Stop")')

        real = [e for e in errors if 'Failed to fetch' not in e]
        check(not real, f'no browser errors ({real[:3]})')
        await b.close()
    print(f'\n{sum(results)} passed, {len(results) - sum(results)} failed')
    raise SystemExit(0 if all(results) else 1)

asyncio.run(main())
