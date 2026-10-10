-- fix_T-S86_mua_nha_carryover.sql
-- Sửa DỮ LIỆU 1 lần (không phải migration schema/RPC) — chỉ áp dụng cho
-- ĐÚNG 1 trường hợp đã xác nhận qua diagnose_T-S86_stale_overload_impact.sql
-- + xác nhận trực tiếp của người dùng (15/08/2026):
--   - Goal "mua nhà" (id 9a444f24-dcf2-49ac-86aa-abbd964574d8), giai đoạn
--     liên kết category "Thuê nhà" đóng băng lúc 2026-08-15T04:33:06.083792Z
--     — 2 giao dịch (1.500.000đ "Tiền nhà" + 2.000.000đ "Thuê nhà" =
--     3.500.000đ) đã được XÁC NHẬN là chi tiêu TRƯỚC khi bấm liên kết, bị
--     cộng sai vào carried_over_spent_amount do bug 2-overload (T-S86).
-- KHÔNG đụng gì tới giai đoạn 2 của "mua nhà" (188.000.000đ, đóng băng lúc
-- 04:40:20 — người dùng xác nhận đây là giao dịch nhập SAU khi liên kết,
-- ĐÚNG, không sửa) và KHÔNG đụng bất kỳ goal nào khác (toàn bộ goal còn lại
-- trong bảng chẩn đoán được xác nhận là dữ liệu TEST, không cần sửa).
--
-- Chạy 1 lần trong Supabase SQL Editor (quyền service role/postgres, bypass
-- RLS — đây là thao tác admin sửa dữ liệu, không phải RPC client).

begin;

-- Guard: chỉ chạy nếu goal vẫn đúng y hệt trạng thái đã audit — tránh áp
-- nhầm nếu dữ liệu đã đổi (vd đã tự sửa tay trước đó, hoặc script này lỡ
-- chạy 2 lần) từ lúc đọc bảng chẩn đoán tới lúc chạy fix này.
do $$
declare
  v_current numeric;
begin
  select carried_over_spent_amount into v_current
    from public.saving_goals
    where id = '9a444f24-dcf2-49ac-86aa-abbd964574d8' and deleted_at is null;

  if v_current is null then
    raise exception 'Không tìm thấy goal "mua nhà" (id đã cho) hoặc đã bị xoá — DỪNG, không áp fix.';
  end if;

  if v_current is distinct from 191500000 then
    raise exception 'Goal "mua nhà" không còn đúng trạng thái đã audit (carried_over_spent_amount hiện = %, kỳ vọng đúng 191.500.000) — DỪNG lại, KHÔNG áp fix này, cần audit lại trước khi chạy tiếp (có thể script đã chạy rồi, hoặc có thay đổi khác từ sau lúc chẩn đoán).', v_current;
  end if;
end $$;

update public.saving_goals
set
  carried_over_spent_amount = carried_over_spent_amount - 3500000,
  carried_over_transaction_ids = array_remove(
      array_remove(carried_over_transaction_ids, 'dce886d7-8d5f-401b-bc3a-401fb6cbc045'::uuid),
      'fd6023e3-2537-4356-93d5-dac0262fe4b4'::uuid
    ),
  -- Sửa lại đúng phần tử linked_history của giai đoạn bị lỗi (khớp cả
  -- ended_at LẪN amount cũ để tránh khớp nhầm phần tử khác): amount -> 0,
  -- transactions_snapshot -> rỗng (không xoá hẳn phần tử — giữ lại làm dấu
  -- vết đã từng có 1 giai đoạn liên kết category "Thuê nhà" tại đây, đúng
  -- tinh thần "giữ lịch sử" đã dùng xuyên suốt CONSTITUTION, chỉ sửa số
  -- tiền về đúng thực tế).
  linked_history = (
    select jsonb_agg(
             case
               when elem ->> 'ended_at' = '2026-08-15T04:33:06.083792+00:00'
                    and (elem ->> 'amount')::numeric = 3500000
                 then jsonb_set(
                        jsonb_set(elem, '{amount}', '0'::jsonb),
                        '{transactions_snapshot}', '[]'::jsonb
                      )
               else elem
             end
             order by ord
           )
      from jsonb_array_elements(linked_history) with ordinality as t(elem, ord)
  ),
  updated_at = now()
where id = '9a444f24-dcf2-49ac-86aa-abbd964574d8'
  and deleted_at is null
  and carried_over_spent_amount = 191500000; -- lặp lại guard ngay trong WHERE, an toàn kép

commit;

-- VERIFY ngay sau khi chạy — carried_over_spent_amount phải còn đúng
-- 188.000.000 (= 191.500.000 - 3.500.000, khớp đúng giai đoạn 2 vẫn giữ
-- nguyên); carried_over_transaction_ids không còn 2 id đã gỡ; linked_history
-- phần tử giai đoạn 1 amount = 0, transactions_snapshot = [].
select
  carried_over_spent_amount,
  carried_over_transaction_ids,
  linked_history
from public.saving_goals
where id = '9a444f24-dcf2-49ac-86aa-abbd964574d8';
