-- =========================================================
-- 0039_fix_orphaned_goal_auto_contribution_on_link.sql
-- Bugfix phát hiện qua hỏi-đáp trực tiếp với người dùng 27/08/2026, ngay
-- sau khi T-S143 mở khả năng bật trích tự động cho CATEGORY (song song
-- goal). Người yêu cầu tự hỏi đúng trọng tâm — không phải do test tay tình
-- cờ phát hiện.
--
-- BỐI CẢNH BUG: 1 goal THỦ CÔNG đã bật trích tự động cấp-goal (T-S139,
-- auto_contribution_configs.goal_id, enabled=true) — sau đó người dùng LIÊN
-- KẾT goal này vào 1 category (§1.20 mục 4, `update_goal_link`). Từ lúc đó:
--   - UI (`SavingGoals.tsx`) tự ẩn khối `AutoContributionConfig` cấp-goal
--     (đúng, có điều kiện `!goal.linkedCategoryId`) -> người dùng tưởng đã
--     tắt.
--   - NHƯNG record `auto_contribution_configs` cũ (target=goal_id) VẪN
--     `enabled=true` trong DB — không có bước nào tắt nó khi liên kết.
--   - CẢ HAI hàm thật sự trích tiền, `apply_auto_contributions_on_income()`
--     (0037) và `run_monthly_auto_contributions()` (0038), CHỈ lọc theo
--     `enabled = true`, KHÔNG kiểm tra lại `saving_goals.linked_category_id
--     is null` -> vẫn âm thầm tạo giao dịch `transfer` vào goal đã liên kết
--     mỗi kỳ, y hệt như còn thủ công.
--   - Cộng thêm T-S143 (category cùng lúc cũng được bật trích) -> tiền bị
--     trích 2 LẦN CHỒNG NHAU vào cùng 1 goal mỗi kỳ: 1 lần qua config cấp-
--     goal orphan (không ai biết còn sống), 1 lần qua config cấp-category
--     mới (đúng, người dùng chủ động bật).
--
-- GIẢI PHÁP CHỐT (theo xác nhận trực tiếp — "ok" — sau khi trình bày 3 bước
-- đề xuất, KHÔNG tự suy diễn thêm ngoài phạm vi đã trình bày):
--   1. `update_goal_link` — khi CHUYỂN từ thủ công -> liên kết category lần
--      đầu (đúng nhánh "Case còn lại: đang thủ công, link sang category" đã
--      có sẵn ở 0026, KHÔNG đụng nhánh "đang liên kết, đổi category khác" vì
--      nhánh đó không thể có config cấp-goal orphan — `create_auto_contribution_config`
--      đã chặn tạo config cấp-goal cho goal ĐANG liên kết từ 0037/0038):
--      tự TẮT (enabled=false, KHÔNG xoá — giữ lịch sử/audit) mọi config cấp-
--      goal đang bật của goal đó.
--   2. Phòng thủ kép (đúng CONSTITUTION §5 "an toàn 2 tầng"): thêm điều kiện
--      loại trừ goal đã liên kết NGAY TRONG WHERE của cả 2 hàm trích tiền —
--      dù bước 1 có lỡ sót ca nào (VD dữ liệu cũ trước migration này), cron/
--      trigger cũng không bao giờ trích nhầm.
--
-- BÀI HỌC T-S86 áp dụng NGHIÊM: giữ NGUYÊN chữ ký cả 3 hàm bị sửa (đúng thứ
-- tự, đúng số tham số, đúng default) như bản đang sống (0026/0037/0038) —
-- CHỈ đổi phần THÂN hàm -> `create or replace` ghi đè đúng bản hiện có,
-- không tạo overload song song.
--
-- PHẠM VI: KHÔNG đụng RLS/constraint/cột nào khác. KHÔNG đụng nhánh "đang
-- liên kết, đổi sang category khác" hay "unlink về thủ công" của
-- `update_goal_link` — 2 nhánh đó không liên quan bug này.
-- =========================================================

begin;

-- =========================================================
-- 1. update_goal_link — tắt config cấp-goal orphan khi liên kết lần đầu
--    (giữ NGUYÊN chữ ký 5 tham số của 0026, chỉ thêm 1 câu lệnh UPDATE
--    trong nhánh "đang thủ công -> link category" — KHÔNG đổi gì khác so
--    với thân hàm 0026, kể cả comment gốc được giữ lại nguyên văn).
-- =========================================================
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
    --
    -- [0039] KHÔNG cần tắt config cấp-goal ở đây — goal ĐANG liên kết không
    -- thể có config cấp-goal orphan còn sống (`create_auto_contribution_config`
    -- đã chặn tạo config cấp-goal khi `linked_category_id is not null` từ
    -- 0037/0038), nên nhánh này giữ nguyên, không sửa gì thêm.
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
    -- [0039, MỚI] Đây CHÍNH XÁC là thời điểm goal chuyển thủ công -> liên
    -- kết — nếu goal đang có config cấp-goal (T-S139) còn `enabled=true`,
    -- tắt hẳn ngay bây giờ (KHÔNG xoá — giữ lại để còn lịch sử/audit qua
    -- `auto_contribution_log`). Từ giờ trích tự động cho goal này (nếu
    -- muốn) phải qua config cấp-CATEGORY (T-S143) trên đúng category vừa
    -- liên kết — tránh trích chồng 2 lần lên cùng 1 goal mỗi kỳ.
    update public.auto_contribution_configs
      set enabled = false, updated_at = v_now
      where goal_id = p_goal_id and enabled = true;

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

-- =========================================================
-- 2. apply_auto_contributions_on_income — phòng thủ kép: loại trừ goal đã
--    liên kết ngay trong điều kiện lọc config (giữ NGUYÊN chữ ký trigger
--    function của 0037 — không tham số, `returns trigger` — chỉ thêm 1
--    điều kiện `and not exists (...)` vào WHERE, không đổi gì khác).
-- =========================================================
create or replace function public.apply_auto_contributions_on_income()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_config record;
  v_income_amount numeric := new.amount;
  v_contribution numeric;
  v_new_tx_id uuid;
begin
  if new.type <> 'income' then
    return new;
  end if;

  for v_config in
    select * from public.auto_contribution_configs
    where trigger_type = 'on_income' and enabled = true
      and (
        (new.owner_id is not null and owner_id = new.owner_id)
        or (new.household_id is not null and household_id = new.household_id)
      )
      -- [0039, MỚI, phòng thủ kép] config cấp-goal (on_income CHỈ áp dụng
      -- cho goal_id — category_id bị chk_category_only_monthly chặn cứng
      -- on_income) mà goal đã liên kết category thì KHÔNG được trích nữa,
      -- dù `enabled` có lỡ vẫn true (VD dữ liệu cũ trước migration này) —
      -- không phụ thuộc hoàn toàn vào bước 1 đã tắt đúng lúc liên kết.
      and (
        v_config.goal_id is null
        or not exists (
          select 1 from public.saving_goals g
          where g.id = v_config.goal_id and g.linked_category_id is not null
        )
      )
  loop
    v_contribution := case
      when v_config.amount_type = 'fixed' then v_config.amount_value
      else round(v_income_amount * v_config.amount_value / 100)
    end;

    -- "Không đủ số dư" v1: chỉ so với chính khoản thu vừa vào, KHÔNG cộng
    -- dồn số dư luỹ kế toàn hệ thống (§1.15) — trigger insert phải rẻ.
    if v_contribution > v_income_amount then
      insert into public.auto_contribution_log (
        config_id, triggered_by_transaction_id, computed_amount, status, skip_reason
      ) values (
        v_config.id, new.id, v_contribution, 'skipped_insufficient',
        'Khoản trích cấu hình (' || v_contribution || 'đ) lớn hơn khoản thu vừa ghi nhận (' || v_income_amount || 'đ)'
      );

      -- Amendment 25/08: cảnh báo phải hiện THẬT cho người dùng, không chỉ
      -- nằm câm lặng trong bảng audit. Dùng ĐÚNG activity_log sẵn có (không
      -- tạo nguồn thông báo thứ 2) -> tự nổi lên NotificationBell.tsx.
      insert into public.activity_log (
        owner_id, household_id, actor_id, action, entity_type, entity_id, message, source
      ) values (
        new.owner_id, new.household_id, coalesce(new.member_id, new.owner_id),
        'goal.auto_contribution_skipped', 'transaction', new.id,
        'Bỏ qua trích tự động: khoản cấu hình ' || to_char(v_contribution, 'FM999,999,999,999')
          || 'đ lớn hơn khoản thu vừa ghi nhận (' || to_char(v_income_amount, 'FM999,999,999,999') || 'đ)',
        'system'
      );

      continue;
    end if;

    insert into public.transactions (
      owner_id, household_id, member_id, type, description, amount, date,
      note, goal_id, source
    ) values (
      new.owner_id, new.household_id, new.member_id, 'transfer',
      'Trích tự động vào mục tiêu tiết kiệm', v_contribution, new.date,
      'Tự động trích từ khoản thu #' || new.id, v_config.goal_id, 'web'
    ) returning id into v_new_tx_id;

    insert into public.auto_contribution_log (
      config_id, triggered_by_transaction_id, contribution_transaction_id, computed_amount, status
    ) values (
      v_config.id, new.id, v_new_tx_id, v_contribution, 'applied'
    );

    -- Bugfix phát hiện khi code T-S138: phải truyền ĐỦ owner_id lẫn
    -- household_id từ đúng new.owner_id/new.household_id (không chỉ 1
    -- trong 2), actor_id luôn coalesce(member_id, owner_id) — nếu không,
    -- giao dịch thu nhập CÁ NHÂN (household_id/member_id null) sẽ khiến
    -- insert activity_log FAIL (actor_id NOT NULL / scope_xor) và kéo
    -- theo rollback toàn bộ insert income gốc.
    insert into public.activity_log (
      owner_id, household_id, actor_id, action, entity_type, entity_id, message, source
    ) values (
      new.owner_id, new.household_id, coalesce(new.member_id, new.owner_id),
      'goal.auto_contribution', 'transaction', v_new_tx_id,
      'Đã tự động trích ' || to_char(v_contribution, 'FM999,999,999,999') || 'đ vào mục tiêu tiết kiệm', 'system'
    );
  end loop;

  return new;
end;
$$;

-- =========================================================
-- 3. run_monthly_auto_contributions — phòng thủ kép, cùng nguyên tắc như
--    mục 2 (giữ NGUYÊN chữ ký `returns void`, không tham số — chỉ thêm 1
--    điều kiện vào WHERE của vòng lặp).
-- =========================================================
create or replace function public.run_monthly_auto_contributions()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_config record;
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_last_day_of_month date := (date_trunc('month', v_today) + interval '1 month - 1 day')::date;
  v_is_last_day boolean := v_today = v_last_day_of_month;
  v_prev_month_start date := (date_trunc('month', v_today) - interval '1 month')::date;
  v_prev_month_end date := (date_trunc('month', v_today) - interval '1 day')::date;
  v_prev_month_income numeric;
  v_contribution numeric;
  v_cumulative_balance numeric;
  v_member_id uuid;
  v_new_tx_id uuid;
begin
  for v_config in
    select * from public.auto_contribution_configs
    where trigger_type = 'monthly_schedule' and enabled = true
      and (
        day_of_month = extract(day from v_today)::int
        or (v_is_last_day and day_of_month > extract(day from v_last_day_of_month)::int)
      )
      -- [0039, MỚI, phòng thủ kép] Cùng lý do với `apply_auto_contributions_on_income`
      -- ở trên — config cấp-goal mà goal đã liên kết category thì bỏ qua,
      -- dù `enabled` có lỡ vẫn true. Config cấp-category (`v_config.goal_id
      -- is null`) không bị ảnh hưởng bởi điều kiện này — luôn hợp lệ.
      and (
        v_config.goal_id is null
        or not exists (
          select 1 from public.saving_goals g
          where g.id = v_config.goal_id and g.linked_category_id is not null
        )
      )
  loop
    -- Số tiền dự kiến trích: fixed = đúng cấu hình; percent = trên tổng
    -- thu nhập THẬT của tháng vừa hoàn tất (không phải tháng đang chạy dở).
    if v_config.amount_type = 'fixed' then
      v_contribution := v_config.amount_value;
    else
      select coalesce(sum(amount), 0) into v_prev_month_income
        from public.transactions
        where type = 'income' and deleted_at is null
          and date between v_prev_month_start and v_prev_month_end
          and (
            (v_config.owner_id is not null and owner_id = v_config.owner_id)
            or (v_config.household_id is not null and household_id = v_config.household_id)
          );
      v_contribution := round(v_prev_month_income * v_config.amount_value / 100);
    end if;

    -- "Đủ/không đủ số dư" cho monthly_schedule: dùng Số dư luỹ kế (§1.15),
    -- KHÁC T-S138 (chỉ so với 1 khoản thu cụ thể) — xác nhận trực tiếp
    -- 25/08/2026, xem CONSTITUTION §1.28.2.
    select coalesce(sum(amount) filter (where type = 'income'), 0)
         - coalesce(sum(amount) filter (where type = 'expense'), 0)
      into v_cumulative_balance
      from public.transactions
      where deleted_at is null
        and (
          (v_config.owner_id is not null and owner_id = v_config.owner_id)
          or (v_config.household_id is not null and household_id = v_config.household_id)
        );

    v_member_id := case when v_config.household_id is not null then v_config.created_by else null end;

    if v_contribution > v_cumulative_balance then
      insert into public.auto_contribution_log (config_id, computed_amount, status, skip_reason)
      values (v_config.id, v_contribution, 'skipped_insufficient',
        'Khoản trích định kỳ (' || v_contribution || 'đ) lớn hơn Số dư luỹ kế hiện có (' || v_cumulative_balance || 'đ)');

      insert into public.activity_log (owner_id, household_id, actor_id, action, entity_type, entity_id, message, source)
      values (v_config.owner_id, v_config.household_id, coalesce(v_member_id, v_config.owner_id),
        case when v_config.goal_id is not null then 'goal.auto_contribution_skipped' else 'category.auto_contribution_skipped' end,
        case when v_config.goal_id is not null then 'saving_goal' else 'category' end,
        coalesce(v_config.goal_id, v_config.category_id),
        'Bỏ qua trích định kỳ: khoản cấu hình ' || to_char(v_contribution, 'FM999,999,999,999')
          || 'đ lớn hơn Số dư luỹ kế hiện có (' || to_char(v_cumulative_balance, 'FM999,999,999,999') || 'đ)',
        'system');

      continue;
    end if;

    if v_config.goal_id is not null then
      insert into public.transactions (
        owner_id, household_id, member_id, type, description, amount, date, note, goal_id, source
      ) values (
        v_config.owner_id, v_config.household_id, v_member_id, 'transfer',
        'Trích tự động định kỳ vào mục tiêu tiết kiệm', v_contribution, v_today,
        'Tự động trích hàng tháng (cấu hình #' || v_config.id || ')', v_config.goal_id, 'web'
      ) returning id into v_new_tx_id;
    else
      insert into public.transactions (
        owner_id, household_id, member_id, type, description, amount, date, note, category_id, source
      ) values (
        v_config.owner_id, v_config.household_id, v_member_id, 'expense',
        'Trích tự động định kỳ vào ngân sách tiết kiệm', v_contribution, v_today,
        'Tự động trích hàng tháng (cấu hình #' || v_config.id || ')', v_config.category_id, 'web'
      ) returning id into v_new_tx_id;
    end if;

    insert into public.auto_contribution_log (config_id, contribution_transaction_id, computed_amount, status)
    values (v_config.id, v_new_tx_id, v_contribution, 'applied');

    insert into public.activity_log (owner_id, household_id, actor_id, action, entity_type, entity_id, message, source)
    values (v_config.owner_id, v_config.household_id, coalesce(v_member_id, v_config.owner_id),
      case when v_config.goal_id is not null then 'goal.auto_contribution' else 'category.auto_contribution' end,
      'transaction', v_new_tx_id,
      'Đã tự động trích ' || to_char(v_contribution, 'FM999,999,999,999') || 'đ định kỳ hàng tháng', 'system');
  end loop;
end;
$$;

-- =========================================================
-- 4. Dọn dữ liệu CŨ (chạy 1 lần, ngay trong migration này): tắt NGAY mọi
--    config cấp-goal đang `enabled=true` mà goal đã liên kết category từ
--    TRƯỚC migration này (bug đã xảy ra trước khi có bước 1 ở trên) — nếu
--    không dọn, config orphan cũ vẫn nằm im `enabled=true` mãi (bước 2 chỉ
--    chặn LÚC CHẠY, không tự sửa dữ liệu sai có sẵn).
-- =========================================================
update public.auto_contribution_configs c
  set enabled = false, updated_at = now()
  where c.enabled = true
    and c.goal_id is not null
    and exists (
      select 1 from public.saving_goals g
      where g.id = c.goal_id and g.linked_category_id is not null
    );

-- Sau khi chạy migration này, BẮT BUỘC reload schema cache PostgREST (bài
-- học T-S86) để loại trừ khả năng cache giữ định nghĩa hàm cũ:
--   NOTIFY pgrst, 'reload schema';
-- hoặc Supabase Dashboard -> Settings -> API -> Reload schema cache.

commit;
