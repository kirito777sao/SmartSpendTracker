-- =========================================================
-- T-S05b — RPC delete_goal(p_goal_id uuid).
--
-- Gap RBAC phát hiện ở T-S05 (xem goals.ts, CHANGELOG mục T-S05): RLS update
-- của saving_goals cho phép MỌI thành viên hộ update (kể cả set deleted_at),
-- nhưng PRD chốt chặt hơn — "mọi thành viên sửa được nhưng chỉ chủ hộ hoặc
-- người tạo mới xoá được". CONSTITUTION §3 cố ý đẩy ràng buộc này xuống 1 RPC
-- riêng thay vì nới RLS UPDATE (đổi RLS UPDATE sẽ làm mọi UPDATE khác của
-- goal — vd sửa target_amount — cũng bị giới hạn theo, sai PRD).
--
-- Dùng đúng pattern đã CHỐT ở 0005/0006: security definer + tự kiểm tra
-- quyền thủ công rồi UPDATE bằng quyền definer (né lỗi 42501 khi UPDATE đổi
-- deleted_at — cột nằm trong chính SELECT policy — xem CONSTITUTION §5 rule
-- mới thêm sau bug transactions).
--
-- Phạm vi cá nhân (household_id null): chỉ owner_id = auth.uid() được xoá —
-- suy ra từ RBAC cá nhân đã CHỐT cho categories/transactions (chủ sở hữu cá
-- nhân toàn quyền trên tài nguyên của mình), CONSTITUTION §3 không ghi gì
-- khác cho goal cá nhân.
-- Phạm vi hộ (household_id not null): is_household_owner(household_id) HOẶC
-- created_by = auth.uid() — đúng nguyên văn PRD, KHÔNG nới thêm.
--
-- activity_log: chỉ ghi khi household_id not null — bảng này thiết kế làm
-- audit trail CHUNG của hộ (comment CONSTITUTION §3: "activity_log: ...
-- read household activity"), goal cá nhân không có "hộ" nào để ghi vào,
-- ghi household_id = null sẽ tạo dòng không ai đọc được qua policy hiện có
-- (is_household_member(null) luôn false) — không có giá trị audit thật, nên
-- không ghi thay vì ghi 1 dòng vô nghĩa.
-- =========================================================

create or replace function public.delete_goal(p_goal_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
  v_household_id uuid;
  v_created_by uuid;
  v_name text;
begin
  select owner_id, household_id, created_by, name
  into v_owner_id, v_household_id, v_created_by, v_name
  from public.saving_goals
  where id = p_goal_id and deleted_at is null;

  if not found then
    raise exception 'Không tìm thấy mục tiêu, hoặc đã bị xoá.';
  end if;

  if v_household_id is null then
    if v_owner_id <> auth.uid() then
      raise exception 'Bạn không có quyền xoá mục tiêu này.';
    end if;
  else
    if not (
      public.is_household_owner(v_household_id)
      or v_created_by = auth.uid()
    ) then
      raise exception 'Chỉ chủ hộ hoặc người tạo mục tiêu mới được xoá.';
    end if;
  end if;

  update public.saving_goals
  set deleted_at = now()
  where id = p_goal_id;

  if v_household_id is not null then
    insert into public.activity_log (household_id, actor_id, action, entity_type, entity_id, message, source)
    values (v_household_id, auth.uid(), 'goal.delete', 'goal', p_goal_id,
            'Đã xoá mục tiêu "' || coalesce(v_name, '') || '"', 'web');
  end if;
end;
$$;

grant execute on function public.delete_goal(uuid) to authenticated;
