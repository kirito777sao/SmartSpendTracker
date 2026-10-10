-- =========================================================
-- T-S05 — Sửa lần 2: soft_delete_category / restore_category.
--
-- NGUYÊN NHÂN THẬT (đã xác nhận bằng thực nghiệm A/B trên project TEST +
-- đối chiếu nguồn Postgres, xem thảo luận đầy đủ trong CHANGELOG.md):
-- Postgres có hành vi CHỦ Ý — với UPDATE có mệnh đề WHERE, dòng kết quả phải
-- thoả policy SELECT của bảng CẢ TRƯỚC LẪN SAU khi update, HOÀN TOÀN không
-- phụ thuộc việc câu lệnh có RETURNING hay không. Bảng `categories` có
-- policy SELECT lọc `deleted_at is null`, nên bất kỳ UPDATE nào đổi
-- `deleted_at` từ null → not null đều tự động vi phạm SELECT policy ở dòng
-- KẾT QUẢ, bị Postgres coi như vi phạm RLS thật (42501) — kể cả khi chạy
-- trong 1 hàm `security invoker` không hề có RETURNING (đã tự kiểm chứng,
-- xem file 0004 — cách tiếp cận đó SAI, đã bị thay bằng file này).
--
-- FIX: đổi hẳn sang `security definer`. Hàm chạy với quyền CHỦ hàm (bỏ qua
-- RLS hoàn toàn cho UPDATE bên trong — xác nhận an toàn vì
-- `relforcerowsecurity = false` trên categories), và tự kiểm tra quyền
-- THỦ CÔNG ngay trong hàm — lặp lại CHÍNH XÁC điều kiện của policy UPDATE đã
-- CHỐT ở §3 CONSTITUTION.md, KHÔNG nới thêm bất kỳ quyền nào. Đây đúng pattern
-- đã dùng cho các RPC khác trong project (xem 0003b_rpc_leave_household.sql,
-- 0003c_rpc_transfer_ownership.sql) — RLS trên categories vẫn nguyên vẹn,
-- không đổi, chỉ riêng 2 thao tác soft-delete/restore đi vòng qua nó bằng
-- security definer + manual check, vì đây là chỗ DUY NHẤT trong schema hiện
-- tại có UPDATE làm đổi giá trị cột nằm trong chính SELECT policy của bảng.
-- =========================================================

drop function if exists public.soft_delete_category(uuid);
drop function if exists public.restore_category(uuid);

create function public.soft_delete_category(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
  v_household_id uuid;
begin
  select owner_id, household_id into v_owner_id, v_household_id
  from public.categories
  where id = p_id and deleted_at is null;

  if not found then
    raise exception 'Không tìm thấy category, hoặc đã bị xoá.';
  end if;

  if not (
    v_owner_id = auth.uid()
    or (v_household_id is not null and public.is_household_owner(v_household_id))
  ) then
    raise exception 'Bạn không có quyền xoá category này.';
  end if;

  update public.categories
  set deleted_at = now()
  where id = p_id;
end;
$$;

create function public.restore_category(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
  v_household_id uuid;
begin
  select owner_id, household_id into v_owner_id, v_household_id
  from public.categories
  where id = p_id and deleted_at is not null;

  if not found then
    raise exception 'Không tìm thấy category đã xoá.';
  end if;

  if not (
    v_owner_id = auth.uid()
    or (v_household_id is not null and public.is_household_owner(v_household_id))
  ) then
    raise exception 'Bạn không có quyền hoàn tác category này.';
  end if;

  update public.categories
  set deleted_at = null
  where id = p_id;
end;
$$;

grant execute on function public.soft_delete_category(uuid) to authenticated;
grant execute on function public.restore_category(uuid) to authenticated;

-- LƯU Ý (chưa xử lý ở file này, cần bạn xác nhận trước — xem CHANGELOG):
-- 1. `debug_check_insert` / `debug_update_check` vẫn đang tồn tại trên DB
--    ngoài migration files — quyết định giữ (đưa vào migration riêng) hay
--    drop sau khi T-S05 xanh.
-- 2. Rule mới nên thêm vào CONSTITUTION.md §3: "Mọi UPDATE làm đổi giá trị
--    1 cột nằm trong chính SELECT policy của bảng (điển hình: soft-delete
--    đổi deleted_at khi SELECT policy lọc deleted_at is null) BẮT BUỘC dùng
--    RPC security definer + manual check, KHÔNG được update trực tiếp qua
--    PostgREST/client — vì Postgres luôn yêu cầu dòng kết quả thoả SELECT
--    policy cả trước lẫn sau UPDATE, không có cách nào tắt hành vi này ở
--    tầng policy thường."
