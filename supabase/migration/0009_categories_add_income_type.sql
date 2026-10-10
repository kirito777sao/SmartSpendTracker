-- 0009_categories_add_income_type.sql
-- T-S06e1b — CHỐT 06/08/2026 (xem CONSTITUTION.md §1.3, CHANGELOG cùng ngày).
--
-- Vấn đề: "Thu nhập" trước đây là 1 category ẢO hard-code ở tầng UI
-- (SmartInput/AIAssistantBubble/TransactionHistory) — không có row thật
-- trong `categories`, mọi giao dịch income đều category_id = null, gộp
-- chung 1 rổ, không tách được "Lương"/"Thưởng"/... để phân tích riêng.
--
-- Giải pháp: thêm `categories.type`, cho phép nhiều category income THẬT.
-- Toàn bộ giao dịch income cũ (category_id null) được gán vào 1 category
-- "Thu nhập chung" tự tạo cho đúng scope của nó (quyết định đã chốt khi
-- trao đổi, thay vì để category_id null lơ lửng).

begin;

alter table public.categories
  add column type text not null default 'expense'
  check (type in ('income', 'expense'));

-- =========================================================
-- Backfill — scope CÁ NHÂN: tạo "Thu nhập chung" cho từng owner_id đang có
-- giao dịch income với category_id null, rồi gán lại.
-- =========================================================
insert into public.categories (owner_id, name, icon, type, created_by)
select distinct t.owner_id, 'Thu nhập chung', '💵', 'income', t.owner_id
from public.transactions t
where t.type = 'income'
  and t.category_id is null
  and t.owner_id is not null
  and t.deleted_at is null
  and not exists (
    select 1 from public.categories c
    where c.owner_id = t.owner_id
      and c.type = 'income'
      and c.name = 'Thu nhập chung'
      and c.deleted_at is null
  );

update public.transactions t
set category_id = c.id
from public.categories c
where t.type = 'income'
  and t.category_id is null
  and t.owner_id is not null
  and t.deleted_at is null
  and c.owner_id = t.owner_id
  and c.type = 'income'
  and c.name = 'Thu nhập chung'
  and c.deleted_at is null;

-- =========================================================
-- Backfill — scope HỘ GIA ĐÌNH: tương tự, `created_by` = owner của hộ
-- (luôn tồn tại — households.owner_id not null).
-- =========================================================
insert into public.categories (household_id, name, icon, type, created_by)
select distinct t.household_id, 'Thu nhập chung', '💵', 'income', h.owner_id
from public.transactions t
join public.households h on h.id = t.household_id
where t.type = 'income'
  and t.category_id is null
  and t.household_id is not null
  and t.deleted_at is null
  and not exists (
    select 1 from public.categories c
    where c.household_id = t.household_id
      and c.type = 'income'
      and c.name = 'Thu nhập chung'
      and c.deleted_at is null
  );

update public.transactions t
set category_id = c.id
from public.categories c
where t.type = 'income'
  and t.category_id is null
  and t.household_id is not null
  and t.deleted_at is null
  and c.household_id = t.household_id
  and c.type = 'income'
  and c.name = 'Thu nhập chung'
  and c.deleted_at is null;

commit;

-- KHÔNG cần đổi RLS policy nào ở §3 — không policy nào lọc theo cột này,
-- và INSERT/UPDATE của backfill chạy trong migration (bypass RLS bằng
-- quyền chạy migration), không đi qua client.
