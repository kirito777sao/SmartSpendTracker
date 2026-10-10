-- 0033_profiles_column_grant_hardening.sql
-- T-S12 (hardening review) — VÁ lỗ hổng leo thang quyền CONFIRMED thật qua
-- test `src/services/__tests__/rlsHardening.test.ts` (18/08/2026, xem
-- CHANGELOG "T-S12 — VERIFY THẬT — lỗ hổng ... CONFIRMED"):
--
-- Policy hiện có `update own profile fields on public.profiles for update
-- using (id = auth.uid())` chỉ giới hạn theo HÀNG. RLS không có khái niệm
-- "chặn theo cột" — nên bất kỳ user nào cũng có thể UPDATE thẳng
-- `household_id`/`household_role` trên chính hàng của mình thành BẤT KỲ
-- giá trị nào (kể cả household_id của 1 hộ có thật mà họ không phải chủ),
-- tự phong `household_role='owner'`, bỏ qua hoàn toàn logic invite-code của
-- `join_household_by_code`. Đã verify thật: UPDATE thành công 100%, không
-- có lỗi nào chặn lại.
--
-- Phương án đã chọn (B — REVOKE/GRANT theo cột, xác nhận với người yêu cầu
-- 18/08/2026, xem CHANGELOG): dùng đúng cơ chế PostgreSQL cho "chặn ghi
-- theo cột" — quyền GRANT/REVOKE cấp cột — thay vì trigger. Lý do chọn B
-- thay vì trigger kiểu 0014 (guard_transaction_type_change): đơn giản hơn,
-- minh bạch hơn (audit được ngay qua information_schema.column_privileges,
-- không cần đọc logic PL/pgSQL), và đây đúng là công cụ Postgres thiết kế
-- sẵn cho chính bài toán này — trigger nên dành cho logic nghiệp vụ phức
-- tạp hơn (như 0014, cần so sánh nhiều điều kiện/raise message rõ nghĩa).
--
-- QUAN TRỌNG: các RPC hợp lệ (create_household/join_household_by_code/
-- leave_household/remove_member/transfer_ownership, tất cả `security
-- definer`) KHÔNG bị ảnh hưởng — SECURITY DEFINER bỏ qua kiểm tra quyền
-- cấp bảng/cột của role gọi hàm (`authenticated`), chạy bằng quyền của
-- chủ hàm (owner) thay vì quyền client. Không cần đổi bất kỳ RPC nào.
--
-- Danh sách cột được phép UPDATE từ client — khớp đúng `Update` type đã
-- khai báo ở database.types.ts (comment cũ tại đó đã ghi rõ ý định này,
-- giờ mới thật sự được enforce ở tầng DB thay vì chỉ ở TS):
--   email, name, personal_role, telegram_username, telegram_active_scope
-- KHÔNG cấp: household_id, household_role (đúng lỗ hổng đang vá),
--            telegram_chat_id, telegram_link_token (đã có RPC riêng ở T-S10,
--            §4 — client không được tự set trực tiếp, tránh giả mạo liên kết
--            Telegram của người khác), created_at, updated_at, id.

begin;

-- Thu hồi toàn bộ quyền UPDATE mặc định trên `profiles` khỏi `authenticated`
-- trước, rồi cấp lại CHÍNH XÁC những cột được phép — deny-by-default, an
-- toàn hơn nếu sau này có cột mới mà quên xét lại quyền.
revoke update on public.profiles from authenticated;

grant update (email, name, personal_role, telegram_username, telegram_active_scope)
  on public.profiles to authenticated;

commit;

-- KHÔNG đổi RLS policy nào ở §3 — GRANT/REVOKE là tầng quyền riêng, độc lập
-- và cộng dồn với RLS (row nào được sửa vẫn do policy `using (id =
-- auth.uid())` quyết định; GRANT chỉ thêm điều kiện CỘT nào được sửa trong
-- hàng đó). Client cố UPDATE household_id/household_role từ giờ sẽ nhận lỗi
-- PostgREST 42501 (insufficient_privilege) ngay từ tầng DB, không phải im
-- lặng bỏ qua.
--
-- VERIFY: chạy lại `npm test -- rlsHardening` sau khi áp migration này —
-- kỳ vọng chuyển từ FAIL (UPDATE thành công) sang PASS (UPDATE bị chặn,
-- household_id/household_role đọc lại vẫn null sau khi cố tấn công).
