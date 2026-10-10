-- =========================================================
-- ĐÃ BỊ THAY THẾ bởi 0005_fix_soft_delete_restore_category_security_definer.sql
-- Lý do: giả thuyết "tránh RETURNING là đủ" ở file này SAI. Postgres có hành vi
-- CHỦ Ý (không phải bug): với UPDATE có WHERE, dòng kết quả phải thoả SELECT
-- policy CẢ TRƯỚC LẪN SAU khi update — bất kể có RETURNING hay không (xác nhận
-- qua thực nghiệm A/B thật trên project TEST + nguồn: thread pgsql-hackers
-- "Bug: RLS policy FOR SELECT is used to check new rows", 10/2023 — đề xuất chỉ
-- áp policy này khi có RETURNING chưa được đưa vào Postgres). Vì SELECT policy
-- categories lọc `deleted_at is null`, MỌI update đổi deleted_at (kể cả trong
-- 1 RPC `security invoker` không RETURNING) đều bị chặn y hệt lỗi RLS thật.
-- Giữ nguyên file này (không xoá) làm hồ sơ — xem CHANGELOG mục T-S05 "sửa lần
-- 2" để không lặp lại nhầm lẫn.
-- =========================================================

-- =========================================================
-- T-S05 — RPC soft_delete_category / restore_category.
-- Bug thật phát hiện khi test T-S05: gọi thẳng
-- `supabase.from("categories").update({ deleted_at: now }).eq("id", id)`
-- luôn kèm RETURNING ngầm ở PostgREST. Dòng SAU khi update không còn thoả
-- policy "read own or household categories" (lọc `deleted_at is null`) →
-- Postgres raise lỗi RLS thật (42501 "new row violates row-level security
-- policy") thay vì chỉ ẩn dòng khỏi kết quả trả về như UPDATE thường.
--
-- Fix: RPC `security invoker`, KHÔNG RETURNING / KHÔNG `returns table` /
-- KHÔNG `returns setof categories` — chỉ `returns void`. UPDATE bên trong
-- không có RETURNING nên Postgres không cần áp lại SELECT policy lên dòng
-- mới, tránh đúng lỗi trên. `security invoker` (KHÔNG phải definer) để
-- policy "update personal or owned household categories" (§3, CHỐT) vẫn áp
-- y hệt theo quyền người gọi thật — RPC không nới quyền gì thêm, chỉ đổi
-- CÁCH gọi, RBAC giữ nguyên 100% như đã chốt.
--
-- Dùng `if not found` (dựa trên số dòng UPDATE ảnh hưởng, không cần
-- RETURNING) để raise lỗi rõ ràng khi id không tồn tại / đã bị xoá rồi /
-- người gọi không có quyền (bị RLS USING lọc mất) — thay vì âm thầm no-op.
-- =========================================================

create or replace function public.soft_delete_category(p_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.categories
  set deleted_at = now()
  where id = p_id
    and deleted_at is null;

  if not found then
    raise exception 'Không tìm thấy category, category đã bị xoá, hoặc bạn không có quyền xoá.'
      using errcode = '42501';
  end if;
end;
$$;

create or replace function public.restore_category(p_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.categories
  set deleted_at = null
  where id = p_id
    and deleted_at is not null;

  if not found then
    raise exception 'Không tìm thấy category đã xoá, hoặc bạn không có quyền hoàn tác.'
      using errcode = '42501';
  end if;
end;
$$;

grant execute on function public.soft_delete_category(uuid) to authenticated;
grant execute on function public.restore_category(uuid) to authenticated;

-- LƯU Ý dọn dẹp (không thuộc phạm vi file này, xem CHANGELOG mục T-S05
-- "Session cũ để lại nợ kỹ thuật"): `debug_check_insert` / `debug_update_check`
-- đang tồn tại trên project TEST nhưng KHÔNG có trong bất kỳ file migration
-- nào — vi phạm kỷ luật "mọi thay đổi DB phải có migration file" đã áp dụng
-- nhất quán từ T-S01. Cân nhắc DROP 2 hàm debug này sau khi T-S05 xanh, hoặc
-- nếu muốn giữ lại làm công cụ chẩn đoán lâu dài thì phải đưa vào 1 file
-- migration riêng (vd `0004b_debug_helpers.sql`) để không còn là DB drift.
