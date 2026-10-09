import { useEffect, useRef, useState } from 'react';
import { usePlatform } from './store';
import { niceError, supabase } from '../supabase';
import { roleLabel } from '../lib/labels';
import Avatar from './Avatar';
import { useInstall } from './pwa';
import { devicePushState, forgetDeviceOnSignOut, turnOffPush, turnOnPush, type DevicePush } from './push';

export default function UserMenu() {
  const { me, isAdmin, dept, toast, fail, reload } = usePlatform();
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<'name' | 'password' | null>(null);
  const [help, setHelp] = useState<'install' | null>(null);
  const [push, setPush] = useState<DevicePush | null>(null);
  const [busy, setBusy] = useState(false);
  const install = useInstall();
  const [value, setValue] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) { setOpen(false); setEdit(null); setHelp(null); } };
    document.addEventListener('mousedown', close);
    devicePushState().then(setPush).catch(() => setPush('unsupported'));
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  async function installApp() {
    if (install.canPrompt) {
      if (await install.install()) toast('Workspace is installed');
      return;
    }
    setHelp('install');
  }

  async function togglePush() {
    if (push === 'needs-install') return setHelp('install');
    setBusy(true);
    try {
      if (push === 'on') {
        await turnOffPush();
        toast('Phone alerts are off on this device');
      } else {
        const problem = await turnOnPush();
        if (problem) toast(problem, 'error');
        else toast('Phone alerts are on for this device');
      }
    } catch (e) {
      fail(e);
    } finally {
      setPush(await devicePushState().catch(() => 'unsupported' as const));
      setBusy(false);
    }
  }

  async function signOut() {
    await forgetDeviceOnSignOut();     // the next person on this device won't get your alerts
    await supabase.auth.signOut();
  }

  const pushLabel = push === 'on' ? 'On' : push === 'blocked' ? 'Blocked' : push === 'unsupported' ? 'Not available'
    : push === 'needs-install' ? 'Install first' : push === 'off' ? 'Off' : '…';

  async function save() {
    if (edit === 'name') {
      if (!value.trim()) return;
      const { error } = await supabase.from('profiles').update({ full_name: value.trim() }).eq('id', me.id);
      if (error) return fail(error);
      await reload();
      toast('Name updated');
    } else if (edit === 'password') {
      if (value.length < 6) return toast('Password must be at least 6 characters.', 'error');
      const { error } = await supabase.auth.updateUser({ password: value });
      if (error) return toast(niceError(error), 'error');
      toast('Password changed');
    }
    setEdit(null);
    setValue('');
  }

  return (
    <div className="usermenu" ref={ref}>
      <button className="icon-btn" onClick={() => setOpen(o => !o)} aria-label="Account">
        <Avatar p={me} size={28} />
      </button>
      {open && (
        <div className="popover user-pop">
          <div className="user-head">
            <Avatar p={me} size={36} />
            <div>
              <div className="strong">{me.full_name}</div>
              <div className="muted small">
                {isAdmin ? 'Administrator' : roleLabel(me.role)}{dept && !isAdmin ? ` · ${dept.name}` : ''}
              </div>
              <div className="muted tiny">{me.email}</div>
            </div>
          </div>
          {help === 'install' ? (
            <div className="install-help">
              <div className="strong">Install Workspace</div>
              {install.ios ? (
                <ol>
                  <li>Open this page in <strong>Safari</strong>.</li>
                  <li>Tap the <strong>Share</strong> button (the square with an arrow).</li>
                  <li>Choose <strong>Add to Home Screen</strong>, then <strong>Add</strong>.</li>
                  <li>Open Workspace from your Home Screen, then turn on <strong>Phone alerts</strong> here.</li>
                </ol>
              ) : /android/i.test(navigator.userAgent) ? (
                <ol>
                  <li>Open the browser menu <strong>⋮</strong> (top right).</li>
                  <li>Tap <strong>Install app</strong> or <strong>Add to Home screen</strong>.</li>
                </ol>
              ) : (
                <ol>
                  <li>In <strong>Chrome</strong> or <strong>Edge</strong>, click the install icon at the right end of the address bar.</li>
                  <li>Or open the browser menu and choose <strong>Install Workspace</strong>.</li>
                </ol>
              )}
              <button className="btn sm" onClick={() => setHelp(null)}>Back</button>
            </div>
          ) : edit ? (
            <form className="user-edit" onSubmit={e => { e.preventDefault(); save(); }}>
              <input
                autoFocus
                type={edit === 'password' ? 'password' : 'text'}
                placeholder={edit === 'password' ? 'New password' : 'Your name'}
                value={value}
                onChange={e => setValue(e.target.value)}
              />
              <div className="row gap">
                <button className="btn primary sm">Save</button>
                <button type="button" className="btn sm" onClick={() => setEdit(null)}>Cancel</button>
              </div>
            </form>
          ) : (
            <div className="menu-list">
              <button onClick={() => { setEdit('name'); setValue(me.full_name); }}>Change name</button>
              <button onClick={() => { setEdit('password'); setValue(''); }}>Change password</button>
              {!install.installed && <button onClick={installApp}>Install app</button>}
              <button className="menu-toggle" onClick={togglePush} disabled={busy || push === null}>
                <span>Phone alerts on this device</span>
                <span className={`toggle-state ${push === 'on' ? 'on' : ''}`}>{busy ? '…' : pushLabel}</span>
              </button>
              <button onClick={signOut}>Sign out</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
