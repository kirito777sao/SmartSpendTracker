-- 0035_categories_case_insensitive_unique_name.sql
-- T-S117 — CHỐT 20/08/2026, xem CONSTITUTION.md + CHANGELOG.md cùng ngày.
--
-- Bug thật, người dùng tự phát hiện qua test tay migration 0034: unique
-- index ở 0034 so TÊN Y HỆT TỪNG KÝ TỰ (case-sensitive theo mặc định
-- Postgres) — "học tập" và "Học tập" là 2 CHUỖI KHÁC NHAU về mặt kỹ thuật,
-- nên vẫn tạo được 2 category gần như trùng tên, chỉ khác cách viết hoa/
-- thường. Sửa: so theo `lower(trim(name))` thay vì `name` thô — vừa bỏ qua
-- hoa/thường, vừa bỏ khoảng trắng thừa đầu/cuối (cùng lớp vấn đề, tiện sửa
-- luôn 1 lần).

begin;

-- ==========================================================================
-- BƯỚC 1 — dọn dữ liệu cũ đang vi phạm theo tiêu chuẩn MỚI (lower+trim).
-- Migration 0034 đã dọn theo tiêu chuẩn CŨ (so y hệt ký tự) rồi, nên ở đây
-- chỉ còn phải dọn thêm các nhóm trùng nhau SAU KHI hạ hoa/thường + trim —
-- ví dụ đúng ca thật vừa phát hiện: "Học tập" và "học tập" là 2 row khác
-- nhau (0034 không dọn được), giờ mới bị coi là trùng.
-- ==========================================================================
with duplicates as (
  select
    id,
    row_number() over (
      partition by
        coalesce(owner_id::text, ''),
        coalesce(household_id::text, ''),
        lower(trim(name)),
        type
      order by created_at asc, id asc
    ) as rn
  from public.categories
  where deleted_at is null
)
update public.categories c
set deleted_at = now()
from duplicates d
where c.id = d.id
  and d.rn > 1;

-- ==========================================================================
-- BƯỚC 2 — xoá unique index cũ (so y hệt ký tự, không đủ chặt), tạo lại
-- theo `lower(trim(name))`.
-- ==========================================================================
drop index if exists public.categories_unique_active_name_per_scope;

create unique index categories_unique_active_name_per_scope
  on public.categories (
    coalesce(owner_id::text, ''),
    coalesce(household_id::text, ''),
    lower(trim(name)),
    type
  )
  where deleted_at is null;

commit;

-- ==========================================================================
-- GHI CHÚ VẬN HÀNH
-- ==========================================================================
-- - Sau migration này, "Học tập" / "học tập" / "HỌC TẬP" / "  Học tập  "
--   (khoảng trắng thừa) đều bị coi là CÙNG 1 TÊN — chỉ tạo được 1 trong số
--   đó, y hệt cơ chế báo lỗi `23505` đã xử lý ở client (`BudgetLimits.tsx`
--   `friendlyWriteError()`) từ T-S116 — không cần đổi gì thêm ở code client,
--   thông báo lỗi hiện tại đã đúng cho cả ca này.
-- - Tên HIỂN THỊ của category vẫn giữ nguyên hoa/thường/khoảng trắng người
--   dùng gõ (migration này KHÔNG tự sửa `name` cột hiện có thành chữ
--   thường) — chỉ có PHÉP SO SÁNH lúc kiểm tra trùng là không phân biệt.
