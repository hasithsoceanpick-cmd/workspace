import { useEffect, useState } from 'react';
import { supabase } from '../../supabase';
import Avatar from '../../platform/Avatar';
import { useNotesApp } from './store';
import { NOTE_COLS, untitled, type Access, type NoteRow, type NoteShare, type ShareScope } from './types';

/** Short label for a page's sharing, as the current person sees it */
export function shareLabel(root: NoteRow, shares: NoteShare[], meId: string, access: Access | null) {
  if (root.share_scope === 'department') return `🏢 Department · ${root.dept_access === 'edit' ? 'can edit' : 'can view'}`;
  if (root.share_scope === 'people') {
    const n = shares.filter(s => s.note_id === root.id).length;
    if (root.owner_id !== meId && access) return `👥 Shared with you · ${access === 'edit' ? 'can edit' : 'can view'}`;
    return `👥 ${n} ${n === 1 ? 'person' : 'people'}`;
  }
  return '🔒 Private';
}

export default function ShareDialog({ note, onClose }: { note: NoteRow; onClose: () => void }) {
  const { me, deptPeople, userHasApp, person, shares, refresh, patchLocal, fail, toast, dept } = useNotesApp();
  const [scope, setScope] = useState<ShareScope>(note.share_scope);
  const [deptAccess, setDeptAccess] = useState<Access>(note.dept_access);
  const list = shares.filter(s => s.note_id === note.id);
  const candidates = deptPeople.filter(p => p.id !== me.id && userHasApp(p.id, 'notes') && !list.some(s => s.user_id === p.id));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function saveScope(s: ShareScope, a: Access = deptAccess) {
    setScope(s); setDeptAccess(a);
    const { data, error } = await supabase.from('notes_pages').update({ share_scope: s, dept_access: a }).eq('id', note.id).select(NOTE_COLS).maybeSingle();
    if (error || !data) { fail(error ?? new Error('Only the owner can change sharing.')); setScope(note.share_scope); setDeptAccess(note.dept_access); return; }
    patchLocal(note.id, data as NoteRow);
  }

  async function addPerson(userId: string) {
    if (!userId) return;
    const { error } = await supabase.from('notes_shares').insert({ note_id: note.id, user_id: userId, access: 'view' });
    if (error) return fail(error);
    if (scope !== 'people') await saveScope('people');
    await refresh();
    toast(`Shared with ${person(userId)?.full_name ?? 'them'}`);
  }
  async function setAccess(s: NoteShare, access: Access) {
    const { error } = await supabase.from('notes_shares').update({ access }).eq('note_id', s.note_id).eq('user_id', s.user_id);
    if (error) return fail(error);
    refresh();
  }
  async function removePerson(s: NoteShare) {
    const { error } = await supabase.from('notes_shares').delete().eq('note_id', s.note_id).eq('user_id', s.user_id);
    if (error) return fail(error);
    refresh();
  }

  return (
    <>
      <div className="modal-backdrop" onClick={onClose} />
      <div className="modal" role="dialog" aria-label="Share page">
        <div className="modal-head">
          <strong>Share “{untitled(note.title)}”</strong>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">
          <p className="muted small">Sub-pages are shared the same way as this page.</p>

          <label className={`share-opt ${scope === 'private' ? 'on' : ''}`}>
            <input type="radio" name="scope" checked={scope === 'private'} onChange={() => saveScope('private')} />
            <span><strong>🔒 Private</strong><span className="muted small">Only you.</span></span>
          </label>

          <label className={`share-opt ${scope === 'department' ? 'on' : ''}`}>
            <input type="radio" name="scope" checked={scope === 'department'} onChange={() => saveScope('department')} />
            <span><strong>🏢 Whole department</strong><span className="muted small">Everyone in {dept?.name} who uses Notes.</span></span>
            {scope === 'department' && (
              <select value={deptAccess} onChange={e => saveScope('department', e.target.value as Access)} aria-label="Department access">
                <option value="view">Can view</option>
                <option value="edit">Can edit</option>
              </select>
            )}
          </label>

          <label className={`share-opt ${scope === 'people' ? 'on' : ''}`}>
            <input type="radio" name="scope" checked={scope === 'people'} onChange={() => saveScope('people')} />
            <span><strong>👥 Selected people</strong><span className="muted small">Only the people you choose.</span></span>
          </label>

          {scope === 'people' && (
            <div className="share-people">
              {list.length === 0 && <div className="muted small">Nobody yet. Add people below.</div>}
              {list.map(s => (
                <div key={s.user_id} className="share-person">
                  <Avatar p={person(s.user_id)} size={24} />
                  <span className="grow">{person(s.user_id)?.full_name ?? 'Former member'}</span>
                  <select value={s.access} onChange={e => setAccess(s, e.target.value as Access)} aria-label={`Access for ${person(s.user_id)?.full_name}`}>
                    <option value="view">Can view</option>
                    <option value="edit">Can edit</option>
                  </select>
                  <button className="icon-btn" onClick={() => removePerson(s)} aria-label={`Stop sharing with ${person(s.user_id)?.full_name}`}>✕</button>
                </div>
              ))}
              {candidates.length > 0 ? (
                <select value="" onChange={e => addPerson(e.target.value)} aria-label="Add a person">
                  <option value="">+ Add a person…</option>
                  {candidates.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                </select>
              ) : <div className="muted small">Everyone in the department who uses Notes is already added.</div>}
            </div>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </>
  );
}
