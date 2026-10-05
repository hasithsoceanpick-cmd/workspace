import { useEffect, useRef, useState } from 'react';
import { usePlatform } from '../../platform/store';
import { supabase } from '../../supabase';
import { setParams, type Params } from '../../lib/route';
import { ROLES, roleLabel } from '../../lib/labels';
import { fmtStamp } from '../../lib/dates';
import type { Profile, Role } from '../../platform/types';
import Avatar from '../../platform/Avatar';

type Patch = Partial<Pick<Profile, 'department_id' | 'role' | 'active' | 'color'>>;

export default function PeoplePage({ params }: { params: Params }) {
  const { me, profiles, departments, toast, fail, reload } = usePlatform();
  const filter = params.dept ?? '';
  const q = (params.q ?? '').toLowerCase();

  async function update(p: Profile, patch: Patch, msg?: string) {
    const { error } = await supabase.from('profiles').update(patch).eq('id', p.id);
    if (error) return fail(error);
    await reload();
    if (msg) toast(msg);
  }

  const waiting = profiles.filter(p => !p.active && !p.department_id);
  const rest = profiles
    .filter(p => !waiting.includes(p))
    .filter(p => !filter || (filter === 'none' ? !p.department_id : p.department_id === filter))
    .filter(p => !q || p.full_name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q));
  const deptName = (id: string | null) => departments.find(d => d.id === id)?.name ?? '—';

  return (
    <div className="page wide">
      <div className="page-head">
        <div>
          <h1>People</h1>
          <div className="muted">Approve sign-ups, place people in departments and set their role.</div>
        </div>
        <div className="filters">
          <select value={filter} onChange={e => setParams({ dept: e.target.value })} aria-label="Department filter">
            <option value="">All departments</option>
            {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            <option value="none">No department</option>
          </select>
          <input className="search" type="search" placeholder="Search people…" defaultValue={params.q ?? ''}
            onChange={e => setParams({ q: e.target.value })} />
        </div>
      </div>

      {waiting.length > 0 && (
        <section className="card approvals">
          <h2>Waiting for approval <span className="count">{waiting.length}</span></h2>
          {departments.length === 0 && <p className="muted small">Create a department first (Departments &amp; apps tab).</p>}
          {waiting.map(p => <ApproveRow key={p.id} p={p} onApprove={(patch) => update(p, patch, `${p.full_name} approved`)} />)}
        </section>
      )}

      <div className="table-scroll">
        <table className="team-table">
          <thead>
            <tr>
              <th>Person</th>
              <th>Department</th>
              <th>Role</th>
              <th>Status</th>
              <th>Joined</th>
            </tr>
          </thead>
          <tbody>
            {rest.map(p => (
              <tr key={p.id} className={p.active ? '' : 'inactive-row'}>
                <td>
                  <div className="person-cell">
                    <ColorPick p={p} onPick={c => update(p, { color: c })} />
                    <span>
                      <span className="strong">{p.full_name}{p.id === me.id ? ' (me)' : ''}</span>
                      {p.id === me.id && <span className="admin-badge">Admin</span>}
                      <span className="muted tiny block">{p.email}</span>
                    </span>
                  </div>
                </td>
                <td>
                  <select value={p.department_id ?? ''} aria-label="Department"
                    onChange={e => update(p, { department_id: e.target.value || null },
                      `${p.full_name} moved to ${deptName(e.target.value || null)}`)}>
                    <option value="">— none —</option>
                    {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </td>
                <td>
                  <select value={p.role} aria-label="Role"
                    onChange={e => update(p, { role: e.target.value as Role }, `${p.full_name} is now ${roleLabel(e.target.value)}`)}>
                    {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                </td>
                <td>
                  {p.id === me.id ? <span className="muted small">Active</span> : p.active ? (
                    <button className="link muted small" onClick={() => update(p, { active: false }, `${p.full_name} deactivated`)}>
                      Active · deactivate
                    </button>
                  ) : (
                    <button className="link small" onClick={() => update(p, { active: true }, `${p.full_name} reactivated`)}>
                      Deactivated · reactivate
                    </button>
                  )}
                </td>
                <td className="muted small">{fmtStamp(p.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">
        Changes apply immediately. Moving someone to another department removes their access to the old department's data.
        Click an avatar to change that person's calendar colour.
      </p>
    </div>
  );
}

function ApproveRow({ p, onApprove }: { p: Profile; onApprove: (patch: Patch) => void }) {
  const { departments } = usePlatform();
  const [dept, setDept] = useState('');
  const [role, setRole] = useState<Role>('member');
  return (
    <div className="approve-row">
      <Avatar p={p} size={28} />
      <div className="grow">
        <div className="strong">{p.full_name}</div>
        <div className="muted tiny">{p.email} · signed up {fmtStamp(p.created_at)}</div>
      </div>
      <select value={dept} onChange={e => setDept(e.target.value)} aria-label="Department">
        <option value="">Choose department…</option>
        {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
      </select>
      <select value={role} onChange={e => setRole(e.target.value as Role)} aria-label="Role">
        {ROLES.map(x => <option key={x.value} value={x.value}>{x.label}</option>)}
      </select>
      <button className="btn primary sm" disabled={!dept} onClick={() => onApprove({ active: true, department_id: dept, role })}>
        Approve
      </button>
    </div>
  );
}

/** Avatar that opens a colour picker; saves once the picker closes. */
function ColorPick({ p, onPick }: { p: Profile; onPick: (c: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const on = () => { if (el.value !== p.color) onPick(el.value); };
    el.addEventListener('change', on);
    return () => el.removeEventListener('change', on);
  }, [p.color, onPick]);
  return (
    <label className="color-dot" title="Change calendar colour">
      <Avatar p={p} size={30} />
      <input ref={ref} type="color" defaultValue={p.color} key={p.color} />
    </label>
  );
}
