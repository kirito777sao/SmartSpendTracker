-- ============================================================
-- BƯỚC 1 — AUDIT: liệt kê MỌI goal thủ công (linked_category_id is null)
-- đang bị lệch current_amount so với tổng thật của các dòng transfer
-- còn sống gắn vào nó — để biết goal nào khác ngoài "Mua laptop (B)"
-- cũng bị ảnh hưởng trước khi sửa hàng loạt.
-- ============================================================
select
  g.id,
  g.name,
  g.current_amount as db_current_amount,
  coalesce(t.sum_live, 0) as real_sum,
  g.current_amount - coalesce(t.sum_live, 0) as diff
from public.saving_goals g
left join (
  select goal_id, sum(amount) as sum_live
  from public.transactions
  where type = 'transfer' and deleted_at is null and goal_id is not null
  group by goal_id
) t on t.goal_id = g.id
where g.deleted_at is null
  and g.linked_category_id is null -- goal liên kết category (T-S48) không dùng current_amount kiểu này
  and g.current_amount <> coalesce(t.sum_live, 0)
order by abs(g.current_amount - coalesce(t.sum_live, 0)) desc;

-- ============================================================
-- BƯỚC 2 — FIX (soát kỹ kết quả Bước 1 trước, CHỈ chạy sau khi đã xem
-- qua và đồng ý đây đúng là các goal cần đồng bộ lại — không chạy mù).
-- Đồng bộ lại current_amount = tổng thật cho TẤT CẢ goal thủ công đang
-- lệch (không đụng goal liên kết category, không đụng deleted_at).
-- ============================================================
-- update public.saving_goals g
-- set current_amount = coalesce(t.sum_live, 0)
-- from (
--   select goal_id, sum(amount) as sum_live
--   from public.transactions
--   where type = 'transfer' and deleted_at is null and goal_id is not null
--   group by goal_id
-- ) t
-- where g.id = t.goal_id
--   and g.deleted_at is null
--   and g.linked_category_id is null
--   and g.current_amount <> t.sum_live;
--
-- -- Riêng goal KHÔNG có dòng transfer nào (real_sum = 0 vì không có ở
-- -- bảng transactions) mà current_amount vẫn khác 0 -- JOIN trên không bắt
-- -- được (LEFT JOIN không match), chạy thêm dòng này:
-- update public.saving_goals
-- set current_amount = 0
-- where deleted_at is null
--   and linked_category_id is null
--   and current_amount <> 0
--   and id not in (
--     select distinct goal_id from public.transactions
--     where type = 'transfer' and deleted_at is null and goal_id is not null
--   );
