import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode } from 'react';
import { useTaskApp } from './store';
import { supabase } from '../../supabase';
import type { TaskActivity as Activity, TaskComment as Comment, Task, TaskDraft } from './types';
import { PRIORITIES, REMINDS, REPEATS, STATUSES, isLate } from './labels';
import { DueMovesList } from './DueHistory';
import { firstName } from '../../lib/labels';
import { daysBetween, fmtDay, fmtDue, fmtStamp, today } from '../../lib/dates';
import { describe } from './activity';
import { useFeatures } from '../../features/useFeatures';
import { clipboardFiles } from '../../platform/files';
import { TASK_PANELS } from '../../platform/slots';
import Avatar from '../../platform/Avatar';
import { TaskFiles, useTaskFiles } from './TaskFiles';
import { Checklist, useChecklist } from './Checklist';

const editable = (t: TaskDraft | Task) => ({
  title: t.title, notes: t.notes, assignee_id: t.assignee_id, priority: t.priority, due_date: t.due_date,
  repeat: t.repeat ?? null, remind_days: t.remind_days ?? null, needs_check: t.needs_check ?? true,
});

export default function TaskDrawer() {
  const store = useTaskApp();
  const {
    drawer, closeDrawer, tasks, me, person, team, createTask, updateTask, deleteTask, canDelete, toast,
    helpersOf, helperOnly, helperCandidates, addHelper, removeHelper, isLead, refreshChecklist, myAppKeys, fullView,
    canCheck, checkerOf, acknowledge, sendBack, refresh,
  } = store;
  const features = useFeatures('tasks').filter(f => f.taskPanel);
  const panels = TASK_PANELS.filter(p => myAppKeys.includes(p.app));
  const defaultAssignee = team.some(p => p.id === me.id) ? me.id : team[0]?.id ?? '';
  const isNew = drawer?.mode === 'new';
  const task = drawer?.mode === 'edit' ? tasks.find(t => t.id === drawer.id) : undefined;
  const readOnly = !!task && helperOnly(task);   // helpers can't change the task itself

  const [form, setForm] = useState<TaskDraft>(() => {
    if (drawer?.mode === 'new') {
      const d = drawer.defaults;
      return {
        title: d.title ?? '', notes: d.notes ?? '', status: d.status ?? 'todo', priority: d.priority ?? 'normal',
        due_date: d.due_date ?? today(), repeat: d.repeat ?? null, remind_days: d.remind_days ?? null, needs_check: true,
        assignee_id: d.assignee_id && team.some(p => p.id === d.assignee_id) ? d.assignee_id : defaultAssignee,
      };
    }
    return task ? { ...editable(task), status: task.status } : {
      title: '', notes: '', status: 'todo', priority: 'normal', due_date: today(), assignee_id: defaultAssignee, repeat: null,
      remind_days: null, needs_check: true,
    };
  });
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [tab, setTab] = useState<'comments' | 'history'>('comments');
  const [comments, setComments] = useState<Comment[]>([]);
  const [history, setHistory] = useState<Activity[]>([]);
  const [reply, setReply] = useState('');
  const [showMoves, setShowMoves] = useState(false);
  const [newHelpers, setNewHelpers] = useState<string[]>([]);
  const [backReason, setBackReason] = useState<string | null>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const files = useTaskFiles(task?.id ?? null);
  const steps = useChecklist(task?.id ?? null, refreshChecklist);

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
  }, [task?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadThread(); }, [loadThread]);

  // opened from an alert about a task that arrived after the list was loaded: fetch the list once more
  const [checked, setChecked] = useState(false);
  const seeded = useRef(isNew || !!task);
  useEffect(() => {
    if (!seeded.current && task) { seeded.current = true; setForm({ ...editable(task), status: task.status }); }
  }, [task]);
  const wanted = drawer?.mode === 'edit' ? drawer.id : null;
  useEffect(() => {
    if (wanted === null || task || checked) return;
    refresh().finally(() => setChecked(true));
  }, [wanted, task, checked, refresh]);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') closeDrawer(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeDrawer]);

  if (!drawer) return null;
  if (!isNew && !task && !checked) {
    return <Frame title="Task" onClose={closeDrawer}><div className="empty">Loading…</div></Frame>;
  }
  if (!isNew && !task) {
    return (
      <Frame title="Task" onClose={closeDrawer}>
        <div className="empty">This task is no longer available. It may have been deleted, or moved to someone you can't see.</div>
      </Frame>
    );
  }

  const set = <K extends keyof TaskDraft>(k: K, v: TaskDraft[K]) => setForm(f => ({ ...f, [k]: v }));
  const dirty = !!task && !readOnly && JSON.stringify(editable(form)) !== JSON.stringify(editable(task));
  const assignOptions = team.some(p => p.id === form.assignee_id) || !person(form.assignee_id)
    ? team : [...team, person(form.assignee_id)!];
  const canReassign = team.length > 1 && !readOnly;
  const helpers = task ? helpersOf(task.id) : newHelpers;
  const candidates = helperCandidates({ assignee_id: form.assignee_id }).filter(p => !helpers.includes(p.id));

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
      if (t) {
        for (const h of newHelpers.filter(h => h !== t.assignee_id)) await addHelper(t.id, h);
        await steps.flush(t.id);
        await files.flush(t.id);
        refreshChecklist();
        const who = person(t.assignee_id);
        toast(t.assignee_id === me.id ? 'Task added' : `Assigned to ${firstName(who?.full_name ?? '')}`);
        setBusy(false);
        closeDrawer();
      } else setBusy(false);
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
    if (readOnly) return;
    if (task && task.status === 'review' && s === 'done' && !canCheck(task)) {
      return toast(`Waiting for ${firstName(checkerOf(task)?.full_name ?? 'the checker')} to sign it off.`);
    }
    set('status', s);
    if (task && s !== task.status) {
      const t = await updateTask(task.id, { status: s });
      if (t) {
        set('status', t.status);
        if (t.status === 'review' && task.status !== 'review') toast(`Sent to ${firstName(checkerOf(t)?.full_name ?? 'the checker')} for sign-off`);
        else if (t.status === 'done' && task.status === 'review') toast(task.repeat && !task.next_task_id ? 'Signed off — the next one has been created' : 'Signed off');
        loadThread();
      } else set('status', task.status);
    }
  }

  async function doSendBack() {
    if (!task || !backReason?.trim()) return toast('Say what needs fixing.', 'error');
    setBusy(true);
    const ok = await sendBack(task.id, backReason.trim());
    setBusy(false);
    if (ok) {
      setBackReason(null);
      set('status', 'doing');
      toast(`Sent back to ${firstName(nameOf(task.assignee_id))}`);
      loadThread();
    }
  }

  async function gotIt() {
    if (!task) return;
    await acknowledge(task.id);
    loadThread();
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

  async function onAddHelper(id: string) {
    if (!id) return;
    if (!task) return setNewHelpers(h => [...h, id]);
    if (await addHelper(task.id, id)) { toast(`${firstName(person(id)?.full_name ?? '')} added as helper`); loadThread(); }
  }
  async function onRemoveHelper(id: string) {
    if (!task) return setNewHelpers(h => h.filter(x => x !== id));
    if (await removeHelper(task.id, id)) loadThread();
  }

  // Ctrl+V a screenshot anywhere in the panel → attached to the task
  function onPaste(e: ClipboardEvent) {
    const f = clipboardFiles(e);
    if (!f.length) return;
    e.preventDefault();
    files.addFiles(f);
    toast(f.length === 1 ? 'Screenshot added' : `${f.length} files added`);
  }

  const onTitleKey = (e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); if (isNew) save(); } };
  const overdue = task && isLate(task, today());
  const givenToOther = isNew ? form.assignee_id !== me.id : !!task && !!task.created_by && task.created_by !== form.assignee_id;
  const mayChangeCheck = isNew || (!!task && canCheck(task));
  const checker = task ? checkerOf(task) : undefined;
  const lastTurn = history.find(a => a.kind === 'sent_back' || a.kind === 'status');
  const sentBack = task && task.status !== 'review' && task.status !== 'done' && lastTurn?.kind === 'sent_back' ? lastTurn : null;
  const creator = person(task?.created_by);
  const nameOf = (id: string | null) => person(id)?.full_name ?? 'Someone';
  const canRemoveFile = (a: { created_by: string | null }) => a.created_by === me.id || (!!task && !readOnly);

  return (
    <Frame title={isNew ? 'New task' : `Task #${task!.id}`} onClose={closeDrawer} onPaste={onPaste}>
      {readOnly && (
        <div className="helper-banner">You're helping on this task. You can tick steps, add files and comment. {firstName(nameOf(task!.assignee_id))} marks it done.</div>
      )}
      {task && !task.acknowledged_at && task.assignee_id === me.id && (
        <div className="ack-banner">
          <span><strong>{firstName(nameOf(task.created_by))}</strong> gave you this task. Let them know you've seen it.</span>
          <button className="btn primary sm" onClick={gotIt}>Got it</button>
        </div>
      )}
      {task?.status === 'review' && (
        <div className="review-banner">
          {canCheck(task) ? (
            backReason === null ? (
              <>
                <span><strong>{firstName(nameOf(task.assignee_id))}</strong> finished this{task.submitted_at ? ` ${fmtStamp(task.submitted_at)}` : ''}. Check it and sign it off.</span>
                <div className="row gap">
                  <button className="btn primary sm" onClick={() => setStatus('done')}>Sign off</button>
                  <button className="btn sm" onClick={() => setBackReason('')}>Send back…</button>
                </div>
              </>
            ) : (
              <div className="send-back">
                <textarea autoFocus rows={2} placeholder={`What does ${firstName(nameOf(task.assignee_id))} need to fix?`}
                  value={backReason} onChange={e => setBackReason(e.target.value)} />
                <div className="row gap">
                  <button className="btn danger sm" disabled={busy || !backReason.trim()} onClick={doSendBack}>Send back</button>
                  <button className="btn sm" onClick={() => setBackReason(null)}>Cancel</button>
                </div>
              </div>
            )
          ) : (
            <>
              <span>Finished — waiting for <strong>{firstName(checker?.full_name ?? 'the checker')}</strong> to sign it off.</span>
              {task.assignee_id === me.id && <button className="btn sm" onClick={() => setStatus('doing')}>Take it back</button>}
            </>
          )}
        </div>
      )}
      {sentBack && (
        <div className="sentback-banner">
          <strong>{firstName(nameOf(sentBack.actor_id))} sent this back</strong>{sentBack.new_value ? <>: “{sentBack.new_value}”</> : null}
          <span className="muted small"> · {fmtStamp(sentBack.created_at)}</span>
        </div>
      )}
      <textarea
        ref={titleRef}
        className="title-input"
        rows={1}
        placeholder="What needs to be done?"
        value={form.title}
        autoFocus={isNew}
        readOnly={readOnly}
        onChange={e => set('title', e.target.value)}
        onKeyDown={onTitleKey}
      />

      <div className="seg" role="radiogroup" aria-label="Status">
        {STATUSES.map(s => {
          const half = s.value === 'done' && form.status === 'review';
          return (
            <button key={s.value} type="button" disabled={readOnly && form.status !== s.value && !half}
              className={`seg-btn s-${s.value} ${form.status === s.value ? 'on' : ''} ${half ? 'half' : ''}`}
              title={half ? 'Finished — waiting for sign-off' : s.value === 'done' && givenToOther && form.needs_check ? 'Sends it for sign-off' : undefined}
              onClick={() => setStatus(s.value)}>{half ? 'Sign-off' : s.label}</button>
          );
        })}
      </div>

      <div className="fields">
        <label className="field">
          <span>Owner</span>
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
          <input type="date" value={form.due_date} onChange={e => set('due_date', e.target.value)} required disabled={readOnly} />
        </label>
        <label className="field">
          <span>Priority</span>
          <select value={form.priority} onChange={e => set('priority', e.target.value as TaskDraft['priority'])} disabled={readOnly}>
            {PRIORITIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </label>
      </div>

      <div className="fields">
        <label className="field">
          <span>Repeat</span>
          <select value={form.repeat ?? ''} onChange={e => set('repeat', (e.target.value || null) as TaskDraft['repeat'])} disabled={readOnly}>
            <option value="">Doesn't repeat</option>
            {REPEATS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Early reminder</span>
          <select value={form.remind_days ?? ''} onChange={e => set('remind_days', e.target.value ? Number(e.target.value) : null)} disabled={readOnly}>
            <option value="">None</option>
            {REMINDS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </label>
        {givenToOther && (
          <label className="field">
            <span>Sign-off</span>
            <select value={form.needs_check ? 'yes' : 'no'} onChange={e => set('needs_check', e.target.value === 'yes')}
              disabled={readOnly || !mayChangeCheck}>
              <option value="yes">{isNew || task?.created_by === me.id ? 'I check it when done' : `${firstName(nameOf(task?.created_by ?? null))} checks it`}</option>
              <option value="no">Not needed</option>
            </select>
          </label>
        )}
      </div>
      {form.repeat && <div className="field-note">When this is {givenToOther && form.needs_check ? 'signed off' : 'marked done'}, the next one is created automatically, with the same owner, helpers and checklist.</div>}

      {task && task.due_moves > 0 && (
        <div className="due-history">
          <button type="button" className="link" onClick={() => setShowMoves(v => !v)}>
            Deadline moved {task.due_moves}× · first set for {fmtDay(task.original_due ?? task.due_date)} {showMoves ? '▴' : '▾'}
          </button>
          {showMoves && <DueMovesList task={task} moves={history.filter(a => a.kind === 'due_date').reverse()} />}
        </div>
      )}

      {(helpers.length > 0 || (isLead && !readOnly)) && (
        <div className="field">
          <span>Helpers</span>
          <div className="helpers">
            {helpers.map(id => (
              <span key={id} className="helper-chip">
                <Avatar p={person(id)} size={20} /> {id === me.id ? 'Me' : person(id)?.full_name ?? 'Former member'}
                {isLead && !readOnly && (task ? (fullView || person(id)?.role === 'member' || id === me.id) : true) && (
                  <button type="button" onClick={() => onRemoveHelper(id)} aria-label={`Remove helper ${person(id)?.full_name}`}>✕</button>
                )}
              </span>
            ))}
            {isLead && !readOnly && candidates.length > 0 && (
              <select className="helper-add" value="" onChange={e => onAddHelper(e.target.value)} aria-label="Add a helper">
                <option value="">+ Add helper</option>
                {candidates.map(p => <option key={p.id} value={p.id}>{p.id === me.id ? `${p.full_name} (me)` : p.full_name}</option>)}
              </select>
            )}
          </div>
        </div>
      )}

      <label className="field">
        <span>Notes</span>
        <textarea rows={3} placeholder={readOnly ? '' : 'Details, anything useful…'} value={form.notes} readOnly={readOnly}
          onChange={e => set('notes', e.target.value)} />
      </label>

      <Checklist list={steps} />
      <TaskFiles files={files} canRemove={canRemoveFile} />

      {isNew ? (
        <div className="row gap end create-row">
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
            {task!.created_by !== task!.assignee_id && (
              task!.acknowledged_at
                ? <> · opened by {firstName(nameOf(task!.assignee_id))} {fmtStamp(task!.acknowledged_at)}</>
                : <> · <span className="warn-text">not opened yet by {firstName(nameOf(task!.assignee_id))}</span></>
            )}
            {task!.status === 'review' && task!.submitted_at && <> · finished {fmtStamp(task!.submitted_at)}</>}
            {task!.completed_at && <> · completed {fmtStamp(task!.completed_at)}</>}
            {task!.status === 'done' && task!.checked_by && <> · signed off by {firstName(nameOf(task!.checked_by))}</>}
            {task!.sent_back_n > 0 && <> · sent back {task!.sent_back_n}×</>}
          </div>

          {panels.map(p => {
            const Panel = p.component;
            return <div key={p.app} className="feature-slot"><Panel task={task!} /></div>;
          })}
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

function Frame({ title, onClose, children, onPaste }: {
  title: string; onClose: () => void; children: ReactNode; onPaste?: (e: ClipboardEvent) => void;
}) {
  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label={title} onPaste={onPaste}>
        <div className="drawer-head">
          <span className="muted">{title}</span>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="drawer-body">{children}</div>
      </aside>
    </>
  );
}
