-- =========================================================
-- Patch T-S02: sửa infinite recursion (không chạy lại toàn bộ 0002_rls.sql,
-- vì các policy khác đã tạo thành công, chạy lại sẽ báo lỗi "already exists").
-- Chỉ DROP + CREATE lại đúng 2 policy bị ảnh hưởng + CREATE OR REPLACE 3 hàm.
-- =========================================================

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

drop policy if exists "read own or same-household profile" on public.profiles;
create policy "read own or same-household profile"
on public.profiles for select using (
  id = auth.uid() or household_id = public.my_household_id()
);

drop policy if exists "read own household" on public.households;
create policy "read own household" on public.households for select using (
  id = public.my_household_id() or owner_id = auth.uid()
);
