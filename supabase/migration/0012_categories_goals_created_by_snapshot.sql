-- =========================================================
-- T-S16 (phần còn lại sau khi thu hẹp phạm vi sang T-S17, xem CONSTITUTION
-- §1.6 + TASKS.md T-S16) — snapshot định danh NGƯỜI TẠO cho `categories` và
-- `saving_goals`, cùng lý do/thiết kế với `transactions.member_name_snapshot`
-- (migration 0011, T-S17): resolve `created_by -> tên hiển thị` qua danh
-- sách thành viên HIỆN TẠI sẽ mất khi người tạo rời hộ (RLS `profiles`
-- chặn đọc lại hồ sơ người đã rời khỏi hộ). Khác với T-S17, format đầy đủ
-- hơn: "${personal_role} (${name})" — khớp CHỐT §1.2 và
-- `authMapping.buildUserFromProfile`, vì đây là snapshot MỚI (chưa có nơi
-- nào hiển thị theo format rút gọn như transactions trước đó).
--
-- LƯU Ý QUAN TRỌNG (khác với mô tả gốc ở CONSTITUTION §1.6/TASKS.md T-S16):
-- `profiles` không bị xoá khi 1 người rời hộ (chỉ `household_id` bị set về
-- null qua RPC `leave_household`/`remove_member`) — hàng `profiles` vẫn tồn
-- tại và migration này chạy với quyền bypass RLS (chủ sở hữu schema), nên
-- backfill thực tế lấp được cho MỌI `created_by` còn tồn tại `profiles`
-- tương ứng, không chỉ riêng người còn trong đúng hộ tại thời điểm chạy
-- migration như mô tả gốc — mô tả gốc quá thận trọng. Giới hạn thật duy
-- nhất: `created_by` mà tài khoản `auth.users` đã bị XOÁ HẲN (không chỉ rời
-- hộ) — `profiles.id` cascade xoá theo — sẽ không backfill được, nhưng
-- trường hợp này hiếm và không phải nguyên nhân được nêu ban đầu.
-- =========================================================

alter table public.categories
  add column created_by_display_snapshot text;

alter table public.saving_goals
  add column created_by_display_snapshot text;

comment on column public.categories.created_by_display_snapshot is
  'Định danh người tạo tại thời điểm TẠO category ("${personal_role} (${name})"), snapshot bất biến — set 1 lần bởi trigger BEFORE INSERT, không đổi theo hồ sơ hiện tại hay còn/mất trong hộ. Xem migration 0012, CONSTITUTION §1.6.';

comment on column public.saving_goals.created_by_display_snapshot is
  'Định danh người tạo tại thời điểm TẠO mục tiêu tiết kiệm ("${personal_role} (${name})"), snapshot bất biến — set 1 lần bởi trigger BEFORE INSERT. Xem migration 0012, CONSTITUTION §1.6.';

create or replace function public.set_category_created_by_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select personal_role || ' (' || name || ')'
    into new.created_by_display_snapshot
  from public.profiles
  where id = new.created_by;
  return new;
end;
$$;

create or replace function public.set_goal_created_by_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select personal_role || ' (' || name || ')'
    into new.created_by_display_snapshot
  from public.profiles
  where id = new.created_by;
  return new;
end;
$$;

drop trigger if exists trg_set_category_created_by_snapshot on public.categories;
create trigger trg_set_category_created_by_snapshot
  before insert on public.categories
  for each row
  execute function public.set_category_created_by_snapshot();

drop trigger if exists trg_set_goal_created_by_snapshot on public.saving_goals;
create trigger trg_set_goal_created_by_snapshot
  before insert on public.saving_goals
  for each row
  execute function public.set_goal_created_by_snapshot();

-- Backfill dữ liệu hiện có — xem LƯU Ý ở đầu file: lấp được cho mọi
-- created_by còn tồn tại profiles tương ứng (thực tế là hầu hết/toàn bộ).
update public.categories c
set created_by_display_snapshot = p.personal_role || ' (' || p.name || ')'
from public.profiles p
where c.created_by = p.id
  and c.created_by_display_snapshot is null;

update public.saving_goals g
set created_by_display_snapshot = p.personal_role || ' (' || p.name || ')'
from public.profiles p
where g.created_by = p.id
  and g.created_by_display_snapshot is null;
