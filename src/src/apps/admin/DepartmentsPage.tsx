import { useState, type FormEvent } from 'react';
import { usePlatform } from '../../platform/store';
import { supabase } from '../../supabase';
import { APPS } from '../../platform/registry';
import { FEATURES } from '../../features/registry';
import { firstName } from '../../lib/labels';
import type { Department } from '../../platform/types';

export default function DepartmentsPage() {
  const { departments, apps, toast, fail, reload } = usePlatform();
  const [name, setName] = useState('');

  async function create(e: FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    const { data, error } = await supabase.from('departments').insert({ name: n }).select().single();
    if (error) return fail(error);
    // switch on every installed app for everyone in the new department
    const keys = APPS.filter(a => a.defaultOn).map(a => a.key).filter(k => apps.some(a => a.key === k));
    if (keys.length) {
      const res = await supabase.from('department_apps')
        .insert(keys.map(k => ({ department_id: (data as Department).id, app_key: k, everyone: true })));
      if (res.error) fail(res.error);
    }
    setName('');
    await reload();
    toast(`${n} created`);
  }

  return (
    <div className="page wide">
      <div className="page-head">
        <div>
          <h1>Departments &amp; apps</h1>
          <div className="muted">Choose which apps and department-only features each department gets, and who can use them.</div>
        </div>
        <form className="row gap" onSubmit={create}>
          <input type="text" placeholder="New department name" value={name} onChange={e => setName(e.target.value)} aria-label="New department name" />
          <button className="btn primary sm" disabled={!name.trim()}>Add department</button>
        </form>
      </div>

      {departments.length === 0 && <div className="empty">No departments yet — add your first one above (e.g. Finance).</div>}
      <div className="dept-grid">
        {departments.map(d => <DeptCard key={d.id} d={d} />)}
      </div>
    </div>
  );
}

function DeptCard({ d }: { d: Department }) {
  const { profiles, apps, deptApps, appMembers, deptFeatures, toast, fail, reload } = usePlatform();
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(d.name);
  const [confirmDel, setConfirmDel] = useState(false);
  const people = profiles.filter(p => p.active && p.department_id === d.id);
  const installed = apps.filter(a => APPS.some(x => x.key === a.key));

  async function run(p: PromiseLike<{ error: unknown }>, msg?: string) {
    const { error } = await p;
    if (error) return fail(error);
    await reload();
    if (msg) toast(msg);
  }

  const appRow = (key: string) => deptApps.find(x => x.department_id === d.id && x.app_key === key);
  const isMember = (key: string, uid: string) => appMembers.some(m => m.department_id === d.id && m.app_key === key && m.user_id === uid);
  const featureOn = (key: string) => deptFeatures.some(f => f.department_id === d.id && f.feature_key === key);

  return (
    <section className="card dept-card">
      <header className="dept-card-head">
        {renaming ? (
          <form className="row gap grow" onSubmit={e => {
            e.preventDefault();
            if (!newName.trim()) return;
            run(supabase.from('departments').update({ name: newName.trim() }).eq('id', d.id), 'Renamed').then(() => setRenaming(false));
          }}>
            <input type="text" value={newName} onChange={e => setNewName(e.target.value)} autoFocus aria-label="Department name" />
            <button className="btn primary sm">Save</button>
            <button type="button" className="btn sm" onClick={() => setRenaming(false)}>Cancel</button>
          </form>
        ) : (
          <>
            <div className="grow">
              <h2 className="dept-name">{d.name}</h2>
              <div className="muted tiny">{people.length} {people.length === 1 ? 'person' : 'people'}</div>
            </div>
            <button className="link small" onClick={() => setRenaming(true)}>Rename</button>
            {people.length === 0 && (confirmDel ? (
              <span className="row gap small">
                Delete?
                <button className="btn danger sm" onClick={() => run(supabase.from('departments').delete().eq('id', d.id), `${d.name} deleted`)}>Yes</button>
                <button className="btn sm" onClick={() => setConfirmDel(false)}>No</button>
              </span>
            ) : <button className="link danger small" onClick={() => setConfirmDel(true)}>Delete</button>)}
          </>
        )}
      </header>

      <div className="dept-section">
        <div className="dept-section-title">Apps</div>
        {installed.map(a => {
          const row = appRow(a.key);
          return (
            <div key={a.key} className="dept-app">
              <label className="check-label strong-label">
                <input type="checkbox" checked={!!row} onChange={e => run(
                  e.target.checked
                    ? supabase.from('department_apps').insert({ department_id: d.id, app_key: a.key, everyone: true })
                    : supabase.from('department_apps').delete().eq('department_id', d.id).eq('app_key', a.key),
                  `${a.name} ${e.target.checked ? 'switched on' : 'switched off'} for ${d.name}`)} />
                {a.name}
              </label>
              {row && (
                <div className="dept-app-access">
                  <select value={row.everyone ? 'everyone' : 'some'} aria-label={`Who can use ${a.name}`}
                    onChange={e => run(supabase.from('department_apps').update({ everyone: e.target.value === 'everyone' })
                      .eq('department_id', d.id).eq('app_key', a.key), 'Access updated')}>
                    <option value="everyone">Everyone in {d.name}</option>
                    <option value="some">Only selected people</option>
                  </select>
                  {!row.everyone && (
                    <div className="people-picks">
                      {people.length === 0 && <span className="muted tiny">No one in this department yet.</span>}
                      {people.map(p => {
                        const on = isMember(a.key, p.id);
                        return (
                          <button key={p.id} className={`pchip ${on ? 'on' : ''}`} style={{ ['--c' as string]: p.color }}
                            onClick={() => run(on
                              ? supabase.from('app_members').delete().eq('department_id', d.id).eq('app_key', a.key).eq('user_id', p.id)
                              : supabase.from('app_members').insert({ department_id: d.id, app_key: a.key, user_id: p.id }))}>
                            <span className="pdot" />{firstName(p.full_name)}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="dept-section">
        <div className="dept-section-title">Department-only features</div>
        {FEATURES.length === 0 && <div className="muted tiny">None built yet.</div>}
        {FEATURES.map(f => {
          const appName = apps.find(a => a.key === f.app)?.name ?? f.app;
          const appOn = !!appRow(f.app);
          return (
            <label key={f.key} className={`check-label feature-row ${appOn ? '' : 'disabled'}`}>
              <input type="checkbox" checked={featureOn(f.key)} disabled={!appOn && !featureOn(f.key)}
                onChange={e => run(
                  e.target.checked
                    ? supabase.from('department_features').insert({ department_id: d.id, feature_key: f.key })
                    : supabase.from('department_features').delete().eq('department_id', d.id).eq('feature_key', f.key),
                  `${f.name} ${e.target.checked ? 'on' : 'off'} for ${d.name}`)} />
              <span>
                <span className="strong">{f.name}</span> <span className="muted tiny">· {appName}</span>
                <span className="muted tiny block">{f.description}</span>
              </span>
            </label>
          );
        })}
      </div>
    </section>
  );
}
