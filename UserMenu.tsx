import { useEffect, useRef, useState } from 'react';
import { usePlatform } from './store';
import { niceError, supabase } from '../supabase';
import { roleLabel } from '../lib/labels';
import Avatar from './Avatar';

export default function UserMenu() {
  const { me, isAdmin, dept, toast, fail, reload } = usePlatform();
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<'name' | 'password' | null>(null);
  const [value, setValue] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) { setOpen(false); setEdit(null); } };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

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
          {edit ? (
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
              <button onClick={() => supabase.auth.signOut()}>Sign out</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
