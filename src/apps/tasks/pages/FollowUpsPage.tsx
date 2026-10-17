import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../supabase';
import { useTaskApp } from '../store';
import { setParams, type Params } from '../../../lib/route';
import { ago, today } from '../../../lib/dates';
import { firstName, initials } from '../../../lib/labels';
import { finished, finishedAt, isLate } from '../labels';
import TaskRow from '../TaskRow';
import ContactForm from '../ContactForm';
import type { Contact, Task } from '../types';

type Note = { task_id: number; body: string; created_at: string; author_id: string | null };

/**
 * Follow-ups: work given to people outside the app (no login) — a bank officer, a supplier — person by person,
 * with what's open, what's late, the last note, and the finished record.
 */
export default function FollowUpsPage({ params }: { params: Params }) {
  const { me, isLead, tasks, contacts, newTask, removeContact, saveContact, toast, person, loaded } = useTaskApp();
  const td = today();
  const scope = isLead && params.show === 'all' ? 'all' : 'mine';
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [openDone, setOpenDone] = useState<Set<number>>(new Set());
  const [showRemoved, setShowRemoved] = useState(false);
  const [notes, setNotes] = useState<Map<number, Note>>(new Map());

  const withContact = useMemo(() => tasks.filter(t => t.contact_id && (scope === 'all' || t.assignee_id === me.id)), [tasks, scope, me.id]);

  // the latest comment on each of these tasks: "last follow-up"
  const ids = useMemo(() => withContact.map(t => t.id).sort((a, b) => a - b).join(','), [withContact]);
  useEffect(() => {
    if (!ids) { setNotes(new Map()); return; }
    let stop = false;
    (async () => {
      const list = ids.split(',').map(Number);
      const out = new Map<number, Note>();
      for (let i = 0; i < list.length; i += 200) {
        const { data } = await supabase.from('task_comments').select('task_id,body,created_at,author_id')
          .in('task_id', list.slice(i, i + 200)).order('created_at', { ascending: false });
        for (const n of (data ?? []) as Note[]) if (!out.has(n.task_id)) out.set(n.task_id, n);
      }
      if (!stop) setNotes(out);
    })();
    return () => { stop = true; };
  }, [ids]);

  const cards = useMemo(() => {
    const term = q.trim().toLowerCase();
    return contacts.map(c => {
      const mine = withContact.filter(t => t.contact_id === c.id);
      const open = mine.filter(t => !finished(t)).sort((a, b) => a.due_date.localeCompare(b.due_date));
      const done = mine.filter(t => finished(t)).sort((a, b) => (finishedAt(b) ?? '').localeCompare(finishedAt(a) ?? ''));
      const late = open.filter(t => isLate(t, td)).length;
      const last = mine.map(t => notes.get(t.id)).filter((n): n is Note => !!n).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
      const hit = !term || [c.name, c.organisation, c.phone, c.email, c.note, ...mine.map(t => t.title)].some(x => x.toLowerCase().includes(term));
      return { c, open, done, late, last, hit };
    }).filter(x => x.hit);
  }, [contacts, withContact, notes, q, td]);

  const listed = cards.filter(x => x.c.active || x.open.length > 0)
    .sort((a, b) => b.late - a.late || b.open.length - a.open.length || a.c.name.localeCompare(b.c.name));
  const removed = cards.filter(x => !x.c.active && x.open.length === 0);
  const openN = listed.reduce((n, x) => n + x.open.length, 0);
  const lateN = listed.reduce((n, x) => n + x.late, 0);
  const titleOf = (id: number) => tasks.find(t => t.id === id)?.title ?? '';

  async function remove(c: Contact) {
    const r = await removeContact(c.id);
    if (r === 'deleted') toast(`${c.name} removed`);
    if (r === 'hidden') toast(`${c.name} taken off the list — their tasks keep the record`);
  }
  async function putBack(c: Contact) {
    if (await saveContact({ ...c, active: true })) toast(`${c.name} is back on the list`);
  }

  const card = (x: typeof listed[number]) => {
    const { c, open, done, late, last } = x;
    const showDone = openDone.has(c.id);
    return (
      <section key={c.id} className={`fu-card ${late ? 'late' : ''}`}>
        {editing === c.id ? (
          <ContactForm initial={c} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); toast('Saved'); }} />
        ) : (
          <header className="fu-head">
            <span className="fu-badge" aria-hidden="true">{initials(c.name)}</span>
            <div className="grow">
              <div className="fu-name">
                <strong>{c.name}</strong>{c.organisation && <span className="muted"> · {c.organisation}</span>}
                {!c.active && <span className="pill unseen">removed from list</span>}
              </div>
              <div className="fu-contact small">
                {c.phone && <a href={`tel:${c.phone.replace(/\s+/g, '')}`}>{c.phone}</a>}
                {c.email && <a href={`mailto:${c.email}`}>{c.email}</a>}
                {c.note && <span className="muted">{c.note}</span>}
              </div>
            </div>
            <div className="fu-counts">
              <span className="pill">{open.length} open</span>
              {late > 0 && <span className="pill high">{late} overdue</span>}
            </div>
          </header>
        )}
        {last && (
          <div className="fu-last small">
            <span className="muted">Last note {ago(last.created_at)}{last.author_id && last.author_id !== me.id ? ` (${firstName(person(last.author_id)?.full_name ?? '')})` : ''}:</span>
            {' '}“{last.body.length > 140 ? last.body.slice(0, 140) + '…' : last.body}”
            <span className="muted"> — {titleOf(last.task_id)}</span>
          </div>
        )}
        {open.length > 0 ? (
          <div className="list fu-list">{open.map(t => <TaskRow key={t.id} t={t as Task} showWho={t.assignee_id !== me.id} />)}</div>
        ) : (
          <div className="muted small fu-none">{done.length ? 'Nothing open.' : 'Nothing given to them yet.'}</div>
        )}
        {showDone && done.length > 0 && (
          <div className="list fu-list fu-done">{done.map(t => <TaskRow key={t.id} t={t as Task} showWho={t.assignee_id !== me.id} />)}</div>
        )}
        <footer className="fu-foot">
          {done.length > 0 && (
            <button className="link" onClick={() => setOpenDone(s => { const n = new Set(s); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })}>
              {showDone ? 'Hide finished' : `Show ${done.length} finished`}
            </button>
          )}
          <span className="grow" />
          {c.active ? (
            <>
              <button className="btn sm" onClick={() => setEditing(c.id)}>Edit</button>
              <button className="btn sm" onClick={() => remove(c)}>Remove</button>
              <button className="btn primary sm" onClick={() => newTask({ contact_id: c.id })}>+ Task for {firstName(c.name)}</button>
            </>
          ) : (
            <button className="btn sm" onClick={() => putBack(c)}>Put back on the list</button>
          )}
        </footer>
      </section>
    );
  };

  return (
    <div className="page followups">
      <div className="page-head">
        <div>
          <h1>Follow-ups</h1>
          <div className="muted">
            Work given to people outside the app — {listed.length} {listed.length === 1 ? 'person' : 'people'} · {openN} open
            {lateN > 0 && <> · <span className="danger">{lateN} overdue</span></>}
          </div>
        </div>
        <div className="filters">
          <input type="search" placeholder="Search…" value={q} onChange={e => setQ(e.target.value)} aria-label="Search follow-ups" />
          {isLead && (
            <select value={scope} onChange={e => setParams({ show: e.target.value === 'all' ? 'all' : '' })} aria-label="Whose follow-ups">
              <option value="mine">I follow up</option>
              <option value="all">Everyone's</option>
            </select>
          )}
          <button className="btn primary sm" onClick={() => setAdding(a => !a)}>{adding ? 'Close' : '+ Add person'}</button>
        </div>
      </div>

      {adding && (
        <div className="card fu-add">
          <p className="muted small">Someone without a login — a bank officer, a supplier, a colleague elsewhere — that you give work to and chase.</p>
          <ContactForm onCancel={() => setAdding(false)} onSaved={c => { setAdding(false); toast(`${c.name} added — give them a task with “+ Task”`); }} />
        </div>
      )}

      {!loaded ? <div className="empty">Loading…</div> : listed.length === 0 && !adding ? (
        <div className="empty">
          {q ? 'No one matches.' : <>Nobody yet. Add someone with <strong>+ Add person</strong>, or pick <em>Given to someone outside the app</em> in a task.</>}
        </div>
      ) : (
        <div className="fu-grid">{listed.map(card)}</div>
      )}

      {removed.length > 0 && (
        <div className="fu-removed">
          <button className="link" onClick={() => setShowRemoved(v => !v)}>
            {showRemoved ? 'Hide' : 'Show'} {removed.length} taken off the list
          </button>
          {showRemoved && <div className="fu-grid">{removed.map(card)}</div>}
        </div>
      )}
    </div>
  );
}
