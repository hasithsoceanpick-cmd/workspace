import { useEffect, useMemo, useState } from 'react';
import type { AppProps } from '../../platform/registry';
import { go } from '../../lib/route';
import { NotesProvider, useNotesApp } from './store';
import { untitled, type NoteRow } from './types';
import NotePage from './NotePage';

/** The Notes app: private or shared pages with sub-pages. */
export default function NotesApp(props: AppProps) {
  return (
    <NotesProvider>
      <NotesInner {...props} />
    </NotesProvider>
  );
}

function NotesInner({ params }: AppProps) {
  const { me, isAdmin, inDept, notes, loaded, byId, childrenOf, createNote, person, rootOf } = useNotesApp();
  const selectedId = params.note ? Number(params.note) : null;
  const selected = byId(selectedId);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Set<number>>(new Set());

  // keep the path to the open page expanded
  useEffect(() => {
    if (!selected) return;
    setOpen(o => {
      const next = new Set(o);
      for (let p = byId(selected.parent_id); p; p = byId(p.parent_id)) next.add(p.id);
      return next;
    });
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const tops = notes.filter(n => n.parent_id === null);
  const mine = tops.filter(n => n.owner_id === me.id).sort((a, b) => a.position - b.position || a.id - b.id);
  const others = tops.filter(n => n.owner_id !== me.id);
  const byOwner = useMemo(() => {
    const m = new Map<string, NoteRow[]>();
    for (const n of others) {
      if (!m.has(n.owner_id)) m.set(n.owner_id, []);
      m.get(n.owner_id)!.push(n);
    }
    return [...m.entries()].sort((a, b) => (person(a[0])?.full_name ?? '').localeCompare(person(b[0])?.full_name ?? ''));
  }, [others, person]);

  async function newPage() {
    const n = await createNote(null);
    if (n) go('notes', '', { note: String(n.id) });
  }

  const toggle = (id: number) => setOpen(o => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const icon = (n: NoteRow) => {
    const r = rootOf(n);
    return r.share_scope === 'private' ? '' : r.share_scope === 'department' ? '🏢' : '👥';
  };

  const Item = ({ n, depth }: { n: NoteRow; depth: number }) => {
    const kids = childrenOf(n.id);
    const isOpen = open.has(n.id) || !!q;
    return (
      <li>
        <div className={`tree-item ${selectedId === n.id ? 'on' : ''}`} style={{ paddingLeft: 6 + depth * 14 }}>
          {kids.length > 0
            ? <button className="tree-caret" onClick={() => toggle(n.id)} aria-label={isOpen ? 'Collapse' : 'Expand'}>{isOpen ? '▾' : '▸'}</button>
            : <span className="tree-caret" />}
          <button className="tree-link" onClick={() => go('notes', '', { note: String(n.id) })} title={untitled(n.title)}>
            <span className="tree-title">{untitled(n.title)}</span>
            {depth === 0 && icon(n) && <span className="tree-share" aria-hidden="true">{icon(n)}</span>}
          </button>
        </div>
        {isOpen && kids.length > 0 && (
          <ul>{kids.map(k => <Item key={k.id} n={k} depth={depth + 1} />)}</ul>
        )}
      </li>
    );
  };

  const search = q.trim().toLowerCase();
  const found = search ? notes.filter(n => untitled(n.title).toLowerCase().includes(search)) : [];

  return (
    <main className={`main notes-app ${selected ? 'has-page' : ''}`}>
      <aside className="notes-side">
        <div className="notes-side-head">
          <input type="search" placeholder="Search pages…" value={q} onChange={e => setQ(e.target.value)} aria-label="Search pages" />
          {inDept && <button className="btn primary sm" onClick={newPage}>+ New page</button>}
        </div>
        {!loaded ? <div className="muted small pad">Loading…</div> : search ? (
          <ul className="tree">
            {found.length === 0 && <li className="muted small pad">No pages match.</li>}
            {found.map(n => (
              <li key={n.id}>
                <div className={`tree-item ${selectedId === n.id ? 'on' : ''}`}>
                  <button className="tree-link" onClick={() => go('notes', '', { note: String(n.id) })}>
                    <span className="tree-title">{untitled(n.title)}</span>
                    {n.parent_id && <span className="muted tiny">in {untitled(byId(n.parent_id)?.title)}</span>}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <>
            {inDept && (
              <>
                <div className="tree-head">My pages</div>
                {mine.length === 0 ? <div className="muted small pad">No pages yet.</div>
                  : <ul className="tree">{mine.map(n => <Item key={n.id} n={n} depth={0} />)}</ul>}
              </>
            )}
            {isAdmin ? byOwner.map(([owner, list]) => (
              <div key={owner}>
                <div className="tree-head">{person(owner)?.full_name ?? 'Former member'}</div>
                <ul className="tree">{list.map(n => <Item key={n.id} n={n} depth={0} />)}</ul>
              </div>
            )) : others.length > 0 && (
              <>
                <div className="tree-head">Shared with me</div>
                <ul className="tree">{others.map(n => <Item key={n.id} n={n} depth={0} />)}</ul>
              </>
            )}
          </>
        )}
      </aside>

      <section className="notes-page">
        {selected ? (
          <>
            <button className="link back-link" onClick={() => go('notes')}>‹ All pages</button>
            <NotePage key={selected.id} row={selected} />
          </>
        ) : (
          <div className="empty notes-empty">
            {selectedId && loaded ? (
              <><h2>Page not available</h2><p>It may have been deleted, or it isn't shared with you.</p></>
            ) : (
              <>
                <h2>Notes</h2>
                <p>Write pages for yourself, or share them with your department or chosen people.<br />
                  Pages can have sub-pages, tickboxes, tables, screenshots, files and links to tasks.</p>
                {inDept && <button className="btn primary" onClick={newPage}>+ New page</button>}
              </>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
