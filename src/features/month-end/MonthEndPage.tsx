import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { supabase } from '../../supabase';
import { usePlatform } from '../../platform/store';
import { setParams, type Params } from '../../lib/route';
import { fmtDay, fmtStamp, today } from '../../lib/dates';
import { firstName } from '../../lib/labels';
import { downloadXlsx, xDate } from '../../platform/excel';
import Avatar from '../../platform/Avatar';

interface Item { id: number; department_id: string; code: string; category: string; title: string; owner_id: string | null; due_day: number; position: number; active: boolean }
interface Period { id: number; department_id: string; period: string; status: 'open' | 'reviewed' | 'approved'; reviewed_by: string | null; reviewed_at: string | null; approved_by: string | null; approved_at: string | null }
interface Entry { id: number; period_id: number; code: string; category: string; title: string; owner_id: string | null; due_date: string; position: number; done: boolean; done_by: string | null; done_at: string | null; remarks: string }

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthName = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
const firstOf = (iso: string) => `${iso.slice(0, 7)}-01`;
const shiftMonth = (iso: string, n: number) => {
  const y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7)) - 1 + n;
  const d = new Date(Date.UTC(y, m, 1));
  return d.toISOString().slice(0, 10);
};
const CAT_NAMES: Record<string, string> = { MEC: 'Month-end confirmation', CMP: 'Compliance' };

/** Department feature "month_end": the monthly self-declaration (Tasks → Month end). */
export default function MonthEndPage({ params }: { params: Params }) {
  const { me, isAdmin, dept, deptPeople, person, toast, fail } = usePlatform();
  const deptId = dept!.id;
  const inDept = me.department_id === deptId;
  const lead = isAdmin || (inDept && (me.role === 'manager' || me.role === 'senior'));
  const canReview = inDept && (me.role === 'manager' || me.role === 'senior');
  const canApprove = inDept && me.role === 'manager';

  const [periods, setPeriods] = useState<Period[] | null>(null);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [busy, setBusy] = useState(false);
  const editing = params.edit === '1' && lead;

  const loadPeriods = useCallback(async () => {
    const { data, error } = await supabase.from('month_end_periods').select('*').eq('department_id', deptId).order('period', { ascending: false });
    if (error) return fail(error);
    setPeriods((data as Period[]) ?? []);
  }, [deptId, fail]);

  useEffect(() => { supabase.rpc('month_end_check'); loadPeriods(); }, [loadPeriods]);

  const lastMonth = shiftMonth(firstOf(today()), -1);
  const selected = params.m ? firstOf(`${params.m}-01`) : periods?.[0]?.period ?? lastMonth;
  const period = periods?.find(p => p.period === selected) ?? null;

  const loadEntries = useCallback(async () => {
    if (!period) { setEntries([]); return; }
    const { data, error } = await supabase.from('month_end_entries').select('*').eq('period_id', period.id).order('position').order('id');
    if (error) return fail(error);
    setEntries((data as Entry[]) ?? []);
  }, [period?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setEntries(null); loadEntries(); }, [loadEntries]);

  const monthOptions = useMemo(() => {
    const set = new Set((periods ?? []).map(p => p.period));
    set.add(lastMonth); set.add(firstOf(today())); set.add(selected);
    return [...set].sort().reverse();
  }, [periods, lastMonth, selected]);

  async function start() {
    setBusy(true);
    const { error } = await supabase.rpc('month_end_start', { p_dept: deptId, p_period: selected });
    setBusy(false);
    if (error) return fail(error);
    toast(`${monthName(selected)} started`);
    await loadPeriods();
  }

  async function setStatus(status: Period['status'], msg: string) {
    if (!period) return;
    setBusy(true);
    const { data, error } = await supabase.from('month_end_periods').update({ status }).eq('id', period.id).select().maybeSingle();
    setBusy(false);
    if (error || !data) return fail(error ?? new Error("You can't do that."));
    toast(msg);
    loadPeriods();
  }

  async function removeMonth() {
    if (!period) return;
    const { error, count } = await supabase.from('month_end_periods').delete({ count: 'exact' }).eq('id', period.id);
    if (error || !count) return fail(error ?? new Error('Only the manager can delete an open month.'));
    toast(`${monthName(period.period)} deleted`);
    setParams({ m: '' });
    loadPeriods();
  }

  async function patchEntry(e: Entry, patch: Partial<Entry>) {
    setEntries(xs => (xs ?? []).map(x => (x.id === e.id ? { ...x, ...patch } : x)));
    const { data, error } = await supabase.from('month_end_entries').update(patch).eq('id', e.id).select().maybeSingle();
    if (error || !data) { fail(error ?? new Error("You can't change that line.")); loadEntries(); return; }
    setEntries(xs => (xs ?? []).map(x => (x.id === e.id ? (data as Entry) : x)));
  }

  async function removeEntry(e: Entry) {
    const { error, count } = await supabase.from('month_end_entries').delete({ count: 'exact' }).eq('id', e.id);
    if (error || !count) return fail(error ?? new Error("You can't remove that line."));
    setEntries(xs => (xs ?? []).filter(x => x.id !== e.id));
  }

  async function exportMonth() {
    if (!period || !entries) return;
    const nm = (id: string | null) => person(id)?.full_name ?? '';
    try {
      await downloadXlsx(`${dept!.name} month-end declaration ${period.period.slice(0, 7)}`, [
        {
          name: monthName(period.period),
          columns: [{ header: 'Code', width: 10 }, { header: 'Category', width: 12 }, { header: 'Line', width: 50 }, { header: 'Owner', width: 20 },
            { header: 'Due', width: 13 }, { header: 'Done', width: 7 }, { header: 'Ticked on', width: 13 }, { header: 'Remarks', width: 50 }],
          rows: entries.map(e => [e.code, e.category, e.title, nm(e.owner_id), xDate(e.due_date), e.done, xDate(e.done_at), e.remarks]),
        },
        {
          name: 'Sign-off',
          columns: [{ header: 'Step', width: 14 }, { header: 'By', width: 22 }, { header: 'On', width: 13 }],
          rows: [
            ['Status', period.status === 'approved' ? 'Approved' : period.status === 'reviewed' ? 'Reviewed' : 'Open', null],
            ['Reviewed', nm(period.reviewed_by), xDate(period.reviewed_at)],
            ['Approved', nm(period.approved_by), xDate(period.approved_at)],
          ],
        },
      ]);
    } catch (e) { fail(e); }
  }

  const mineOnly = params.who === 'me';
  const list = (entries ?? []).filter(e => !mineOnly || e.owner_id === me.id);
  const doneCount = (entries ?? []).filter(e => e.done).length;
  const total = entries?.length ?? 0;
  const myOpen = (entries ?? []).filter(e => e.owner_id === me.id && !e.done).length;
  const open = period?.status === 'open';
  const td = today();
  const groups = useMemo(() => {
    const m = new Map<string, Entry[]>();
    for (const e of list) { if (!m.has(e.category)) m.set(e.category, []); m.get(e.category)!.push(e); }
    return [...m.entries()];
  }, [list]);

  return (
    <div className="page wide month-end">
      <div className="page-head">
        <div>
          <h1>Month-end declaration</h1>
          <div className="muted">{dept?.name} · lines are ticked by their owners, reviewed by a senior executive and approved by the manager</div>
        </div>
        <div className="filters">
          <select value={selected} onChange={e => setParams({ m: e.target.value.slice(0, 7), edit: '' })} aria-label="Month">
            {monthOptions.map(m => (
              <option key={m} value={m}>{monthName(m)}{periods?.some(p => p.period === m) ? '' : ' (not started)'}</option>
            ))}
          </select>
          {lead && (
            <button className={`btn sm ${editing ? 'primary' : ''}`} onClick={() => setParams({ edit: editing ? '' : '1' })}>
              {editing ? 'Back to the month' : 'Edit master list'}
            </button>
          )}
        </div>
      </div>

      {editing ? <MasterList deptId={deptId} /> : periods === null ? <div className="empty">Loading…</div> : !period ? (
        <div className="empty me-start">
          <h2>{monthName(selected)} hasn't been started</h2>
          {lead ? (
            <>
              <p>Starting it copies the master list into this month, with each line's owner and due date.</p>
              <button className="btn primary" disabled={busy} onClick={start}>Start {monthName(selected)}</button>
            </>
          ) : <p>A senior executive or the manager starts each month.</p>}
        </div>
      ) : (
        <>
          <div className={`me-status s-${period.status}`}>
            <div className="me-status-main">
              <span className={`me-badge s-${period.status}`}>
                {period.status === 'open' ? 'Open' : period.status === 'reviewed' ? 'Reviewed' : 'Approved'}
              </span>
              <div className="grow">
                <div className="strong">{monthName(period.period)} · {doneCount}/{total} lines ticked</div>
                <div className="progress"><div style={{ width: `${total ? (doneCount / total) * 100 : 0}%` }} /></div>
                <div className="muted tiny">
                  {period.reviewed_by && <>Reviewed by {person(period.reviewed_by)?.full_name ?? 'someone'} · {fmtStamp(period.reviewed_at!)}. </>}
                  {period.approved_by && <>Approved by {person(period.approved_by)?.full_name ?? 'someone'} · {fmtStamp(period.approved_at!)}.</>}
                  {open && total > doneCount && <>{total - doneCount} line{total - doneCount === 1 ? '' : 's'} still open.</>}
                </div>
              </div>
            </div>
            <div className="row gap me-actions">
              {open && canReview && (
                <button className="btn primary sm" disabled={busy || total === 0 || doneCount < total}
                  title={doneCount < total ? 'Every line must be ticked first' : ''}
                  onClick={() => setStatus('reviewed', 'Marked as reviewed')}>Mark reviewed</button>
              )}
              {period.status === 'reviewed' && canApprove && (
                <button className="btn primary sm" disabled={busy} onClick={() => setStatus('approved', 'Approved')}>Approve</button>
              )}
              {period.status === 'reviewed' && canReview && (
                <button className="btn sm" disabled={busy} onClick={() => setStatus('open', 'Sent back')}>Send back</button>
              )}
              {period.status === 'approved' && canApprove && (
                <button className="btn sm" disabled={busy} onClick={() => setStatus('open', 'Reopened')}>Reopen</button>
              )}
              <button className="btn sm" onClick={exportMonth} disabled={!entries}>Export to Excel</button>
            </div>
          </div>

          <div className="row gap me-filter">
            <div className="seg small">
              <button className={`seg-btn ${!mineOnly ? 'on' : ''}`} onClick={() => setParams({ who: '' })}>Everyone</button>
              <button className={`seg-btn ${mineOnly ? 'on' : ''}`} onClick={() => setParams({ who: 'me' })}>
                Mine {myOpen > 0 && <span className="count">{myOpen}</span>}
              </button>
            </div>
            {!open && <span className="muted small">Signed off: lines are locked{canApprove || canReview ? ' (send back or reopen to change them)' : ''}.</span>}
          </div>

          {entries === null ? <div className="empty">Loading…</div> : list.length === 0 ? (
            <div className="empty small">{mineOnly ? 'You have no lines this month.' : 'No lines yet. Add them below, or to the master list for future months.'}</div>
          ) : groups.map(([cat, rows]) => (
            <section key={cat} className="group">
              <h2>{cat}{CAT_NAMES[cat] ? ` · ${CAT_NAMES[cat]}` : ''} <span className="count">{rows.filter(r => r.done).length}/{rows.length}</span></h2>
              <div className="list me-list">
                {rows.map(e => {
                  const mine = e.owner_id === me.id;
                  const late = !e.done && e.due_date < td;
                  return (
                    <div key={e.id} className={`me-row ${e.done ? 'done' : ''} ${late ? 'late' : ''}`}>
                      <input type="checkbox" checked={e.done} disabled={!open || !mine}
                        title={mine ? (e.done ? 'Untick' : 'Tick when done') : `Only ${firstName(person(e.owner_id)?.full_name ?? 'the owner')} can tick this`}
                        onChange={() => patchEntry(e, { done: !e.done })} aria-label={`Done: ${e.title}`} />
                      <div className="me-main">
                        <div className="me-title">{e.code && <span className="me-code">{e.code}</span>}{e.title}</div>
                        <div className="me-meta">
                          {lead && open ? (
                            <select value={e.owner_id ?? ''} onChange={ev => patchEntry(e, { owner_id: ev.target.value || null })} aria-label="Owner">
                              <option value="">No owner</option>
                              {deptPeople.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                            </select>
                          ) : (
                            <span className="row gap-s"><Avatar p={person(e.owner_id)} size={18} /> {person(e.owner_id)?.full_name ?? 'No owner'}</span>
                          )}
                          {lead && open ? (
                            <input type="date" value={e.due_date} onChange={ev => ev.target.value && patchEntry(e, { due_date: ev.target.value })} aria-label="Due date" />
                          ) : (
                            <span className={late ? 'danger strong' : 'muted'}>due {fmtDay(e.due_date)}{late ? ' · overdue' : ''}</span>
                          )}
                          {e.done && e.done_at && <span className="good small">✓ {firstName(person(e.done_by)?.full_name ?? '')} · {fmtStamp(e.done_at)}</span>}
                        </div>
                      </div>
                      <input className="me-remarks" placeholder={open && (mine || lead) ? 'Remarks…' : ''} defaultValue={e.remarks}
                        key={`${e.id}-${e.remarks}`} readOnly={!open || !(mine || lead)}
                        onBlur={ev => { if (ev.target.value !== e.remarks) patchEntry(e, { remarks: ev.target.value }); }}
                        onKeyDown={ev => { if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur(); }} aria-label={`Remarks: ${e.title}`} />
                      {lead && open && <button className="icon-btn me-x" onClick={() => removeEntry(e)} aria-label={`Remove ${e.title}`}>✕</button>}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}

          {lead && open && <AddLine periodId={period.id} people={deptPeople} defaultDue={`${shiftMonth(period.period, 1).slice(0, 8)}15`} onAdded={loadEntries} />}

          {canApprove && open && (
            <ConfirmDelete label={`Delete ${monthName(period.period)}`} onConfirm={removeMonth} />
          )}
        </>
      )}
    </div>
  );
}

function AddLine({ periodId, people, defaultDue, onAdded }: { periodId: number; people: { id: string; full_name: string }[]; defaultDue: string; onAdded: () => void }) {
  const { fail } = usePlatform();
  const [f, setF] = useState({ code: '', category: 'MEC', title: '', owner_id: '', due_date: defaultDue });
  async function add(e: FormEvent) {
    e.preventDefault();
    if (!f.title.trim()) return;
    const { error } = await supabase.from('month_end_entries').insert({
      period_id: periodId, code: f.code.trim(), category: f.category.trim() || 'MEC', title: f.title.trim(),
      owner_id: f.owner_id || null, due_date: f.due_date, position: Date.now() / 1e6,
    });
    if (error) return fail(error);
    setF(x => ({ ...x, code: '', title: '' }));
    onAdded();
  }
  return (
    <form className="me-add" onSubmit={add}>
      <span className="muted small">Add a line to this month only:</span>
      <input placeholder="Code" value={f.code} onChange={e => setF({ ...f, code: e.target.value })} className="w-code" aria-label="Code" />
      <input placeholder="Category" value={f.category} onChange={e => setF({ ...f, category: e.target.value })} className="w-cat" aria-label="Category" list="me-cats" />
      <input placeholder="What must be confirmed" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} className="grow" aria-label="Line" />
      <select value={f.owner_id} onChange={e => setF({ ...f, owner_id: e.target.value })} aria-label="Owner">
        <option value="">Owner…</option>
        {people.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
      </select>
      <input type="date" value={f.due_date} onChange={e => setF({ ...f, due_date: e.target.value })} aria-label="Due date" />
      <button className="btn sm primary" disabled={!f.title.trim()}>Add</button>
      <datalist id="me-cats"><option value="MEC" /><option value="CMP" /></datalist>
    </form>
  );
}

function ConfirmDelete({ label, onConfirm }: { label: string; onConfirm: () => void }) {
  const [ask, setAsk] = useState(false);
  return (
    <div className="danger-zone">
      {ask ? (
        <>
          <span>Delete this month and all its ticks? The master list stays.</span>
          <button className="btn danger sm" onClick={onConfirm}>Yes, delete</button>
          <button className="btn sm" onClick={() => setAsk(false)}>Keep</button>
        </>
      ) : <button className="link danger" onClick={() => setAsk(true)}>{label}</button>}
    </div>
  );
}

/** The lines copied into every new month. */
function MasterList({ deptId }: { deptId: string }) {
  const { deptPeople, person, fail, toast } = usePlatform();
  const [items, setItems] = useState<Item[] | null>(null);
  const [f, setF] = useState({ code: '', category: 'MEC', title: '', owner_id: '', due_day: 15 });

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('month_end_items').select('*').eq('department_id', deptId).order('position').order('id');
    if (error) return fail(error);
    setItems((data as Item[]) ?? []);
  }, [deptId, fail]);
  useEffect(() => { load(); }, [load]);

  async function patch(it: Item, p: Partial<Item>) {
    setItems(xs => (xs ?? []).map(x => (x.id === it.id ? { ...x, ...p } : x)));
    const { error } = await supabase.from('month_end_items').update(p).eq('id', it.id);
    if (error) { fail(error); load(); }
  }
  async function move(i: number, dir: -1 | 1) {
    const list = items ?? [];
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const a = list[i], b = list[j];
    const pa = a.position === b.position ? i : a.position, pb = a.position === b.position ? j : b.position;
    await Promise.all([patch(a, { position: pb }), patch(b, { position: pa })]);
    load();
  }
  async function remove(it: Item) {
    const { error } = await supabase.from('month_end_items').delete().eq('id', it.id);
    if (error) return fail(error);
    setItems(xs => (xs ?? []).filter(x => x.id !== it.id));
  }
  async function add(e: FormEvent) {
    e.preventDefault();
    if (!f.title.trim()) return;
    const position = (items ?? []).reduce((m, x) => Math.max(m, x.position), 0) + 1;
    const { error } = await supabase.from('month_end_items').insert({
      department_id: deptId, code: f.code.trim(), category: f.category.trim() || 'MEC', title: f.title.trim(),
      owner_id: f.owner_id || null, due_day: f.due_day, position,
    });
    if (error) return fail(error);
    toast('Line added to the master list');
    setF(x => ({ ...x, code: '', title: '' }));
    load();
  }

  return (
    <div className="me-master">
      <p className="muted small">
        These lines are copied into each month when it's started. Changes here apply to months you start from now on;
        to change a month that's already running, edit its lines there.
      </p>
      {items === null ? <div className="empty">Loading…</div> : (
        <div className="table-scroll">
          <table className="team-table me-table">
            <thead>
              <tr><th>Code</th><th>Category</th><th>Line</th><th>Owner</th><th className="num">Due day</th><th>In use</th><th /></tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={it.id} className={it.active ? '' : 'inactive'}>
                  <td><input defaultValue={it.code} className="w-code" onBlur={e => e.target.value !== it.code && patch(it, { code: e.target.value })} aria-label="Code" /></td>
                  <td><input defaultValue={it.category} className="w-cat" list="me-cats2" onBlur={e => e.target.value !== it.category && patch(it, { category: e.target.value || 'MEC' })} aria-label="Category" /></td>
                  <td><input defaultValue={it.title} className="w-title" onBlur={e => e.target.value.trim() && e.target.value !== it.title && patch(it, { title: e.target.value.trim() })} aria-label="Line" /></td>
                  <td>
                    <select value={it.owner_id ?? ''} onChange={e => patch(it, { owner_id: e.target.value || null })} aria-label="Owner">
                      <option value="">No owner</option>
                      {deptPeople.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                      {it.owner_id && !deptPeople.some(p => p.id === it.owner_id) && <option value={it.owner_id}>{person(it.owner_id)?.full_name ?? 'Former member'}</option>}
                    </select>
                  </td>
                  <td className="num">
                    <input type="number" min={1} max={31} defaultValue={it.due_day} className="w-day"
                      onBlur={e => { const v = Math.max(1, Math.min(31, Number(e.target.value) || 15)); if (v !== it.due_day) patch(it, { due_day: v }); }} aria-label="Due day" />
                  </td>
                  <td><input type="checkbox" checked={it.active} onChange={() => patch(it, { active: !it.active })} aria-label="In use" /></td>
                  <td className="row gap-s">
                    <button className="icon-btn sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">↑</button>
                    <button className="icon-btn sm" onClick={() => move(i, 1)} disabled={i === items.length - 1} aria-label="Move down">↓</button>
                    <button className="icon-btn sm" onClick={() => remove(it)} aria-label={`Delete ${it.title}`}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <form className="me-add" onSubmit={add}>
        <input placeholder="Code (e.g. MEC-07)" value={f.code} onChange={e => setF({ ...f, code: e.target.value })} className="w-code" aria-label="New code" />
        <input placeholder="Category" value={f.category} onChange={e => setF({ ...f, category: e.target.value })} className="w-cat" list="me-cats2" aria-label="New category" />
        <input placeholder="What must be confirmed each month" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} className="grow" aria-label="New line" />
        <select value={f.owner_id} onChange={e => setF({ ...f, owner_id: e.target.value })} aria-label="New owner">
          <option value="">Owner…</option>
          {deptPeople.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
        </select>
        <label className="row gap-s small muted">due day
          <input type="number" min={1} max={31} value={f.due_day} onChange={e => setF({ ...f, due_day: Number(e.target.value) || 15 })} className="w-day" aria-label="New due day" />
        </label>
        <button className="btn sm primary" disabled={!f.title.trim()}>Add line</button>
        <datalist id="me-cats2"><option value="MEC" /><option value="CMP" /></datalist>
      </form>
      <p className="hint">Due day = the day of the following month the line is due (e.g. 15 → September's lines are due 15 October).</p>
    </div>
  );
}
