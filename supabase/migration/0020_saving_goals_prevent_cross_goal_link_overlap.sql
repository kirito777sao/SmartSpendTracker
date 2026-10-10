-- 0020_saving_goals_prevent_cross_goal_link_overlap.sql
-- T-S63 — [12/08/2026, xem CONSTITUTION §1.13.1 (tu chỉnh cho §1.13)].
-- CHƯA CHẠY — thuộc diện "đổi cấu trúc bảng đã chốt" (CONSTITUTION §5, cột
-- "Hỏi trước khi làm"). File này chỉ CHUẨN BỊ, KHÔNG tự ý apply lên
-- Supabase — người yêu cầu phải tự soát lại rồi chạy.
--
-- BỐI CẢNH: người dùng phát hiện qua test tay 12/08/2026 (tạo nhiều goal
-- MỚI, tất cả cùng liên kết 1 category "Tiết kiệm" với khoảng ngày chồng
-- lấp nhau) — mỗi goal độc lập tự SUM lại toàn bộ giao dịch expense của
-- category đó trong khoảng ngày, KHÔNG hề biết goal khác cũng đang liên kết
-- cùng category cùng khoảng ngày => CÙNG 1 khoản tiền bị nhiều goal khác
-- nhau cùng tính là "đã để dành" một lúc. Khác lớp bug T-S61/T-S62 (dedup
-- theo THỜI GIAN trong lịch sử của 1 goal) — đây là thiếu dedup theo GOAL
-- (nhiều goal khác nhau, không có ràng buộc "1 category tại 1 thời điểm chỉ
-- được liên kết đúng 1 goal").
--
-- Root cause: không có ràng buộc nào ở DB lẫn code chặn việc này — cả 2
-- đường ghi `linked_category_id` (tạo goal mới qua INSERT thẳng
-- `services/goals.ts createGoal()`, và sửa liên kết qua RPC
-- `update_goal_link`) đều không kiểm tra goal KHÁC có đang liên kết cùng
-- category + khoảng ngày chồng lấp hay không.
--
-- GIẢI PHÁP CHỐT: 1 ràng buộc EXCLUSION ở cấp database (dùng
-- `btree_gist`, extension chuẩn có sẵn trên Postgres/Supabase) — chặn TẠI
-- NGUỒN, không phụ thuộc code phía trên có nhớ check ở từng entry point
-- hay không (đúng bài học rút ra từ chính bug này: RPC có thể có check,
-- nhưng đường INSERT trực tiếp lúc tạo goal thì dễ bị quên). Ràng buộc này
-- đảm bảo: tại bất kỳ thời điểm nào, 1 category chỉ được liên kết ĐÚNG 1
-- goal (còn sống, chưa xoá) cho 1 khoảng ngày bất kỳ — không chồng lấp.
--
-- KHÔNG đổi RLS/RPC nào khác — chỉ thêm extension + 1 constraint mới trên
-- bảng đã có sẵn.

begin;

create extension if not exists btree_gist;

alter table public.saving_goals
  add constraint saving_goals_linked_category_no_overlap
  exclude using gist (
    linked_category_id with =,
    daterange(linked_start_date, linked_end_date, '[]') with &&
  )
  where (linked_category_id is not null and deleted_at is null);

comment on constraint saving_goals_linked_category_no_overlap on public.saving_goals is
  'T-S63: chặn 2 goal KHÁC NHAU (còn sống) cùng linked_category_id với khoảng ngày chồng lấp — tránh 1 khoản chi thật bị nhiều goal khác nhau cùng tính là "đã để dành" một lúc. Áp dụng cho MỌI đường ghi linked_category_id/linked_start_date/linked_end_date (INSERT lúc tạo goal, UPDATE qua RPC update_goal_link) — vi phạm sẽ raise lỗi Postgres 23P01 (exclusion_violation), client (services/goals.ts) bắt lỗi này để hiện thông báo thân thiện.';

commit;
