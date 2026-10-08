import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent, type PointerEvent as RPointerEvent } from 'react';
import { useTaskApp } from '../store';
import { supabase } from '../../../supabase';
import { setParams, type Params } from '../../../lib/route';
import { addDays, daysBetween, fmtDue, fmtLong, today } from '../../../lib/dates';
import { firstName } from '../../../lib/labels';
import type { Task, TimeBlock } from '../types';
import { finished } from '../labels';
import Avatar from '../../../platform/Avatar';

// Timeline runs 07:00 – 20:30, in 30-minute rows, snapping to 15 minutes.
const START = 7 * 60;
const END = 20 * 60 + 30;
const SNAP = 15;
const ROW = 30;               // minutes per row
const ROW_PX = 44;            // height of one row
const PX = ROW_PX / ROW;      // pixels per minute
const TASK_LEN = 60;          // a task dropped on the timeline gets an hour
const OWN_LEN = 30;           // your own block gets half an hour

const pad = (n: number) => String(n).padStart(2, '0');
const hm = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const snap = (m: number) => Math.round(m / SNAP) * SNAP;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const len = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`);
const prioRank = { high: 0, normal: 1, low: 2 } as const;

type Drag = { id: number; mode: 'move' | 'resize'; offset: number; x: number; y: number; moved: boolean };

export default function TodayPage({ params }: { params: Params }) {
  const { me, inDept, isLead, team, tasks, person, openTask, helpersOf, fail, dept } = useTaskApp();
  const td = today();
  const d = params.d || td;
  const who = isLead && params.who && team.some(p => p.id === params.who) ? params.who
    : inDept ? me.id : team[0]?.id ?? me.id;
  const mine = who === me.id && inDept;     // only the owner plans their own day
  const owner = person(who);

  const [blocks, setBlocks] = useState<TimeBlock[] | null>(null);
  const [draft, setDraft] = useState<{ start: number; title: string } | null>(null);
  const [renaming, setRenaming] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);   // drop preview while dragging a task in
  const [now, setNow] = useState(() => new Date());
  const grid = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [, force] = useState(0);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('time_blocks').select('*')
      .eq('department_id', dept!.id).eq('user_id', who).eq('day', d).order('start_min');
    if (error) return fail(error);
    setBlocks((data as TimeBlock[]) ?? []);
  }, [dept, who, d, fail]);
  useEffect(() => { setBlocks(null); load(); }, [load]);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  // scroll the timeline so the current hour (or 08:00) is in view
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scroller.current;
    if (!el || blocks === null) return;
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const focus = d === td ? clamp(nowMin - 60, START, END) : 8 * 60;
    el.scrollTop = (focus - START) * PX;
  }, [d, blocks === null]); // eslint-disable-line react-hooks/exhaustive-deps

  const taskById = useMemo(() => new Map(tasks.map(t => [t.id, t])), [tasks]);

  // Work this person can plan: their own open tasks and tasks they help on
  const planList = useMemo(() => {
    const open = tasks.filter(t => !finished(t) && (t.assignee_id === who || helpersOf(t.id).includes(who)))
      .sort((a, b) => a.due_date.localeCompare(b.due_date) || prioRank[a.priority] - prioRank[b.priority] || a.id - b.id);
    const groups = [
      { label: 'Overdue', tone: 'danger', items: open.filter(t => t.due_date < d) },
      { label: d === td ? 'Due today' : 'Due this day', tone: 'accent', items: open.filter(t => t.due_date === d) },
      { label: 'Next 7 days', tone: '', items: open.filter(t => t.due_date > d && t.due_date <= addDays(d, 7)) },
      { label: 'Later', tone: '', items: open.filter(t => t.due_date > addDays(d, 7)) },
    ];
    return groups.filter(g => g.items.length);
  }, [tasks, who, helpersOf, d, td]);

  const plannedAt = useMemo(() => {
    const m = new Map<number, number>();
    for (const b of blocks ?? []) if (b.task_id && !m.has(b.task_id)) m.set(b.task_id, b.start_min);
    return m;
  }, [blocks]);

  // side-by-side columns for blocks that overlap
  const layout = useMemo(() => {
    const list = [...(blocks ?? [])].sort((a, b) => a.start_min - b.start_min || b.end_min - a.end_min);
    const out = new Map<number, { col: number; cols: number }>();
    let cluster: TimeBlock[] = [];
    let clusterEnd = -1;
    const flush = () => {
      const cols: number[] = [];   // end minute of the last block in each column
      const placed: [TimeBlock, number][] = [];
      for (const b of cluster) {
        let c = cols.findIndex(e => e <= b.start_min);
        if (c === -1) { c = cols.length; cols.push(0); }
        cols[c] = b.end_min;
        placed.push([b, c]);
      }
      for (const [b, c] of placed) out.set(b.id, { col: c, cols: cols.length });
      cluster = [];
    };
    for (const b of list) {
      if (cluster.length && b.start_min >= clusterEnd) flush();
      cluster.push(b);
      clusterEnd = Math.max(clusterEnd, b.end_min);
    }
    if (cluster.length) flush();
    return out;
  }, [blocks]);

  const planned = (blocks ?? []).reduce((n, b) => n + (b.end_min - b.start_min), 0);
  const minuteAt = (clientY: number) => {
    const r = grid.current!.getBoundingClientRect();
    return START + (clientY - r.top) / PX;
  };

  // ---------- saving ----------
  async function insert(row: { start_min: number; end_min: number; task_id?: number; title?: string }) {
    const { data, error } = await supabase.from('time_blocks').insert({ day: d, ...row }).select().single();
    if (error) return fail(error);
    setBlocks(bs => [...(bs ?? []), data as TimeBlock]);
  }
  async function save(b: TimeBlock, patch: Partial<Pick<TimeBlock, 'start_min' | 'end_min' | 'title'>>) {
    const prev = blocks;
    setBlocks(bs => (bs ?? []).map(x => (x.id === b.id ? { ...x, ...patch } : x)));
    const { error } = await supabase.from('time_blocks').update(patch).eq('id', b.id);
    if (error) { setBlocks(prev); fail(error); }
  }
  async function remove(b: TimeBlock) {
    setBlocks(bs => (bs ?? []).filter(x => x.id !== b.id));
    const { error } = await supabase.from('time_blocks').delete().eq('id', b.id);
    if (error) { fail(error); load(); }
  }

  function placeTask(t: Task, start: number) {
    const s = clamp(snap(start), START, END - SNAP);
    insert({ task_id: t.id, start_min: s, end_min: Math.min(END, s + TASK_LEN) });
  }

  /** First free hour from now (today) or 09:00 */
  function nextFree(): number {
    const nowMin = now.getHours() * 60 + now.getMinutes();
    let s = d === td ? clamp(Math.ceil(nowMin / SNAP) * SNAP, START, END - SNAP) : 9 * 60;
    const busy = (blocks ?? []).map(b => [b.start_min, b.end_min]);
    for (; s + SNAP <= END; s += SNAP) {
      const e = Math.min(END, s + TASK_LEN);
      if (!busy.some(([a, z]) => s < z && e > a)) return s;
    }
    return d === td ? clamp(Math.ceil(nowMin / SNAP) * SNAP, START, END - SNAP) : 9 * 60;
  }

  // ---------- drag a task in from the list ----------
  const onDragOver = (e: DragEvent) => {
    if (!mine || !e.dataTransfer.types.includes('text/x-task')) return;
    e.preventDefault();
    const m = clamp(snap(minuteAt(e.clientY) - 15), START, END - SNAP);
    if (m !== hover) setHover(m);
  };
  const onDrop = (e: DragEvent) => {
    setHover(null);
    if (!mine) return;
    const id = Number(e.dataTransfer.getData('text/x-task'));
    const t = taskById.get(id);
    if (!t) return;
    e.preventDefault();
    placeTask(t, minuteAt(e.clientY) - 15);
  };

  // ---------- move / resize blocks ----------
  function down(e: RPointerEvent, b: TimeBlock, mode: Drag['mode']) {
    if (!mine || e.button !== 0) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { id: b.id, mode, offset: minuteAt(e.clientY) - b.start_min, x: e.clientX, y: e.clientY, moved: false };
  }
  function move(e: RPointerEvent) {
    const g = drag.current;
    if (!g) return;
    if (!g.moved && Math.abs(e.clientY - g.y) + Math.abs(e.clientX - g.x) < 4) return;
    g.moved = true;
    const m = minuteAt(e.clientY);
    setBlocks(bs => (bs ?? []).map(b => {
      if (b.id !== g.id) return b;
      const dur = b.end_min - b.start_min;
      if (g.mode === 'move') {
        const s = clamp(snap(m - g.offset), START, END - dur);
        return { ...b, start_min: s, end_min: s + dur };
      }
      return { ...b, end_min: clamp(snap(m), b.start_min + SNAP, END) };
    }));
    force(n => n + 1);
  }
  async function up(b: TimeBlock) {
    const g = drag.current;
    drag.current = null;
    if (!g) return;
    if (!g.moved) {
      if (b.task_id) openTask(b.task_id);
      return;
    }
    const cur = (blocks ?? []).find(x => x.id === b.id);
    if (!cur) return;
    const { error } = await supabase.from('time_blocks').update({ start_min: cur.start_min, end_min: cur.end_min }).eq('id', b.id);
    if (error) { fail(error); load(); }
  }

  // ---------- click an empty slot to add your own block ----------
  function clickGrid(e: MouseEvent) {
    if (!mine || e.target !== e.currentTarget) return;
    const s = clamp(Math.floor((minuteAt(e.clientY) - START) / ROW) * ROW + START, START, END - SNAP);
    setDraft({ start: s, title: '' });
  }
  async function saveDraft() {
    if (!draft) return;
    const title = draft.title.trim();
    setDraft(null);
    if (!title) return;
    await insert({ title, start_min: draft.start, end_min: Math.min(END, draft.start + OWN_LEN) });
  }

  const nowMin = now.getHours() * 60 + now.getMinutes();
  const showNow = d === td && nowMin >= START && nowMin <= END;
  const rows = Array.from({ length: (END - START) / ROW }, (_, i) => START + i * ROW);

  return (
    <div className="page wide today">
      <div className="page-head">
        <div>
          <h1>{d === td ? 'Today' : fmtLong(d)}</h1>
          <div className="muted">
            {d === td ? fmtLong(d) : daysBetween(td, d) > 0 ? `In ${daysBetween(td, d)} day${daysBetween(td, d) === 1 ? '' : 's'}` : `${daysBetween(d, td)} day${daysBetween(d, td) === 1 ? '' : 's'} ago`}
            {' · '}{planned ? `${len(planned)} planned` : 'nothing planned yet'}
          </div>
        </div>
        <div className="filters">
          {isLead && team.length > 1 && (
            <select value={who} onChange={e => setParams({ who: e.target.value === me.id ? '' : e.target.value })} aria-label="Whose day">
              {team.map(p => <option key={p.id} value={p.id}>{p.id === me.id ? 'My day' : `${p.full_name}'s day`}</option>)}
            </select>
          )}
          <div className="cal-nav">
            <button className="icon-btn" onClick={() => setParams({ d: addDays(d, -1) === td ? '' : addDays(d, -1) })} aria-label="Previous day">‹</button>
            <input type="date" value={d} onChange={e => e.target.value && setParams({ d: e.target.value === td ? '' : e.target.value })} aria-label="Day" />
            <button className="icon-btn" onClick={() => setParams({ d: addDays(d, 1) === td ? '' : addDays(d, 1) })} aria-label="Next day">›</button>
            {d !== td && <button className="btn sm" onClick={() => setParams({ d: '' })}>Today</button>}
          </div>
        </div>
      </div>

      {!mine && (
        <div className="readonly-note">
          <Avatar p={owner} size={20} /> Viewing {owner ? `${firstName(owner.full_name)}'s` : 'this'} day. Only {owner ? firstName(owner.full_name) : 'they'} can change it.
        </div>
      )}

      <div className="today-grid">
        <aside className="plan-list">
          <div className="plan-head">
            <span className="section-title">{mine ? 'Drag work into your day' : 'Open work'}</span>
          </div>
          {planList.length === 0 && <div className="muted small pad">No open tasks.</div>}
          {planList.map(g => (
            <section key={g.label} className="plan-group">
              <h3 className={g.tone}>{g.label} <span className="count">{g.items.length}</span></h3>
              {g.items.map(t => {
                const at = plannedAt.get(t.id);
                const helping = t.assignee_id !== who;
                return (
                  <div key={t.id} className={`plan-item ${t.priority === 'high' ? 'high' : ''} ${at !== undefined ? 'planned' : ''}`}
                    draggable={mine}
                    onDragStart={e => { e.dataTransfer.setData('text/x-task', String(t.id)); e.dataTransfer.effectAllowed = 'copy'; }}
                    onDragEnd={() => setHover(null)}>
                    {mine && <span className="grip" aria-hidden="true">⋮⋮</span>}
                    <button className="plan-title" onClick={() => openTask(t.id)}>
                      <span>{t.title}</span>
                      <span className="muted tiny">
                        {fmtDue(t.due_date)}
                        {helping && <> · helping {firstName(person(t.assignee_id)?.full_name ?? '')}</>}
                        {at !== undefined && <> · <span className="accent">⏱ {hm(at)}</span></>}
                      </span>
                    </button>
                    {mine && (
                      <button className="btn sm plan-add" onClick={() => placeTask(t, nextFree())} title="Add to the next free hour" aria-label={`Plan ${t.title}`}>+</button>
                    )}
                  </div>
                );
              })}
            </section>
          ))}
        </aside>

        <div className="timeline-wrap" ref={scroller}>
          <div className="timeline" style={{ height: (END - START) * PX }}>
            <div className="tl-hours" aria-hidden="true">
              {rows.map(m => <div key={m} className={`tl-hour ${m % 60 ? 'half' : ''}`} style={{ height: ROW_PX }}>{m % 60 ? '' : hm(m)}</div>)}
              <div className="tl-hour end">{hm(END)}</div>
            </div>
            <div ref={grid} className={`tl-grid ${mine ? 'editable' : ''}`}
              onClick={clickGrid} onDragOver={onDragOver} onDragLeave={() => setHover(null)} onDrop={onDrop}
              style={{ backgroundSize: `100% ${ROW_PX * 2}px` }}>
              {blocks === null && <div className="tl-loading muted small">Loading…</div>}
              {showNow && <div className="tl-now" style={{ top: (nowMin - START) * PX }}><span>{hm(nowMin)}</span></div>}
              {hover !== null && <div className="tl-ghost" style={{ top: (hover - START) * PX, height: Math.min(TASK_LEN, END - hover) * PX }}>{hm(hover)}</div>}

              {(blocks ?? []).map(b => {
                const t = b.task_id ? taskById.get(b.task_id) : undefined;
                const pos = layout.get(b.id) ?? { col: 0, cols: 1 };
                const h = (b.end_min - b.start_min) * PX;
                const short = b.end_min - b.start_min <= 30;
                const isDragging = drag.current?.id === b.id && drag.current.moved;
                return (
                  <div key={b.id}
                    className={`tl-block ${b.task_id ? 'task' : 'own'} ${t && finished(t) ? 'done' : ''} ${t?.priority === 'high' ? 'high' : ''} ${short ? 'short' : ''} ${isDragging ? 'dragging' : ''} ${mine ? 'movable' : ''}`}
                    style={{
                      top: (b.start_min - START) * PX, height: h,
                      left: `calc(${(pos.col / pos.cols) * 100}% + 2px)`, width: `calc(${100 / pos.cols}% - 4px)`,
                    }}
                    onPointerDown={e => down(e, b, 'move')}
                    onPointerMove={move}
                    onPointerUp={() => up(b)}
                    onDoubleClick={() => { if (mine && !b.task_id) setRenaming(b.id); }}
                    title={`${hm(b.start_min)}–${hm(b.end_min)} · ${t?.title ?? b.title ?? ''}`}
                  >
                    {renaming === b.id ? (
                      <input className="tl-rename" autoFocus defaultValue={b.title ?? ''}
                        onPointerDown={e => e.stopPropagation()}
                        onBlur={e => { const v = e.target.value.trim(); setRenaming(null); if (v && v !== b.title) save(b, { title: v }); }}
                        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setRenaming(null); }} />
                    ) : (
                      <div className="tl-text">
                        <span className="tl-title">{t ? t.title : b.task_id ? `Task #${b.task_id}` : b.title}</span>
                        <span className="tl-time">{hm(b.start_min)}–{hm(b.end_min)}{!short && t && t.assignee_id !== who ? ` · helping ${firstName(person(t.assignee_id)?.full_name ?? '')}` : ''}</span>
                      </div>
                    )}
                    {mine && (
                      <>
                        <button className="tl-x" onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); remove(b); }}
                          aria-label="Remove from the day">✕</button>
                        <div className="tl-resize" onPointerDown={e => down(e, b, 'resize')} aria-hidden="true" />
                      </>
                    )}
                  </div>
                );
              })}

              {draft && (
                <div className="tl-block own draft" style={{ top: (draft.start - START) * PX, height: OWN_LEN * PX, left: 2, width: 'calc(100% - 4px)' }}>
                  <input className="tl-rename" autoFocus placeholder={`${hm(draft.start)} — e.g. Lunch, Meeting… (Enter)`}
                    value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })}
                    onBlur={saveDraft}
                    onKeyDown={e => { if (e.key === 'Enter') saveDraft(); if (e.key === 'Escape') setDraft(null); }} />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      {mine && (
        <p className="hint">Drag tasks onto the timeline (or press +) · click an empty slot to add your own block · drag a block to move it, its bottom edge to resize · double-click your own block to rename.</p>
      )}
    </div>
  );
}
