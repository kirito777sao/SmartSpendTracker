-- 0018_saving_goals_carry_over_link.sql
-- T-S57 — [11/08/2026, xem PRD.md "Chốt 11/08/2026" + CONSTITUTION §1.20].
-- CHƯA CHẠY — thuộc diện "đổi cấu trúc bảng đã chốt" (CONSTITUTION §5, cột
-- "Hỏi trước khi làm"). File này chỉ CHUẨN BỊ đúng theo thiết kế đã CHỐT qua
-- 6 vòng thảo luận (xem CHANGELOG "[Phase 1 — Plan] T-S57 + T-S60"),
-- KHÔNG tự ý apply lên Supabase — người yêu cầu phải tự chạy sau khi soát lại.
--
-- Mục đích: cho phép sửa linked_category_id/linked_start_date/linked_end_date
-- của 1 goal ĐÃ liên kết (T-S48, migration 0017) — đổi category, unlink về
-- thủ công, hoặc link 1 goal thủ công có sẵn sang category — mà KHÔNG mất
-- tiến độ đã tích luỹ và KHÔNG trừ tiền thật đúp lần 2.
--
-- Vấn đề gốc: goal liên kết category chi tiêu (tiền ĐÃ trừ thật, category
-- gốc đã ghi type='expense' thật) và goal thủ công (tiền transfer nội bộ,
-- CHƯA trừ thật) không cùng bản chất dòng tiền — gộp chung 1 con số "dồn
-- tiếp" sẽ khiến rút/hoàn thành sau này (T-S60) trừ tiền thật đúp lần 2.
-- Giải pháp: tách riêng 2 cột dồn theo đúng nguồn, cộng thêm 1 cột lịch sử
-- chi tiết từng giai đoạn liên kết đã kết thúc (không chỉ 1 số trần trụi).

begin;

alter table public.saving_goals
  add column carried_over_saved_amount numeric not null default 0,
  add column carried_over_spent_amount numeric not null default 0,
  add column linked_history jsonb not null default '[]';

comment on column public.saving_goals.carried_over_saved_amount is
  'T-S57: tổng dồn từ (các) giai đoạn TRƯỚC ĐÓ goal ở trạng thái THỦ CÔNG (tiền transfer, chưa tiêu thật, rút được thật sau này ở T-S60). Chỉ được ghi qua RPC update_goal_link, không update trực tiếp từ client.';
comment on column public.saving_goals.carried_over_spent_amount is
  'T-S57: tổng dồn từ (các) giai đoạn TRƯỚC ĐÓ goal đang LIÊN KẾT category (tiền đã là chi tiêu thật rồi, không rút được thật nữa, chỉ để theo dõi). Chỉ được ghi qua RPC update_goal_link.';
comment on column public.saving_goals.linked_history is
  'T-S57: mảng snapshot từng giai đoạn liên kết đã KẾT THÚC, mỗi phần tử {category_name, start_date, end_date, amount, ended_at}. Chỉ được ghi qua RPC update_goal_link.';

-- KHÔNG đổi RLS: saving_goals UPDATE policy hiện có (owner_id = auth.uid()
-- or is_household_member(household_id)) vẫn đúng cho việc SỬA field khác
-- (name/target_amount/target_date) qua updateGoal() bình thường. RPC dưới
-- đây SECURITY DEFINER chỉ vì cần đọc+ghi ATOMIC (đóng băng số đang tính
-- động rồi ghi carried_over/linked_history cùng 1 transaction, tránh race
-- condition nếu có giao dịch mới chen vào giữa lúc đọc và lúc ghi) — RBAC
-- bên trong hàm CỐ Ý lặp lại ĐÚNG điều kiện của UPDATE policy đã CHỐT ở §3,
-- không nới thêm quyền (đúng quy tắc bắt buộc CONSTITUTION §5 cho RPC ghi
-- SECURITY DEFINER trên bảng có policy sẵn).
create or replace function public.update_goal_link(
  p_goal_id uuid,
  p_new_linked_category_id uuid,
  p_new_linked_start_date date,
  p_new_linked_end_date date
)
returns public.saving_goals
language plpgsql
security definer
set search_path = public
as $$
declare
  v_goal public.saving_goals;
  v_old_dynamic numeric;
  v_cat_name text;
  v_now timestamptz := now();
begin
  select * into v_goal from public.saving_goals where id = p_goal_id and deleted_at is null;
  if not found then
    raise exception 'Mục tiêu không tồn tại hoặc đã bị xoá.';
  end if;

  -- RBAC: lặp lại đúng điều kiện "update personal or household goals" (§3),
  -- không nới thêm — hàm SECURITY DEFINER bypass RLS nên phải tự kiểm tra.
  if not (
    v_goal.owner_id = auth.uid()
    or (v_goal.household_id is not null and is_household_member(v_goal.household_id))
  ) then
    raise exception 'Không có quyền sửa mục tiêu này.';
  end if;

  -- Trạng thái MỚI phải hợp lệ: cả 3 cùng null (thủ công) hoặc cả 3 cùng có
  -- giá trị (liên kết), end >= start — khớp CHECK constraint đã có ở 0017.
  if (p_new_linked_category_id is null) <> (p_new_linked_start_date is null)
     or (p_new_linked_category_id is null) <> (p_new_linked_end_date is null) then
    raise exception 'Thiếu danh mục hoặc khoảng ngày liên kết.';
  end if;
  if p_new_linked_category_id is not null and p_new_linked_end_date < p_new_linked_start_date then
    raise exception 'Ngày kết thúc phải sau hoặc bằng ngày bắt đầu.';
  end if;

  -- Case: đang liên kết
  if v_goal.linked_category_id is not null then
    -- Chỉ đổi khoảng ngày, GIỮ NGUYÊN category (§1.20 mục 2): KHÔNG dồn gì,
    -- chỉ tính lại theo khoảng ngày mới (client tự tính lại dynamic amount).
    if p_new_linked_category_id is not distinct from v_goal.linked_category_id then
      update public.saving_goals
        set linked_start_date = p_new_linked_start_date,
            linked_end_date = p_new_linked_end_date,
            updated_at = v_now
        where id = p_goal_id
        returning * into v_goal;
      return v_goal;
    end if;

    -- Đổi sang category khác HOẶC unlink về thủ công (§1.20 mục 1 + mục 3):
    -- đóng băng tổng đang tính động của category/khoảng ngày CŨ.
    select coalesce(sum(amount), 0) into v_old_dynamic
      from public.transactions
      where category_id = v_goal.linked_category_id
        and type = 'expense'
        and deleted_at is null
        and date between v_goal.linked_start_date and v_goal.linked_end_date;

    select name into v_cat_name from public.categories where id = v_goal.linked_category_id;

    update public.saving_goals
      set carried_over_spent_amount = carried_over_spent_amount + v_old_dynamic,
          linked_history = linked_history || jsonb_build_array(jsonb_build_object(
            'category_name', coalesce(v_cat_name, '(danh mục đã xoá)'),
            'start_date', v_goal.linked_start_date,
            'end_date', v_goal.linked_end_date,
            'amount', v_old_dynamic,
            'ended_at', v_now
          )),
          linked_category_id = p_new_linked_category_id,
          linked_start_date = p_new_linked_start_date,
          linked_end_date = p_new_linked_end_date,
          updated_at = v_now
      where id = p_goal_id
      returning * into v_goal;
    return v_goal;
  end if;

  -- Case: đang thủ công, link sang 1 category (§1.20 mục 4) — đóng băng
  -- current_amount thủ công hiện tại vào carried_over_saved_amount (KHÔNG
  -- phải carried_over_spent_amount — tiền này CHƯA từng tiêu thật), rồi đưa
  -- current_amount về 0 (từ nay không dùng cho loại goal liên kết — tránh
  -- đếm đúp ở công thức "số dư khả dụng để rút" của T-S60).
  if p_new_linked_category_id is not null then
    update public.saving_goals
      set carried_over_saved_amount = carried_over_saved_amount + v_goal.current_amount,
          linked_category_id = p_new_linked_category_id,
          linked_start_date = p_new_linked_start_date,
          linked_end_date = p_new_linked_end_date,
          current_amount = 0,
          updated_at = v_now
      where id = p_goal_id
      returning * into v_goal;
    return v_goal;
  end if;

  -- Case còn lại: đang thủ công, gọi hàm với target vẫn thủ công -> không
  -- có gì để đổi.
  raise exception 'Không có thay đổi liên kết để lưu.';
end;
$$;

commit;
