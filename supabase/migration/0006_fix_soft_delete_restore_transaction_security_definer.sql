-- =========================================================
-- T-S05 — Sửa transactions: cùng 1 lớp bug đã fix cho categories ở 0005,
-- nhưng lúc đó CHỈ SỬA categories, quên áp lại đúng pattern cho transactions
-- dù cả 2 hàm được viết CÙNG 1 FILE 0004 (cùng dùng security invoker, cùng
-- sai). Đây là nợ kỹ thuật bỏ sót, phát hiện qua transactions.test.ts:
--   "insert → select → soft-delete → restore" fail ở bước soft-delete với
--   đúng thông điệp đã gặp ở categories trước khi có 0005:
--   `new row violates row-level security policy for table "transactions"`.
--
-- NGUYÊN NHÂN (đã xác nhận thực nghiệm cho categories ở 0005, áp dụng y hệt
-- ở đây vì cùng cấu trúc bảng — deleted_at nằm trong SELECT policy):
-- Postgres yêu cầu dòng KẾT QUẢ của UPDATE có WHERE phải thoả SELECT policy
-- của bảng cả TRƯỚC LẪN SAU khi update, không liên quan RETURNING, không
-- liên quan security invoker/definer của hàm gọi UPDATE đó. SELECT policy
-- của `transactions` lọc `deleted_at is null` → mọi UPDATE đổi deleted_at
-- tự vi phạm khi chạy dưới quyền người gọi thường (security invoker).
--
-- FIX: đổi `soft_delete_transaction`/`restore_transaction` sang
-- `security definer`, tự kiểm tra quyền thủ công — lặp lại CHÍNH XÁC điều
-- kiện policy "update own personal or household transactions" đã CHỐT ở
-- CONSTITUTION §3 (owner cá nhân, HOẶC member tự sửa giao dịch hộ của mình,
-- HOẶC chủ hộ override mọi giao dịch hộ) — KHÔNG nới thêm quyền nào.
-- File `0004` KHÔNG xoá, giữ làm hồ sơ (đã sai y hệt lý do file 0004 của
-- category cũ bị thay thế).
-- =========================================================

drop function if exists public.soft_delete_transaction(uuid);
drop function if exists public.restore_transaction(uuid);

create function public.soft_delete_transaction(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
  v_household_id uuid;
  v_member_id uuid;
begin
  select owner_id, household_id, member_id into v_owner_id, v_household_id, v_member_id
  from public.transactions
  where id = p_id and deleted_at is null;

  if not found then
    raise exception 'Không tìm thấy giao dịch, hoặc đã bị xoá.';
  end if;

  if not (
    v_owner_id = auth.uid()
    or (v_household_id is not null and v_member_id = auth.uid())
    or (v_household_id is not null and public.is_household_owner(v_household_id))
  ) then
    raise exception 'Bạn không có quyền xoá giao dịch này.';
  end if;

  update public.transactions
  set deleted_at = now()
  where id = p_id;
end;
$$;

create function public.restore_transaction(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
  v_household_id uuid;
  v_member_id uuid;
begin
  select owner_id, household_id, member_id into v_owner_id, v_household_id, v_member_id
  from public.transactions
  where id = p_id and deleted_at is not null;

  if not found then
    raise exception 'Không tìm thấy giao dịch đã xoá.';
  end if;

  if not (
    v_owner_id = auth.uid()
    or (v_household_id is not null and v_member_id = auth.uid())
    or (v_household_id is not null and public.is_household_owner(v_household_id))
  ) then
    raise exception 'Bạn không có quyền hoàn tác giao dịch này.';
  end if;

  update public.transactions
  set deleted_at = null
  where id = p_id;
end;
$$;

grant execute on function public.soft_delete_transaction(uuid) to authenticated;
grant execute on function public.restore_transaction(uuid) to authenticated;
