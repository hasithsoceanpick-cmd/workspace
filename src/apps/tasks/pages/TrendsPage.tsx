import { useEffect, useMemo, useState } from 'react';
import { useTaskApp } from '../store';
import { supabase } from '../../../supabase';
import { go, setParams, type Params } from '../../../lib/route';
import { firstName } from '../../../lib/labels';
import { downloadXlsx } from '../../../platform/excel';
import Avatar from '../../../platform/Avatar';

interface Row {
  month: string; user_id: string; due: number; on_time: number; late: number; open_late: number; finished: number;
  moved: number; sent_back: number; assigned: number; ack_hours: number | null;
}
type Metric = 'ontime' | 'finished' | 'late' | 'moved' | 'sentback' | 'ack';

const METRICS: { id: Metric; label: string; help: string }[] = [
  { id: 'ontime', label: 'On time', help: 'Of the deadlines that fell in the month, how many were finished on or before the day. Green 90%+, amber 75–89%, red below.' },
  { id: 'finished', label: 'Finished', help: 'Tasks finished in the month (whatever their deadline).' },
  { id: 'late', label: 'Missed', help: 'Deadlines in the month that were finished late, or still aren\'t finished.' },
  { id: 'moved', label: 'Deadlines moved', help: 'How often deadlines on their tasks were moved during the month.' },
  { id: 'sentback', label: 'Sent back', help: 'How often their finished work was sent back by the checker.' },
  { id: 'ack', label: 'Time to open', help: 'Average time between being given a task and pressing "Got it". Green within 4 hours, amber within a day.' },
];

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (iso: string) => `${MON[Number(iso.slice(5, 7)) - 1]} ${iso.slice(2, 4)}`;

type Cell = { text: string; sub?: string; tone: '' | 'good' | 'warn' | 'bad' };

function cell(metric: Metric, r: Pick<Row, 'due' | 'on_time' | 'late' | 'open_late' | 'finished' | 'moved' | 'sent_back' | 'ack_hours'> | undefined): Cell {
  if (!r) return { text: '—', tone: '' };
  switch (metric) {
    case 'ontime': {
      if (!r.due) return { text: '—', tone: '' };
      const p = Math.round((r.on_time / r.due) * 100);
      return { text: `${p}%`, sub: `${r.on_time}/${r.due}`, tone: p >= 90 ? 'good' : p >= 75 ? 'warn' : 'bad' };
    }
    case 'finished': return { text: r.finished ? String(r.finished) : '—', tone: '' };
    case 'late': { const n = r.late + r.open_late; return { text: n ? String(n) : '—', sub: r.open_late ? `${r.open_late} open` : undefined, tone: n ? 'bad' : '' }; }
    case 'moved': return { text: r.moved ? String(r.moved) : '—', tone: r.moved >= 3 ? 'bad' : r.moved ? 'warn' : '' };
    case 'sentback': return { text: r.sent_back ? String(r.sent_back) : '—', tone: r.sent_back >= 3 ? 'bad' : r.sent_back ? 'warn' : '' };
    case 'ack': {
      if (r.ack_hours === null || r.ack_hours === undefined) return { text: '—', tone: '' };
      const h = Number(r.ack_hours);
      const text = h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : h < 48 ? `${Math.round(h * 10) / 10} h` : `${Math.round(h / 24)} days`;
      return { text, tone: h <= 4 ? 'good' : h <= 24 ? 'warn' : 'bad' };
    }
  }
}

/** Switch between this week's summary and the month-by-month trends. */
export function ReportsSwitch({ current }: { current: 'week' | 'trends' }) {
  return (
    <div className="seg small">
      <button className={`seg-btn ${current === 'week' ? 'on' : ''}`} onClick={() => go('tasks', 'week')}>Weekly summary</button>
      <button className={`seg-btn ${current === 'trends' ? 'on' : ''}`} onClick={() => go('tasks', 'trends')}>Trends</button>
    </div>
  );
}

/** Month by month, per person: on time, finished, missed, moves, sent back, time to open. Leads only. */
export default function TrendsPage({ params }: { params: Params }) {
  const { dept, team, person, fail } = useTaskApp();
  const months = [3, 6, 12].includes(Number(params.months)) ? Number(params.months) : 6;
  const metric: Metric = (METRICS.find(m => m.id === params.metric)?.id) ?? 'ontime';
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    let live = true;
    setRows(null);
    supabase.rpc('tasks_trends', { p_dept: dept!.id, p_months: months }).then(({ data, error }) => {
      if (!live) return;
      if (error) { fail(error); setRows([]); return; }
      setRows((data as Row[]).map(r => ({ ...r, month: String(r.month).slice(0, 10) })));
    });
    return () => { live = false; };
  }, [dept, months, fail]);

  const monthList = useMemo(() => [...new Set((rows ?? []).map(r => r.month))].sort(), [rows]);
  const people = useMemo(() => {
    const ids = new Set((rows ?? []).map(r => r.user_id));
    const inTeam = team.filter(p => ids.has(p.id));
    const others = [...ids].filter(id => !team.some(p => p.id === id)).map(id => person(id)).filter(Boolean);
    return [...inTeam, ...others] as typeof team;
  }, [rows, team, person]);
  const at = (uid: string, m: string) => rows?.find(r => r.user_id === uid && r.month === m);

  // totals: per person over the period, and the department per month
  const sum = (list: Row[]) => {
    const s = list.reduce((a, r) => ({
      due: a.due + r.due, on_time: a.on_time + r.on_time, late: a.late + r.late, open_late: a.open_late + r.open_late,
      finished: a.finished + r.finished, moved: a.moved + r.moved, sent_back: a.sent_back + r.sent_back,
      ackSum: a.ackSum + (r.ack_hours !== null ? Number(r.ack_hours) * r.assigned : 0), ackN: a.ackN + (r.ack_hours !== null ? r.assigned : 0),
    }), { due: 0, on_time: 0, late: 0, open_late: 0, finished: 0, moved: 0, sent_back: 0, ackSum: 0, ackN: 0 });
    return { ...s, ack_hours: s.ackN ? s.ackSum / s.ackN : null };
  };

  async function exportSheet() {
    try {
      const nameOf = (id: string) => person(id)?.full_name ?? 'Former member';
      await downloadXlsx(`${dept!.name} trends ${monthList[0] ?? ''}`, [{
        name: 'Trends',
        columns: [
          { header: 'Person', width: 22 }, { header: 'Month', width: 10 }, { header: 'Deadlines', width: 11 },
          { header: 'On time', width: 9 }, { header: 'Late', width: 7 }, { header: 'Still open', width: 10 },
          { header: 'On time %', width: 10 }, { header: 'Finished', width: 9 }, { header: 'Deadlines moved', width: 15 },
          { header: 'Sent back', width: 10 }, { header: 'Tasks given', width: 11 }, { header: 'Avg hours to open', width: 16 },
        ],
        rows: (rows ?? []).map(r => [
          nameOf(r.user_id), monthLabel(r.month), r.due, r.on_time, r.late, r.open_late,
          r.due ? Math.round((r.on_time / r.due) * 100) : null, r.finished, r.moved, r.sent_back, r.assigned,
          r.ack_hours === null ? null : Number(r.ack_hours),
        ]),
      }]);
    } catch (e) { fail(e); }
  }

  const help = METRICS.find(m => m.id === metric)!.help;

  return (
    <div className="page wide">
      <div className="page-head">
        <div>
          <h1>Trends</h1>
          <div className="muted">Month by month, for the people whose work you can see.</div>
        </div>
        <div className="filters">
          <ReportsSwitch current="trends" />
          <select value={months} onChange={e => setParams({ months: e.target.value === '6' ? '' : e.target.value })} aria-label="Period">
            <option value="3">Last 3 months</option>
            <option value="6">Last 6 months</option>
            <option value="12">Last 12 months</option>
          </select>
          <button className="btn sm" onClick={exportSheet} disabled={!rows?.length}>Export to Excel</button>
        </div>
      </div>

      <div className="seg trend-metrics" role="tablist">
        {METRICS.map(m => (
          <button key={m.id} className={`seg-btn ${metric === m.id ? 'on' : ''}`} onClick={() => setParams({ metric: m.id === 'ontime' ? '' : m.id })}>{m.label}</button>
        ))}
      </div>
      <p className="muted small">{help}</p>

      {rows === null ? <div className="empty">Loading…</div> : people.length === 0 ? (
        <div className="empty">No tasks in this period yet.</div>
      ) : (
        <div className="table-scroll">
          <table className="team-table trend-table">
            <thead>
              <tr>
                <th>Person</th>
                {monthList.map(m => <th key={m} className="num">{monthLabel(m)}</th>)}
                <th className="num">{months} months</th>
              </tr>
            </thead>
            <tbody>
              {people.map(p => {
                const all = (rows ?? []).filter(r => r.user_id === p.id);
                const total = cell(metric, sum(all));
                return (
                  <tr key={p.id}>
                    <td><span className="person-cell"><Avatar p={p} size={24} />{firstName(p.full_name)}</span></td>
                    {monthList.map(m => {
                      const c = cell(metric, at(p.id, m));
                      return <td key={m} className={`num t-${c.tone}`}>{c.text}{c.sub && <span className="sub">{c.sub}</span>}</td>;
                    })}
                    <td className={`num total t-${total.tone}`}>{total.text}{total.sub && <span className="sub">{total.sub}</span>}</td>
                  </tr>
                );
              })}
              <tr className="dept-row">
                <td><strong>Everyone</strong></td>
                {monthList.map(m => {
                  const c = cell(metric, sum((rows ?? []).filter(r => r.month === m)));
                  return <td key={m} className={`num t-${c.tone}`}>{c.text}{c.sub && <span className="sub">{c.sub}</span>}</td>;
                })}
                {(() => { const c = cell(metric, sum(rows ?? [])); return <td className={`num total t-${c.tone}`}>{c.text}{c.sub && <span className="sub">{c.sub}</span>}</td>; })()}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
