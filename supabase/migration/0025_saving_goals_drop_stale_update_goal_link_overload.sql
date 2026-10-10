-- 0025_saving_goals_drop_stale_update_goal_link_overload.sql
-- T-S86 [BUG THẬT 15/08/2026, xem CONSTITUTION §1.22.6 + CHANGELOG "T-S86"]
-- KHÔNG sửa 0018/0019/0020/0021/0022 đã chạy — chỉ DROP đúng 1 overload cũ,
-- không đổi logic bên trong overload đang dùng (0022).
--
-- BỐI CẢNH: người dùng test T-S80/T-S81 (link category "thuê nhà" vào goal
-- thủ công có sẵn, chọn RÕ "Ngân sách chi tiêu thường" tức is_savings_link=
-- false) nhưng khoản chi PHÁT SINH TRƯỚC thời điểm bấm liên kết (3.500.000đ)
-- vẫn bị cộng vào carried_over_spent_amount — đúng ra phải bị loại theo
-- §1.22.5/T-S80 ("chi tiêu thường" chỉ tính từ linked_at trở đi).
--
-- ROOT CAUSE xác nhận qua truy vấn trực tiếp Supabase SQL Editor:
--   select oid::regprocedure from pg_proc where proname = 'update_goal_link';
--   -> trả về 2 DÒNG:
--        update_goal_link(uuid,uuid,date,date)          -- bản CŨ, từ 0018/0019
--        update_goal_link(uuid,uuid,date,date,boolean)  -- bản ĐÚNG, từ 0022 (T-S80)
--
-- Lý do tồn tại song song: `create or replace function` chỉ thay thế đúng
-- 1 hàm có CÙNG danh sách kiểu tham số. Migration 0022 thêm tham số MỚI
-- `p_is_savings_link` (dù có `default false`) -> đổi hẳn signature so với
-- bản 4 tham số của 0018/0019 -> Postgres coi đây là 1 OVERLOAD MỚI, không
-- ghi đè lên bản cũ. Bản cũ 4 tham số (hoàn toàn không biết đến
-- is_savings_link/linked_at) vẫn còn nguyên trong DB, sống song song với
-- bản đúng. Bất kỳ đường gọi nào (PostgREST schema cache cũ chưa reload,
-- client build cũ, hay công cụ gọi RPC nào khác không gửi đúng tham số
-- `p_is_savings_link`) đều có thể khớp vào ĐÚNG bản cũ này thay vì bản 0022
-- -> im lặng bỏ qua toàn bộ logic "chi tiêu thường" (T-S80), quay lại hành
-- vi hồi tố vô điều kiện của 0018/0019 -> đúng y hệt hiện tượng người dùng
-- báo cáo. Đây là bug hạ tầng (2 phiên bản hàm cùng tên tồn tại song song),
-- không phải bug trong logic SQL của 0022 (logic 0022 đọc lại kỹ vẫn ĐÚNG,
-- xem 0022 dòng 142: `and (v_goal.is_savings_link or t.date >=
-- v_goal.linked_at::date)`).
--
-- GIẢI PHÁP: xoá hẳn overload CŨ (4 tham số) — không có lý do giữ lại, mọi
-- lời gọi hợp lệ từ client (`src/services/goals.ts updateGoalLink`) LUÔN
-- gửi đủ 5 tham số kể cả `p_is_savings_link` (xem services/goals.ts dòng
-- 105-111, không có đường gọi nào trong code hiện tại chỉ gửi 4 tham số).
-- Xoá xong chỉ còn ĐÚNG 1 hàm `update_goal_link` trong DB -> loại bỏ vĩnh
-- viễn khả năng bị khớp nhầm, bất kể nguyên nhân khớp nhầm cụ thể là gì.
--
-- KHÔNG đổi RLS/grant nào khác — DROP FUNCTION không đụng RLS của
-- saving_goals/transactions.

begin;

drop function if exists public.update_goal_link(uuid, uuid, date, date);

commit;

-- SAU KHI CHẠY migration này trên Supabase thật, BẮT BUỘC thêm 1 bước thủ
-- công (không phải SQL, làm trong Supabase Dashboard): Settings -> API ->
-- "Reload schema cache" (hoặc chạy `NOTIFY pgrst, 'reload schema';` trong
-- SQL Editor) — để PostgREST bỏ cache cũ (nếu có) từng biết tới overload
-- vừa xoá, tránh lỗi "Could not find the function" tạm thời do cache trễ.
--
-- VERIFY sau khi chạy (dán lại đúng câu người dùng đã chạy để xác nhận):
--   select oid::regprocedure from pg_proc where proname = 'update_goal_link';
--   -> PHẢI chỉ còn ĐÚNG 1 dòng: update_goal_link(uuid,uuid,date,date,boolean)
--
-- LƯU Ý QUAN TRỌNG — DỮ LIỆU CŨ ĐÃ BỊ CỘNG SAI (khoản 3.500.000đ của goal
-- "thuê nhà" và có thể còn goal khác đã từng link/relink cùng lỗi này)
-- KHÔNG được migration này tự sửa — migration chỉ chặn lỗi PHÁT SINH THÊM
-- từ bây giờ, không hồi tố dữ liệu đã ghi sai trước đó. Sửa dữ liệu cũ
-- (rút đúng khoản 3.5M đã cộng nhầm ra khỏi carried_over_spent_amount +
-- gỡ đúng transaction id tương ứng khỏi carried_over_transaction_ids của
-- goal đó) là thay đổi DỮ LIỆU sản xuất trực tiếp — thuộc "Hỏi trước khi
-- làm" (CONSTITUTION §5), CHƯA làm ở migration này, cần người yêu cầu xác
-- nhận rõ goal nào/số tiền nào trước khi viết script sửa riêng.
