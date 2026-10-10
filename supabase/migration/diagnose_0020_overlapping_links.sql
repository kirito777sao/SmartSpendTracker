-- diagnose_0020_overlapping_links.sql
-- T-S63 — CHẠY TRƯỚC migration 0020, thuần READ-ONLY (không sửa gì).
-- Mục đích: liệt kê chính xác các cặp goal đang VI PHẠM constraint mới
-- (cùng linked_category_id, khoảng ngày chồng lấp) — đây là dữ liệu ĐÃ SAI
-- có sẵn trên project (đúng bug T-S63 mô tả), cần dọn bằng tay TRƯỚC khi
-- 0020 chạy được (Postgres không cho ADD CONSTRAINT nếu dữ liệu hiện có vi
-- phạm ngay).

select
  g1.id            as goal_1_id,
  g1.name          as goal_1_name,
  g1.linked_start_date as goal_1_start,
  g1.linked_end_date   as goal_1_end,
  g2.id            as goal_2_id,
  g2.name          as goal_2_name,
  g2.linked_start_date as goal_2_start,
  g2.linked_end_date   as goal_2_end,
  c.name           as category_name,
  daterange(g1.linked_start_date, g1.linked_end_date, '[]')
    * daterange(g2.linked_start_date, g2.linked_end_date, '[]') as overlap_range
from public.saving_goals g1
join public.saving_goals g2
  on g1.linked_category_id = g2.linked_category_id
  and g1.id < g2.id  -- mỗi cặp chỉ liệt kê 1 lần
join public.categories c on c.id = g1.linked_category_id
where g1.linked_category_id is not null
  and g1.deleted_at is null
  and g2.deleted_at is null
  and daterange(g1.linked_start_date, g1.linked_end_date, '[]')
      && daterange(g2.linked_start_date, g2.linked_end_date, '[]')
order by category_name;
