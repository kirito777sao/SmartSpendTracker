-- 0026_saving_goals_fix_backdating_created_at.sql
-- T-S87 — [15/08/2026, xem CONSTITUTION §1.22.7 + PRD.md "Chốt 15/08/2026"].
-- CHƯA CHẠY — thuộc diện "sửa RPC SECURITY DEFINER, ảnh hưởng logic tính
-- tiền" (CONSTITUTION §5, "Hỏi trước khi làm"). Người yêu cầu đã XÁC NHẬN
-- đồng ý ở lượt trao đổi 15/08/2026 trước khi file này được viết. Người
-- yêu cầu tự soát lại rồi chạy trên Supabase thật.
--
-- BỐI CẢNH BUG: T-S80/T-S81 (migration 0022) chặn hồi tố cho category "chi
-- tiêu thường" (is_savings_link=false) bằng điều kiện
--   t.date >= v_goal.linked_at::date   (RPC, đóng băng lúc unlink/relink)
--   row.date < g.linkedAt.slice(0,10)  (client, SavingGoals.tsx, tính "đang sống")
-- Cả 2 đều so sánh theo NGÀY — nhưng cột transactions.date CHỈ có độ chính
-- xác theo ngày (không giờ), còn linked_at là timestamptz đầy đủ. Khi giao
-- dịch được nhập và hành động "Liên kết" xảy ra CÙNG 1 NGÀY (trường hợp phổ
-- biến nhất: tạo category mới -> chi tiêu -> link ngay trong buổi), phần
-- ngày luôn bằng nhau -> điều kiện lọc luôn true, không loại được gì -> toàn
-- bộ giao dịch trước lúc bấm Liên kết vẫn bị cộng. Xác nhận bằng test thủ
-- công thật của người dùng 15/08/2026 (goal test, category mới chi 872.000đ
-- trước khi link, chọn "Ngân sách chi tiêu thường", vẫn bị cộng đủ 872.000đ).
--
-- GIẢI PHÁP CHỐT: bảng transactions đã sẵn có cột created_at timestamptz
-- (0001_init_schema.sql, ghi tại thời điểm INSERT thật, KHÔNG bị ảnh hưởng
-- nếu người dùng sửa lại `date` của giao dịch về sau, KHÔNG cho client ghi
-- trực tiếp qua UPDATE — chỉ do DB default now() lúc insert) — đổi điều
-- kiện lọc is_savings_link=false từ so theo `date` sang so theo
-- `created_at >= linked_at` (cả 2 đều timestamptz, so sánh chính xác đến
-- giây, không còn lẫn lộn trong-ngày). KHÔNG đổi bất kỳ điều kiện nào khác
-- (khoảng ngày linked_start_date/linked_end_date, dedup theo ID
-- carried_over_transaction_ids, is_savings_link=true vẫn hồi tố đầy đủ như
-- cũ) — chỉ đổi đúng 1 vế so sánh.
--
-- BÀI HỌC T-S86 áp dụng: giữ NGUYÊN chữ ký hàm (5 tham số, thứ tự y hệt
-- 0022/0025) — chỉ đổi phần THÂN hàm, không thêm/bớt tham số -> không tạo
-- overload mới, `create or replace` sẽ ghi đè đúng hàm hiện có.
--
-- PHẠM VI: CHỈ sửa nhánh "đang liên kết, đổi category/relink" (nơi duy nhất
-- có điều kiện is_savings_link/linked_at trong RPC). Nhánh "thủ công -> link
-- category lần đầu" không có điều kiện này (đã có comment giải thích riêng
-- ở 0022 — gom giao dịch transfer thủ công cũ, không liên quan backdating).
-- KHÔNG đụng RLS/constraint/cột nào khác.

begin;

create or replace function public.update_goal_link(
  p_goal_id uuid,
  p_new_linked_category_id uuid,
  p_new_linked_start_date date,
  p_new_linked_end_date date,
  p_is_savings_link boolean default false
)
returns public.saving_goals
language plpgsql
security definer
set search_path = public
as $$
declare
  v_goal public.saving_goals;
  v_new_ids uuid[];
  v_new_sum numeric;
  v_cat_name text;
  v_now timestamptz := now();
  v_snapshot jsonb;
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
    -- KHÔNG đụng linked_at/is_savings_link (không phải 1 lần liên kết mới).
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
    -- đóng băng CHỈ những giao dịch CHƯA từng được cộng ở lần đóng băng nào
    -- trước đó (dedup theo ID, T-S61), VÀ (T-S80, SỬA LẠI T-S87) chỉ những
    -- giao dịch từ linked_at trở đi nếu goal đang ở chế độ
    -- is_savings_link=false — so theo created_at (timestamptz, chính xác
    -- đến giây), KHÔNG so theo date (::date bị lẫn lộn trong-ngày, bug
    -- T-S87) — 2 điều kiện lọc độc lập (khoảng ngày + created_at), áp dụng
    -- CẢ HAI trước khi đưa vào SUM/dedup.
    select coalesce(array_agg(t.id), '{}'), coalesce(sum(t.amount), 0)
      into v_new_ids, v_new_sum
      from public.transactions t
      where t.category_id = v_goal.linked_category_id
        and t.type = 'expense'
        and t.deleted_at is null
        and t.date between v_goal.linked_start_date and v_goal.linked_end_date
        and not (t.id = any(v_goal.carried_over_transaction_ids))
        and (v_goal.is_savings_link or t.created_at >= v_goal.linked_at);

    select name into v_cat_name from public.categories where id = v_goal.linked_category_id;

    if coalesce(array_length(v_new_ids, 1), 0) > 0 then
      select jsonb_agg(
               jsonb_build_object('id', t.id, 'description', t.description, 'date', t.date, 'amount', t.amount)
               order by t.date desc, t.created_at desc
             )
        into v_snapshot
        from public.transactions t
        where t.id = any(v_new_ids);

      update public.saving_goals
        set carried_over_spent_amount = carried_over_spent_amount + v_new_sum,
            linked_history = linked_history || jsonb_build_array(jsonb_build_object(
              'type', 'linked',
              'category_name', coalesce(v_cat_name, '(danh mục đã xoá)'),
              'start_date', v_goal.linked_start_date,
              'end_date', v_goal.linked_end_date,
              'amount', v_new_sum,
              'ended_at', v_now,
              'transactions_snapshot', v_snapshot
            )),
            carried_over_transaction_ids = carried_over_transaction_ids || v_new_ids,
            linked_category_id = p_new_linked_category_id,
            linked_start_date = p_new_linked_start_date,
            linked_end_date = p_new_linked_end_date,
            is_savings_link = p_is_savings_link,
            linked_at = v_now,
            updated_at = v_now
        where id = p_goal_id
        returning * into v_goal;
    else
      update public.saving_goals
        set linked_category_id = p_new_linked_category_id,
            linked_start_date = p_new_linked_start_date,
            linked_end_date = p_new_linked_end_date,
            is_savings_link = p_is_savings_link,
            linked_at = v_now,
            updated_at = v_now
        where id = p_goal_id
        returning * into v_goal;
    end if;
    return v_goal;
  end if;

  -- Case: đang thủ công, link sang 1 category (§1.20 mục 4) — dedup ID
  -- giống hệt nhánh trên (T-S61 bug 3), ghi is_savings_link/linked_at MỚI.
  -- Nhánh này KHÔNG áp filter linked_at cho v_new_ids (đang gom giao dịch
  -- transfer THỦ CÔNG cũ, không phải giao dịch category liên kết — không
  -- liên quan quy tắc backdating của T-S80/T-S87). KHÔNG đổi gì ở đây.
  if p_new_linked_category_id is not null then
    select coalesce(array_agg(t.id), '{}'), coalesce(sum(t.amount), 0)
      into v_new_ids, v_new_sum
      from public.transactions t
      where t.goal_id = p_goal_id
        and t.type = 'transfer'
        and t.deleted_at is null
        and not (t.id = any(v_goal.carried_over_transaction_ids));

    if coalesce(array_length(v_new_ids, 1), 0) > 0 then
      select jsonb_agg(
               jsonb_build_object('id', t.id, 'description', t.description, 'date', t.date, 'amount', t.amount)
               order by t.date desc, t.created_at desc
             )
        into v_snapshot
        from public.transactions t
        where t.id = any(v_new_ids);

      update public.saving_goals
        set carried_over_saved_amount = carried_over_saved_amount + v_new_sum,
            linked_history = linked_history || jsonb_build_array(jsonb_build_object(
              'type', 'manual',
              'category_name', null,
              'start_date', null,
              'end_date', null,
              'amount', v_new_sum,
              'ended_at', v_now,
              'transactions_snapshot', v_snapshot
            )),
            carried_over_transaction_ids = carried_over_transaction_ids || v_new_ids,
            linked_category_id = p_new_linked_category_id,
            linked_start_date = p_new_linked_start_date,
            linked_end_date = p_new_linked_end_date,
            is_savings_link = p_is_savings_link,
            linked_at = v_now,
            current_amount = 0,
            updated_at = v_now
        where id = p_goal_id
        returning * into v_goal;
    else
      update public.saving_goals
        set linked_category_id = p_new_linked_category_id,
            linked_start_date = p_new_linked_start_date,
            linked_end_date = p_new_linked_end_date,
            is_savings_link = p_is_savings_link,
            linked_at = v_now,
            current_amount = 0,
            updated_at = v_now
        where id = p_goal_id
        returning * into v_goal;
    end if;
    return v_goal;
  end if;

  -- Case còn lại: đang thủ công, gọi hàm với target vẫn thủ công -> không
  -- có gì để đổi.
  raise exception 'Không có thay đổi liên kết để lưu.';
end;
$$;

-- Sau khi chạy migration này, BẮT BUỘC reload schema cache PostgREST (bài
-- học T-S86) để loại trừ khả năng cache giữ định nghĩa hàm cũ:
--   NOTIFY pgrst, 'reload schema';
-- hoặc Supabase Dashboard -> Settings -> API -> Reload schema cache.

commit;
