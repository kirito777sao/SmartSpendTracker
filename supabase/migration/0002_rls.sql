-- =========================================================
-- T-S02 — RLS + helper functions (CONSTITUTION.md §3)
-- Scope: CHỈ RLS policy + helper function. KHÔNG RPC (T-S03).
-- Chạy sau khi 0001_init_schema.sql đã thành công.
-- =========================================================

alter table public.profiles enable row level security;
alter table public.households enable row level security;
alter table public.categories enable row level security;
alter table public.saving_goals enable row level security;
alter table public.transactions enable row level security;
alter table public.activity_log enable row level security;

create or replace function public.my_household_id()
returns uuid language sql stable security definer set search_path = public as $$
  select household_id from public.profiles where id = auth.uid();
$$;

create or replace function public.is_household_owner(hh uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.households where id = hh and owner_id = auth.uid());
$$;

create or replace function public.is_household_member(hh uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.my_household_id() = hh;
$$;

-- profiles
create policy "read own or same-household profile"
on public.profiles for select using (
  id = auth.uid() or household_id = public.my_household_id()
);
create policy "update own profile fields"
on public.profiles for update using (id = auth.uid());

-- categories
create policy "read own or household categories" on public.categories for select using (
  deleted_at is null and (owner_id = auth.uid() or is_household_member(household_id))
);
create policy "write personal categories" on public.categories for all using (
  owner_id = auth.uid()
) with check (owner_id = auth.uid());
create policy "owner manages household budget categories" on public.categories for all using (
  household_id is not null and is_household_owner(household_id)
) with check (household_id is not null and is_household_owner(household_id));

-- saving_goals
create policy "read own or household goals" on public.saving_goals for select using (
  deleted_at is null and (owner_id = auth.uid() or is_household_member(household_id))
);
create policy "write personal goals" on public.saving_goals for all using (
  owner_id = auth.uid()
) with check (owner_id = auth.uid());
create policy "household members manage shared goals" on public.saving_goals for all using (
  household_id is not null and is_household_member(household_id)
) with check (household_id is not null and is_household_member(household_id));

-- transactions
create policy "read own or household transactions" on public.transactions for select using (
  deleted_at is null and (owner_id = auth.uid() or is_household_member(household_id))
);
create policy "write personal transactions" on public.transactions for all using (
  owner_id = auth.uid()
) with check (owner_id = auth.uid());
create policy "member writes own household transactions" on public.transactions for all using (
  household_id is not null and member_id = auth.uid()
) with check (household_id is not null and member_id = auth.uid());
create policy "owner overrides any household transaction" on public.transactions for all using (
  household_id is not null and is_household_owner(household_id)
) with check (household_id is not null and is_household_owner(household_id));

-- activity_log
create policy "read household activity" on public.activity_log for select using (
  is_household_member(household_id)
);

-- households: chưa có policy select/insert ở CONSTITUTION gốc — lỗ hổng phát hiện khi viết
-- migration này, không phải khi lên kế hoạch. Bổ sung tối thiểu để không chặn nhầm chính owner
-- đọc household của mình; insert/join thực hiện qua RPC SECURITY DEFINER ở T-S03 nên không cần
-- policy insert cho client thường ở đây.
create policy "read own household" on public.households for select using (
  id = public.my_household_id() or owner_id = auth.uid()
);
