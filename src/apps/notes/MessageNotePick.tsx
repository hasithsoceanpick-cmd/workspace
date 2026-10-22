import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../supabase';
import { usePlatform } from '../../platform/store';
import type { WorkPickProps } from '../../platform/slots';
import { firstName } from '../../lib/labels';
import { ago } from '../../lib/dates';
import { untitled, type ShareScope } from './types';

interface Page { id: number; title: string; owner_id: string; root_id: number | null; parent_id: number | null; share_scope: ShareScope; updated_at: string }

/**
 * Messages → Attach → Note: pick a page. If it's yours and private, it can be shared (view only) with the people
 * in the chat at the same time, so they can open it from the message.
 */
export default function MessageNotePick({ audience, where, onPick, onCancel }: WorkPickProps) {
  const { me, dept, person, fail, toast } = usePlatform();
  const [pages, setPages] = useState<Page[] | null>(null);
  const [q, setQ] = useState('');
  const [chosen, setChosen] = useState<Page | null>(null);
  const [share, setShare] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.from('notes_pages').select('id,title,owner_id,root_id,parent_id,share_scope,updated_at')
        .eq('department_id', dept!.id).order('updated_at', { ascending: false }).limit(400);
      if (error) { fail(error); setPages([]); return; }
      setPages((data ?? []) as Page[]);
    })();
  }, [dept, fail]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (pages ?? []).filter(p => !t || untitled(p.title).toLowerCase().includes(t)).slice(0, 60);
  }, [pages, q]);

  const root = chosen ? (pages ?? []).find(p => p.id === (chosen.root_id ?? chosen.id)) ?? chosen : null;
  const canShare = !!root && root.owner_id === me.id && root.share_scope !== 'department' && audience.length > 0;
  const whom = where === 'direct' ? firstName(person(audience[0])?.full_name ?? '') : 'everyone in the department';

  async function attach() {
    if (!chosen) return;
    if (canShare && share && root) {
      setBusy(true);
      if (where === 'direct') {
        const { error } = await supabase.from('notes_shares').insert({ note_id: root.id, user_id: audience[0], access: 'view' });
        if (error && !/duplicate|unique/i.test(error.message)) { setBusy(false); return fail(error); }
        if (root.share_scope === 'private') await supabase.from('notes_pages').update({ share_scope: 'people' }).eq('id', root.id);
      } else {
        const { error } = await supabase.from('notes_pages').update({ share_scope: 'department', dept_access: 'view' }).eq('id', root.id);
        if (error) { setBusy(false); return fail(error); }
      }
      setBusy(false);
      toast(`Shared with ${whom} (view only)`);
    }
    onPick({ kind: 'note', ref_id: chosen.id, title: untitled(chosen.title), for_id: null });
  }

  return (
    <>
      <div className="modal-backdrop" onClick={onCancel} />
      <div className="modal msg-pick" role="dialog" aria-label="Attach a note">
        <div className="modal-head">
          <strong>Attach a note</strong>
          <button className="icon-btn" onClick={onCancel} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">
          {!chosen ? (
            <>
              <input autoFocus placeholder="Find a page…" value={q} onChange={e => setQ(e.target.value)} aria-label="Find a page" />
              <div className="pick-list">
                {pages === null && <div className="muted small pad">Loading…</div>}
                {shown.map(p => (
                  <button key={p.id} className="pick-row" onClick={() => { setChosen(p); setShare(true); }}>
                    <span className="pick-title">📄 {untitled(p.title)}</span>
                    <span className="muted tiny">
                      {p.owner_id === me.id ? 'Yours' : firstName(person(p.owner_id)?.full_name ?? '')} · {p.share_scope === 'private' ? '🔒 Private' : p.share_scope === 'department' ? '🏢 Department' : '👥 Shared'} · edited {ago(p.updated_at)}
                    </span>
                  </button>
                ))}
                {pages && !shown.length && <div className="muted small pad">{q ? 'Nothing matches.' : 'No pages yet.'}</div>}
              </div>
            </>
          ) : (
            <>
              <div className="pick-chosen">📄 <strong>{untitled(chosen.title)}</strong> <button className="link small" onClick={() => setChosen(null)}>Change</button></div>
              {canShare ? (
                <label className="check-label">
                  <input type="checkbox" checked={share} onChange={e => setShare(e.target.checked)} />
                  Let {whom} open it (view only)
                </label>
              ) : root && root.owner_id !== me.id ? (
                <p className="muted small">It's {firstName(person(root.owner_id)?.full_name ?? 'someone')}'s page — people it isn't shared with will see the title only.</p>
              ) : null}
              {chosen.parent_id && canShare && <p className="muted tiny">Sub-pages are shared together with their top page.</p>}
            </>
          )}
        </div>
        <div className="modal-foot row gap">
          <button className="btn" onClick={onCancel}>Cancel</button>
          {chosen && <button className="btn primary" disabled={busy} onClick={attach}>Attach</button>}
        </div>
      </div>
    </>
  );
}
