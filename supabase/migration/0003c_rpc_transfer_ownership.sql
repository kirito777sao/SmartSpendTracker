-- =========================================================
-- T-S03b — RPC transfer_ownership. Cho phép chủ hộ chuyển quyền cho 1
-- thành viên khác trong cùng hộ, sau đó chủ hộ cũ có thể leave_household()
-- bình thường như member.
-- =========================================================

create or replace function public.transfer_ownership(p_new_owner_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_household_id uuid;
  v_caller_role text;
  v_target_household uuid;
  v_target_role text;
begin
  select household_id, household_role into v_household_id, v_caller_role
  from public.profiles where id = auth.uid();

  if v_caller_role is distinct from 'owner' then
    raise exception 'Chỉ chủ hộ mới được chuyển quyền.';
  end if;

  if p_new_owner_id = auth.uid() then
    raise exception 'Không thể chuyển quyền cho chính mình.';
  end if;

  select household_id, household_role into v_target_household, v_target_role
  from public.profiles where id = p_new_owner_id;

  if v_target_household is distinct from v_household_id then
    raise exception 'Người này không thuộc hộ gia đình của bạn.';
  end if;

  if v_target_role is distinct from 'member' then
    raise exception 'Người nhận chuyển quyền phải là thành viên hợp lệ trong hộ.';
  end if;

  update public.profiles set household_role = 'member' where id = auth.uid();
  update public.profiles set household_role = 'owner' where id = p_new_owner_id;
  update public.households set owner_id = p_new_owner_id where id = v_household_id;

  insert into public.activity_log (household_id, actor_id, action, entity_type, entity_id, message, source)
  values (v_household_id, auth.uid(), 'household.transfer_ownership', 'household', v_household_id,
          'Quyền chủ hộ đã được chuyển giao', 'web');
end;
$$;

grant execute on function public.transfer_ownership(uuid) to authenticated;
