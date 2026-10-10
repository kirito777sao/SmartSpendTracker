-- =========================================================
-- T-S03 (tiếp) — RPC leave_household.
-- Quyết định đã xác nhận: chủ hộ KHÔNG được rời khi còn thành viên khác
-- (phải remove hết trước qua remove_member, hoặc dùng transfer_ownership
-- nếu sau này được xây — hiện CHƯA có, xem TASKS.md task mới).
-- Suy luận thêm (không phải quyết định mới, chỉ là hệ quả tự nhiên của rule
-- trên): nếu owner là thành viên DUY NHẤT còn lại, cho rời và xoá luôn
-- household (tránh household rỗng mồ côi không ai sở hữu).
-- =========================================================

create or replace function public.leave_household()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_household_id uuid;
  v_role text;
  v_other_members int;
begin
  select household_id, household_role into v_household_id, v_role
  from public.profiles where id = auth.uid();

  if v_household_id is null then
    raise exception 'Bạn hiện không ở trong hộ gia đình nào.';
  end if;

  if v_role = 'owner' then
    select count(*) into v_other_members
    from public.profiles where household_id = v_household_id and id <> auth.uid();

    if v_other_members > 0 then
      raise exception 'Bạn là chủ hộ và còn % thành viên khác. Xoá hết thành viên trước khi rời hộ.', v_other_members;
    end if;

    -- Owner là thành viên duy nhất còn lại → rời đồng thời giải tán household
    insert into public.activity_log (household_id, actor_id, action, entity_type, entity_id, message, source)
    values (v_household_id, auth.uid(), 'household.dissolve', 'household', v_household_id,
            'Chủ hộ đã rời và giải tán hộ gia đình (không còn thành viên khác)', 'web');

    update public.profiles
    set household_id = null, household_role = null, telegram_active_scope = 'personal'
    where id = auth.uid();

    delete from public.households where id = v_household_id;
  else
    insert into public.activity_log (household_id, actor_id, action, entity_type, entity_id, message, source)
    select v_household_id, auth.uid(), 'member.leave', 'member', auth.uid(),
           coalesce(name, 'Một thành viên') || ' đã rời hộ gia đình', 'web'
    from public.profiles where id = auth.uid();

    update public.profiles
    set household_id = null, household_role = null, telegram_active_scope = 'personal'
    where id = auth.uid();
  end if;
end;
$$;

grant execute on function public.leave_household() to authenticated;
