import { Suspense, useEffect } from 'react';
import { usePlatform } from './store';
import { go, useRoute } from '../lib/route';
import { PLATFORM_NAME } from './config';
import { ADMIN_APP, APPS, type AppDef } from './registry';
import Dropdown from './Dropdown';
import Bell from './Bell';
import UserMenu from './UserMenu';

export default function Shell() {
  const { isAdmin, dept, departments, setDeptId, myAppKeys, apps, profiles, toasts } = usePlatform();
  const route = useRoute();

  const available: AppDef[] = APPS.filter(a => myAppKeys.includes(a.key));
  const wantsAdmin = route.app === 'admin' && isAdmin;
  const current: AppDef | undefined = wantsAdmin ? ADMIN_APP : available.find(a => a.key === route.app) ?? available[0];
  const pending = isAdmin ? profiles.filter(p => !p.active || !p.department_id).length : 0;

  // keep the URL pointing at a real app
  useEffect(() => {
    if (!wantsAdmin && current && route.app !== current.key) go(current.key, '');
  }, [wantsAdmin, current, route.app]);

  const appItems = [
    ...available.map(a => ({
      key: a.key,
      label: a.name,
      hint: apps.find(x => x.key === a.key)?.description,
      active: current?.key === a.key,
      onSelect: () => go(a.key),
    })),
    ...(isAdmin ? [{
      key: 'admin', divider: available.length > 0, label: ADMIN_APP.name,
      hint: pending ? `${pending} waiting for approval` : 'People, departments, app access',
      active: wantsAdmin, onSelect: () => go('admin'),
    }] : []),
  ];

  const deptItems = departments.map(d => ({
    key: d.id,
    label: d.name,
    hint: `${profiles.filter(p => p.active && p.department_id === d.id).length} people`,
    active: dept?.id === d.id,
    onSelect: () => setDeptId(d.id),
  }));

  const AppComp = current?.component;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand" onClick={() => go(available[0]?.key ?? (isAdmin ? 'admin' : ''))}>
          <span className="brand-mark">✓</span>
          <span className="brand-name">{PLATFORM_NAME}</span>
        </div>

        {appItems.length > 0 && (
          <Dropdown title="Apps" className="app-switch" items={appItems}
            label={current?.name ?? 'Apps'} />
        )}

        {isAdmin ? (
          departments.length > 0 && !wantsAdmin && (
            <Dropdown title="Departments (admin only)" className="dept-switch" items={deptItems}
              label={<><span className="dept-dot" />{dept?.name ?? 'Department'}</>} />
          )
        ) : (
          dept && <span className="dept-label"><span className="dept-dot" />{dept.name}</span>
        )}

        <div className="topbar-right">
          <Bell />
          <UserMenu />
        </div>
      </header>

      {AppComp && (wantsAdmin || dept) ? (
        <Suspense fallback={<main className="main"><div className="page"><div className="empty">Loading…</div></div></main>}>
          <AppComp key={wantsAdmin ? 'admin' : `${current!.key}-${dept!.id}`} page={route.page} params={route.params} />
        </Suspense>
      ) : (
        <main className="main">
          <div className="page">
            <div className="empty">
              {isAdmin && departments.length === 0 ? (
                <>
                  <h2>Welcome — let's set things up</h2>
                  <p>Create your first department in the Admin console, then add yourself to it.</p>
                  <button className="btn primary" onClick={() => go('admin', 'departments')}>Open Admin console</button>
                </>
              ) : isAdmin ? (
                <>
                  <h2>No apps are switched on for {dept?.name}</h2>
                  <p><button className="btn primary" onClick={() => go('admin', 'departments')}>Turn apps on</button></p>
                </>
              ) : (
                <>
                  <h2>No apps yet</h2>
                  <p>Your administrator hasn't given you access to any apps yet.</p>
                </>
              )}
            </div>
          </div>
        </main>
      )}

      <div className="toasts">
        {toasts.map(t => <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>)}
      </div>
    </div>
  );
}
