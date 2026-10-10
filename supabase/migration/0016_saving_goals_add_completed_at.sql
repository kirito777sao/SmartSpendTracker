-- 0016_saving_goals_add_completed_at.sql
-- T-S19 (CONSTITUTION §1.9 mục 3) — "Hoàn thành" mục tiêu tiết kiệm (luồng
-- thủ công). Thêm cột completed_at cho saving_goals.
--
-- Thuộc diện "đổi cấu trúc bảng đã chốt" (CONSTITUTION §5, cột "Hỏi trước
-- khi làm") — đã hỏi và được người yêu cầu xác nhận rõ 09/08/2026 trước khi
-- viết migration này (không tự ý chạy).
--
-- Ngữ nghĩa: NULL = goal đang tiết kiệm (mọi goal hiện có giữ nguyên hành vi
-- cũ, không cần backfill). Có giá trị = đã bấm "Hoàn thành" (nút thủ công
-- T-S19, hoặc xác nhận banner tự động T-S20 sau này — CÙNG 1 action, xem
-- `useCompleteGoal` ở hooks/useGoals.ts) — `current_amount` GIỮ NGUYÊN làm
-- lịch sử, KHÔNG reset/xoá (§1.9 mục 3, không có bước reconciliation nào).
--
-- Không cần index riêng: số lượng goal mỗi user/hộ nhỏ, toàn bộ danh sách
-- đã tải qua đúng 1 query `useGoals` (client tự lọc active/completed bằng
-- `completed_at`), không có truy vấn WHERE completed_at nào ở service layer
-- cần tối ưu.
--
-- Không đổi RLS: SELECT/UPDATE policy hiện có của `saving_goals` (§3) không
-- lọc theo field cụ thể nào ngoài owner/household/deleted_at — completed_at
-- chỉ là 1 field dữ liệu thường, mọi thành viên hộ vẫn sửa được như các
-- field khác (name/target_amount/target_date), đúng RBAC đã CHỐT (chỉ XOÁ
-- goal mới giới hạn owner/created_by, qua RPC delete_goal riêng).

begin;

alter table public.saving_goals
  add column completed_at timestamptz;

commit;
