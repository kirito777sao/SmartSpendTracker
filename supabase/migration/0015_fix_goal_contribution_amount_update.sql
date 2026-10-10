-- 0015_fix_goal_contribution_amount_update.sql
-- T-S25 — [Bug thật báo 08/08/2026]. Trigger `apply_goal_contribution`
-- (migration 0013, CONSTITUTION §2.6/§1.9) chỉ xử lý:
--   - TG_OP='INSERT' (dòng transfer mới -> cộng current_amount)
--   - TG_OP='UPDATE' khi deleted_at ĐỔI (soft-delete -> trừ, restore -> cộng)
-- Thiếu nhánh: sửa `amount` của 1 dòng `transfer` CÒN SỐNG (deleted_at
-- không đổi, vẫn null cả trước lẫn sau) — vd sửa 500.000 -> 300.000 qua
-- form sửa giao dịch (TransactionHistory.tsx, updateTransaction) —
-- `current_amount` của goal không được điều chỉnh theo phần chênh lệch,
-- lệch vĩnh viễn khỏi tổng các dòng transfer thật.
--
-- KHÔNG sửa lại migration 0013 đã chạy (nguyên tắc "mọi mở rộng đi qua
-- migration mới có review", CONSTITUTION §2) — `create or replace function`
-- ở đây định nghĩa lại TOÀN BỘ thân hàm (giữ nguyên 3 nhánh cũ + thêm 1
-- nhánh mới), Postgres áp dụng bản mới nhất cho trigger đã gắn sẵn, không
-- cần drop/create lại trigger.
--
-- Nhánh mới CHỈ áp dụng khi:
--   - old.amount <> new.amount (thật sự có đổi số tiền)
--   - new.type = 'transfer' (không áp cho income/expense — T-S23 đã chặn
--     đổi type sang/khỏi transfer nên type luôn ổn định ở đây)
--   - old.deleted_at is null and new.deleted_at is null (còn sống cả 2 phía
--     — tránh double-count/trùng với 2 nhánh deleted_at đã có ở trên: nếu
--     deleted_at ĐỔI CÙNG LÚC với amount, 2 nhánh soft-delete/restore đã xử
--     lý đúng phần cộng/trừ rồi (soft-delete trừ OLD.amount — số tiền còn
--     sống TRƯỚC lúc xoá; restore cộng lại NEW.amount — số tiền cuối cùng
--     sau khi hoàn tác), không cần cộng thêm phần chênh lệch nữa)
-- Công thức: current_amount += (new.amount - new.amount cũ) — cộng đúng
-- phần chênh lệch, không tính lại từ đầu, tránh race condition với các
-- dòng transfer khác của cùng goal đang được sửa song song.

begin;

create or replace function public.apply_goal_contribution()
returns trigger as $$
begin
  if (tg_op = 'INSERT') then
    if new.goal_id is not null and new.deleted_at is null and new.type = 'transfer' then
      update public.saving_goals set current_amount = current_amount + new.amount
      where id = new.goal_id;
    end if;
  end if;

  if (tg_op = 'UPDATE') then
    -- [T-S25, migration 0015 — hardening] Dùng OLD.amount (không phải
    -- NEW.amount) để trừ: current_amount được cộng vào dựa trên số tiền
    -- CÒN SỐNG TRƯỚC KHI soft-delete (OLD.amount), không phải số tiền sau
    -- khi update xong. Qua RPC thật (soft_delete_transaction, 0006) 2 giá
    -- trị này luôn bằng nhau (RPC chỉ đổi deleted_at, không đụng amount) —
    -- nhưng nếu có nơi gọi khác gộp cả deleted_at + amount trong 1 UPDATE
    -- (vd PostgREST gọi thẳng, bỏ qua RPC), dùng OLD.amount mới trừ đúng
    -- phần đã thực sự được cộng trước đó, tránh lệch current_amount vĩnh
    -- viễn. Cùng lớp bug với chính lý do T-S25 được mở — CONSTITUTION §5
    -- rule "liệt kê ĐỦ mọi field có thể đổi làm lệch tổng" áp cho cả
    -- trường hợp gộp nhiều field thay đổi trong 1 UPDATE, không chỉ 1 field
    -- rõ ràng nhất.
    if new.goal_id is not null and new.type = 'transfer' and old.deleted_at is null and new.deleted_at is not null then
      update public.saving_goals set current_amount = current_amount - old.amount
      where id = new.goal_id;
    end if;
    if new.goal_id is not null and new.type = 'transfer' and old.deleted_at is not null and new.deleted_at is null then
      update public.saving_goals set current_amount = current_amount + new.amount
      where id = new.goal_id;
    end if;

    -- [T-S25, migration 0015] Sửa amount của 1 dòng transfer còn sống
    -- (deleted_at không đổi, vẫn null cả 2 phía) -> cộng đúng phần chênh
    -- lệch, không đụng nhánh soft-delete/restore ở trên (loại trừ lẫn
    -- nhau bằng điều kiện deleted_at is null ở cả 2 phía).
    if new.goal_id is not null and new.type = 'transfer'
       and old.deleted_at is null and new.deleted_at is null
       and old.amount <> new.amount then
      update public.saving_goals
      set current_amount = current_amount + (new.amount - old.amount)
      where id = new.goal_id;
    end if;
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

commit;

-- KHÔNG cần đổi RLS/trigger definition (CREATE TRIGGER) — trigger
-- `trg_goal_contribution` (0001_init_schema.sql) đã gắn sẵn
-- `AFTER INSERT OR UPDATE ON transactions FOR EACH ROW EXECUTE FUNCTION
-- apply_goal_contribution()`, tự dùng bản định nghĩa hàm MỚI NHẤT.
