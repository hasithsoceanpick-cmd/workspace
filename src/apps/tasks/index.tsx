import { useEffect } from 'react';
import { TasksProvider, useTasks } from './store';
import { go, setParams } from '../../lib/route';
import type { AppProps } from '../../platform/registry';
import { useFeatures } from '../../features/useFeatures';
import TaskDrawer from './TaskDrawer';
import TodayPage from './pages/TodayPage';
import TasksPage from './pages/TasksPage';
import CalendarPage from './pages/CalendarPage';
import DayPage from './pages/DayPage';
import TeamPage from './pages/TeamPage';

/** The Tasks app: today (time blocking), list, calendar, day review, team workload. */
export default function TasksApp(props: AppProps) {
  return (
    <TasksProvider>
      <TasksInner {...props} />
    </TasksProvider>
  );
}

function TasksInner({ page, params }: AppProps) {
  const { isLead, newTask, openTask, drawer, team, loaded } = useTasks();
  const features = useFeatures('tasks');
  const featurePages = features.flatMap(f => f.pages ?? []);

  // open a task straight from a link / notification:  #/tasks?task=123
  useEffect(() => {
    if (params.task && loaded) {
      openTask(Number(params.task));
      setParams({ task: '' });
    }
  }, [params.task, loaded, openTask]);

  const tabs = [
    { id: '', label: 'Today', show: true },
    { id: 'list', label: 'Tasks', show: true },
    { id: 'calendar', label: 'Calendar', show: true },
    { id: 'day', label: 'Day review', show: true },
    { id: 'team', label: 'Team', show: isLead },
    ...featurePages.map(p => ({ id: `x-${p.id}`, label: p.label, show: true })),
  ].filter(t => t.show);
  const current = tabs.some(t => t.id === page) ? page : '';
  const FeaturePage = featurePages.find(p => `x-${p.id}` === current)?.component;

  return (
    <>
      <div className="subnav">
        <nav className="tabs">
          {tabs.map(t => (
            <a key={t.id} href={`#/tasks${t.id ? '/' + t.id : ''}`} className={current === t.id ? 'tab active' : 'tab'}
              onClick={e => { e.preventDefault(); go('tasks', t.id); }}>
              {t.label}
            </a>
          ))}
        </nav>
        {team.length > 0 && (
          <button className="btn primary sm" onClick={() => newTask()}>
            <span className="plus">+</span><span className="hide-sm"> New task</span>
          </button>
        )}
      </div>
      <main className="main">
        {current === '' && <TodayPage params={params} />}
        {current === 'list' && <TasksPage params={params} />}
        {current === 'calendar' && <CalendarPage params={params} />}
        {current === 'day' && <DayPage params={params} />}
        {current === 'team' && <TeamPage />}
        {FeaturePage && <FeaturePage params={params} />}
      </main>
      {drawer && <TaskDrawer key={drawer.mode === 'edit' ? `e${drawer.id}` : 'new'} />}
    </>
  );
}
