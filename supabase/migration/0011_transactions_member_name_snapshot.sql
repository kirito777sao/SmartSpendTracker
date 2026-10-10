-- =========================================================
-- T-S17 — Fix thật: định danh giao dịch hộ gia đình bị MẤT khi thành viên
-- rời hộ. Người yêu cầu xác nhận chọn HƯỚNG A (2 phương án đã đề xuất ở
-- CHANGELOG "Bug mất định danh khi thành viên rời hộ") — snapshot tên tại
-- thời điểm tạo giao dịch, KHÔNG mở rộng RLS đọc lịch sử (phương án B).
--
-- NGUYÊN NHÂN (đã xác nhận đọc code, không đoán):
-- `rowToTransaction()` (src/lib/mapRows.ts) resolve `member_id -> tên` bằng
-- cách tra trong danh sách thành viên HIỆN TẠI (`listHouseholdMembers`,
-- lọc `household_id = X`). `leave_household`/`remove_member` RPC đổi
-- `profiles.household_id` của người rời -> họ biến mất khỏi danh sách tra
-- cứu đó, dù `transactions.member_id` (FK tới auth.users, không đụng khi
-- rời hộ) vẫn còn nguyên. RLS đọc `profiles` ("read own or same-household
-- profile") cũng chặn đọc lại hồ sơ người đã rời -> không thể fix chỉ bằng
-- đổi câu query phía client, phải lưu bền 1 bản sao tên ngay lúc ghi.
--
-- THIẾT KẾ: cột mới `member_name_snapshot` (nullable, không đổi được sau
-- khi ghi — chỉ set 1 lần bởi trigger BEFORE INSERT, không có cách nào set
-- qua UPDATE vì Update type ở database.types.ts không khai báo field này
-- và không component nào gửi nó lên). Đặt trigger ở TẦNG DB (không phải
-- service layer JS) để áp dụng cho MỌI đường ghi transaction hiện tại và
-- tương lai (web trực tiếp `.insert()`, và RPC `add_transactions_via_bot`
-- của Telegram sau này — CONSTITUTION §4) mà không cần sửa từng nơi gọi.
-- Chỉ áp dụng cho giao dịch HỘ GIA ĐÌNH (`member_id is not null`) — giao
-- dịch cá nhân không cần vì luôn là owner_id = auth.uid() của chính mình.
-- =========================================================

alter table public.transactions
  add column member_name_snapshot text;

comment on column public.transactions.member_name_snapshot is
  'Tên thành viên tại thời điểm TẠO giao dịch (household transactions), snapshot bất biến — không đổi theo tên hiện tại hay còn/mất trong hộ. Dùng làm fallback khi member_id không còn resolve được qua danh sách thành viên hiện tại (đã rời hộ). Xem migration 0011.';

create or replace function public.set_transaction_member_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.member_id is not null then
    select name into new.member_name_snapshot
    from public.profiles
    where id = new.member_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_set_transaction_member_snapshot on public.transactions;
create trigger trg_set_transaction_member_snapshot
  before insert on public.transactions
  for each row
  execute function public.set_transaction_member_snapshot();

-- Backfill best-effort cho giao dịch cũ đã tồn tại TRƯỚC migration này: chỉ
-- lấp được cho member_id còn resolve được NGAY BÂY GIỜ (còn trong hộ tương
-- ứng tại thời điểm chạy migration). Giao dịch của người đã rời hộ TRƯỚC
-- khi migration này chạy sẽ KHÔNG lấp lại được (dữ liệu tên đã mất thật ở
-- nguồn, không có cách khôi phục) — đây là giới hạn đã biết, không phải
-- lỗi của migration. Từ migration này trở đi, mọi giao dịch mới không còn
-- gặp lại vấn đề này nữa dù thành viên rời hộ bất cứ lúc nào sau đó.
update public.transactions t
set member_name_snapshot = p.name
from public.profiles p
where t.member_id = p.id
  and t.member_name_snapshot is null;
