-- =========================================================
-- 0038_auto_contribution_monthly_schedule.sql
-- T-S140 (mở rộng, CONSTITUTION §1.28.2) — thêm target `category_id` song
-- song `goal_id` cho `auto_contribution_configs`, RPC
-- `run_monthly_auto_contributions()` cho trigger_type='monthly_schedule'.
--
-- KHÔNG sửa lại migration 0037 đã apply — chỉ ALTER thêm ở đây, đúng
-- nguyên tắc "không sửa migration đã chạy trên production".
--
-- [SOÁT LẠI 26/08/2026, trước khi apply — xem CHANGELOG "T-S140 PHASE 3
-- (VERIFY)"] 2 điểm đã sửa so với bản nháp đầu tiên:
--   1. Bugfix thật (đúng lớp lỗi T-S86/§1.22.6): thêm DROP FUNCTION cho
--      chữ ký cũ của create_auto_contribution_config (5 tham số, từ 0037)
--      NGAY TRƯỚC khi tạo bản 6 tham số — tránh 2 overload sống song song.
--   2. Theo xác nhận trực tiếp (chọn CẢ 2 phương án (a)+(b)): RPC chặn
--      cứng category_id phải có type='expense' (tầng 2, phòng thủ kép),
--      VÀ UI T-S143 (chưa code) sẽ chỉ cho chọn từ danh sách category chi
--      tiêu ngay từ đầu (tầng 1) — không chỉ dựa vào 1 trong 2.
--
-- LƯU Ý BẮT BUỘC TRƯỚC KHI SCHEDULE THẬT: extension `pg_cron` phải được
-- người yêu cầu tự bật qua Supabase Dashboard (Database > Extensions) —
-- KHÔNG nằm trong migration này. Sau khi bật, chạy riêng (không phải
-- trong file này, chạy 1 lần thủ công):
--   select cron.schedule(
--     'run_monthly_auto_contributions',
--     '5 17 * * *', -- 00:05 giờ VN = 17:05 UTC hôm trước
--     $$ select public.run_monthly_auto_contributions(); $$
--   );
-- =========================================================

begin;

-- =========================================================
-- 1. Schema: thêm category_id, đổi ràng buộc target
-- =========================================================
alter table public.auto_contribution_configs
  add column category_id uuid references public.categories(id);

alter table public.auto_contribution_configs
  alter column goal_id drop not null;

alter table public.auto_contribution_configs
  add constraint chk_target_xor check ((goal_id is not null) <> (category_id is not null));

-- Xác nhận trực tiếp 25/08/2026: category_id CHỈ dùng được với
-- trigger_type='monthly_schedule' (không có on_income cho category).
alter table public.auto_contribution_configs
  add constraint chk_category_only_monthly check (category_id is null or trigger_type = 'monthly_schedule');

comment on column public.auto_contribution_configs.category_id is
  'T-S140 mở rộng/§1.28.2 — mục tiêu trích thay thế cho goal_id (XOR). '
  'Khi set: chỉ hợp lệ với trigger_type=monthly_schedule, giao dịch tự sinh '
  'là type=expense (không phải transfer) — tự tính vào limit_amount của '
  'category, và nếu category đang liên kết 1 saving_goals (§1.13) thì tự '
  'tính vào current_amount goal đó qua đúng cơ chế SUM sẵn có.';

-- =========================================================
-- 2. Sửa create_auto_contribution_config — nhận thêm p_category_id
--
--    [BUGFIX tự phát hiện khi kiểm tra lại 0038, trước khi apply — ĐÚNG
--    LỚP LỖI T-S86 (CONSTITUTION §1.22.6) tái diễn]: bản 0037 định nghĩa
--    create_auto_contribution_config(uuid, text, text, numeric, int) — 5
--    tham số, không có default cho 4 tham số đầu. Bản dưới đây thêm
--    p_category_id vào CUỐI (đúng khuyến nghị (a) của §1.22.6: "giữ đúng
--    thứ tự tham số cũ, chỉ thêm tham số MỚI vào cuối"), NHƯNG chữ ký
--    (uuid, text, text, numeric, int, uuid) là 1 overload KHÁC PostgreSQL
--    hoàn toàn so với (uuid, text, text, numeric, int) — `create or
--    replace` KHÔNG ghi đè bản cũ, chỉ tạo thêm 1 overload song song, y
--    hệt nguyên nhân gốc của bug T-S86. Nếu không DROP bản cũ NGAY TRONG
--    CÙNG migration này (đúng vế còn lại của khuyến nghị (a)), Postgres sẽ
--    giữ cả 2 hàm cùng lúc: bản cũ không biết category_id, không có 2
--    validation mới (XOR target, category chỉ cho monthly_schedule) — bất
--    kỳ lời gọi nào (do cache PostgREST cũ, hay do gọi thiếu p_category_id)
--    khớp đúng 5 tham số sẽ âm thầm rơi vào bản cũ mà không báo lỗi gì.
--    Xác nhận: chưa có service/component nào trong `src/` gọi RPC này
--    (grep "auto_contribution" src/ chỉ thấy khai báo type, T-S139 UI chưa
--    code) — DROP bản cũ ở đây an toàn, không phá luồng client nào.
drop function if exists public.create_auto_contribution_config(uuid, text, text, numeric, int);

create or replace function public.create_auto_contribution_config(
  p_goal_id uuid default null,
  p_trigger_type text default 'on_income',
  p_amount_type text default 'fixed',
  p_amount_value numeric default null,
  p_day_of_month int default null,
  p_category_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
  v_household_id uuid;
  v_new_id uuid;
begin
  if (p_goal_id is not null) = (p_category_id is not null) then
    raise exception 'Phải chọn ĐÚNG 1 trong 2: mục tiêu tiết kiệm hoặc danh mục ngân sách.';
  end if;

  if p_category_id is not null and p_trigger_type <> 'monthly_schedule' then
    raise exception 'Trích tự động vào danh mục ngân sách chỉ hỗ trợ lịch cố định hàng tháng.';
  end if;

  if p_goal_id is not null then
    declare
      v_goal record;
    begin
      select id, owner_id, household_id, linked_category_id
        into v_goal
        from public.saving_goals
        where id = p_goal_id and deleted_at is null;

      if v_goal.id is null then
        raise exception 'Không tìm thấy mục tiêu tiết kiệm.';
      end if;
      if v_goal.linked_category_id is not null then
        raise exception 'Chỉ áp dụng trích tự động cho mục tiêu thủ công (chưa liên kết danh mục ngân sách).';
      end if;
      if v_goal.owner_id is not null and v_goal.owner_id <> auth.uid() then
        raise exception 'Bạn không có quyền cấu hình mục tiêu này.';
      end if;
      if v_goal.household_id is not null and not is_household_member(v_goal.household_id) then
        raise exception 'Bạn không có quyền cấu hình mục tiêu này.';
      end if;

      v_owner_id := v_goal.owner_id;
      v_household_id := v_goal.household_id;
    end;
  else
    declare
      v_cat record;
    begin
      select id, owner_id, household_id, type
        into v_cat
        from public.categories
        where id = p_category_id and deleted_at is null;

      if v_cat.id is null then
        raise exception 'Không tìm thấy danh mục ngân sách.';
      end if;
      if v_cat.owner_id is not null and v_cat.owner_id <> auth.uid() then
        raise exception 'Bạn không có quyền cấu hình danh mục này.';
      end if;
      if v_cat.household_id is not null and not is_household_member(v_cat.household_id) then
        raise exception 'Bạn không có quyền cấu hình danh mục này.';
      end if;
      -- [Bổ sung theo xác nhận 26/08/2026 — "cả đi" = làm cả (a) chặn RPC
      -- lẫn (b) để UI (T-S143) chỉ cho chọn category chi tiêu]: giao dịch
      -- tự sinh cho target category_id luôn là type='expense' (mục 3,
      -- PRD "Chốt 25/08/2026 (tiếp)") — chặn cứng ở đây (tầng 2, không chỉ
      -- tin UI T-S143 sẽ luôn lọc đúng, đúng nguyên tắc defense-in-depth
      -- đã áp dụng nhất quán cho mọi bảng tài chính khác trong dự án).
      if v_cat.type <> 'expense' then
        raise exception 'Chỉ áp dụng trích tự động cho danh mục CHI TIÊU (category type=''expense''). Không áp dụng cho danh mục nguồn thu.';
      end if;

      v_owner_id := v_cat.owner_id;
      v_household_id := v_cat.household_id;
    end;
  end if;

  insert into public.auto_contribution_configs (
    owner_id, household_id, goal_id, category_id, trigger_type, amount_type, amount_value, day_of_month, created_by, enabled
  ) values (
    v_owner_id, v_household_id, p_goal_id, p_category_id, p_trigger_type, p_amount_type, p_amount_value, p_day_of_month,
    auth.uid(), false
  ) returning id into v_new_id;

  return v_new_id;
end;
$$;

-- =========================================================
-- 3. RPC run_monthly_auto_contributions() — gọi bởi pg_cron 1 lần/ngày
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

commit;
