-- =========================================================
-- T-S03 (một phần) — RPC create_household, join_household_by_code, remove_member.
-- leave_household CHƯA viết — chờ xác nhận xử lý case chủ hộ rời hộ (xem PRD.md).
-- =========================================================

create or replace function public.create_household(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_household_id uuid;
  v_invite_code text;
  v_attempts int := 0;
begin
  if exists (select 1 from public.profiles where id = auth.uid() and household_id is not null) then
    raise exception 'Bạn đang ở trong 1 hộ gia đình khác. Rời hộ hiện tại trước khi tạo hộ mới.';
  end if;

  loop
    v_invite_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    begin
      insert into public.households (id, name, invite_code, owner_id)
      values (gen_random_uuid(), p_name, v_invite_code, auth.uid())
      returning id into v_household_id;
      exit;
    exception when unique_violation then
      v_attempts := v_attempts + 1;
      if v_attempts > 5 then
        raise exception 'Không tạo được mã mời duy nhất, thử lại sau.';
      end if;
    end;
  end loop;

  update public.profiles
  set household_id = v_household_id, household_role = 'owner'
  where id = auth.uid();

  insert into public.activity_log (household_id, actor_id, action, entity_type, entity_id, message, source)
  values (v_household_id, auth.uid(), 'household.create', 'household', v_household_id,
          'Đã tạo hộ gia đình "' || p_name || '"', 'web');

  return v_household_id;
end;
$$;

create or replace function public.join_household_by_code(p_invite_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_household_id uuid;
  v_actor_name text;
begin
  if exists (select 1 from public.profiles where id = auth.uid() and household_id is not null) then
    raise exception 'Bạn đang ở trong 1 hộ gia đình khác. Rời hộ hiện tại trước khi tham gia hộ mới.';
  end if;

  select id into v_household_id from public.households where invite_code = upper(p_invite_code);
  if v_household_id is null then
    raise exception 'Mã mời không hợp lệ.';
  end if;

  update public.profiles
  set household_id = v_household_id, household_role = 'member'
  where id = auth.uid()
  returning name into v_actor_name;

  insert into public.activity_log (household_id, actor_id, action, entity_type, entity_id, message, source)
  values (v_household_id, auth.uid(), 'member.join', 'member', auth.uid(),
          coalesce(v_actor_name, 'Một thành viên') || ' đã tham gia hộ gia đình', 'web');

  return v_household_id;
end;
$$;

create or replace function public.remove_member(p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_household uuid;
  v_caller_role text;
  v_target_household uuid;
  v_target_name text;
begin
  select household_id, household_role into v_caller_household, v_caller_role
  from public.profiles where id = auth.uid();

  if v_caller_role is distinct from 'owner' then
    raise exception 'Chỉ chủ hộ mới được xoá thành viên.';
  end if;

  if p_member_id = auth.uid() then
    raise exception 'Chủ hộ không thể tự xoá chính mình bằng chức năng này.';
  end if;

  select household_id, name into v_target_household, v_target_name
  from public.profiles where id = p_member_id;

  if v_target_household is distinct from v_caller_household then
    raise exception 'Người này không thuộc hộ gia đình của bạn.';
  end if;

  update public.profiles
  set household_id = null, household_role = null, telegram_active_scope = 'personal'
  where id = p_member_id;

  insert into public.activity_log (household_id, actor_id, action, entity_type, entity_id, message, source)
  values (v_caller_household, auth.uid(), 'member.remove', 'member', p_member_id,
          coalesce(v_target_name, 'Một thành viên') || ' đã bị xoá khỏi hộ gia đình', 'web');
end;
$$;

grant execute on function public.create_household(text) to authenticated;
grant execute on function public.join_household_by_code(text) to authenticated;
grant execute on function public.remove_member(uuid) to authenticated;
