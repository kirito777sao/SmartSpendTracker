-- 0019_saving_goals_fix_link_idempotency.sql
-- T-S61 — [11/08/2026, xem CONSTITUTION §1.20 tu chỉnh + CHANGELOG "T-S61 —
-- fix bug idempotency update_goal_link"]. CHƯA CHẠY — thuộc diện "đổi cấu
-- trúc bảng đã chốt" (CONSTITUTION §5, cột "Hỏi trước khi làm"). File này chỉ
-- CHUẨN BỊ, KHÔNG tự ý apply lên Supabase — người yêu cầu phải tự chạy sau
-- khi soát lại.
--
-- BỐI CẢNH: sau khi 0018 (T-S57) chạy trên project thật, test tay phát hiện
-- 3 bug cùng gốc rễ (xem CHANGELOG để có phân tích đầy đủ, tóm tắt ở đây):
--
--   Bug 1 (nhân tiền / không idempotent) — nghiêm trọng nhất. RPC cũ ở 0018
--   luôn SUM lại TOÀN BỘ giao dịch khớp category+khoảng ngày mỗi lần đóng
--   băng, không kiểm tra đã từng cộng ở lần đóng băng trước hay chưa. Link A
--   → unlink (đóng băng tổng A lần 1) → link lại A → unlink lần nữa (đóng
--   băng lại ĐÚNG tổng A đó lần 2) => carried_over_spent_amount = 2×A dù
--   không có giao dịch mới.
--
--   Bug 2 — linked_history chỉ lưu 1 số tổng/giai đoạn, không lưu giao dịch
--   gốc => modal "Lịch sử" không tách được dòng chi tiết cho giai đoạn cũ.
--
--   Bug 3 — giai đoạn "thủ công → liên kết" (case 4 của RPC cũ) đóng băng
--   current_amount vào carried_over_saved_amount nhưng KHÔNG ghi snapshot gì
--   => lịch sử góp thủ công cũ biến mất trắng khỏi modal dù giao dịch gốc
--   vẫn còn trong DB.
--
-- GIẢI PHÁP (1 cơ chế chung cho cả 3 bug — nguồn sự thật là ID giao dịch,
-- không phải tổng tiền, đúng nguyên tắc "period close"/idempotency key
-- trong kế toán/ledger — xem CHANGELOG để có đối chiếu thị trường):
--
--   1. Thêm `carried_over_transaction_ids uuid[]` — lưu ID mọi giao dịch gốc
--      (expense trong category liên kết HOẶC transfer thủ công) đã từng
--      được cộng vào carried_over_* ở BẤT KỲ lần đóng băng nào trước đó.
--      Mỗi lần đóng băng: chỉ SUM những giao dịch CHƯA có ID trong mảng này,
--      rồi mới thêm ID chúng vào mảng — lặp lại link/unlink bao nhiêu lần
--      cũng ra đúng 1 số tiền thật.
--   2. `linked_history` mỗi phần tử thêm `type` ("linked"|"manual") +
--      `transactions_snapshot` (danh sách giao dịch gốc đã resolve tại thời
--      điểm đóng băng — bất biến, không đổi dù sau này sửa/xoá giao dịch
--      gốc). Nếu không có giao dịch mới nào để đóng băng (mọi ID đã có sẵn
--      trong carried_over_transaction_ids) => KHÔNG tạo dòng linked_history
--      rác mới.
--   3. Case "thủ công → liên kết" giờ cũng snapshot đúng các giao dịch
--      transfer thủ công (loại "manual"), cùng cơ chế dedup theo ID — sửa
--      luôn để không tái diễn khi user unlink rồi link lại nhiều lần.
--
-- Xem thêm: fix_and_audit_goal_link_duplication.sql (rà soát/sửa dữ liệu ĐÃ
-- bị lệch bởi RPC cũ 0018 — CHỜ người yêu cầu xác nhận trước khi chạy, xem
-- CHANGELOG mục "Việc còn treo").
--
-- KHÔNG đổi RLS/constraint khác — chỉ thêm 1 cột + CREATE OR REPLACE lại
-- đúng 1 hàm `update_goal_link` đã có (cùng chữ ký tham số, không phá client
-- đang gọi).

begin;

alter table public.saving_goals
  add column carried_over_transaction_ids uuid[] not null default '{}';

comment on column public.saving_goals.carried_over_transaction_ids is
  'T-S61: ID mọi giao dịch gốc (expense category liên kết HOẶC transfer thủ công) đã từng được cộng vào carried_over_saved_amount/carried_over_spent_amount ở bất kỳ lần đóng băng nào trước đó của goal này. Nguồn sự thật chống đếm đúp khi link/unlink lặp lại nhiều lần — so theo ID cụ thể, không so theo ngày/category. Chỉ được ghi qua RPC update_goal_link.';

comment on column public.saving_goals.linked_history is
  'T-S57 + T-S61: mảng snapshot từng giai đoạn đã KẾT THÚC. Mỗi phần tử {type: "linked"|"manual", category_name, start_date, end_date, amount, ended_at, transactions_snapshot: [{id,description,date,amount}]}. Phần tử ghi trước T-S61 (bởi RPC 0018) thiếu type/transactions_snapshot — client (mapRows.ts) mặc định type:"linked", transactions_snapshot:[] khi đọc. Chỉ được ghi qua RPC update_goal_link.';

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
    -- chỉ tính lại theo khoảng ngày mới (client tự tính lại dynamic amount).
    -- Không đóng băng => không đụng carried_over_transaction_ids.
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
    -- trước đó (dedup theo ID, không phải theo category/khoảng ngày) — đây
    -- là fix chính của T-S61 (bug 1, "nhân tiền" khi link/unlink lặp lại).
    select coalesce(array_agg(t.id), '{}'), coalesce(sum(t.amount), 0)
      into v_new_ids, v_new_sum
      from public.transactions t
      where t.category_id = v_goal.linked_category_id
        and t.type = 'expense'
        and t.deleted_at is null
        and t.date between v_goal.linked_start_date and v_goal.linked_end_date
        and not (t.id = any(v_goal.carried_over_transaction_ids));

    select name into v_cat_name from public.categories where id = v_goal.linked_category_id;

    -- Chỉ tạo dòng linked_history mới nếu THẬT SỰ có giao dịch mới để đóng
    -- băng — tránh dòng rác trùng khi không có gì thay đổi kể từ lần đóng
    -- băng trước (T-S61, bug 1 mục 2).
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
            updated_at = v_now
        where id = p_goal_id
        returning * into v_goal;
    else
      update public.saving_goals
        set linked_category_id = p_new_linked_category_id,
            linked_start_date = p_new_linked_start_date,
            linked_end_date = p_new_linked_end_date,
            updated_at = v_now
        where id = p_goal_id
        returning * into v_goal;
    end if;
    return v_goal;
  end if;

  -- Case: đang thủ công, link sang 1 category (§1.20 mục 4) — đóng băng chỉ
  -- những giao dịch transfer thủ công CHƯA từng được cộng ở lần đóng băng
  -- nào trước đó (dedup ID giống hệt nhánh trên, T-S61 bug 3: trước đây
  -- KHÔNG snapshot gì nên lịch sử góp thủ công biến mất khỏi modal). Tính
  -- trực tiếp từ bảng transactions (nguồn sự thật), KHÔNG dùng
  -- v_goal.current_amount — cột này có thể lệch (drift đã biết, xem
  -- fix_and_audit_goal_drift.sql), tính lại từ transactions luôn đúng và
  -- vẫn idempotent nhờ dedup theo ID.
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
            current_amount = 0,
            updated_at = v_now
        where id = p_goal_id
        returning * into v_goal;
    else
      update public.saving_goals
        set linked_category_id = p_new_linked_category_id,
            linked_start_date = p_new_linked_start_date,
            linked_end_date = p_new_linked_end_date,
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

commit;
