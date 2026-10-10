-- 0017_saving_goals_linked_category.sql
-- T-S48 — [10/08/2026, xem PRD.md "Chốt 10/08/2026" + CONSTITUTION §1.13].
-- CHƯA CHẠY — thuộc diện "đổi cấu trúc bảng đã chốt" (CONSTITUTION §5, cột
-- "Hỏi trước khi làm"). File này chỉ CHUẨN BỊ đúng theo AC đã ghi ở TASKS.md
-- (T-S48), KHÔNG tự ý apply lên Supabase — người yêu cầu phải tự chạy (hoặc
-- xác nhận rõ ràng để chạy) sau khi đã soát lại.
--
-- LƯU Ý PHỤ THUỘC (đối chiếu TASKS.md lúc soát migration này): T-S48 khai
-- báo phụ thuộc T-S47, T-S14, T-S45. T-S14/T-S45 đã 🔒, nhưng T-S47 hiện
-- đang 🟡 (code xong, CHƯA test UI thật lại sau bugfix gần nhất) — chưa
-- 🔒. Theo đúng PHASE 2 bước 1 ("respecting dependency order"), về nguyên
-- tắc không nên bắt đầu T-S48 (kể cả bước migration) trước khi T-S47 verify
-- xong. Ghi nhận rõ ở đây; không tự ý chạy migration này thay người yêu cầu.
--
-- Vấn đề: category ngân sách định kỳ (vd "Tiết kiệm & Đầu tư") không có
-- cách nào xem TỔNG đã "để dành" qua các tháng mà không tự cộng tay. Thêm
-- 1 loại goal thứ 2 — "goal liên kết category" — SONG SONG với goal thủ
-- công hiện có (current_amount cộng dồn qua transfer, §1.9), KHÔNG thay
-- thế. 2 sổ độc lập, không liên thông (CONSTITUTION §1.13, hướng A đã
-- chốt) — tuyệt đối không có giao dịch/thao tác nào mang ý nghĩa "rút từ
-- category liên kết sang góp cho goal thủ công", tránh double-count.
--
-- Ngữ nghĩa 3 cột mới:
--   - linked_category_id: NULL = goal thủ công (mặc định, hành vi không đổi
--     cho toàn bộ goal hiện có). Có giá trị = goal liên kết category — loại
--     goal này bỏ qua cột current_amount hiện có của bảng (không đọc/không
--     ghi), client tự tính lại bằng SUM(transactions.amount) where
--     category_id = linked_category_id and type = 'expense' and
--     deleted_at is null and date between linked_start_date and
--     linked_end_date (tính ở hook/query, KHÔNG lưu cứng — tránh lệch khi
--     có giao dịch mới/sửa/xoá sau này).
--   - linked_start_date / linked_end_date: khoảng ngày TUỲ Ý người dùng chọn
--     lúc tạo goal (không mặc định "từ ngày tạo", không tự reset theo
--     tháng) — BẮT BUỘC cùng có giá trị với linked_category_id (constraint
--     bên dưới), validate end >= start.
--   - on delete set null: xoá category đang liên kết không được xoá theo
--     goal — goal tự rơi về "chưa liên kết" (linked_category_id = null),
--     UI phải tự xử lý fallback hợp lý (không crash) — nhưng chú ý: 2 cột
--     ngày sẽ MỒ CÔI (còn giá trị) trong khi linked_category_id đã null,
--     phá vỡ ngay ràng buộc constraint bên dưới (đòi hỏi cả 3 cùng null
--     hoặc cùng có giá trị) trừ khi cascade cũng dọn 2 cột ngày. Vì "on
--     delete set null" chỉ tự set đúng 1 cột FK, không tự dọn cột khác —
--     BẮT BUỘC có trigger riêng dọn kèm 2 cột ngày, xem bên dưới.
--
-- Backfill: KHÔNG cần — mọi goal hiện có giữ nguyên linked_category_id =
-- null (hành vi goal thủ công như cũ, không đổi gì).
--
-- KHÔNG đổi RLS: SELECT/UPDATE policy hiện có của `saving_goals` (§3) không
-- lọc theo field cụ thể ngoài owner/household/deleted_at — 3 cột mới chỉ là
-- field dữ liệu thường, đọc/sửa theo đúng RBAC đã CHỐT (mọi thành viên hộ
-- sửa được, chỉ XOÁ goal mới giới hạn qua RPC delete_goal riêng).

begin;

alter table public.saving_goals
  add column linked_category_id uuid references public.categories(id) on delete set null,
  add column linked_start_date date,
  add column linked_end_date date;

alter table public.saving_goals
  add constraint saving_goals_linked_dates_check
  check (
    (linked_category_id is null and linked_start_date is null and linked_end_date is null)
    or (linked_category_id is not null and linked_start_date is not null and linked_end_date is not null
        and linked_end_date >= linked_start_date)
  );

-- Dọn kèm 2 cột ngày khi `on delete set null` ở trên tự đưa
-- linked_category_id về null (category liên kết bị xoá) — nếu không, dòng
-- goal sẽ vi phạm ngay constraint XOR vừa thêm (linked_category_id = null
-- nhưng 2 cột ngày vẫn còn giá trị cũ).
create or replace function public.clear_linked_goal_dates_on_category_unlink()
returns trigger as $$
begin
  if new.linked_category_id is null and old.linked_category_id is not null then
    new.linked_start_date := null;
    new.linked_end_date := null;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger trg_clear_linked_goal_dates
before update on public.saving_goals
for each row execute function public.clear_linked_goal_dates_on_category_unlink();

commit;
