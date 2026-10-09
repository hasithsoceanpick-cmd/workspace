import { useEffect, useState } from 'react';
import { supabase } from '../../supabase';
import { go } from '../../lib/route';
import { usePlatform } from '../../platform/store';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Home screen panel: where the latest month-end declaration stands. */
export default function MonthEndHome() {
  const { dept } = usePlatform();
  const [st, setSt] = useState<{ period: string; status: string; done: number; total: number } | null | undefined>(undefined);
  useEffect(() => {
    (async () => {
      const { data: p } = await supabase.from('month_end_periods').select('id,period,status').eq('department_id', dept!.id)
        .order('period', { ascending: false }).limit(1);
      const period = (p ?? [])[0] as { id: number; period: string; status: string } | undefined;
      if (!period) return setSt(null);
      const { data: e } = await supabase.from('month_end_entries').select('done').eq('period_id', period.id);
      const rows = (e ?? []) as { done: boolean }[];
      setSt({ period: period.period, status: period.status, done: rows.filter(r => r.done).length, total: rows.length });
    })();
  }, [dept]);
  if (st === undefined) return null;
  const label = st ? `${MONTHS[Number(st.period.slice(5, 7)) - 1]} ${st.period.slice(0, 4)}` : '';
  return (
    <section className="home-panel">
      <div className="hp-head"><h2>Month-end declaration</h2><button className="link" onClick={() => go('tasks', 'x-month-end')}>Open</button></div>
      {!st ? <div className="muted small">No month started yet.</div> : (
        <div className="hp-me">
          <div><strong>{label}</strong> · {st.status === 'approved' ? 'approved and locked' : st.status === 'reviewed' ? 'reviewed — waiting for your approval' : `${st.done}/${st.total} lines ticked`}</div>
          <div className="progress"><div style={{ width: `${st.total ? (st.done / st.total) * 100 : 0}%` }} /></div>
        </div>
      )}
    </section>
  );
}
