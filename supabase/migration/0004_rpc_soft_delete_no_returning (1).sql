-- =========================================================
-- ĐÃ BỊ THAY THẾ HOÀN TOÀN — KHÔNG CHẠY LẠI FILE NÀY.
-- Cả 4 hàm dưới đây (category + transaction) dùng `security invoker`, dựa
-- trên giả thuyết SAI "tránh RETURNING là đủ". Vì đều là `create or replace`,
-- chạy lại file này sau khi đã áp 0005/0006 sẽ ÂM THẦM REVERT về bản lỗi.
--   - soft_delete_category / restore_category  → thay bởi 0005 (security definer)
--   - soft_delete_transaction / restore_transaction → thay bởi 0006 (security definer)
-- Giữ file lại chỉ để làm hồ sơ lịch sử migration, xem CHANGELOG.md.
-- =========================================================

-- =========================================================
-- T-S05 — Fix thật phát hiện qua test: UPDATE deleted_at trực tiếp từ
-- client (PostgREST) luôn kèm RETURNING nội bộ (để tính row count/status),
-- và Postgres coi UPDATE...RETURNING trên 1 dòng KHÔNG còn thoả SELECT
-- policy sau khi update (ở đây: deleted_at is null) là LỖI RLS thật
-- (42501), không phải silently ẩn dòng đi. Đây là hành vi chuẩn của
-- Postgres RLS cho RETURNING, không phải bug ở policy USING/WITH CHECK —
-- 2 cái đó vẫn đúng, đã verify bằng debug_check_insert + qual/with_check
-- thật lấy từ pg_policies (xem CHANGELOG).
--
-- Fix: đưa UPDATE deleted_at vào RPC SECURITY INVOKER — vẫn chạy dưới
-- quyền người gọi (auth.uid() không đổi, USING/WITH CHECK của policy
-- UPDATE vẫn áp đúng như cũ, không nới quyền gì thêm), nhưng vì câu UPDATE
-- bên trong hàm KHÔNG có RETURNING nên không bao giờ chạm nhánh lỗi này.
-- =========================================================

create or replace function public.soft_delete_category(p_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.categories set deleted_at = now() where id = p_id;
end;
$$;

create or replace function public.restore_category(p_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.categories set deleted_at = null where id = p_id;
end;
$$;

create or replace function public.soft_delete_transaction(p_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.transactions set deleted_at = now() where id = p_id;
end;
$$;

create or replace function public.restore_transaction(p_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.transactions set deleted_at = null where id = p_id;
end;
$$;

grant execute on function public.soft_delete_category(uuid) to authenticated;
grant execute on function public.restore_category(uuid) to authenticated;
grant execute on function public.soft_delete_transaction(uuid) to authenticated;
grant execute on function public.restore_transaction(uuid) to authenticated;
