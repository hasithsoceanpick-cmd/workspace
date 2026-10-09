import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { supabase } from '../../supabase';
import { setParams, type Params } from '../../lib/route';
import { addDays, daysBetween, fmtDay, fmtMonth, fromISO, localDayOf, startOfMonth, toISO, today, addMonths } from '../../lib/dates';
import { firstName } from '../../lib/labels';
import { downloadXlsx, xDate } from '../../platform/excel';
import Avatar from '../../platform/Avatar';
import { useTaskApp } from '../../apps/tasks/store';
import { finished, finishedAt, REMINDS, REPEATS, remindLabel, repeatLabel, statusLabel } from '../../apps/tasks/labels';
import type { Repeat, Task } from '../../apps/tasks/types';

interface Item {
  id: number; department_id: string; name: string; authority: string; notes: string;
  series_id: number | null; active: boolean; position: number;
}

// names only — Hasith enters the dates himself
const SUGGESTIONS = [
  'VAT return', 'SSCL return', 'APIT (PAYE) payment', 'WHT payment', 'Income tax instalment', 'Annual income tax return',
  'EPF contribution', 'ETF contribution', 'Stamp duty', 'Annual return (Registrar of Companies)', 'Audited financial statements',
  'Insurance renewal', 'Business registration renewal', 'Bank covenant report', 'Board pack',
];

/** Same rule as the database: anchor + n × step, month ends kept (31 Jan → 28 Feb → 31 Mar). */
export function scheduleDate(anchor: string, repeat: Repeat, n: number): string {
  if (repeat === 'weekly') return addDays(anchor, 7 * n);
  const months = (repeat === 'monthly' ? 1 : repeat === 'quarterly' ? 3 : 12) * n;
  const a = fromISO(anchor);
  const firstOfTarget = new Date(a.getFullYear(), a.getMonth() + months, 1);
  const lastDay = new Date(firstOfTarget.getFullYear(), firstOfTarget.getMonth() + 1, 0).getDate();
  return toISO(new Date(firstOfTarget.getFullYear(), firstOfTarget.getMonth(), Math.min(a.getDate(), lastDay)));
}

type Past = { t: Task; result: 'on-time' | 'late' | 'missed' };

/** Department feature "compliance": recurring obligations with owners, deadlines and an on-time record. */
export default function CompliancePage({ params }: { params: Params }) {
  const { me, isAdmin, dept, tasks, team, person, openTask, refresh, toast, fail, loaded } = useTaskApp();
  const deptId = dept!.id;
  const inDept = me.department_id === deptId;
  const lead = isAdmin || (inDept && (me.role === 'manager' || me.role === 'senior'));
  const view = params.view === 'year' ? 'year' : 'list';
  const td = today();

  const [items, setItems] = useState<Item[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('compliance_items').select('*').eq('department_id', deptId).order('position');
    if (error) return fail(error);
    setItems(data as Item[]);
  }, [deptId, fail]);
  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => (items ?? []).map(it => {
    const series = tasks.filter(t => it.series_id !== null && t.series_id === it.series_id).sort((a, b) => a.due_date.localeCompare(b.due_date));
    const current = [...series].reverse().find(t => t.status !== 'done') ?? null;
    const latest = series[series.length - 1] ?? null;
    // the record: every one that was finished, or whose deadline has passed
    const past: Past[] = series.filter(t => finished(t) || t.due_date < td).map(t => {
      const f = finishedAt(t);
      return { t, result: !f ? 'missed' as const : localDayOf(f) <= t.due_date ? 'on-time' as const : 'late' as const };
    });
    const scored = past;
    const onTime = past.filter(p => p.result === 'on-time').length;
    const repeat = (current ?? latest)?.repeat ?? null;
    return { it, series, current, latest, past, onTime, scored: scored.length, repeat };
  }), [items, tasks, td]);

  const visible = rows.filter(r => r.it.active);
  const paused = rows.filter(r => !r.it.active);

  // the next 12 months: the current deadline plus the ones the schedule will create
  const year = useMemo(() => {
    const start = startOfMonth(td);
    const months = Array.from({ length: 12 }, (_, i) => addMonths(start, i));
    const end = addDays(addMonths(start, 12), -1);
    const dues: { day: string; row: typeof rows[number]; projected: boolean }[] = [];
    for (const r of visible) {
      const cur = r.current;
      if (cur) dues.push({ day: cur.due_date, row: r, projected: false });
      const base = cur ?? r.latest;
      if (!base?.repeat || !base.repeat_anchor) continue;
      for (let n = base.repeat_n + 1; n < base.repeat_n + 60; n++) {
        const d = scheduleDate(base.repeat_anchor, base.repeat, n);
        if (d > end) break;
        if (d >= start) dues.push({ day: d, row: r, projected: true });
      }
    }
    return months.map(m => ({
      m, items: dues.filter(x => x.day.slice(0, 7) === m.slice(0, 7)).sort((a, b) => a.day.localeCompare(b.day)),
    }));
  }, [visible, td]);

  // repeating tasks that could be put on the calendar
  const linkable = useMemo(() => {
    const linked = new Set((items ?? []).map(i => i.series_id));
    const bySeries = new Map<number, Task>();
    for (const t of tasks) {
      if (t.series_id === null || linked.has(t.series_id)) continue;
      const prev = bySeries.get(t.series_id);
      if (!prev || prev.due_date < t.due_date) bySeries.set(t.series_id, t);
    }
    return [...bySeries.values()].filter(t => t.repeat).sort((a, b) => a.title.localeCompare(b.title));
  }, [items, tasks]);

  async function exportSheet() {
    try {
      await downloadXlsx(`${dept!.name} compliance calendar ${td}`, [{
        name: 'Compliance',
        columns: [
          { header: 'Obligation', width: 34 }, { header: 'Authority', width: 18 }, { header: 'Repeats', width: 11 },
          { header: 'Owner', width: 20 }, { header: 'Next deadline', width: 14 }, { header: 'Days left', width: 10 },
          { header: 'Status', width: 20 }, { header: 'Early reminder', width: 15 }, { header: 'On time (so far)', width: 15 },
          { header: 'Notes', width: 40 },
        ],
        rows: rows.map(r => [
          r.it.name, r.it.authority, repeatLabel(r.repeat), person(r.current?.assignee_id ?? r.latest?.assignee_id)?.full_name ?? '',
          xDate(r.current?.due_date ?? null), r.current ? daysBetween(td, r.current.due_date) : null,
          r.it.active ? (r.current ? statusLabel(r.current.status) : 'Nothing scheduled') : 'Paused',
          remindLabel((r.current ?? r.latest)?.remind_days), r.scored ? `${r.onTime} of ${r.scored}` : '', r.it.notes,
        ]),
      }]);
    } catch (e) { fail(e); }
  }

  if (!items || !loaded) return <div className="page"><div className="empty">Loading…</div></div>;

  return (
    <div className="page wide compliance">
      <div className="page-head">
        <div>
          <h1>Compliance calendar</h1>
          <div className="muted">Every recurring deadline, who owns it, and whether it was met. Each one is a repeating task — finishing it schedules the next.</div>
        </div>
        <div className="filters">
          <div className="seg small">
            <button className={`seg-btn ${view === 'list' ? 'on' : ''}`} onClick={() => setParams({ view: '' })}>List</button>
            <button className={`seg-btn ${view === 'year' ? 'on' : ''}`} onClick={() => setParams({ view: 'year' })}>Next 12 months</button>
          </div>
          <button className="btn sm" onClick={exportSheet} disabled={!rows.length}>Export to Excel</button>
          {lead && <button className="btn primary sm" onClick={() => setAdding(a => !a)}>{adding ? 'Close' : '+ Add obligation'}</button>}
        </div>
      </div>

      {adding && lead && (
        <AddForm deptId={deptId} team={team} linkable={linkable}
          onDone={async () => { setAdding(false); await refresh(); await load(); }} />
      )}

      {rows.length === 0 && !adding && (
        <div className="empty">
          No obligations yet.{lead ? ' Add the first one — VAT, EPF, renewals, anything with a recurring deadline.' : ''}
        </div>
      )}

      {view === 'list' && visible.length > 0 && (
        <div className="table-scroll">
          <table className="team-table co-table">
            <thead>
              <tr>
                <th>Obligation</th><th>Next deadline</th><th>Owner</th><th>Status</th><th>Track record</th>{lead && <th />}
              </tr>
            </thead>
            <tbody>
              {visible.map(r => {
                const cur = r.current;
                const left = cur ? daysBetween(td, cur.due_date) : null;
                const tone = left === null ? '' : cur!.status === 'review' ? 'ok' : left < 0 ? 'late' : left <= 7 ? 'soon' : '';
                const owner = person(cur?.assignee_id ?? r.latest?.assignee_id);
                return (
                  <tr key={r.it.id}>
                    <td>
                      {editing === r.it.id ? <EditItem it={r.it} onDone={() => { setEditing(null); load(); }} /> : (
                        <>
                          <div className="co-name">{r.it.name}</div>
                          <div className="muted small">{[r.it.authority, repeatLabel(r.repeat), remindLabel((cur ?? r.latest)?.remind_days) && `reminder ${remindLabel((cur ?? r.latest)?.remind_days)}`].filter(Boolean).join(' · ')}</div>
                        </>
                      )}
                    </td>
                    <td>
                      {cur ? (
                        <button className="link co-due" onClick={() => openTask(cur.id)}>
                          {fmtDay(cur.due_date)}
                          <span className={`co-left ${tone}`}>
                            {cur.status === 'review' ? 'finished' : left === 0 ? 'today' : left! < 0 ? `${-left!}d late` : `${left}d left`}
                          </span>
                        </button>
                      ) : r.latest ? <span className="muted small">Nothing scheduled — repeat is off</span>
                        : <span className="muted small">{r.it.series_id ? 'Not visible to you' : 'No task linked'}</span>}
                    </td>
                    <td>{owner && <span className="person-cell"><Avatar p={owner} size={22} />{firstName(owner.full_name)}</span>}</td>
                    <td>{cur ? <span className={`pill s-${cur.status}`}>{statusLabel(cur.status)}</span> : null}</td>
                    <td>
                      <span className="co-dots" title={r.past.slice(-8).map(p => `${fmtDay(p.t.due_date)}: ${p.result === 'missed' ? 'not finished' : p.result.replace('-', ' ')}`).join('\n')}>
                        {r.past.slice(-8).map(p => <span key={p.t.id} className={`co-dot ${p.result}`} onClick={() => openTask(p.t.id)} />)}
                      </span>
                      {r.scored > 0 && <span className="muted small"> {r.onTime}/{r.scored} on time</span>}
                    </td>
                    {lead && (
                      <td className="co-actions">
                        <ItemMenu it={r.it} onEdit={() => setEditing(r.it.id)} onChanged={load} />
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {view === 'year' && visible.length > 0 && (
        <div className="co-year">
          {year.map(({ m, items: due }) => (
            <section key={m} className="co-month">
              <h3>{fmtMonth(m)}</h3>
              {due.length === 0 ? <div className="muted small">—</div> : (
                <ul>
                  {due.map((x, i) => {
                    const late = !x.projected && x.day < td && x.row.current?.status !== 'review';
                    return (
                      <li key={i} className={`${x.projected ? 'projected' : ''} ${late ? 'late' : ''}`}
                        onClick={() => !x.projected && x.row.current && openTask(x.row.current.id)}>
                        <span className="co-day">{fromISO(x.day).getDate()}</span>
                        <span className="grow">{x.row.it.name}</span>
                        <span className="muted tiny">{firstName(person(x.row.current?.assignee_id ?? x.row.latest?.assignee_id)?.full_name ?? '')}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}

      {paused.length > 0 && (
        <div className="co-paused muted small">
          Paused: {paused.map((r, i) => (
            <span key={r.it.id}>{i > 0 && ', '}{r.it.name}{lead && <> (<button className="link" onClick={async () => {
              const { error } = await supabase.from('compliance_items').update({ active: true }).eq('id', r.it.id);
              if (error) return fail(error);
              toast('Back on the calendar'); load();
            }}>resume</button>)</>}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function AddForm({ deptId, team, linkable, onDone }: {
  deptId: string; team: { id: string; full_name: string }[]; linkable: Task[]; onDone: () => void;
}) {
  const { me, toast, fail } = useTaskApp();
  const [f, setF] = useState({ name: '', authority: '', owner: team.find(p => p.id !== me.id)?.id ?? me.id, due: '', repeat: 'monthly' as Repeat, remind: 5, notes: '' });
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState('');

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!f.name.trim() || !f.due) return toast('Give it a name and its next deadline.', 'error');
    setBusy(true);
    const { error } = await supabase.rpc('compliance_add', {
      p_dept: deptId, p_name: f.name.trim(), p_authority: f.authority.trim(), p_notes: f.notes.trim(),
      p_owner: f.owner, p_due: f.due, p_repeat: f.repeat, p_remind_days: f.remind || null,
    });
    setBusy(false);
    if (error) return fail(error);
    toast(`${f.name.trim()} added — ${firstName(team.find(p => p.id === f.owner)?.full_name ?? '')} has been given the task`);
    onDone();
  }

  async function addExisting() {
    const t = linkable.find(x => String(x.series_id) === link);
    if (!t) return;
    const { error } = await supabase.from('compliance_items').insert({ department_id: deptId, name: t.title, series_id: t.series_id });
    if (error) return fail(error);
    toast(`${t.title} is on the calendar`);
    onDone();
  }

  return (
    <form className="card co-add" onSubmit={add}>
      <div className="fields">
        <label className="field">
          <span>Obligation</span>
          <input list="co-names" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="e.g. VAT return" autoFocus />
          <datalist id="co-names">{SUGGESTIONS.map(s => <option key={s} value={s} />)}</datalist>
        </label>
        <label className="field">
          <span>Authority (optional)</span>
          <input value={f.authority} onChange={e => setF({ ...f, authority: e.target.value })} placeholder="e.g. IRD" />
        </label>
        <label className="field">
          <span>Owner</span>
          <select value={f.owner} onChange={e => setF({ ...f, owner: e.target.value })}>
            {team.map(p => <option key={p.id} value={p.id}>{p.id === me.id ? `${p.full_name} (me)` : p.full_name}</option>)}
          </select>
        </label>
      </div>
      <div className="fields">
        <label className="field">
          <span>Next deadline</span>
          <input type="date" value={f.due} onChange={e => setF({ ...f, due: e.target.value })} required />
        </label>
        <label className="field">
          <span>Repeats</span>
          <select value={f.repeat} onChange={e => setF({ ...f, repeat: e.target.value as Repeat })}>
            {REPEATS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Early reminder</span>
          <select value={f.remind} onChange={e => setF({ ...f, remind: Number(e.target.value) })}>
            <option value={0}>None</option>
            {REMINDS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </label>
      </div>
      <label className="field">
        <span>Notes (optional)</span>
        <textarea rows={2} value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} placeholder="How to file it, portal, who to call…" />
      </label>
      <div className="row gap end">
        <span className="muted small grow">The owner gets it as a high-priority task. When it's done (and signed off), the next one is scheduled.</span>
        <button className="btn primary sm" disabled={busy}>{busy ? 'Adding…' : 'Add obligation'}</button>
      </div>
      {linkable.length > 0 && (
        <div className="co-link row gap">
          <span className="small">Or put a repeating task you already have on the calendar:</span>
          <select value={link} onChange={e => setLink(e.target.value)} aria-label="Existing repeating task">
            <option value="">Choose…</option>
            {linkable.map(t => <option key={t.series_id} value={String(t.series_id)}>{t.title} ({repeatLabel(t.repeat)})</option>)}
          </select>
          <button type="button" className="btn sm" disabled={!link} onClick={addExisting}>Add</button>
        </div>
      )}
    </form>
  );
}

function EditItem({ it, onDone }: { it: Item; onDone: () => void }) {
  const { toast, fail } = useTaskApp();
  const [f, setF] = useState({ name: it.name, authority: it.authority, notes: it.notes });
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!f.name.trim()) return;
    const { error } = await supabase.from('compliance_items').update({ name: f.name.trim(), authority: f.authority.trim(), notes: f.notes }).eq('id', it.id);
    if (error) return fail(error);
    toast('Saved');
    onDone();
  }
  return (
    <form className="co-edit" onSubmit={save}>
      <input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} aria-label="Name" autoFocus />
      <input value={f.authority} onChange={e => setF({ ...f, authority: e.target.value })} placeholder="Authority" aria-label="Authority" />
      <div className="row gap">
        <button className="btn primary sm">Save</button>
        <button type="button" className="btn sm" onClick={onDone}>Cancel</button>
      </div>
      <div className="muted tiny">To change the owner, deadline or schedule, open its task.</div>
    </form>
  );
}

function ItemMenu({ it, onEdit, onChanged }: { it: Item; onEdit: () => void; onChanged: () => void }) {
  const { toast, fail } = useTaskApp();
  const [confirm, setConfirm] = useState(false);
  async function pause() {
    const { error } = await supabase.from('compliance_items').update({ active: false }).eq('id', it.id);
    if (error) return fail(error);
    toast(`${it.name} paused`);
    onChanged();
  }
  async function remove() {
    const { error } = await supabase.from('compliance_items').delete().eq('id', it.id);
    if (error) return fail(error);
    toast(`${it.name} taken off the calendar (its tasks are kept)`);
    onChanged();
  }
  if (confirm) {
    return (
      <span className="row gap">
        <button className="btn danger sm" onClick={remove}>Remove</button>
        <button className="btn sm" onClick={() => setConfirm(false)}>Keep</button>
      </span>
    );
  }
  return (
    <span className="row gap co-menu">
      <button className="link" onClick={onEdit}>Edit</button>
      <button className="link" onClick={pause}>Pause</button>
      <button className="link danger" onClick={() => setConfirm(true)}>Remove</button>
    </span>
  );
}
