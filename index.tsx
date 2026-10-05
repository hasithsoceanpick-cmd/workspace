import { usePlatform } from '../../platform/store';
import { go } from '../../lib/route';
import type { AppProps } from '../../platform/registry';
import PeoplePage from './PeoplePage';
import DepartmentsPage from './DepartmentsPage';

/** Admin console — only the platform admin can open this (and the database enforces it). */
export default function AdminApp({ page, params }: AppProps) {
  const { isAdmin, profiles } = usePlatform();
  if (!isAdmin) return null;
  const pending = profiles.filter(p => !p.active || !p.department_id).length;
  const current = page === 'departments' ? 'departments' : 'people';

  return (
    <>
      <div className="subnav admin-subnav">
        <nav className="tabs">
          <a href="#/admin/people" className={current === 'people' ? 'tab active' : 'tab'}
            onClick={e => { e.preventDefault(); go('admin', 'people'); }}>
            People {pending > 0 && <span className="badge">{pending}</span>}
          </a>
          <a href="#/admin/departments" className={current === 'departments' ? 'tab active' : 'tab'}
            onClick={e => { e.preventDefault(); go('admin', 'departments'); }}>
            Departments &amp; apps
          </a>
        </nav>
        <span className="admin-tag">Admin only</span>
      </div>
      <main className="main">
        {current === 'people' ? <PeoplePage params={params} /> : <DepartmentsPage />}
      </main>
    </>
  );
}
