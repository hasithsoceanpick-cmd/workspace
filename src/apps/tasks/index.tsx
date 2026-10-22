import { Suspense, lazy, useEffect } from 'react';
import { TasksProvider, useTasks } from './store';
import { go, replaceRoute, setParams } from '../../lib/route';
import type { AppProps } from '../../platform/registry';
import { useFeatures } from '../../features/useFeatures';
import TaskDrawer from './TaskDrawer';
import TodayPage from './pages/TodayPage';
import TasksPage from './pages/TasksPage';
const CalendarPage = lazy(() => import('./pages/CalendarPage'));
const DayPage = lazy(() => import('./pages/DayPage'));
const TeamPage = lazy(() => import('./pages/TeamPage'));
const WeekPage = lazy(() => import('./pages/WeekPage'));
const TrendsPage = lazy(() => import('./pages/TrendsPage'));
import HomePage from './pages/HomePage';
import NewPage from './pages/NewPage';
import RemindersPage from './pages/RemindersPage';
const OutputPage = lazy(() => import('./pages/OutputPage'));
const FollowUpsPage = lazy(() => import('./pages/FollowUpsPage'));
const ProjectsPage = lazy(() => import('./pages/ProjectsPage'));
const ProjectPage = lazy(() => import('./pages/ProjectPage'));

// managers and senior executives land on Home the first time the app opens (Today is one tab away)
let landed = false;

/** The Tasks app: today (time blocking), list, calendar, day review, team workload. */
export default function TasksApp(props: AppProps) {
  return (
    <TasksProvider>
      <TasksInner {...props} />
    </TasksProvider>
  );
}

function TasksInner({ page, params }: AppProps) {
  const { isLead, newTask, openTask, drawer, team, loaded, inbox } = useTasks();
  const features = useFeatures('tasks');
  const featurePages = features.flatMap(f => f.pages ?? []);

  useEffect(() => {
    if (landed) return;
    landed = true;
    if (!isLead) return;
    // after the shell has settled the address (it may still be pointing at the bare site)
    setTimeout(() => {
      const h = window.location.hash.replace(/^#\/?/, '');
      if (h === '' || h === 'tasks' || h === 'tasks/') replaceRoute('tasks', 'home');
    }, 0);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // open a task straight from a link / notification:  #/tasks?task=123
  useEffect(() => {
    if (params.task && loaded) {
      openTask(Number(params.task));
      setParams({ task: '' });
    }
  }, [params.task, loaded, openTask]);

  const tabs: { id: string; label: string; show: boolean; count?: number }[] = [
    { id: 'home', label: 'Home', show: isLead },
    { id: '', label: 'Today', show: true },
    { id: 'new', label: 'New', show: inbox.length > 0 || page === 'new', count: inbox.length },
    { id: 'list', label: 'Tasks', show: true },
    { id: 'projects', label: 'Projects', show: true },
    { id: 'followups', label: 'Follow-ups', show: true },
    { id: 'calendar', label: 'Calendar', show: true },
    { id: 'day', label: 'Day review', show: true },
    { id: 'output', label: 'My output', show: true },
    { id: 'team', label: "Who's on what", show: isLead },
    { id: 'week', label: 'Reports', show: isLead },
    ...featurePages.map(p => ({ id: `x-${p.id}`, label: p.label, show: true })),
  ].filter(t => t.show);
  // Reports has two views: this week ('week', opened by the Monday alert) and month-by-month trends
  const current = tabs.some(t => t.id === page) ? page : page === 'trends' && isLead ? 'trends' : page === 'reminders' ? 'reminders'
    : page === 'project' ? 'project' : '';
  const activeTab = current === 'trends' ? 'week' : current === 'project' ? 'projects' : current;
  const FeaturePage = featurePages.find(p => `x-${p.id}` === current)?.component;

  return (
    <>
      <div className="subnav">
        <nav className="tabs">
          {tabs.map(t => (
            <a key={t.id} href={`#/tasks${t.id ? '/' + t.id : ''}`} className={activeTab === t.id ? 'tab active' : 'tab'}
              onClick={e => { e.preventDefault(); go('tasks', t.id); }}>
              {t.label}{t.count ? <span className="badge">{t.count}</span> : null}
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
        <Suspense fallback={<div className="page"><div className="empty">Loading…</div></div>}>
        {inbox.length > 0 && current !== 'new' && current !== 'home' && (
          <div className="page"><button className="new-banner" onClick={() => go('tasks', 'new')}>
            <strong>{inbox.length} new task{inbox.length === 1 ? '' : 's'} for you</strong> — open them and press Got it →
          </button></div>
        )}
        {current === 'home' && <HomePage />}
        {current === 'new' && <NewPage />}
        {current === 'reminders' && <RemindersPage />}
        {current === '' && <TodayPage params={params} />}
        {current === 'list' && <TasksPage params={params} />}
        {current === 'calendar' && <CalendarPage params={params} />}
        {current === 'day' && <DayPage params={params} />}
        {current === 'output' && <OutputPage params={params} />}
        {current === 'followups' && <FollowUpsPage params={params} />}
        {current === 'projects' && <ProjectsPage params={params} />}
        {current === 'project' && <ProjectPage params={params} />}
        {current === 'team' && <TeamPage params={params} />}
        {current === 'week' && <WeekPage params={params} />}
        {current === 'trends' && <TrendsPage params={params} />}
        {FeaturePage && <FeaturePage params={params} />}
        </Suspense>
      </main>
      {drawer && <TaskDrawer key={drawer.mode === 'edit' ? `e${drawer.id}` : 'new'} />}
    </>
  );
}
