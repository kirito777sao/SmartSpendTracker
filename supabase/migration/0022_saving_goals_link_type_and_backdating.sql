-- 0022_saving_goals_link_type_and_backdating.sql
-- T-S80 — [14/08/2026, xem CONSTITUTION §1.22.5 + PRD.md "Chốt 14/08/2026"].
-- CHƯA CHẠY — thuộc diện "đổi cấu trúc bảng đã chốt" (CONSTITUTION §5, cột
-- "Hỏi trước khi làm"). File này chỉ CHUẨN BỊ, KHÔNG tự ý apply lên
-- Supabase — người yêu cầu phải tự soát lại rồi chạy. KHÔNG sửa
-- 0018/0019/0020/0021 (đã chạy trên project thật).
--
-- BỐI CẢNH: `linkedAmountByGoal` (client, SavingGoals.tsx) và `v_old_dynamic`
-- (RPC update_goal_link, khi đóng băng lúc unlink/đổi category) đều SUM mọi
-- giao dịch expense của category liên kết trong [linked_start_date,
-- linked_end_date], KHÔNG phân biệt giao dịch phát sinh TRƯỚC hay SAU thời
-- điểm thật sự bấm liên kết. Đúng với category bản chất "theo dõi dòng tiền
-- tiết kiệm/đầu tư ở ví khác ngoài đời" (hồi tố hợp lý), SAI với category chi
-- tiêu thường (chi tiêu trước khi liên kết là tiền đã tiêu mục đích khác,
-- không thể hồi tố gán ngược thành tiến độ goal).
--
-- ĐÃ CÂN NHẮC VÀ LOẠI BỎ phương án tự nhận diện qua từ khoá tên category
-- (SAVINGS_INTENT_KEYWORDS) — rủi ro lặp lại đúng lớp lỗi nhận diện sai đã
-- gây ra toàn bộ chuỗi thảo luận 14/08/2026 (category "mua Wukong" từng bị
-- nhận nhầm "Du lịch"), và bản thân hàm đó tự ghi chú chỉ dùng cho gợi ý UI
-- mềm, không dùng quyết định logic tài chính cứng.
--
-- GIẢI PHÁP CHỐT: người dùng tự chọn tường minh khi liên kết (radio bắt
-- buộc, không mặc định — UI ở T-S81), lưu vào 1 cột boolean:
--   is_savings_link = true  -> hồi tố đầy đủ theo khoảng ngày (giữ nguyên
--                              hành vi hiện tại, không đổi).
--   is_savings_link = false -> chỉ tính giao dịch từ THỜI ĐIỂM BẤM LIÊN KẾT
--                              trở đi (cột linked_at mới, ghi tự động
--                              server-side, KHÔNG cho client ghi trực tiếp
--                              qua UPDATE thường — chỉ RPC update_goal_link
--                              hoặc mặc định `now()` lúc INSERT tạo goal
--                              liên kết ngay từ đầu).
--
-- PHẠM VI CỘT MỚI: cả 2 đường ghi linked_category_id đều cần set đúng —
-- (1) INSERT trực tiếp lúc tạo goal MỚI đã liên kết sẵn (services/goals.ts
-- createGoal(), SavingGoals.tsx handleSaveAdd) — `linked_at` dùng DEFAULT
-- now() của cột (không khai báo trong GoalInsert type phía client, xem
-- types.ts sửa cùng đợt, để không ai gán được ngày giả từ client), còn
-- `is_savings_link` do client set trực tiếp lúc tạo (cùng mức tin cậy như
-- `linked_category_id` chính nó — không cần RPC vì không có logic dedup/đọc
-- trước nào cần atomic ở bước tạo mới); (2) RPC `update_goal_link` (relink/
-- đổi category 1 goal đã tồn tại) — nhận thêm `p_is_savings_link`, tự ghi
-- `linked_at = now()`.
--
-- PHẢI tích hợp đúng với dedup-theo-ID `carried_over_transaction_ids` đã
-- chốt ở §1.20.1/§1.20.2 (migration 0019, T-S61) — điều kiện `is_savings_link`/
-- `linked_at` mới này là 1 BỘ LỌC BỔ SUNG áp dụng TRƯỚC khi đưa giao dịch vào
-- tập ứng viên dedup-theo-ID, KHÔNG thay thế cơ chế dedup (không quay lại
-- kiểu SUM mù theo điều kiện ngày đã từng gây lỗi nhân tiền ở T-S61 bug 1).
--
-- KHÔNG đổi RLS/constraint khác (kể cả constraint chống chồng lấp T-S63,
-- migration 0020 — is_savings_link/linked_at không nằm trong biểu thức
-- EXCLUDE nên không ảnh hưởng).

begin;

alter table public.saving_goals
  add column is_savings_link boolean not null default false,
  add column linked_at timestamptz not null default now();

comment on column public.saving_goals.is_savings_link is
  'T-S80: true = category liên kết có bản chất "ngân sách tiết kiệm/theo dõi dòng tiền ở ví khác ngoài đời" -> tính hồi tố đầy đủ mọi giao dịch trong [linked_start_date, linked_end_date] kể cả trước thời điểm bấm liên kết (hành vi gốc, không đổi). false = category chi tiêu thường -> CHỈ tính giao dịch từ linked_at trở đi, không hồi tố. Người dùng tự chọn tường minh lúc liên kết (radio bắt buộc, không mặc định, xem T-S81 UI) — KHÔNG tự nhận diện qua từ khoá tên category (đã cân nhắc và loại bỏ, xem đầu file). Vô nghĩa/không dùng khi linked_category_id là null (goal thủ công thuần).';
comment on column public.saving_goals.linked_at is
  'T-S80: thời điểm THẬT SỰ bấm liên kết category gần nhất (khác linked_start_date — cột đó là ngày người dùng TỰ CHỌN, có thể lùi về quá khứ thoải mái). Dùng làm cận dưới lọc giao dịch khi is_savings_link=false. Mặc định now() lúc INSERT (goal tạo mới đã liên kết sẵn); ghi lại now() mỗi lần relink/đổi category qua RPC update_goal_link. Không cho client UPDATE trực tiếp qua đường thường (cùng mức bảo vệ carried_over_* — chỉ RPC hoặc DEFAULT lúc INSERT).';

-- Sửa RPC update_goal_link: thêm tham số p_is_savings_link, tự ghi
-- linked_at=now() ở NHÁNH CÓ ĐỔI linked_category_id thật sự (đổi category
-- khác HOẶC thủ công->liên kết) — nhánh "chỉ đổi khoảng ngày, giữ nguyên
-- category" (§1.20 mục 2) KHÔNG được đụng linked_at/is_savings_link, vì đó
-- không phải 1 lần liên kết mới, chỉ sửa ngày của liên kết đang có.
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
    -- trước đó (dedup theo ID, T-S61), VÀ (T-S80) chỉ những giao dịch từ
    -- linked_at trở đi nếu goal đang ở chế độ is_savings_link=false — 2 điều
    -- kiện lọc độc lập, áp dụng CẢ HAI trước khi đưa vào SUM/dedup.
    select coalesce(array_agg(t.id), '{}'), coalesce(sum(t.amount), 0)
      into v_new_ids, v_new_sum
      from public.transactions t
      where t.category_id = v_goal.linked_category_id
        and t.type = 'expense'
        and t.deleted_at is null
        and t.date between v_goal.linked_start_date and v_goal.linked_end_date
        and not (t.id = any(v_goal.carried_over_transaction_ids))
        and (v_goal.is_savings_link or t.date >= v_goal.linked_at::date);

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
  -- liên quan quy tắc backdating của T-S80).
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

commit;
