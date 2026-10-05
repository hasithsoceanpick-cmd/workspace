import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useTaskApp } from './store';
import { supabase } from '../../supabase';
import type { TaskActivity as Activity, TaskComment as Comment, Task, TaskDraft } from './types';
import { PRIORITIES, STATUSES } from './labels';
import { firstName } from '../../lib/labels';
import { daysBetween, fmtDue, fmtStamp, today } from '../../lib/dates';
import { describe } from './activity';
import { useFeatures } from '../../features/useFeatures';
import Avatar from '../../platform/Avatar';

const editable = (t: TaskDraft | Task) => ({
  title: t.title, notes: t.notes, assignee_id: t.assignee_id, priority: t.priority, due_date: t.due_date,
});

export default function TaskDrawer() {
  const store = useTaskApp();
  const { drawer, closeDrawer, tasks, me, person, team, createTask, updateTask, deleteTask, canDelete, toast } = store;
  const features = useFeatures('tasks').filter(f => f.taskPanel);
  const defaultAssignee = team.some(p => p.id === me.id) ? me.id : team[0]?.id ?? '';
  const isNew = drawer?.mode === 'new';
  const task = drawer?.mode === 'edit' ? tasks.find(t => t.id === drawer.id) : undefined;

  const [form, setForm] = useState<TaskDraft>(() => {
    if (drawer?.mode === 'new') {
      const d = drawer.defaults;
      return {
        title: d.title ?? '', notes: d.notes ?? '', status: d.status ?? 'todo', priority: d.priority ?? 'normal',
        due_date: d.due_date ?? today(),
        assignee_id: d.assignee_id && team.some(p => p.id === d.assignee_id) ? d.assignee_id : defaultAssignee,
      };
    }
    return task ? { ...editable(task), status: task.status } : {
      title: '', notes: '', status: 'todo', priority: 'normal', due_date: today(), assignee_id: defaultAssignee,
    };
  });
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [tab, setTab] = useState<'comments' | 'history'>('comments');
  const [comments, setComments] = useState<Comment[]>([]);
  const [history, setHistory] = useState<Activity[]>([]);
  const [reply, setReply] = useState('');
  const titleRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = titleRef.current;
    if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; }
  }, [form.title, drawer]);

  const loadThread = useCallback(async () => {
    if (!task) return;
    const [c, a] = await Promise.all([
      supabase.from('task_comments').select('*').eq('task_id', task.id).order('created_at'),
      supabase.from('task_activity').select('*').eq('task_id', task.id).order('created_at', { ascending: false }),
    ]);
    if (c.data) setComments(c.data as Comment[]);
    if (a.data) setHistory(a.data as Activity[]);
  }, [task?.id]);

  useEffect(() => { loadThread(); }, [loadThread]);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') closeDrawer(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeDrawer]);

  if (!drawer) return null;
  if (!isNew && !task) {
    return (
      <Frame title="Task" onClose={closeDrawer}>
        <div className="empty">This task is no longer available — it may have been deleted or moved to someone you can't see.</div>
      </Frame>
    );
  }

  const set = <K extends keyof TaskDraft>(k: K, v: TaskDraft[K]) => setForm(f => ({ ...f, [k]: v }));
  const dirty = !!task && JSON.stringify(editable(form)) !== JSON.stringify(editable(task));
  const assignOptions = team.some(p => p.id === form.assignee_id) || !person(form.assignee_id)
    ? team : [...team, person(form.assignee_id)!];
  const canReassign = team.length > 1;

  function validate(): string | null {
    if (!form.title.trim()) return 'Give the task a title.';
    if (!form.due_date) return 'Pick a deadline.';
    return null;
  }

  async function save() {
    const err = validate();
    if (err) return toast(err, 'error');
    setBusy(true);
    if (isNew) {
      const t = await createTask({ ...form, title: form.title.trim() });
      setBusy(false);
      if (t) {
        const who = person(t.assignee_id);
        toast(t.assignee_id === me.id ? 'Task added' : `Assigned to ${firstName(who?.full_name ?? '')}`);
        closeDrawer();
      }
    } else if (task) {
      const patch: Partial<TaskDraft> = {};
      (Object.keys(editable(form)) as (keyof ReturnType<typeof editable>)[]).forEach(k => {
        if (form[k] !== task[k]) (patch as Record<string, unknown>)[k] = k === 'title' ? form.title.trim() : form[k];
      });
      const t = await updateTask(task.id, patch);
      setBusy(false);
      if (t) { toast('Saved'); loadThread(); }
    }
  }

  async function setStatus(s: TaskDraft['status']) {
    set('status', s);
    if (task && s !== task.status) {
      const t = await updateTask(task.id, { status: s });
      if (t) loadThread(); else set('status', task.status);
    }
  }

  async function sendComment() {
    if (!task || !reply.trim()) return;
    const { error } = await supabase.from('task_comments').insert({ task_id: task.id, body: reply.trim() });
    if (error) return toast(error.message, 'error');
    setReply('');
    loadThread();
  }

  async function remove() {
    if (!task) return;
    if (await deleteTask(task.id)) { toast('Task deleted'); closeDrawer(); }
  }

  const onTitleKey = (e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); if (isNew) save(); } };
  const overdue = task && task.status !== 'done' && task.due_date < today();
  const creator = person(task?.created_by);
  const nameOf = (id: string | null) => person(id)?.full_name ?? 'Someone';

  return (
    <Frame title={isNew ? 'New task' : `Task #${task!.id}`} onClose={closeDrawer}>
      <textarea
        ref={titleRef}
        className="title-input"
        rows={1}
        placeholder="What needs to be done?"
        value={form.title}
        autoFocus={isNew}
        onChange={e => set('title', e.target.value)}
        onKeyDown={onTitleKey}
      />

      <div className="seg" role="radiogroup" aria-label="Status">
        {STATUSES.map(s => (
          <button key={s.value} type="button" className={`seg-btn s-${s.value} ${form.status === s.value ? 'on' : ''}`}
            onClick={() => setStatus(s.value)}>{s.label}</button>
        ))}
      </div>

      <div className="fields">
        <label className="field">
          <span>Assigned to</span>
          {canReassign ? (
            <select value={form.assignee_id} onChange={e => set('assignee_id', e.target.value)}>
              {assignOptions.map(p => (
                <option key={p.id} value={p.id} disabled={!team.some(x => x.id === p.id)}>
                  {p.id === me.id ? `${p.full_name} (me)` : p.full_name}
                </option>
              ))}
            </select>
          ) : (
            <div className="static-field"><Avatar p={person(form.assignee_id)} size={20} /> {person(form.assignee_id)?.full_name}</div>
          )}
        </label>
        <label className="field">
          <span>Deadline {task && form.due_date === task.due_date && (
            <em className={overdue ? 'danger' : 'muted'}>· {overdue ? `${daysBetween(task.due_date, today())}d overdue` : fmtDue(task.due_date)}</em>
          )}</span>
          <input type="date" value={form.due_date} onChange={e => set('due_date', e.target.value)} required />
        </label>
        <label className="field">
          <span>Priority</span>
          <select value={form.priority} onChange={e => set('priority', e.target.value as TaskDraft['priority'])}>
            {PRIORITIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </label>
      </div>

      <label className="field">
        <span>Notes</span>
        <textarea rows={4} placeholder="Details, links, anything useful…" value={form.notes} onChange={e => set('notes', e.target.value)} />
      </label>

      {isNew ? (
        <div className="row gap end">
          <button className="btn" onClick={closeDrawer}>Cancel</button>
          <button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Create task'}</button>
        </div>
      ) : (
        <>
          {dirty && (
            <div className="save-bar">
              <span>Unsaved changes</span>
              <div className="row gap">
                <button className="btn sm" onClick={() => setForm({ ...editable(task!), status: form.status })}>Discard</button>
                <button className="btn primary sm" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save changes'}</button>
              </div>
            </div>
          )}
          <div className="meta">
            Assigned by {creator ? creator.full_name : 'unknown'} · created {fmtStamp(task!.created_at)}
            {task!.completed_at && <> · completed {fmtStamp(task!.completed_at)}</>}
          </div>

          {features.map(f => {
            const Panel = f.taskPanel!;
            return <div key={f.key} className="feature-slot"><Panel task={task!} /></div>;
          })}

          <div className="subtabs">
            <button className={tab === 'comments' ? 'on' : ''} onClick={() => setTab('comments')}>
              Comments {comments.length > 0 && <span className="count">{comments.length}</span>}
            </button>
            <button className={tab === 'history' ? 'on' : ''} onClick={() => setTab('history')}>History</button>
          </div>

          {tab === 'comments' ? (
            <div className="thread">
              {comments.length === 0 && <div className="muted small">No comments yet.</div>}
              {comments.map(c => (
                <div key={c.id} className="comment">
                  <Avatar p={person(c.author_id)} size={26} />
                  <div className="c-body">
                    <div className="c-head"><strong>{nameOf(c.author_id)}</strong> <span className="muted small">{fmtStamp(c.created_at)}</span></div>
                    <div className="c-text">{c.body}</div>
                  </div>
                </div>
              ))}
              <div className="reply">
                <textarea rows={2} placeholder="Write a comment… (Ctrl+Enter to send)" value={reply}
                  onChange={e => setReply(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) sendComment(); }} />
                <button className="btn sm" disabled={!reply.trim()} onClick={sendComment}>Send</button>
              </div>
            </div>
          ) : (
            <ul className="history">
              {history.map(a => {
                const d = describe(a, nameOf);
                return (
                  <li key={a.id}>
                    <span className="h-time">{fmtStamp(a.created_at)}</span>
                    <span><strong>{nameOf(a.actor_id)}</strong> {d.verb}{d.detail && a.kind !== 'comment' ? <> <span className="muted">{d.detail}</span></> : null}</span>
                  </li>
                );
              })}
            </ul>
          )}

          {canDelete(task!) && (
            <div className="danger-zone">
              {confirmDelete ? (
                <>
                  <span>Delete this task for everyone?</span>
                  <button className="btn danger sm" onClick={remove}>Yes, delete</button>
                  <button className="btn sm" onClick={() => setConfirmDelete(false)}>Keep</button>
                </>
              ) : (
                <button className="link danger" onClick={() => setConfirmDelete(true)}>Delete task</button>
              )}
            </div>
          )}
        </>
      )}
    </Frame>
  );
}

function Frame({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label={title}>
        <div className="drawer-head">
          <span className="muted">{title}</span>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="drawer-body">{children}</div>
      </aside>
    </>
  );
}
