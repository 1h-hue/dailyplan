-- 两人每日计划
-- 项目：sxsktgjbxcnxfwijjtxi
-- 在 Supabase Dashboard → SQL Editor 里整段粘贴并运行。
-- 可重复执行：表已存在时不会重建，策略和触发器会先删后建。

create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  plan_date date not null,
  title text not null,
  done boolean not null default false,
  shared boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint plans_title_len check (char_length(btrim(title)) between 1 and 200)
);

create index if not exists plans_plan_date_idx on public.plans (plan_date);
create index if not exists plans_user_date_idx on public.plans (user_id, plan_date);

-- updated_at
create or replace function public.set_plans_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- RLS 是行级的，不能在策略里只允许改 done / updated_at、同时禁止改
-- title、shared、user_id、plan_date。多条 UPDATE 策略的 USING 和 WITH CHECK
-- 还会分开做 OR，仅靠策略挡不住“把别人的行改成自己的”。
-- 因此：非所有者的更新策略只放行 shared = true 的行；前端对别人的计划只提交 done；
-- 真正限制列的是这个触发器。
create or replace function public.plans_guard_shared_update()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is distinct from old.user_id then
    if new.id is distinct from old.id
       or new.user_id is distinct from old.user_id
       or new.plan_date is distinct from old.plan_date
       or new.title is distinct from old.title
       or new.shared is distinct from old.shared
    then
      raise exception '只能修改共享计划的完成状态';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists plans_guard_shared_update on public.plans;
create trigger plans_guard_shared_update
before update on public.plans
for each row
execute function public.plans_guard_shared_update();

drop trigger if exists plans_set_updated_at on public.plans;
create trigger plans_set_updated_at
before update on public.plans
for each row
execute function public.set_plans_updated_at();

alter table public.plans enable row level security;

revoke all on table public.plans from public;
revoke all on table public.plans from anon;
grant select, insert, update, delete on table public.plans to authenticated;

drop policy if exists "plans_select_own_or_shared" on public.plans;
create policy "plans_select_own_or_shared"
on public.plans
for select
to authenticated
using (user_id = auth.uid() or shared = true);

drop policy if exists "plans_insert_own" on public.plans;
create policy "plans_insert_own"
on public.plans
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "plans_update_own" on public.plans;
create policy "plans_update_own"
on public.plans
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- 非所有者只能更新 shared = true 的行。列限制见上面的触发器说明。
drop policy if exists "plans_update_shared" on public.plans;
create policy "plans_update_shared"
on public.plans
for update
to authenticated
using (shared = true and user_id <> auth.uid())
with check (shared = true and user_id <> auth.uid());

drop policy if exists "plans_delete_own" on public.plans;
create policy "plans_delete_own"
on public.plans
for delete
to authenticated
using (user_id = auth.uid());

-- 每日留言板
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  message_date date not null,
  body text not null,
  reply_to_id uuid references public.messages (id) on delete set null,
  quoted_plan_id uuid references public.plans (id) on delete set null,
  quoted_plan_title text,
  created_at timestamptz not null default now(),
  constraint messages_body_len check (char_length(btrim(body)) between 1 and 500),
  constraint messages_quote_title_len check (
    quoted_plan_title is null or char_length(quoted_plan_title) between 1 and 200
  )
);

create index if not exists messages_date_created_idx
on public.messages (message_date, created_at);

alter table public.messages enable row level security;

revoke all on table public.messages from public;
revoke all on table public.messages from anon;
grant select, insert, delete on table public.messages to authenticated;

drop policy if exists "messages_select_authenticated" on public.messages;
create policy "messages_select_authenticated"
on public.messages
for select
to authenticated
using (true);

drop policy if exists "messages_insert_own" on public.messages;
create policy "messages_insert_own"
on public.messages
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "messages_delete_own" on public.messages;
create policy "messages_delete_own"
on public.messages
for delete
to authenticated
using (user_id = auth.uid());

alter table public.messages replica identity full;

-- Realtime 需要完整旧行，删除或更新日期时客户端才能按 plan_date 过滤。
alter table public.plans replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'plans'
  ) then
    alter publication supabase_realtime add table public.plans;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;
