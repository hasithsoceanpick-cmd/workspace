import { useTaskApp } from '../store';
import { go } from '../../../lib/route';
import { addDays, fromISO, localDayOf, startOfWeek, today } from '../../../lib/dates';
import { roleLabel } from '../../../lib/labels';
import Avatar from '../../../platform/Avatar';

export default function TeamPage() {
  const { me, isAdmin, dept, team, tasks } = useTaskApp();
  const td = today();
  const weekStart = startOfWeek(td);
  const weekEnd = addDays(weekStart, 6);

  const rows = team.map(p => {
    const mine = tasks.filter(t => t.assignee_id === p.id);
    const open = mine.filter(t => t.status !== 'done');
    const doneDays = mine.filter(t => t.status === 'done' && t.completed_at).map(t => localDayOf(t.completed_at!));
    return {
      p,
      open: open.length,
      overdue: open.filter(t => t.due_date < td).length,
      today: open.filter(t => t.due_date === td).length,
      week: open.filter(t => t.due_date >= td && t.due_date <= weekEnd).length,
      doneToday: doneDays.filter(d => d === td).length,
      doneWeek: doneDays.filter(d => d >= weekStart).length,
    };
  });

  return (
    <div className="page wide">
      <div className="page-head">
        <div>
          <h1>{dept?.name} team</h1>
          <div className="muted">
            Workload at a glance · week of {fromISO(weekStart).getDate()} {fromISO(weekStart).toLocaleString('en', { month: 'short' })}
          </div>
        </div>
      </div>

      <div className="table-scroll">
        <table className="team-table">
          <thead>
            <tr>
              <th>Person</th>
              <th>Role</th>
              <th className="num">Open</th>
              <th className="num">Overdue</th>
              <th className="num">Due today</th>
              <th className="num">Due this week</th>
              <th className="num">Done today</th>
              <th className="num">Done this week</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.p.id}>
                <td>
                  <button className="person-cell person-link" onClick={() => go('tasks', 'list', { who: r.p.id === me.id ? 'me' : r.p.id })}>
                    <Avatar p={r.p} size={28} />
                    <span className="strong">{r.p.full_name}{r.p.id === me.id ? ' (me)' : ''}</span>
                  </button>
                </td>
                <td className="muted">{roleLabel(r.p.role)}</td>
                <td className="num">{r.open}</td>
                <td className={`num ${r.overdue ? 'danger strong' : 'muted'}`}>{r.overdue}</td>
                <td className={`num ${r.today ? 'accent strong' : 'muted'}`}>{r.today}</td>
                <td className="num">{r.week}</td>
                <td className="num good">{r.doneToday || <span className="muted">0</span>}</td>
                <td className="num">{r.doneWeek}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">
        Click a name to see their tasks.
        {isAdmin ? ' Roles, colours and who belongs to this department are managed in the Admin console.' : ''}
      </p>
    </div>
  );
}
