-- 0024_saving_goals_complete_unspent.sql
-- T-S79 [CONSTITUTION §1.22.4] — "Hoàn thành" với số tiền = 0 (không ghi
-- giao dịch chi tiêu nào). Khác `withdraw_from_linked_goal` hiện có
-- (0021/0023): RPC đó khi gọi với `p_amount=null` CHỈ set `completed_at`,
-- KHÔNG ghi lại BẤT KỲ log nào mô tả số tiền đã gom được tại thời điểm đó
-- (không có ý nghĩa "đã dùng gì" nên không cần — nhưng T-S79 cần 1 dòng
-- LỊCH SỬ mô tả rõ "đã gom đủ NHƯNG CHƯA DÙNG", breakdown thủ công/liên
-- kết, để người xem lại lịch sử biết chính xác số tiền tại thời điểm đóng
-- mục tiêu, không phải đoán ngược từ các dòng góp quỹ rời rạc).
--
-- KHÔNG sửa 0021/0023 đã chạy — thêm RPC MỚI hoàn toàn (`complete_goal_unspent`),
-- không đụng chữ ký `withdraw_from_linked_goal` hiện có.

begin;

create or replace function public.complete_goal_unspent(
  p_goal_id uuid,
  p_manual_amount numeric,
  p_linked_amount numeric,
  p_note text
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

  if coalesce(p_manual_amount, 0) < 0 or coalesce(p_linked_amount, 0) < 0 then
    raise exception 'Số tiền không hợp lệ.';
  end if;

  update public.saving_goals
  set linked_history = coalesce(linked_history, '[]'::jsonb) || jsonb_build_array(
    jsonb_build_object(
      -- T-S79: type RIÊNG, KHÔNG phải 'withdrawal_log' — không phải 1 lần
      -- rút/chi tiêu thật, chỉ là snapshot mô tả "đã gom đủ, đóng mục tiêu,
      -- CHƯA dùng đồng nào". `manual_amount`/`linked_amount` tách riêng
      -- (khác `withdrawal_log` chỉ có 1 field `amount` chung) vì bản chất
      -- là 2 con số ĐỘC LẬP cần hiển thị breakdown, không phải 1 khoản rút
      -- gộp cần cộng lại.
      'type', 'completed_unspent',
      'manual_amount', coalesce(p_manual_amount, 0),
      'linked_amount', coalesce(p_linked_amount, 0),
      'note', coalesce(p_note, ''),
      'ended_at', now()
    )
  ),
  completed_at = coalesce(completed_at, now())
  where id = p_goal_id;

  select * into v_goal from public.saving_goals where id = p_goal_id;
  return v_goal;
end;
$$;

comment on function public.complete_goal_unspent is
  'T-S79 (CONSTITUTION §1.22.4): đánh dấu goal hoàn thành mà KHÔNG ghi bất kỳ giao dịch chi tiêu/log rút quỹ nào — dùng khi tiền (phần liên kết) vẫn còn nguyên ở ví khác ngoài đời, chưa thật sự tiêu. Ghi 1 phần tử `type=completed_unspent` vào linked_history làm snapshot breakdown thủ công/liên kết tại thời điểm đóng, thuần thông tin — KHÔNG trừ vào `goalCurrentAmount` (khác `withdrawal_log`).';

commit;
