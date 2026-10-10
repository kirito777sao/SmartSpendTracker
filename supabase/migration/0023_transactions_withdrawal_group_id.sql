-- 0023_transactions_withdrawal_group_id.sql
-- T-S83 [CHỐT 14/08/2026, tiếp — thảo luận "chi tiết lịch sử rút quỹ"]
-- Bối cảnh: khi 1 lần "Rút quỹ" bị cascade qua CẢ 2 nguồn (thủ công +
-- liên kết, xem CONSTITUTION §1.21/§1.22.2, handleSaveWithdraw trong
-- SavingGoals.tsx), 2 phần được ghi thành 2 bản ghi ĐỘC LẬP, KHÔNG có gì
-- đánh dấu chúng cùng 1 lần rút:
--   1. Phần thủ công -> 1 dòng `transactions` (type='expense', goal_id).
--   2. Phần liên kết -> 1 phần tử `type:'withdrawal_log'` trong
--      `saving_goals.linked_history` (RPC withdraw_from_linked_goal, 0021).
-- Người yêu cầu xác nhận muốn GOM rõ 2 phần này thành 1 nhóm hiển thị ở
-- modal "Lịch sử" (SavingGoals.tsx) — quyết định: thêm cột mới (migration),
-- KHÔNG suy luận gộp theo ngày/số tiền trùng khớp (không đáng tin, 2 lần
-- rút khác nhau trong cùng ngày cùng số tiền vẫn có thể xảy ra).
--
-- KHÔNG sửa 0018-0022 đã chạy (đúng convention từ T-S80) — chỉ ALTER TABLE
-- thêm cột mới (nullable, không phá dữ liệu cũ) + CREATE OR REPLACE lại
-- đúng 1 hàm `withdraw_from_linked_goal` với 1 tham số MỚI có default null
-- (an toàn ngược: lời gọi cũ không truyền tham số này vẫn chạy y hệt).

begin;

alter table public.transactions
  add column if not exists withdrawal_group_id uuid;

comment on column public.transactions.withdrawal_group_id is
  'T-S83: id nhóm dùng để gom 1 lần "Rút quỹ" bị cascade qua cả nguồn thủ công (dòng transactions này) lẫn nguồn liên kết (linked_history.withdrawal_log cùng withdrawal_group_id) thành 1 nhóm hiển thị ở modal Lịch sử. NULL với mọi giao dịch khác (góp quỹ thường, chi tiêu thường, rút quỹ chỉ 1 nguồn).';

-- [FIX 14/08/2026 — lỗi thật khi chạy lần đầu: 42725 "function name ... is
-- not unique"] Thêm 1 tham số MỚI (`p_withdrawal_group_id`) làm đổi hẳn
-- signature của hàm — `CREATE OR REPLACE FUNCTION` KHÔNG thay thế hàm cũ
-- trong trường hợp này, mà tạo ra 1 OVERLOAD THỨ 2 cùng tên khác signature
-- (đúng ngữ nghĩa Postgres: "replace" chỉ áp dụng khi danh sách tham số
-- giống hệt cái cũ) — để lại 2 hàm `withdraw_from_linked_goal` cùng tồn
-- tại, khiến `comment on function` (không chỉ định rõ tham số) không biết
-- chọn hàm nào -> lỗi "not unique". Sửa: DROP tường minh đúng signature 4
-- tham số của bản gốc (migration 0021) trước, đảm bảo chỉ còn ĐÚNG 1 hàm
-- sau khi chạy xong.
-- Phòng trường hợp môi trường chạy SQL không coi `begin/commit` là 1
-- transaction thật (một số SQL runner auto-commit từng câu lệnh) khiến lần
-- chạy lỗi trước đó đã kịp tạo overload 5-tham số trước khi lỗi ở bước
-- comment — drop luôn cả 2 signature có thể tồn tại để đảm bảo sạch trước
-- khi tạo lại, không phụ thuộc giả định "toàn bộ script rollback được".
drop function if exists public.withdraw_from_linked_goal(uuid, numeric, text, boolean);
drop function if exists public.withdraw_from_linked_goal(uuid, numeric, text, boolean, uuid);

create or replace function public.withdraw_from_linked_goal(
  p_goal_id uuid,
  p_amount numeric,
  p_note text,
  p_close_goal boolean,
  p_withdrawal_group_id uuid default null
) returns public.saving_goals
language plpgsql
security definer
set search_path = public
as $$
declare
  v_goal public.saving_goals;
begin
  select * into v_goal from public.saving_goals where id = p_goal_id and deleted_at is null for update;
  if not found then
    raise exception 'Không tìm thấy mục tiêu tiết kiệm.';
  end if;

  if v_goal.owner_id is not null and v_goal.owner_id <> auth.uid() then
    raise exception 'Bạn không có quyền thao tác trên mục tiêu này.';
  end if;
  if v_goal.household_id is not null and not is_household_member(v_goal.household_id) then
    raise exception 'Bạn không có quyền thao tác trên mục tiêu này.';
  end if;

  if p_amount is not null then
    if p_amount <= 0 then
      raise exception 'Số tiền rút phải lớn hơn 0.';
    end if;

    update public.saving_goals
    set linked_history = coalesce(linked_history, '[]'::jsonb) || jsonb_build_array(
      jsonb_build_object(
        'type', 'withdrawal_log',
        'amount', p_amount,
        'note', coalesce(p_note, ''),
        'ended_at', now(),
        -- T-S83: null khi rút chỉ 1 nguồn (như cũ) — chỉ có giá trị khi
        -- tầng gọi (SavingGoals.tsx handleSaveWithdraw) phát hiện cascade
        -- cả 2 nguồn cho cùng 1 lần bấm "Rút quỹ".
        'withdrawal_group_id', p_withdrawal_group_id
      )
    )
    where id = p_goal_id;
  end if;

  if p_close_goal then
    update public.saving_goals
    set completed_at = now()
    where id = p_goal_id and completed_at is null;
  end if;

  select * into v_goal from public.saving_goals where id = p_goal_id;
  return v_goal;
end;
$$;

comment on function public.withdraw_from_linked_goal is
  'T-S60/T-S83: ghi 1 dòng log rút quỹ (KHÔNG tạo giao dịch transactions) vào linked_history của goal, dùng cho nhánh "rút từ phần liên kết" — tiền đã chi tiêu thật ở category gốc rồi, không trừ đúp. Tuỳ chọn đóng mục tiêu cùng lúc (p_close_goal). p_withdrawal_group_id (T-S83) dùng để gom với dòng transactions phần thủ công khi 1 lần rút bị cascade qua cả 2 nguồn.';

commit;
