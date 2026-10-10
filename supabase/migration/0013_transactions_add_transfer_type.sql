-- 0013_transactions_add_transfer_type.sql
-- T-S14 — [Phạm vi đã xác nhận 08/08/2026, xem CHANGELOG cùng ngày].
--
-- Vấn đề: đóng góp quỹ tiết kiệm (`SavingGoals.handleTopUp`) hiện ghi
-- `type='expense'` — làm méo báo cáo thu/chi thật vì đây là chuyển khoản
-- nội bộ (tiền vẫn của mình, chỉ đổi "ngăn"), không phải tiền mất đi.
--
-- Giải pháp: thêm giá trị `'transfer'` vào CHECK constraint
-- `transactions.type` (0001_init_schema.sql dòng 88, constraint tự đặt tên
-- `transactions_type_check`). Đồng thời sửa trigger `apply_goal_contribution`
-- (0001_init_schema.sql §6) để CHỈ cộng/trừ `saving_goals.current_amount`
-- khi `type='transfer'` — chuẩn bị sẵn cho T-S19/T-S20 (CONSTITUTION §1.9),
-- lúc đó giao dịch mua thật (`type='expense'`) cũng có thể mang `goal_id`
-- (để tiện tra lịch sử) mà KHÔNG được cộng thêm current_amount lần nữa.
--
-- Backfill: KHÔNG cần — giao dịch `expense` có goal_id đã tồn tại trước
-- migration này giữ nguyên `type='expense'`, chỉ áp `'transfer'` cho giao
-- dịch góp quỹ MỚI tạo sau khi FE (SavingGoals.tsx, toTransactionInsert.ts)
-- deploy bản đã sửa. Không đổi hành vi/số liệu của dữ liệu cũ.

begin;

alter table public.transactions
  drop constraint transactions_type_check;

alter table public.transactions
  add constraint transactions_type_check
  check (type in ('income', 'expense', 'transfer'));

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
    if new.goal_id is not null and new.type = 'transfer' and old.deleted_at is null and new.deleted_at is not null then
      update public.saving_goals set current_amount = current_amount - new.amount
      where id = new.goal_id;
    end if;
    if new.goal_id is not null and new.type = 'transfer' and old.deleted_at is not null and new.deleted_at is null then
      update public.saving_goals set current_amount = current_amount + new.amount
      where id = new.goal_id;
    end if;
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

commit;

-- KHÔNG cần đổi RLS policy nào ở §3 — không policy nào lọc theo `type`.
-- KHÔNG cần đổi RPC nào — không RPC hiện có insert/update trực tiếp vào
-- `transactions.type` ngoài luồng client `.insert()`/`.update()` thường.
