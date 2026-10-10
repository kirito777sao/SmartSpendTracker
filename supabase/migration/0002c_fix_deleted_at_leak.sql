-- =========================================================
-- Patch T-S02: sửa lỗi "for all" policy làm rò rỉ soft-deleted rows.
-- Nguyên nhân: "for all" cấp quyền cho cả SELECT; nhiều permissive
-- policy được ghép bằng OR → policy ghi (không lọc deleted_at) vô tình
-- mở rộng quyền đọc, đè lên bộ lọc deleted_at is null của policy đọc chính.
-- Fix: tách "for all" thành "for insert" + "for update" riêng, không có
-- "for delete" ở đâu cả (thiết kế cố ý — hard delete luôn bị từ chối,
-- xoá chỉ được phép qua UPDATE deleted_at, tức soft delete).
-- =========================================================

-- ---- categories ----
drop policy if exists "write personal categories" on public.categories;
drop policy if exists "owner manages household budget categories" on public.categories;

create policy "insert personal or owned household categories" on public.categories
for insert with check (
  (owner_id = auth.uid() and household_id is null) or
  (household_id is not null and is_household_owner(household_id))
);
create policy "update personal or owned household categories" on public.categories
for update using (
  (owner_id = auth.uid()) or (household_id is not null and is_household_owner(household_id))
) with check (
  (owner_id = auth.uid()) or (household_id is not null and is_household_owner(household_id))
);

-- ---- saving_goals ----
drop policy if exists "write personal goals" on public.saving_goals;
drop policy if exists "household members manage shared goals" on public.saving_goals;

create policy "insert personal or household goals" on public.saving_goals
for insert with check (
  (owner_id = auth.uid() and household_id is null) or
  (household_id is not null and is_household_member(household_id))
);
create policy "update personal or household goals" on public.saving_goals
for update using (
  (owner_id = auth.uid()) or (household_id is not null and is_household_member(household_id))
) with check (
  (owner_id = auth.uid()) or (household_id is not null and is_household_member(household_id))
);

-- ---- transactions ----
drop policy if exists "write personal transactions" on public.transactions;
drop policy if exists "member writes own household transactions" on public.transactions;
drop policy if exists "owner overrides any household transaction" on public.transactions;

create policy "insert own personal or household transactions" on public.transactions
for insert with check (
  (owner_id = auth.uid() and household_id is null and member_id is null) or
  (household_id is not null and member_id = auth.uid()) or
  (household_id is not null and is_household_owner(household_id))
);
create policy "update own personal or household transactions" on public.transactions
for update using (
  (owner_id = auth.uid()) or
  (household_id is not null and member_id = auth.uid()) or
  (household_id is not null and is_household_owner(household_id))
) with check (
  (owner_id = auth.uid()) or
  (household_id is not null and member_id = auth.uid()) or
  (household_id is not null and is_household_owner(household_id))
);
