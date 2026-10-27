-- =====================================================================
--  WORKSPACE — Messages app (step 9 of 9)
--  Run after 01–08. Safe to run again.
--
--  Per department: a team chat, announcements (managers post, everyone
--  presses "Got it") and one-to-one chats (private to the two people —
--  not even the admin can read them). Messages can carry tasks, notes,
--  reminders and mini tasks as cards, files and screenshots, replies,
--  @mentions; WhatsApp-style delivered / seen ticks.
--  Every object is named msg_* — the older app's "messages",
--  "conversations" and "chat_reads" tables are never touched.
-- =====================================================================

-- Safety: the live project also holds an older app's tables. If anything named msg_… exists that Workspace didn't
-- make (no msg_threads yet), stop before touching it.
do $$
begin
  if to_regclass('public.msg_threads') is null and (
       exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname like 'msg\_%')
    or exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                where n.nspname = 'public' and c.relname like 'msg\_%')) then
    raise exception 'Stopped before the Messages part: this database already has something named msg_… that Workspace did not create. Nothing in it was changed.';
  end if;
end $$;

-- The app. The first time this runs it is switched on for every department that has Tasks.
do $$
begin
  if not exists (select 1 from public.apps where key = 'messages') then
    insert into public.apps (key, name, description, sort)
    values ('messages', 'Messages', 'Team chat, one-to-one messages and announcements', 30);
    insert into public.department_apps (department_id, app_key)
    select department_id, 'messages' from public.department_apps where app_key = 'tasks'
    on conflict do nothing;
  end if;
end $$;
update public.apps set name = 'Messages', description = 'Team chat, one-to-one messages and announcements'
 where key = 'messages';

-- ---------- Tables -----------------------------------------------------
-- A conversation: the department's team chat, its announcements, or a one-to-one chat (user_a < user_b).
create table if not exists public.msg_threads (
  id             bigint generated always as identity primary key,
  department_id  uuid not null references public.departments(id) on delete cascade,
  kind           text not null check (kind in ('team', 'announce', 'direct')),
  user_a         uuid references public.profiles(id) on delete cascade,
  user_b         uuid references public.profiles(id) on delete cascade,
  last_at        timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  check ((kind = 'direct') = (user_a is not null and user_b is not null)),
  check (user_a is null or user_a < user_b)
);
create unique index if not exists msg_threads_shared_idx on public.msg_threads (department_id, kind) where kind <> 'direct';
create unique index if not exists msg_threads_direct_idx on public.msg_threads (user_a, user_b) where kind = 'direct';

create table if not exists public.msg_messages (
  id             bigint generated always as identity primary key,
  thread_id      bigint not null references public.msg_threads(id) on delete cascade,
  department_id  uuid not null references public.departments(id) on delete cascade,
  author_id      uuid default auth.uid() references public.profiles(id) on delete set null,
  body           text not null default '' check (length(body) <= 4000),
  reply_to       bigint references public.msg_messages(id) on delete set null,
  mentions       uuid[] not null default '{}',
  created_at     timestamptz not null default now(),
  edited_at      timestamptz,
  deleted_at     timestamptz
);
create index if not exists msg_messages_thread_idx on public.msg_messages (thread_id, id);
create index if not exists msg_messages_dept_idx on public.msg_messages (department_id, created_at);

-- Work in a message: attached to it, sent as it ("Send as"), or made from it later ("Turn into work").
create table if not exists public.msg_items (
  id             bigint generated always as identity primary key,
  message_id     bigint not null references public.msg_messages(id) on delete cascade,
  thread_id      bigint not null references public.msg_threads(id) on delete cascade,
  department_id  uuid not null references public.departments(id) on delete cascade,
  kind           text not null check (kind in ('task', 'note', 'reminder', 'mini')),
  ref_id         bigint not null,
  relation       text not null default 'attached' check (relation in ('attached', 'sent', 'made')),
  title          text not null default '' check (length(title) <= 300),   -- shown even to people who can't open it
  for_id         uuid references public.profiles(id) on delete set null,   -- who the work is for
  remind_at      timestamptz,                                              -- reminders: when ("Remind me too")
  created_by     uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now()
);
create index if not exists msg_items_message_idx on public.msg_items (message_id);

-- Files and screenshots, in the private bucket under messages/<thread id>/…
create table if not exists public.msg_files (
  id             bigint generated always as identity primary key,
  message_id     bigint not null references public.msg_messages(id) on delete cascade,
  thread_id      bigint not null references public.msg_threads(id) on delete cascade,
  department_id  uuid not null references public.departments(id) on delete cascade,
  path           text not null,
  name           text not null,
  size           bigint,
  mime           text,
  created_by     uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now()
);
create index if not exists msg_files_message_idx on public.msg_files (message_id);

-- Ticks: when each person's app last fetched a conversation (delivered) and last opened it (seen).
create table if not exists public.msg_reads (
  thread_id      bigint not null references public.msg_threads(id) on delete cascade,
  user_id        uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  department_id  uuid not null references public.departments(id) on delete cascade,
  delivered_at   timestamptz,
  read_at        timestamptz,
  primary key (thread_id, user_id)
);

-- Announcements: who pressed "Got it".
create table if not exists public.msg_acks (
  message_id     bigint not null references public.msg_messages(id) on delete cascade,
  user_id        uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  thread_id      bigint not null references public.msg_threads(id) on delete cascade,
  department_id  uuid not null references public.departments(id) on delete cascade,
  acked_at       timestamptz not null default now(),
  primary key (message_id, user_id)
);

-- ---------- Who can see / write ------------------------------------------
-- See a conversation: one-to-one → only the two people (never anyone else, not even the admin);
-- team chat and announcements → the department's people with Messages, and the admin.
create or replace function public.msg_can_see(p_thread bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select case when t.kind = 'direct' then auth.uid() in (t.user_a, t.user_b)
                else public.is_admin()
                     or (t.department_id = public.my_dept() and public.user_has_app(auth.uid(), 'messages', t.department_id))
           end
      from public.msg_threads t where t.id = p_thread), false)
$$;

-- Write in it: one-to-one → the two; team → the department (and the admin); announcements → managers (and the admin).
create or replace function public.msg_can_post(p_thread bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select case t.kind
             when 'direct' then auth.uid() in (t.user_a, t.user_b)
             when 'team' then public.is_admin()
                              or (t.department_id = public.my_dept() and public.user_has_app(auth.uid(), 'messages', t.department_id))
             else public.is_admin()
                  or (t.department_id = public.my_dept() and public.user_has_app(auth.uid(), 'messages', t.department_id)
                      and public.my_role() = 'manager')
           end
      from public.msg_threads t where t.id = p_thread), false)
$$;

-- The department's people who have Messages (team chat and announcement members)
create or replace function public.msg_members(p_dept uuid) returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(p.id), '{}') from public.profiles p
   where p.active and p.department_id = p_dept and public.user_has_app(p.id, 'messages', p_dept)
$$;

-- Files: messages/<thread id>/…  read → can see it; add / remove → can write in it
create or replace function public.msg_file_ok(p_name text, p_write boolean) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare ref bigint;
begin
  if split_part(p_name, '/', 1) <> 'messages' then return false; end if;
  begin
    ref := split_part(p_name, '/', 2)::bigint;
  exception when others then
    return false;
  end;
  return case when p_write then public.msg_can_post(ref) else public.msg_can_see(ref) end;
end $$;

-- ---------- Opening conversations ----------------------------------------
-- The team chat and announcements of a department exist from the first look.
create or replace function public.msg_shared(p_dept uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_admin() or (p_dept = public.my_dept() and public.user_has_app(auth.uid(), 'messages', p_dept))) then
    return;
  end if;
  insert into public.msg_threads (department_id, kind) values (p_dept, 'team'), (p_dept, 'announce')
  on conflict do nothing;
end $$;

-- A one-to-one chat with someone in my department (found or started). Returns its id.
create or replace function public.msg_direct(p_other uuid) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  d  uuid := public.dept_of(p_other);
  a  uuid := least(me, p_other);
  b  uuid := greatest(me, p_other);
  tid bigint;
begin
  if me is null or p_other is null or p_other = me then
    raise exception 'Pick someone to message.';
  end if;
  if d is null or not public.user_has_app(p_other, 'messages', d)
     or not (public.is_admin() or (d = public.my_dept() and public.user_has_app(me, 'messages', d))) then
    raise exception 'You can only message people in your department who use Messages.' using errcode = '42501';
  end if;
  select id into tid from public.msg_threads where kind = 'direct' and user_a = a and user_b = b;
  if tid is null then
    insert into public.msg_threads (department_id, kind, user_a, user_b) values (d, 'direct', a, b)
    on conflict do nothing returning id into tid;
    if tid is null then
      select id into tid from public.msg_threads where kind = 'direct' and user_a = a and user_b = b;
    end if;
  end if;
  return tid;
end $$;

-- ---------- Rules before saving ----------------------------------------
create or replace function public.msg_messages_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  t public.msg_threads;
begin
  if pg_trigger_depth() > 1 or current_setting('app.system', true) = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    select * into t from public.msg_threads where id = new.thread_id;
    if not found or (auth.uid() is not null and not public.msg_can_post(new.thread_id)) then
      raise exception 'You can''t write in this conversation.' using errcode = '42501';
    end if;
    new.author_id := coalesce(auth.uid(), new.author_id);
    new.department_id := t.department_id;
    new.created_at := now();
    new.edited_at := null;
    new.deleted_at := null;
    new.body := trim(coalesce(new.body, ''));
    if new.reply_to is not null and not exists (select 1 from public.msg_messages m where m.id = new.reply_to and m.thread_id = new.thread_id) then
      new.reply_to := null;
    end if;
    -- @mentions only in the team chat, only people who are in it
    new.mentions := case when t.kind = 'team' then
      coalesce((select array_agg(distinct u) from unnest(coalesce(new.mentions, '{}')) u
                 where u = any(public.msg_members(t.department_id)) and u is distinct from new.author_id), '{}')
      else '{}' end;
    return new;
  end if;
  -- UPDATE: only the words (edit) or deleting, by the author, within 15 minutes
  new.thread_id := old.thread_id;
  new.department_id := old.department_id;
  new.author_id := old.author_id;
  new.created_at := old.created_at;
  new.reply_to := old.reply_to;
  new.mentions := old.mentions;
  if old.deleted_at is not null then
    raise exception 'This message was deleted.';
  end if;
  if now() > old.created_at + interval '15 minutes' then
    raise exception 'Messages can only be changed or deleted for 15 minutes after sending.';
  end if;
  if new.deleted_at is not null then
    new.deleted_at := now();
    new.body := '';
    new.edited_at := old.edited_at;
  elsif new.body is distinct from old.body then
    new.body := trim(new.body);
    new.edited_at := now();
  else
    new.edited_at := old.edited_at;
  end if;
  return new;
end $$;

drop trigger if exists msg_messages_before on public.msg_messages;
create trigger msg_messages_before before insert or update on public.msg_messages
  for each row execute function public.msg_messages_before();

-- After a message: the conversation moves to the top, the author has seen it, and people are told.
--   one-to-one   → the other person (phone too)
--   team chat    → only people @mentioned
--   announcement → everyone in the department
create or replace function public.msg_messages_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  t public.msg_threads;
  who text := public.name_of(new.author_id);
  preview text := coalesce(nullif(left(new.body, 140), ''), '📎 Attachment');
begin
  if current_setting('app.system', true) = 'on' then
    return null;
  end if;
  select * into t from public.msg_threads where id = new.thread_id;
  perform set_config('app.system', 'on', true);
  update public.msg_threads set last_at = new.created_at where id = t.id;
  perform set_config('app.system', 'off', true);
  insert into public.msg_reads (thread_id, user_id, department_id, delivered_at, read_at)
  values (t.id, new.author_id, t.department_id, now(), now())
  on conflict (thread_id, user_id) do update set delivered_at = now(), read_at = now();
  if t.kind = 'direct' then
    perform public.notify(array[case when t.user_a = new.author_id then t.user_b else t.user_a end], t.department_id,
      'messages', t.id, 'message', format('%s: %s', who, preview), new.author_id);
  elsif t.kind = 'team' then
    perform public.notify(new.mentions, t.department_id, 'messages', t.id, 'mention',
      format('%s mentioned you in the team chat: %s', who, preview), new.author_id);
  else
    perform public.notify(public.msg_members(t.department_id), t.department_id, 'messages', t.id, 'announce',
      format('Announcement from %s: %s', who, preview), new.author_id);
  end if;
  return null;
end $$;

drop trigger if exists msg_messages_after on public.msg_messages;
create trigger msg_messages_after after insert on public.msg_messages
  for each row execute function public.msg_messages_after();

-- Items, files and acks take their conversation and department from the message; reads from the conversation.
create or replace function public.msg_children_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  m public.msg_messages;
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;
  if tg_table_name = 'msg_reads' then
    if tg_op = 'INSERT' then
      new.user_id := coalesce(auth.uid(), new.user_id);
      new.department_id := (select department_id from public.msg_threads where id = new.thread_id);
    else
      new.user_id := old.user_id;
      new.thread_id := old.thread_id;
      new.department_id := old.department_id;
    end if;
    -- only ever forwards; seen means delivered too
    new.delivered_at := greatest(case when tg_op = 'UPDATE' then old.delivered_at end, new.delivered_at, new.read_at);
    new.read_at := greatest(case when tg_op = 'UPDATE' then old.read_at end, new.read_at);
    return new;
  end if;
  select * into m from public.msg_messages where id = new.message_id;
  if not found then
    raise exception 'That message is gone.';
  end if;
  new.thread_id := m.thread_id;
  new.department_id := m.department_id;
  if tg_table_name = 'msg_acks' then
    new.user_id := coalesce(auth.uid(), new.user_id);
    new.acked_at := now();
    if (select kind from public.msg_threads where id = m.thread_id) <> 'announce' then
      raise exception 'Only announcements take a "Got it".';
    end if;
    return new;
  end if;
  new.created_by := coalesce(auth.uid(), new.created_by);
  new.created_at := now();
  if tg_table_name = 'msg_files' then
    if new.created_by is distinct from m.author_id then
      raise exception 'Only whoever wrote the message adds its files.';
    end if;
    if split_part(new.path, '/', 1) <> 'messages' or split_part(new.path, '/', 2) <> m.thread_id::text then
      raise exception 'That file is in the wrong place.';
    end if;
    return new;
  end if;
  -- msg_items: "attached" / "sent" only by whoever wrote the message; "made" by anyone in the conversation
  new.title := left(trim(coalesce(new.title, '')), 300);
  if new.relation in ('attached', 'sent') and new.created_by is distinct from m.author_id then
    raise exception 'Only whoever wrote the message attaches to it.';
  end if;
  return new;
end $$;

drop trigger if exists msg_items_before on public.msg_items;
create trigger msg_items_before before insert on public.msg_items
  for each row execute function public.msg_children_before();
drop trigger if exists msg_files_before on public.msg_files;
create trigger msg_files_before before insert on public.msg_files
  for each row execute function public.msg_children_before();
drop trigger if exists msg_acks_before on public.msg_acks;
create trigger msg_acks_before before insert on public.msg_acks
  for each row execute function public.msg_children_before();
drop trigger if exists msg_reads_before on public.msg_reads;
create trigger msg_reads_before before insert or update on public.msg_reads
  for each row execute function public.msg_children_before();

-- ---------- The conversation list (with unread counts), and "delivered" ticks ----------
-- Called by the app every few seconds: makes sure the team chat and announcements exist, marks everything the
-- app has fetched as delivered, and lists the conversations with their last message and unread counts.
drop function if exists public.msg_sync(uuid);   -- its columns may change between versions
create or replace function public.msg_sync(p_dept uuid)
returns table (thread_id bigint, kind text, other_id uuid, last_at timestamptz, last_body text, last_author uuid,
               last_deleted boolean, last_files int, last_item text, unread int, mentions int)
language plpgsql volatile set search_path = public as $$
begin
  perform public.msg_shared(p_dept);
  insert into public.msg_reads (thread_id, user_id, delivered_at)
  select t.id, auth.uid(), now() from public.msg_threads t where t.department_id = p_dept
  on conflict on constraint msg_reads_pkey do update set delivered_at = now();
  return query
  select t.id, t.kind,
         case when t.kind = 'direct' then case when t.user_a = auth.uid() then t.user_b else t.user_a end end,
         t.last_at, lm.body, lm.author_id, lm.deleted_at is not null,
         (select count(*)::int from public.msg_files f where f.message_id = lm.id),
         (select i.kind from public.msg_items i where i.message_id = lm.id and i.relation <> 'made' order by i.id limit 1),
         (select count(*)::int from public.msg_messages m
           where m.thread_id = t.id and m.author_id is distinct from auth.uid() and m.deleted_at is null
             and m.created_at > coalesce(r.read_at, '-infinity'::timestamptz)),
         (select count(*)::int from public.msg_messages m
           where m.thread_id = t.id and auth.uid() = any(m.mentions) and m.deleted_at is null
             and m.created_at > coalesce(r.read_at, '-infinity'::timestamptz))
    from public.msg_threads t
    left join public.msg_reads r on r.thread_id = t.id and r.user_id = auth.uid()
    left join lateral (select m.* from public.msg_messages m where m.thread_id = t.id order by m.id desc limit 1) lm on true
   where t.department_id = p_dept
   order by case t.kind when 'announce' then 0 when 'team' then 1 else 2 end, t.last_at desc;
end $$;

-- I've opened a conversation: seen ticks for its messages, and its alerts in the bell are read.
create or replace function public.msg_seen(p_thread bigint) returns void
language plpgsql volatile set search_path = public as $$
begin
  if not public.msg_can_see(p_thread) then
    return;
  end if;
  insert into public.msg_reads (thread_id, read_at) values (p_thread, now())
  on conflict on constraint msg_reads_pkey do update set read_at = now();
  update public.notifications set read_at = now()
   where user_id = auth.uid() and app_key = 'messages' and ref_id = p_thread and read_at is null;
end $$;

-- ---------- Search (Ctrl+K): only conversations the person can already read ----------
create or replace function public.msg_search(p_q text, p_dept uuid)
returns table (id bigint, thread_id bigint, kind text, other_id uuid, author_id uuid, snippet text, created_at timestamptz)
language sql stable set search_path = public as $$
  with q as (
    select '%' || replace(replace(replace(trim(coalesce(p_q, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pat
  )
  select m.id, m.thread_id, t.kind,
         case when t.kind = 'direct' then case when t.user_a = auth.uid() then t.user_b else t.user_a end end,
         m.author_id, left(m.body, 200), m.created_at
    from public.msg_messages m
    join public.msg_threads t on t.id = m.thread_id
    cross join q
   where t.department_id = p_dept and m.deleted_at is null and length(trim(coalesce(p_q, ''))) >= 2
     and m.body ilike q.pat
   order by m.created_at desc
   limit 30
$$;

-- ---------- Row level security ------------------------------------------
alter table public.msg_threads  enable row level security;
alter table public.msg_messages enable row level security;
alter table public.msg_items    enable row level security;
alter table public.msg_files    enable row level security;
alter table public.msg_reads    enable row level security;
alter table public.msg_acks     enable row level security;

drop policy if exists msg_threads_select on public.msg_threads;
create policy msg_threads_select on public.msg_threads for select to authenticated
  using (public.msg_can_see(id));

drop policy if exists msg_messages_select on public.msg_messages;
create policy msg_messages_select on public.msg_messages for select to authenticated
  using (public.msg_can_see(thread_id));
drop policy if exists msg_messages_insert on public.msg_messages;
create policy msg_messages_insert on public.msg_messages for insert to authenticated
  with check (author_id = auth.uid() and public.msg_can_post(thread_id));
drop policy if exists msg_messages_update on public.msg_messages;
create policy msg_messages_update on public.msg_messages for update to authenticated
  using (author_id = auth.uid()) with check (author_id = auth.uid());

drop policy if exists msg_items_select on public.msg_items;
create policy msg_items_select on public.msg_items for select to authenticated
  using (public.msg_can_see(thread_id));
drop policy if exists msg_items_insert on public.msg_items;
create policy msg_items_insert on public.msg_items for insert to authenticated
  with check (public.msg_can_see(thread_id));

drop policy if exists msg_files_select on public.msg_files;
create policy msg_files_select on public.msg_files for select to authenticated
  using (public.msg_can_see(thread_id));
drop policy if exists msg_files_insert on public.msg_files;
create policy msg_files_insert on public.msg_files for insert to authenticated
  with check (public.msg_can_post(thread_id));
drop policy if exists msg_files_delete on public.msg_files;
create policy msg_files_delete on public.msg_files for delete to authenticated
  using (created_by = auth.uid());

drop policy if exists msg_reads_select on public.msg_reads;
create policy msg_reads_select on public.msg_reads for select to authenticated
  using (public.msg_can_see(thread_id));
drop policy if exists msg_reads_insert on public.msg_reads;
create policy msg_reads_insert on public.msg_reads for insert to authenticated
  with check (user_id = auth.uid() and public.msg_can_see(thread_id));
drop policy if exists msg_reads_update on public.msg_reads;
create policy msg_reads_update on public.msg_reads for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists msg_acks_select on public.msg_acks;
create policy msg_acks_select on public.msg_acks for select to authenticated
  using (public.msg_can_see(thread_id));
drop policy if exists msg_acks_insert on public.msg_acks;
create policy msg_acks_insert on public.msg_acks for insert to authenticated
  with check (user_id = auth.uid() and public.msg_can_see(thread_id));

-- files: messages/<thread id>/…
drop policy if exists "msg files: read" on storage.objects;
create policy "msg files: read" on storage.objects for select to authenticated
  using (bucket_id = 'workspace-files' and public.msg_file_ok(name, false));
drop policy if exists "msg files: upload" on storage.objects;
create policy "msg files: upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'workspace-files' and public.msg_file_ok(name, true));
drop policy if exists "msg files: delete" on storage.objects;
create policy "msg files: delete" on storage.objects for delete to authenticated
  using (bucket_id = 'workspace-files' and public.msg_file_ok(name, true));

-- ---------- Permissions -------------------------------------------------
revoke all on public.msg_threads, public.msg_messages, public.msg_items, public.msg_files, public.msg_reads, public.msg_acks
  from anon, authenticated;
grant select                         on public.msg_threads  to authenticated;
grant select, insert, update         on public.msg_messages to authenticated;
grant select, insert                 on public.msg_items    to authenticated;
grant select, insert, delete         on public.msg_files    to authenticated;
grant select, insert, update         on public.msg_reads    to authenticated;
grant select, insert                 on public.msg_acks     to authenticated;
grant usage on all sequences in schema public to authenticated;

revoke execute on function public.msg_messages_before()  from public, anon, authenticated;
revoke execute on function public.msg_messages_after()   from public, anon, authenticated;
revoke execute on function public.msg_children_before()  from public, anon, authenticated;
revoke execute on function public.msg_members(uuid)      from public, anon, authenticated;
revoke execute on function public.msg_shared(uuid)       from public, anon;
grant  execute on function public.msg_shared(uuid)       to authenticated;
revoke execute on function public.msg_direct(uuid)       from public, anon;
grant  execute on function public.msg_direct(uuid)       to authenticated;
revoke execute on function public.msg_sync(uuid)         from public, anon;
grant  execute on function public.msg_sync(uuid)         to authenticated;
revoke execute on function public.msg_seen(bigint)       from public, anon;
grant  execute on function public.msg_seen(bigint)       to authenticated;
revoke execute on function public.msg_search(text, uuid) from public, anon;
grant  execute on function public.msg_search(text, uuid) to authenticated;
