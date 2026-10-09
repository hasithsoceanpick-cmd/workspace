import { usePlatform } from '../../../platform/store';
import { ReminderForm, ReminderItem, useReminders } from '../Reminders';
import { isDue } from '../reminders';

/** All my reminders, and the ones I've set for my team. */
export default function RemindersPage() {
  const { me } = usePlatform();
  const { list } = useReminders();
  if (!list) return <div className="page"><div className="empty">Loading…</div></div>;

  const mine = list.filter(r => r.user_id === me.id);
  const due = mine.filter(r => isDue(r));
  const upcoming = mine.filter(r => !r.done_at && !isDue(r) && !r.repeat);
  const repeating = mine.filter(r => !r.done_at && r.repeat);
  const forOthers = list.filter(r => r.user_id !== me.id && r.created_by === me.id && !r.done_at);
  const done = mine.filter(r => r.done_at).sort((a, b) => (b.done_at ?? '').localeCompare(a.done_at ?? '')).slice(0, 15);

  const section = (title: string, items: typeof list, tone = '') => items.length > 0 && (
    <section className="group">
      <h2 className={tone}>{title} <span className="count">{items.length}</span></h2>
      <ul className="rem-list card-list">{items.map(r => <ReminderItem key={r.id} r={r} />)}</ul>
    </section>
  );

  return (
    <div className="page reminders-page">
      <div className="page-head">
        <div>
          <h1>Reminders</h1>
          <div className="muted">They pop up in your bell — and on your phone if alerts are on — at the time you choose.</div>
        </div>
      </div>
      <div className="card"><ReminderForm autoFocus={false} /></div>
      {section('Due now', due, 'warn')}
      {section('Coming up', upcoming)}
      {section('Repeating', repeating)}
      {section('Set by you for others', forOthers)}
      {section('Done recently', done)}
      {mine.length === 0 && forOthers.length === 0 && <div className="empty">No reminders yet. Type one above — e.g. “Call Sampath bank about the charges”.</div>}
    </div>
  );
}
