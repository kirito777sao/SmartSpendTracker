-- =========================================================
-- T-S01 — Init schema + triggers (CONSTITUTION.md §2)
-- Scope: CHỈ schema + trigger. KHÔNG RLS (T-S02), KHÔNG RPC (T-S03/T-S10).
-- Chạy nguyên file này 1 lần trong Supabase SQL Editor.
-- =========================================================

create extension if not exists pgcrypto;

-- 1. profiles
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text not null,
  personal_role text not null default 'Cá nhân',

  household_id uuid, -- FK gắn sau khi households tồn tại (bên dưới)
  household_role text check (household_role in ('owner','member')),

  telegram_chat_id text unique,
  telegram_username text,
  telegram_link_token text,
  telegram_active_scope text not null default 'personal'
    check (telegram_active_scope in ('personal','household')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint household_role_requires_household
    check ((household_id is null) = (household_role is null))
);

-- 2. households
create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text unique not null,
  owner_id uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.profiles
  add constraint profiles_household_fk
  foreign key (household_id) references public.households(id) on delete set null;

-- 3. categories / saving_goals / transactions
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id),
  household_id uuid references public.households(id) on delete cascade,
  name text not null,
  icon text not null,
  limit_amount numeric check (limit_amount is null or limit_amount >= 0),
  is_recurring boolean not null default false,
  created_by uuid not null references auth.users(id),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint categories_scope_xor check (
    (owner_id is not null and household_id is null) or
    (owner_id is null and household_id is not null)
  )
);

create table public.saving_goals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id),
  household_id uuid references public.households(id) on delete cascade,
  name text not null,
  target_amount numeric check (target_amount is null or target_amount >= 0),
  current_amount numeric not null default 0,
  target_date date,
  created_by uuid not null references auth.users(id),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint goals_scope_xor check (
    (owner_id is not null and household_id is null) or
    (owner_id is null and household_id is not null)
  )
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id),
  household_id uuid references public.households(id) on delete cascade,
  member_id uuid references auth.users(id),

  type text not null check (type in ('income','expense')),
  description text not null,
  amount numeric not null check (amount >= 0),
  date date not null,
  note text,
  category_id uuid references public.categories(id) on delete set null,
  goal_id uuid references public.saving_goals(id) on delete set null,

  source text not null default 'web' check (source in ('web','telegram')),
  telegram_batch_id uuid,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint tx_scope_xor check (
    (owner_id is not null and household_id is null and member_id is null) or
    (owner_id is null and household_id is not null and member_id is not null)
  )
);

-- 4. activity_log
create table public.activity_log (
  id uuid primary key default gen_random_uuid(),
  household_id uuid references public.households(id) on delete cascade,
  actor_id uuid not null references auth.users(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  message text not null,
  source text not null default 'web' check (source in ('web','telegram','system')),
  created_at timestamptz not null default now()
);

-- 5. Trigger: auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'name', new.email));
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- 6. Trigger: auto-update saving_goals.current_amount
create or replace function public.apply_goal_contribution()
returns trigger as $$
begin
  if (tg_op = 'INSERT') then
    if new.goal_id is not null and new.deleted_at is null then
      update public.saving_goals set current_amount = current_amount + new.amount
      where id = new.goal_id;
    end if;
  end if;

  if (tg_op = 'UPDATE') then
    if new.goal_id is not null and old.deleted_at is null and new.deleted_at is not null then
      update public.saving_goals set current_amount = current_amount - new.amount
      where id = new.goal_id;
    end if;
    if new.goal_id is not null and old.deleted_at is not null and new.deleted_at is null then
      update public.saving_goals set current_amount = current_amount + new.amount
      where id = new.goal_id;
    end if;
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger trg_goal_contribution
after insert or update on public.transactions
for each row execute function public.apply_goal_contribution();

-- 7. updated_at auto-touch
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_categories_updated_at before update on public.categories
  for each row execute function public.set_updated_at();
create trigger trg_goals_updated_at before update on public.saving_goals
  for each row execute function public.set_updated_at();
create trigger trg_tx_updated_at before update on public.transactions
  for each row execute function public.set_updated_at();

-- 8. Index cho FK (ALWAYS DO theo CONSTITUTION boundary table, không cần hỏi)
create index idx_profiles_household_id on public.profiles(household_id);
create index idx_categories_owner_id on public.categories(owner_id);
create index idx_categories_household_id on public.categories(household_id);
create index idx_goals_owner_id on public.saving_goals(owner_id);
create index idx_goals_household_id on public.saving_goals(household_id);
create index idx_tx_owner_id on public.transactions(owner_id);
create index idx_tx_household_id on public.transactions(household_id);
create index idx_tx_member_id on public.transactions(member_id);
create index idx_tx_telegram_batch_id on public.transactions(telegram_batch_id);
create index idx_activity_log_household_id on public.activity_log(household_id);
