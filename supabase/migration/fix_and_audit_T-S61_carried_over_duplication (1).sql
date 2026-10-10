-- fix_and_audit_T-S61_carried_over_duplication.sql
-- T-S88 [tách từ T-S61, xem CONSTITUTION §1.20.1 + TASKS.md T-S88]
--
-- KHÁC HẲN fix_and_audit_goal_drift.sql (script đó audit goal THỦ CÔNG bị
-- lệch current_amount so với tổng transfer — dùng SAI cho việc này, xem
-- ghi chú trong hội thoại 15/08/2026). Bug T-S61 chỉ ảnh hưởng goal LIÊN
-- KẾT CATEGORY: RPC update_goal_link bản 0018 (trước fix idempotency 0019)
-- luôn SUM lại TOÀN BỘ giao dịch expense khớp category+khoảng ngày mỗi lần
-- đóng băng (unlink/đổi category), không dedup theo ID giao dịch. Link →
-- unlink (đóng băng lần 1, +A vào carried_over_spent_amount) → link lại
-- CÙNG category → unlink lần nữa (đóng băng lần 2, SUM lại đúng tập giao
-- dịch đó → +A LẦN NỮA) => carried_over_spent_amount = 2×A dù không có
-- giao dịch mới. current_amount KHÔNG liên quan gì tới bug này (goal liên
-- kết category luôn có current_amount=0 theo thiết kế §1.13 — so sánh cột
-- đó, như goal_drift đã làm nhầm, không phát hiện được bug này).
--
-- DẤU HIỆU NHẬN DẠNG bug: phần tử linked_history ghi bởi RPC 0018 (TRƯỚC
-- fix 0019) thiếu hẳn field `transactions_snapshot` (fix 0019 mới thêm field
-- này + field `type`) — dùng làm "con dấu thời gian" phân biệt kiểu cũ/mới,
-- không cần biết ended_at chính xác. 2 phần tử "kiểu cũ" trong CÙNG 1 goal,
-- CÙNG category_name, khoảng ngày CHỒNG LẤP nhau => rất giống 1 giai đoạn bị
-- đóng băng lặp lại (bug), không phải 2 giai đoạn liên kết hợp lệ khác nhau
-- theo thời gian (2 giai đoạn hợp lệ thường không trùng ngày).
--
-- ============================================================
-- BƯỚC 1 — AUDIT (thuần SELECT, không sửa gì)
-- ============================================================

-- 1a. Liệt kê MỌI phần tử "kiểu cũ" (nghi ngờ, chưa kết luận là lỗi) theo
--     từng goal, để nhìn tổng quan trước.
with old_entries as (
  select
    g.id as goal_id,
    g.name as goal_name,
    g.carried_over_spent_amount,
    elem->>'category_name' as category_name,
    (elem->>'start_date')::date as start_date,
    (elem->>'end_date')::date as end_date,
    (elem->>'amount')::numeric as amount,
    (elem->>'ended_at')::timestamptz as ended_at
  from public.saving_goals g,
       jsonb_array_elements(g.linked_history) as elem
  where g.deleted_at is null
    and not (elem ? 'type')  -- "kiểu cũ" = ghi bởi 0018, trước fix 0019 (SỬA 15/08:
    -- ban đầu lọc theo `transactions_snapshot`, SAI — withdrawal_log (0021/0023)
    -- và completed_unspent (0024) cũng thiếu key này dù có `type` hợp lệ, gây false
    -- positive tràn lan. `type` là key DUY NHẤT chỉ vắng mặt ở đúng phần tử di sản
    -- 0018, mọi RPC từ 0019 trở đi (kể cả withdrawal_log/manual/completed_unspent)
    -- đều luôn ghi `type`.)
)
select * from old_entries order by goal_id, ended_at;

-- 1b. TRỌNG TÂM — chỉ những GOAL có ≥2 phần tử "kiểu cũ" cùng category,
--     khoảng ngày chồng lấp nhau (ứng viên bị cộng đúp thật sự). Sắp theo
--     độ chênh lệch số tiền giữa 2 lần (gần 0 → giống bug nhất, đúng gợi ý
--     đã ghi ở TASKS.md T-S88).
with old_entries as (
  select
    g.id as goal_id,
    g.name as goal_name,
    g.carried_over_spent_amount,
    elem->>'category_name' as category_name,
    (elem->>'start_date')::date as start_date,
    (elem->>'end_date')::date as end_date,
    (elem->>'amount')::numeric as amount,
    (elem->>'ended_at')::timestamptz as ended_at
  from public.saving_goals g,
       jsonb_array_elements(g.linked_history) as elem
  where g.deleted_at is null
    and not (elem ? 'type')  -- xem ghi chú sửa lỗi ở query 1a phía trên
)
select
  a.goal_id,
  a.goal_name,
  a.category_name,
  a.carried_over_spent_amount as current_carried_over_spent_amount,
  a.start_date as period_1_start, a.end_date as period_1_end, a.amount as period_1_amount, a.ended_at as period_1_ended_at,
  b.start_date as period_2_start, b.end_date as period_2_end, b.amount as period_2_amount, b.ended_at as period_2_ended_at,
  abs(a.amount - b.amount) as amount_diff
from old_entries a
join old_entries b
  on a.goal_id = b.goal_id
 and a.category_name is not distinct from b.category_name
 and a.ended_at < b.ended_at  -- mỗi cặp chỉ lấy 1 chiều, tránh liệt kê 2 lần
 and daterange(a.start_date, a.end_date, '[]') && daterange(b.start_date, b.end_date, '[]')
order by amount_diff asc, a.goal_id;

-- ============================================================
-- BƯỚC 2 — FIX (CHƯA VIẾT)
-- Chỉ viết sau khi xem kết quả 1b thật, người yêu cầu xác nhận TỪNG DÒNG
-- đúng là bug (không phải trùng hợp 2 giai đoạn hợp lệ) và số tiền đúng nên
-- là bao nhiêu, theo đúng CONSTITUTION §5 (sửa dữ liệu sản xuất — Hỏi trước
-- khi làm). Không sửa hàng loạt theo 1 công thức chung như goal_drift, vì
-- mỗi dòng cần soát riêng (số lần lặp có thể >2, không phải lúc nào cũng
-- đúng 2×).
-- ============================================================
