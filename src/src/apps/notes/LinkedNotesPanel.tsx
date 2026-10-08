import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../supabase';
import { go } from '../../lib/route';
import { usePlatform } from '../../platform/store';
import type { Task } from '../tasks/types';
import { untitled } from './types';

type PageLite = { id: number; title: string; parent_id: number | null; owner_id: string };

/**
 * Shown inside the Tasks app's task panel (through platform/slots.ts) for people who
 * have Notes. Lists the pages linked to the task. Kept small: no editor code here.
 */
export default function LinkedNotesPanel({ task }: { task: Task }) {
  const { me, person, fail, toast } = usePlatform();
  const [pages, setPages] = useState<PageLite[]>([]);
  const [all, setAll] = useState<PageLite[] | null>(null);
  const [picking, setPicking] = useState(false);
  const [q, setQ] = useState('');
  const canCreate = me.department_id === task.department_id;

  const load = useCallback(async () => {
    const { data } = await supabase.from('notes_task_links').select('note_id').eq('task_id', task.id);
    const ids = ((data ?? []) as { note_id: number }[]).map(r => r.note_id);
    if (!ids.length) return setPages([]);
    const n = await supabase.from('notes_pages').select('id,title,parent_id,owner_id').in('id', ids);
    setPages((n.data ?? []) as PageLite[]);
  }, [task.id]);
  useEffect(() => { load(); }, [load]);

  async function openPicker() {
    setPicking(p => !p);
    if (all) return;
    const { data } = await supabase.from('notes_pages').select('id,title,parent_id,owner_id')
      .eq('department_id', task.department_id).order('updated_at', { ascending: false }).limit(300);
    setAll((data ?? []) as PageLite[]);
  }
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (all ?? []).filter(p => !pages.some(x => x.id === p.id) && (!s || untitled(p.title).toLowerCase().includes(s))).slice(0, 8);
  }, [all, pages, q]);

  async function link(id: number) {
    const { error } = await supabase.from('notes_task_links').insert({ note_id: id, task_id: task.id });
    if (error) { fail(error); return false; }
    return true;
  }
  async function pick(p: PageLite) {
    if (await link(p.id)) { setPicking(false); setQ(''); toast('Page linked'); load(); }
  }
  async function newPage() {
    const { data, error } = await supabase.from('notes_pages').insert({ title: task.title, position: Date.now() / 1000 }).select('id').single();
    if (error) return fail(error);
    const id = (data as { id: number }).id;
    if (await link(id)) go('notes', '', { note: String(id) });
  }
  async function unlink(p: PageLite) {
    const { error, count } = await supabase.from('notes_task_links').delete({ count: 'exact' }).eq('task_id', task.id).eq('note_id', p.id);
    if (error || !count) return fail(error ?? new Error('Only people who can edit that page can remove links others added.'));
    setPages(ps => ps.filter(x => x.id !== p.id));
  }

  return (
    <section className="linked-notes">
      <div className="section-head">
        <span className="section-title">Notes pages {pages.length > 0 && <span className="count">{pages.length}</span>}</span>
        <div className="row gap">
          <button type="button" className="btn sm" onClick={openPicker}>{picking ? 'Close' : 'Link a page'}</button>
          {canCreate && <button type="button" className="btn sm" onClick={newPage}>New page</button>}
        </div>
      </div>
      {picking && (
        <div className="picker">
          <input autoFocus type="search" placeholder="Search your pages…" value={q} onChange={e => setQ(e.target.value)} aria-label="Search pages" />
          {all === null ? <div className="muted small">Loading…</div> : matches.length === 0 ? <div className="muted small">No pages found.</div> : (
            <ul>
              {matches.map(p => (
                <li key={p.id}><button type="button" onClick={() => pick(p)}>
                  <span className="grow">📄 {untitled(p.title)}</span>
                  {p.owner_id !== me.id && <span className="muted tiny">{person(p.owner_id)?.full_name}</span>}
                </button></li>
              ))}
            </ul>
          )}
        </div>
      )}
      {pages.length > 0 && (
        <ul className="linked-list">
          {pages.map(p => (
            <li key={p.id}>
              <button type="button" className="linked-open" onClick={() => go('notes', '', { note: String(p.id) })}>
                <span>📄</span><span className="grow">{untitled(p.title)}</span>
                {p.owner_id !== me.id && <span className="muted tiny">{person(p.owner_id)?.full_name}</span>}
              </button>
              <button type="button" className="icon-btn" onClick={() => unlink(p)} aria-label={`Unlink ${untitled(p.title)}`}>✕</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
