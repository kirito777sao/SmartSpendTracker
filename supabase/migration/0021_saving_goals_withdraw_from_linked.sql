-- 0021_saving_goals_withdraw_from_linked.sql
-- T-S60 — [12/08/2026, CONSTITUTION §1.21]. "Rút quỹ" thay cho "Hoàn thành"
-- 1 lần (T-S19). Phần "rút từ phần thủ công" TÁI DÙNG nguyên xi cơ chế đã
-- có (ghi 1 giao dịch expense thật, gắn goal_id — xem `useCompleteGoal`,
-- KHÔNG cần RPC mới). RPC dưới đây CHỈ phục vụ nhánh "rút từ phần liên
-- kết" — theo CONSTITUTION §1.21: phần này KHÔNG tạo giao dịch (tiền đã
-- chi tiêu thật ở category gốc rồi, tạo thêm giao dịch sẽ trừ đúp) mà chỉ
-- ghi 1 dòng log vào `linked_history` (cột jsonb đã có sẵn từ 0018/0019,
-- KHÔNG thêm cột/bảng mới) để người dùng theo dõi lại dòng tiền của quỹ
-- "ngoài đời" (vd ví tiết kiệm riêng ngoài hệ thống).
--
-- RBAC: giống hệt `update_goal_link` (0018/0019) — chủ sở hữu cá nhân hoặc
-- thành viên đúng hộ gia đình của goal. security definer để append jsonb
-- an toàn (đọc-sửa-ghi nguyên tử trong 1 transaction, tránh lost-update
-- nếu 2 request chạy gần nhau — dù rủi ro thấp với 1 user, vẫn giữ đúng
-- convention RPC cho MỌI thay đổi `linked_history`/`carried_over_*` đã áp
-- dụng xuyên suốt từ T-S57).

begin;

create or replace function public.withdraw_from_linked_goal(
  p_goal_id uuid,
  p_amount numeric,
  p_note text,
  p_close_goal boolean
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
        'ended_at', now()
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
  'T-S60: ghi 1 dòng log rút quỹ (KHÔNG tạo giao dịch transactions) vào linked_history của goal, dùng cho nhánh "rút từ phần liên kết" — tiền đã chi tiêu thật ở category gốc rồi, không trừ đúp. Tuỳ chọn đóng mục tiêu cùng lúc (p_close_goal).';

commit;
