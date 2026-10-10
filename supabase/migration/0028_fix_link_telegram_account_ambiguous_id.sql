-- =========================================================
-- T-S10 hotfix (17/08/2026) — sửa lỗi 42702 "column reference id is
-- ambiguous" phát hiện khi test tay /link trên Telegram thật.
--
-- Nguyên nhân: `link_telegram_account` khai báo
-- `returns table (id uuid, name text, household_id uuid)` — Postgres tự
-- tạo biến PL/pgSQL ẩn tên `id`/`name`/`household_id` trong toàn bộ thân
-- hàm. 2 câu UPDATE bên trong lại dùng `where id = ...`/`id is distinct
-- from ...` KHÔNG có alias bảng — Postgres không phân biệt được đây là
-- biến trả về hay cột `public.profiles.id`, báo lỗi mơ hồ (ambiguous) và
-- huỷ toàn bộ giao dịch (không ghi được gì, kể cả bước gán chat_id đầu).
--
-- Sửa: thêm alias `t` rõ ràng cho bảng profiles ở cả 2 câu UPDATE — không
-- đổi chữ ký hàm, không đổi cách Edge Function gọi/đọc kết quả.
-- =========================================================

create or replace function public.link_telegram_account(
  p_token text,
  p_chat_id text,
  p_username text
)
returns table (id uuid, name text, household_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target_id uuid;
  v_target_name text;
  v_target_household uuid;
begin
  select p.id, p.name, p.household_id
  into v_target_id, v_target_name, v_target_household
  from public.profiles p
  where p.telegram_link_token = p_token
  limit 1;

  if v_target_id is null then
    raise exception 'invalid_token';
  end if;

  -- Gỡ liên kết cũ nếu chat_id này đang gán ở 1 profile KHÁC (không phải
  -- đích) — chạy TRƯỚC bước gán mới để không vi phạm unique constraint.
  -- [HOTFIX] thêm alias "t" — tránh trùng tên với cột trả về "id" của hàm.
  update public.profiles t
  set telegram_chat_id = null, telegram_username = null
  where t.telegram_chat_id = p_chat_id and t.id is distinct from v_target_id;

  -- [HOTFIX] thêm alias "t" — tránh trùng tên với cột trả về "id" của hàm.
  update public.profiles t
  set telegram_chat_id = p_chat_id,
      telegram_username = nullif(p_username, ''),
      telegram_link_token = null
  where t.id = v_target_id;

  return query select v_target_id, v_target_name, v_target_household;
end;
$$;

grant execute on function public.link_telegram_account(text, text, text) to service_role;
