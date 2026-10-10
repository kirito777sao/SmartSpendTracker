-- diagnose_T-S86_stale_overload_impact.sql
-- THUẦN ĐỌC (SELECT only) — không sửa dữ liệu gì. Dùng để khoanh vùng
-- những goal CÓ THỂ đã bị ảnh hưởng bởi bug 2-overload (xem
-- 0025_saving_goals_drop_stale_update_goal_link_overload.sql) trước khi
-- quyết định có cần sửa tay dữ liệu carried_over_spent_amount hay không.
--
-- CÁCH ĐỌC: bug chỉ có thể xảy ra ở goal có is_savings_link = false (chọn
-- "chi tiêu thường") NHƯNG có ít nhất 1 phần tử linked_history kiểu
-- "linked" mà trong đó có giao dịch snapshot với `date` SỚM HƠN `ended_at`
-- của chính phần tử đó trừ đi khoảng cách hợp lý — nói cách khác: nếu bản
-- RPC đúng (0022) đã chạy, mọi giao dịch trong snapshot của 1 giai đoạn
-- is_savings_link=false phải có date >= thời điểm goal đó ĐƯỢC LIÊN KẾT lần
-- đó (linked_at tại thời điểm đóng băng, KHÔNG lưu lại y nguyên trong
-- snapshot — chỉ có thể so gián tiếp qua ngày sớm nhất trong snapshot so
-- với ended_at của chính giai đoạn liền trước, hoặc đơn giản hơn: rà tay
-- từng dòng nghi ngờ). Vì `linked_at` bị ghi đè mỗi lần relink (không giữ
-- lịch sử), câu dưới đây liệt kê ỨNG VIÊN để người yêu cầu tự đối chiếu
-- tay qua ngày tạo goal / ngày bấm liên kết thật (nhớ lại hoặc xem
-- activity_log nếu có bật), KHÔNG khẳng định chắc chắn 100% từng dòng.

select
  g.id as goal_id,
  g.name as goal_name,
  g.is_savings_link,
  g.linked_at,
  g.carried_over_spent_amount,
  hist.value ->> 'category_name' as giai_doan_category,
  hist.value ->> 'start_date' as giai_doan_start_date,
  hist.value ->> 'end_date' as giai_doan_end_date,
  hist.value ->> 'ended_at' as giai_doan_ended_at,
  hist.value -> 'transactions_snapshot' as giao_dich_trong_giai_doan
from public.saving_goals g,
     jsonb_array_elements(g.linked_history) as hist(value)
where g.deleted_at is null
  and hist.value ->> 'type' = 'linked'
order by g.name, (hist.value ->> 'ended_at');

-- Gợi ý đọc kết quả: mở cột `giao_dich_trong_giai_doan`, so ngày `date` của
-- từng giao dịch trong đó với ngày bạn NHỚ mình thật sự bấm "Liên kết" cho
-- giai đoạn đó. Nếu có giao dịch với `date` SỚM HƠN ngày bấm liên kết thật
-- MÀ giai đoạn đó bạn đã chọn "Ngân sách chi tiêu thường" (is_savings_link
-- lúc đó = false) -> đúng là 1 trường hợp bị bug này, cần liệt kê ra để
-- xác nhận trước khi viết script sửa riêng (KHÔNG tự sửa ở đây).
