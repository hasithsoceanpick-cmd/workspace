import { useCallback, useEffect, useState } from 'react';
import { usePlatform } from '../../platform/store';
import { supabase, supabasePublicKey, supabaseUrl } from '../../supabase';
import { devicePushState, makePushKeys, turnOnPush, type DevicePush } from '../../platform/push';
import { fmtStamp } from '../../lib/dates';
import { firstName } from '../../lib/labels';
import Avatar from '../../platform/Avatar';

interface Status {
  configured: boolean;
  enabled: boolean;
  function_url: string | null;
  updated_at: string | null;
  pg_net: boolean;
  devices: { user_id: string; device: string; last_seen_at: string }[];
  recent: { at: string; messages: number; test: boolean; status: number | null; error: string | null; timed_out: boolean | null;
            result: { sent: number; gone: string[]; failed: { host: string; status: number; detail?: string }[] } | null }[];
}
interface TestResult { done: boolean; status?: number; error?: string; timed_out?: boolean; text?: string;
  result?: { sent: number; gone: string[]; failed: { host: string; status: number; detail?: string }[] } | null }

const FN_NAME = 'workspace-push';

/** What a send result means, in plain words (and what to do about it). */
function explain(r: { status?: number | null; error?: string | null; timed_out?: boolean | null; result?: TestResult['result'] }):
  { tone: 'good' | 'warn' | 'bad'; text: string } {
  if (r.timed_out) return { tone: 'bad', text: 'Supabase didn\'t answer in time. Try again in a minute.' };
  if (r.error) return { tone: 'bad', text: `Couldn't reach the sender: ${r.error}` };
  if (r.status === 401 || r.status === 403) return { tone: 'bad', text: `Supabase blocked the call. Open Edge Functions → ${FN_NAME} → Details and turn OFF "Verify JWT", save, then test again.` };
  if (r.status === 404) return { tone: 'bad', text: `The sender isn't there yet. Check it's deployed and named exactly ${FN_NAME}.` };
  if (r.status && r.status >= 500) return { tone: 'bad', text: `The sender had a problem (error ${r.status}). Check it was pasted in full, then deploy again.` };
  if (r.result) {
    const { sent, gone, failed } = r.result;
    if (failed.length) {
      const f = failed[0];
      return { tone: sent ? 'warn' : 'bad', text: `${sent} sent. ${failed.length} refused by ${f.host} (${f.status}${f.detail ? `: ${f.detail}` : ''}). On that device, turn Phone alerts off and on again.` };
    }
    if (gone.length && !sent) return { tone: 'warn', text: 'That device has switched alerts off or removed the app. Turn Phone alerts on again on it.' };
    return { tone: 'good', text: `Sent to ${sent} device${sent === 1 ? '' : 's'}${gone.length ? ` (${gone.length} old one${gone.length === 1 ? '' : 's'} removed)` : ''}.` };
  }
  return { tone: 'warn', text: r.status ? `Answer ${r.status}` : 'Waiting…' };
}

export default function PushPage() {
  const { me, profiles, toast, fail } = usePlatform();
  const [st, setSt] = useState<Status | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<{ text: string; tone: string } | null>(null);
  const [here, setHere] = useState<DevicePush | null>(null);
  const [confirmKeys, setConfirmKeys] = useState(false);
  const fnUrl = `${supabaseUrl}/functions/v1/${FN_NAME}`;

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('workspace_push_status');
    if (error) {
      if (/does not exist|Could not find/i.test(error.message)) setMissing(true); else fail(error);
      return;
    }
    setSt(data as Status);
  }, [fail]);

  useEffect(() => {
    load();
    devicePushState().then(setHere).catch(() => setHere('unsupported'));
  }, [load]);

  async function copyCode() {
    try {
      const code = (await import('../../../supabase/functions/workspace-push/index.ts?raw')).default;
      await navigator.clipboard.writeText(code);
      toast('Sender code copied — paste it into the Supabase editor');
    } catch (e) { fail(e); }
  }
  async function copy(text: string, what: string) {
    try { await navigator.clipboard.writeText(text); toast(`${what} copied`); } catch (e) { fail(e); }
  }

  async function setUp() {
    setBusy(true);
    try {
      const keys = await makePushKeys();
      const subject = location.protocol === 'https:' ? location.origin : `mailto:${me.email}`;
      const { error } = await supabase.rpc('workspace_push_setup', {
        p_url: fnUrl, p_public: keys.publicKey, p_private: keys.privateKey, p_subject: subject, p_api_key: supabasePublicKey,
      });
      if (error) throw error;
      toast(st?.configured ? 'New keys made — devices re-join by themselves' : 'Phone alerts are switched on');
      setConfirmKeys(false);
      await load();
    } catch (e) { fail(e); }
    setBusy(false);
  }

  async function enable(on: boolean) {
    const { error } = await supabase.rpc('workspace_push_enable', { p_on: on });
    if (error) return fail(error);
    toast(on ? 'Phone alerts resumed' : 'Phone alerts paused for everyone');
    load();
  }

  async function thisDevice() {
    setBusy(true);
    try {
      const problem = await turnOnPush();
      if (problem) toast(problem, 'error'); else toast('Phone alerts are on for this device');
    } catch (e) { fail(e); }
    setHere(await devicePushState().catch(() => 'unsupported' as const));
    setBusy(false);
    load();
  }

  async function sendTest() {
    setTest({ text: 'Sending…', tone: 'warn' });
    const { data: id, error } = await supabase.rpc('workspace_push_test');
    if (error) { setTest({ text: error.message, tone: 'bad' }); return; }
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const { data } = await supabase.rpc('workspace_push_result', { p_request: id });
      const r = data as TestResult | null;
      if (r?.done) {
        const e = explain(r);
        setTest({ text: e.tone === 'good' ? `${e.text} Check your phone.` : e.text, tone: e.tone });
        load();
        return;
      }
    }
    setTest({ text: 'No answer yet. pg_net may be off (Database → Extensions → pg_net), or Supabase is busy — try again.', tone: 'bad' });
  }

  if (missing) {
    return (
      <div className="page">
        <h1>Phone alerts</h1>
        <div className="card">Run <strong>update 4</strong> in Supabase first (the copy-paste SQL page, step U4), then come back here.</div>
      </div>
    );
  }
  if (!st) return <div className="page"><div className="empty">Loading…</div></div>;

  const byPerson = new Map<string, Status['devices']>();
  for (const d of st.devices) byPerson.set(d.user_id, [...(byPerson.get(d.user_id) ?? []), d]);
  const people = profiles.filter(p => p.active && p.department_id);
  const without = people.filter(p => !byPerson.has(p.id));

  return (
    <div className="page push-page">
      <div className="page-head">
        <div>
          <h1>Phone alerts</h1>
          <div className="muted">Whatever lands in someone's bell also pops up on their phone — once they turn it on in their account menu.</div>
        </div>
        {st.configured && (
          <span className={`pill ${st.enabled ? 'on-pill' : ''}`}>{st.enabled ? 'On' : 'Paused'}</span>
        )}
      </div>

      {!st.pg_net && (
        <div className="card warn-card">
          <strong>One switch is off in Supabase.</strong> Open <em>Database → Extensions</em>, search <strong>pg_net</strong> and switch it on.
        </div>
      )}

      {!st.configured ? (
        <div className="card setup-steps">
          <h2>Set up (about 5 minutes, once)</h2>
          <ol>
            <li>
              <strong>Add the sender to Supabase.</strong> In Supabase open <em>Edge Functions</em> → <em>Deploy a new function</em> → <em>Via Editor</em>.
              Name it <code>{FN_NAME}</code>, delete the sample code, paste the sender code, and press <em>Deploy</em>.
              <div className="row gap wrap">
                <button className="btn sm" onClick={copyCode}>Copy sender code</button>
                <button className="btn sm" onClick={() => copy(FN_NAME, 'Name')}>Copy name</button>
              </div>
            </li>
            <li>
              <strong>Let the database call it.</strong> On the function's page open <em>Details</em>, turn <strong>OFF</strong> "Verify JWT"
              (it may be called "Enforce JWT verification") and save.
            </li>
            <li>
              <strong>Switch phone alerts on.</strong> This makes the keys that sign every alert and saves them in your database.
              <div><button className="btn primary sm" disabled={busy} onClick={setUp}>{busy ? 'Working…' : 'Turn on phone alerts'}</button></div>
            </li>
          </ol>
          <div className="muted small">Sender address: <code>{fnUrl}</code></div>
        </div>
      ) : (
        <div className="card">
          <h2>Test it</h2>
          <p className="muted small">Turn alerts on for this device first, then send yourself a test.</p>
          <div className="row gap wrap">
            <button className="btn sm" disabled={busy || here === 'on'} onClick={thisDevice}>
              {here === 'on' ? 'This device: alerts on' : here === 'needs-install' ? 'Install the app first (see your account menu)' : 'Turn on for this device'}
            </button>
            <button className="btn primary sm" onClick={sendTest}>Send a test to my devices</button>
          </div>
          {test && <div className={`push-result ${test.tone}`}>{test.text}</div>}
          <div className="row gap wrap push-actions">
            {st.enabled
              ? <button className="btn sm" onClick={() => enable(false)}>Pause for everyone</button>
              : <button className="btn primary sm" onClick={() => enable(true)}>Resume</button>}
            {confirmKeys ? (
              <>
                <span className="small">Everyone's devices re-join by themselves the next time they open Workspace.</span>
                <button className="btn danger sm" disabled={busy} onClick={setUp}>Make new keys</button>
                <button className="btn sm" onClick={() => setConfirmKeys(false)}>Cancel</button>
              </>
            ) : (
              <button className="btn sm" onClick={() => setConfirmKeys(true)}>Make new keys…</button>
            )}
            <button className="btn sm" onClick={copyCode}>Copy sender code</button>
          </div>
          <div className="muted small">Sender: <code>{st.function_url}</code>{st.updated_at && <> · set up {fmtStamp(st.updated_at)}</>}</div>
        </div>
      )}

      {st.configured && (
        <>
          <div className="card">
            <h2>Who has alerts on <span className="count">{byPerson.size}</span></h2>
            {byPerson.size === 0 ? (
              <div className="muted small">Nobody yet. Ask the team to open Workspace on their phone, tap their picture (top right) → <em>Phone alerts on this device</em>.</div>
            ) : (
              <ul className="push-people">
                {[...byPerson.entries()].map(([uid, ds]) => {
                  const p = profiles.find(x => x.id === uid);
                  return (
                    <li key={uid}>
                      <Avatar p={p} size={24} />
                      <span className="grow">{p?.full_name ?? 'Former member'}</span>
                      <span className="muted small">{ds.map(d => d.device || 'Device').join(', ')}</span>
                    </li>
                  );
                })}
              </ul>
            )}
            {without.length > 0 && byPerson.size > 0 && (
              <div className="muted small">Not on yet: {without.map(p => firstName(p.full_name)).join(', ')}</div>
            )}
          </div>

          {st.recent.length > 0 && (
            <div className="card">
              <h2>Recent sends</h2>
              <ul className="push-log">
                {st.recent.map((r, i) => {
                  const e = r.status === null && !r.error ? { tone: 'warn', text: 'Waiting for an answer…' } : explain(r);
                  return (
                    <li key={i} className={e.tone}>
                      <span className="muted small">{fmtStamp(r.at)}</span>
                      <span>{r.test ? 'Test' : `${r.messages} alert${r.messages === 1 ? '' : 's'}`}</span>
                      <span className="grow">{e.text}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
