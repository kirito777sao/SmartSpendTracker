-- =========================================================
-- T-S15 — Household soft-delete, "hộ không chủ" (ownerless),
-- xoay invite_code khi ownerless. Xem CONSTITUTION §1.6 (CHỐT 07/08/2026,
-- xác nhận phạm vi 07/08/2026 sau thảo luận về ảnh hưởng quyền chủ hộ).
--
-- THAY ĐỔI HÀNH VI so với 0003b_rpc_leave_household.sql (không xoá file cũ,
-- migration này REPLACE lại đúng hàm đó bằng create or replace):
--   - CŨ: owner đơn độc rời -> `delete from households` (hard delete, cascade
--     xoá vĩnh viễn categories/saving_goals/transactions/activity_log).
--   - MỚI: owner đơn độc rời -> household KHÔNG bị xoá, chỉ gỡ hồ sơ owner
--     về cá nhân -> household trở thành "ownerless" (còn tồn tại, không ai
--     household_role='owner' trỏ tới) -> invite_code cũ TỰ ĐỘNG xoay sang mã
--     mới ngay lúc này (vô hiệu hoá mã cũ, tránh rủi ro bảo mật nêu ở
--     CONSTITUTION §1.6 mục 5).
--
-- "Xoá hộ" giờ là 1 hành động TƯỜNG MINH riêng (`delete_household()`), khác
-- hẳn "rời hộ" — chỉ soft-delete (`households.deleted_at`), không đụng dữ
-- liệu con.
-- =========================================================

alter table public.households add column if not exists deleted_at timestamptz;

-- ---------------------------------------------------------
-- Helper RLS: chủ hộ CŨ của 1 hộ ĐÃ xoá (archive) — dùng để cho phép họ
-- vẫn tra cứu/export lại dữ liệu lịch sử, đúng tinh thần "giữ lại để tra
-- cứu sau" (không phải enterprise transfer, xem CONSTITUTION §1.6).
-- ---------------------------------------------------------
create or replace function public.is_archived_household_owner(hh uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.households
    where id = hh and deleted_at is not null and owner_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------
-- households SELECT policy — bỏ hẳn vế `owner_id = auth.uid()` không điều
-- kiện cũ (owner đã rời/hộ đã xoá không còn quyền xem như đang hoạt động
-- nữa, nhất quán hành vi rời hộ của member thường); thay bằng đúng 2
-- trường hợp hợp lệ: (a) đang là thành viên hoạt động của hộ đó, hoặc
-- (b) là chủ hộ CŨ của 1 hộ ĐÃ xoá (archive-view).
-- Hộ "ownerless" (chưa xoá, không còn owner) KHÔNG ai SELECT được qua
-- policy này nữa — đúng, vì không còn ai là member/owner hoạt động; chỉ
-- vào lại được qua RPC join_household_by_code (SECURITY DEFINER, bypass
-- RLS).
-- ---------------------------------------------------------
drop policy if exists "read own household" on public.households;
create policy "read own household" on public.households for select using (
  id = public.my_household_id()
  or (deleted_at is not null and owner_id = auth.uid())
);

-- ---------------------------------------------------------
-- categories / saving_goals / transactions SELECT — thêm đúng 1 nhánh cho
-- phép chủ hộ cũ của hộ ĐÃ xoá đọc lại dữ liệu (T-S16 sẽ dùng chung nhánh
-- này để export). Giữ nguyên is_household_member() cho member đang hoạt
-- động, giữ nguyên deleted_at is null lọc xoá-từng-dòng (khác khái niệm
-- với households.deleted_at).
-- ---------------------------------------------------------
drop policy if exists "read own or household categories" on public.categories;
create policy "read own or household categories" on public.categories for select using (
  deleted_at is null and (
    owner_id = auth.uid()
    or is_household_member(household_id)
    or is_archived_household_owner(household_id)
  )
);

drop policy if exists "read own or household goals" on public.saving_goals;
create policy "read own or household goals" on public.saving_goals for select using (
  deleted_at is null and (
    owner_id = auth.uid()
    or is_household_member(household_id)
    or is_archived_household_owner(household_id)
  )
);

drop policy if exists "read own or household transactions" on public.transactions;
create policy "read own or household transactions" on public.transactions for select using (
  deleted_at is null and (
    owner_id = auth.uid()
    or is_household_member(household_id)
    or is_archived_household_owner(household_id)
  )
);

-- ---------------------------------------------------------
-- leave_household() — REPLACE lại đúng hàm ở 0003b. Bỏ nhánh hard-delete,
-- thêm xoay invite_code khi tạo trạng thái ownerless.
-- ---------------------------------------------------------
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
  v_new_invite_code text;
  v_attempts int := 0;
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

    -- Owner là thành viên duy nhất còn lại → rời, household KHÔNG bị xoá,
    -- chỉ trở thành "ownerless". Xoay invite_code ngay để vô hiệu hoá mã cũ
    -- (CONSTITUTION §1.6 mục 5 — bắt buộc, không phải tuỳ chọn).
    loop
      v_new_invite_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
      begin
        update public.households
        set invite_code = v_new_invite_code
        where id = v_household_id;
        exit;
      exception when unique_violation then
        v_attempts := v_attempts + 1;
        if v_attempts > 5 then
          raise exception 'Không tạo được mã mời mới, thử lại sau.';
        end if;
      end;
    end loop;

    insert into public.activity_log (household_id, actor_id, action, entity_type, entity_id, message, source)
    values (v_household_id, auth.uid(), 'household.become_ownerless', 'household', v_household_id,
            'Chủ hộ đã rời hộ gia đình (không còn thành viên khác) — hộ tạm thời không có chủ, mã mời cũ đã bị vô hiệu hoá', 'web');

    update public.profiles
    set household_id = null, household_role = null, telegram_active_scope = 'personal'
    where id = auth.uid();
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

-- ---------------------------------------------------------
-- delete_household() — MỚI. Hành động tường minh, tách hẳn khỏi "Rời hộ".
-- Chỉ owner hiện tại gọi được, chỉ khi là thành viên duy nhất còn lại
-- (nhất quán rule leave_household). Soft-delete: set deleted_at, KHÔNG
-- đụng categories/saving_goals/transactions/activity_log — đây là điểm
-- mấu chốt thoả yêu cầu lưu vết (T-S16 dùng chung dữ liệu này).
-- Owner sau khi xoá hộ cũng được gỡ về cá nhân (giống leave) — hộ đã xoá
-- vĩnh viễn không còn "ownerless-joinable" nữa, phân biệt rõ với trạng
-- thái ownerless của leave_household (join_household_by_code sẽ chặn join
-- vào hộ đã deleted_at, xem bên dưới).
-- ---------------------------------------------------------
create or replace function public.delete_household()
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

  if v_role is distinct from 'owner' then
    raise exception 'Chỉ chủ hộ mới được xoá hộ gia đình.';
  end if;

  select count(*) into v_other_members
  from public.profiles where household_id = v_household_id and id <> auth.uid();

  if v_other_members > 0 then
    raise exception 'Hộ còn % thành viên khác. Xoá hết thành viên trước khi xoá hộ gia đình.', v_other_members;
  end if;

  update public.households
  set deleted_at = now()
  where id = v_household_id and deleted_at is null;

  if not found then
    raise exception 'Hộ gia đình đã bị xoá trước đó.';
  end if;

  insert into public.activity_log (household_id, actor_id, action, entity_type, entity_id, message, source)
  select v_household_id, auth.uid(), 'household.delete', 'household', v_household_id,
         coalesce(name, 'Chủ hộ') || ' đã xoá hộ gia đình (dữ liệu được lưu trữ, có thể tra cứu lại)', 'web'
  from public.profiles where id = auth.uid();

  update public.profiles
  set household_id = null, household_role = null, telegram_active_scope = 'personal'
  where id = auth.uid();
end;
$$;

-- ---------------------------------------------------------
-- join_household_by_code() — REPLACE lại đúng hàm ở 0003. Thêm 2 điều
-- kiện mới: (a) chặn join vào hộ đã bị xoá (deleted_at is not null) — mã
-- mời cũ của hộ đã xoá coi như không hợp lệ, giống hệt thông báo "mã mời
-- không hợp lệ" hiện có, không tiết lộ hộ từng tồn tại; (b) nếu hộ đang
-- "ownerless" (không profiles nào household_role='owner' trỏ tới, và chưa
-- bị xoá), người join ĐẦU TIÊN tự động nhận household_role='owner' +
-- households.owner_id cập nhật sang người này.
-- ---------------------------------------------------------
create or replace function public.join_household_by_code(p_invite_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_household_id uuid;
  v_deleted_at timestamptz;
  v_actor_name text;
  v_has_owner boolean;
  v_assigned_role text;
begin
  if exists (select 1 from public.profiles where id = auth.uid() and household_id is not null) then
    raise exception 'Bạn đang ở trong 1 hộ gia đình khác. Rời hộ hiện tại trước khi tham gia hộ mới.';
  end if;

  select id, deleted_at into v_household_id, v_deleted_at
  from public.households where invite_code = upper(p_invite_code);

  -- Cố tình dùng chung 1 thông báo cho "không tồn tại" và "đã bị xoá" —
  -- không tiết lộ hộ từng tồn tại cho người cầm mã mời cũ của hộ đã xoá.
  if v_household_id is null or v_deleted_at is not null then
    raise exception 'Mã mời không hợp lệ.';
  end if;

  select exists (
    select 1 from public.profiles
    where household_id = v_household_id and household_role = 'owner'
  ) into v_has_owner;

  v_assigned_role := case when v_has_owner then 'member' else 'owner' end;

  update public.profiles
  set household_id = v_household_id, household_role = v_assigned_role
  where id = auth.uid()
  returning name into v_actor_name;

  if not v_has_owner then
    update public.households
    set owner_id = auth.uid()
    where id = v_household_id;

    insert into public.activity_log (household_id, actor_id, action, entity_type, entity_id, message, source)
    values (v_household_id, auth.uid(), 'household.reclaim_owner', 'household', v_household_id,
            coalesce(v_actor_name, 'Một thành viên') || ' đã tham gia và trở thành chủ hộ mới (hộ trước đó không có chủ)', 'web');
  else
    insert into public.activity_log (household_id, actor_id, action, entity_type, entity_id, message, source)
    values (v_household_id, auth.uid(), 'member.join', 'member', auth.uid(),
            coalesce(v_actor_name, 'Một thành viên') || ' đã tham gia hộ gia đình', 'web');
  end if;

  return v_household_id;
end;
$$;

grant execute on function public.delete_household() to authenticated;
-- leave_household() và join_household_by_code() đã được grant ở 0003/0003b,
-- `create or replace` không đổi quyền execute đã cấp, không cần grant lại.

-- ---------------------------------------------------------
-- LƯU Ý CHƯA XỬ LÝ Ở FILE NÀY (ghi rõ để không quên, không phải bug):
--  1. UI (`HouseholdManagement.tsx`, `src/services/household.ts`,
--     `src/hooks/useHousehold.ts`) CHƯA có nút/hook gọi `delete_household()`
--     — đây là phần việc code client, nằm trong scope T-S15, làm ở phiên kế
--     tiếp cùng task (không tách task mới).
--  2. Màn hình "hộ đã lưu trữ" (archive view, dùng RLS mới ở đây để chủ hộ
--     cũ xem lại/export) CHƯA có UI — backlog UI riêng, xem CONSTITUTION
--     §1.6 "Đề xuất bổ sung".
-- ---------------------------------------------------------
