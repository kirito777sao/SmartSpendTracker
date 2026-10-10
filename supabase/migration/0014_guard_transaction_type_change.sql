-- 0014_guard_transaction_type_change.sql
-- T-S23 (CONSTITUTION §1.10) — cho phép sửa `transactions.type` (income <->
-- expense) của giao dịch đã tạo, thay nguyên tắc "xoá-tạo-lại" cũ ở §1.2.
--
-- Đây là hàng rào phòng thủ TẦNG 2 (defense-in-depth) ở tầng DB — tầng 1 đã
-- chặn ở FE (TransactionHistory.tsx: chỉ hiện toggle đổi loại khi
-- `t.type !== 'transfer' && !t.goalId`; `buildTransactionUpdate`
-- (toTransactionInsert.ts) validate lại category chọn đúng nhóm type mới
-- trước khi gửi patch). Trigger này đảm bảo đúng luật dù có nơi gọi mới sau
-- này (RPC khác, Telegram, seed script...) quên chặn ở tầng trên.
--
-- Luật CHỐT ở CONSTITUTION §1.10:
--   1. Chỉ cho đổi 2 chiều income <-> expense. KHÔNG cho đổi sang/khỏi
--      'transfer' qua đường sửa nhanh này (gắn chặt với apply_goal_contribution,
--      migration 0013).
--   2. Chặn cứng khi `goal_id is not null` (dùng giá trị TRƯỚC khi sửa —
--      OLD.goal_id — muốn đổi type phải gỡ goal_id trước, thao tác tách
--      riêng theo đúng thiết kế).
--   3. Đổi type xong bắt buộc `category_id` mới thuộc đúng nhóm
--      `categories.type` mới — không giữ category cũ khác nhóm.
--
-- KHÔNG cần security definer: hàm chỉ SELECT (đọc categories, bảng người
-- gọi vốn đã có quyền đọc qua RLS §3) + RAISE EXCEPTION khi vi phạm, không
-- ghi đè quyền của ai — dùng security invoker (mặc định) đúng nguyên tắc
-- "ít đặc quyền nhất cần thiết".

begin;

create or replace function public.guard_transaction_type_change()
returns trigger as $$
begin
  -- Không đổi type -> không cần kiểm tra gì thêm ở đây.
  if new.type is not distinct from old.type then
    return new;
  end if;

  if old.type = 'transfer' or new.type = 'transfer' then
    raise exception 'Không được đổi giao dịch sang/khỏi loại "Chuyển khoản" (transfer) qua sửa nhanh.'
      using errcode = '23514';
  end if;

  if old.goal_id is not null then
    raise exception 'Giao dịch đang gắn 1 mục tiêu tiết kiệm — vui lòng gỡ mục tiêu trước khi đổi loại thu/chi.'
      using errcode = '23514';
  end if;

  if new.category_id is null then
    raise exception 'Phải chọn lại 1 danh mục thuộc đúng nhóm mới khi đổi loại giao dịch.'
      using errcode = '23514';
  end if;

  if not exists (
    select 1 from public.categories
    where id = new.category_id and type = new.type and deleted_at is null
  ) then
    raise exception 'Danh mục đã chọn không thuộc đúng nhóm loại giao dịch mới.'
      using errcode = '23514';
  end if;

  return new;
end;
$$ language plpgsql security invoker set search_path = public;

drop trigger if exists trg_guard_transaction_type_change on public.transactions;
create trigger trg_guard_transaction_type_change
before update on public.transactions
for each row execute function public.guard_transaction_type_change();

commit;

-- KHÔNG cần đổi RLS policy nào ở §3 — trigger chạy trước khi RLS `with
-- check` của policy UPDATE đánh giá dòng kết quả, không nới/siết quyền ai,
-- chỉ raise exception sớm hơn với thông điệp rõ ràng hơn lỗi CHECK constraint
-- chung chung nếu để Postgres tự chặn ở tầng khác.
