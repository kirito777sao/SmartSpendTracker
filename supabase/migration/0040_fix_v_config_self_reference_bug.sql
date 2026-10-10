-- =========================================================
-- 0040_fix_v_config_self_reference_bug.sql
-- Hotfix KHẨN CẤP — phát hiện 31/08/2026 khi chẩn đoán log `npx vitest run`
-- gửi bởi người yêu cầu (7/10 test fail), KHÔNG phải do test tay tình cờ.
--
-- BUG: `apply_auto_contributions_on_income()` và `run_monthly_auto_contributions()`
-- (cả 2 `create or replace` trong migration `0039`, ĐÃ CHẠY THẬT trên
-- Supabase production 27/08/2026, xem CHANGELOG "27/08/2026 — T-S139 🔒 và
-- T-S143 🔒") có đoạn WHERE của câu SELECT dùng để gán biến vòng lặp
-- `v_config` lại tự tham chiếu `v_config.goal_id` NGAY TRONG chính câu SELECT
-- đó:
--   for v_config in
--     select * from auto_contribution_configs
--     where ... and (v_config.goal_id is null or not exists (...))
--   loop
-- `v_config` là biến `record`, chỉ có giá trị SAU KHI 1 dòng được gán trong
-- vòng lặp — PL/pgSQL phải resolve `v_config.goal_id` như 1 tham số TRƯỚC KHI
-- query chạy để lấy dòng đầu tiên, nên luôn raise:
--   record "v_config" is not assigned yet
--
-- HẬU QUẢ THẬT (không chỉ lỗi test): `apply_auto_contributions_on_income()`
-- chạy `AFTER INSERT` trên MỌI giao dịch `type='income'` của MỌI user. Ngay
-- khi có ≥1 dòng `auto_contribution_configs` khớp
-- `trigger_type='on_income' and enabled=true` cho đúng owner/household đang
-- ghi giao dịch, trigger raise exception → INSERT `income` gốc bị ROLLBACK
-- TOÀN BỘ. `run_monthly_auto_contributions()` (cron `pg_cron`, T-S140) dính
-- y hệt — cron sẽ crash mỗi lần chạy, không trích được cho bất kỳ ai (kể cả
-- config cấp-category không hề liên quan tới goal liên kết).
--
-- FIX: đặt alias `acc` cho bảng trong câu SELECT nạp vòng lặp, dùng
-- `acc.goal_id` thay vì `v_config.goal_id` ở ĐÚNG 2 chỗ (điều kiện lọc
-- TRƯỚC `loop`) — KHÔNG đổi bất kỳ dòng nào bên TRONG thân vòng lặp (những
-- chỗ đó `v_config` đã được gán, tham chiếu đúng, không phải bug).
--
-- BÀI HỌC T-S86 áp dụng NGHIÊM: giữ NGUYÊN chữ ký cả 2 hàm (đúng như
-- 0037/0039) — CHỈ đổi phần THÂN hàm bằng `create or replace`, không tạo
-- overload song song, không đổi trigger đã gắn.
--
-- PHẠM VI: KHÔNG đụng RLS/constraint/cột/`update_goal_link` nào khác —
-- migration này CHỈ sửa đúng 2 hàm bị bug, không mở rộng.
-- =========================================================

begin;

-- =========================================================
-- 1. apply_auto_contributions_on_income — fix self-reference, giữ NGUYÊN
--    mọi logic khác so với bản 0039 (kể cả comment gốc).
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
    select acc.* from public.auto_contribution_configs acc
    where acc.trigger_type = 'on_income' and acc.enabled = true
      and (
        (new.owner_id is not null and acc.owner_id = new.owner_id)
        or (new.household_id is not null and acc.household_id = new.household_id)
      )
      -- [0039, phòng thủ kép] config cấp-goal (on_income CHỈ áp dụng cho
      -- goal_id — category_id bị chk_category_only_monthly chặn cứng
      -- on_income) mà goal đã liên kết category thì KHÔNG được trích nữa,
      -- dù `enabled` có lỡ vẫn true (VD dữ liệu cũ trước migration 0039) —
      -- không phụ thuộc hoàn toàn vào bước tắt tự động lúc liên kết.
      -- [0040, FIX] dùng alias `acc.goal_id` thay vì `v_config.goal_id` —
      -- v_config chưa hề được gán tại thời điểm câu SELECT này chạy.
      and (
        acc.goal_id is null
        or not exists (
          select 1 from public.saving_goals g
          where g.id = acc.goal_id and g.linked_category_id is not null
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

    -- Bugfix T-S138: phải truyền ĐỦ owner_id lẫn household_id từ đúng
    -- new.owner_id/new.household_id (không chỉ 1 trong 2), actor_id luôn
    -- coalesce(member_id, owner_id) — nếu không, giao dịch thu nhập CÁ NHÂN
    -- sẽ khiến insert activity_log FAIL và kéo theo rollback insert income gốc.
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
-- 2. run_monthly_auto_contributions — cùng fix, giữ NGUYÊN mọi logic khác.
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
    select acc.* from public.auto_contribution_configs acc
    where acc.trigger_type = 'monthly_schedule' and acc.enabled = true
      and (
        acc.day_of_month = extract(day from v_today)::int
        or (v_is_last_day and acc.day_of_month > extract(day from v_last_day_of_month)::int)
      )
      -- [0039, phòng thủ kép] Cùng lý do với apply_auto_contributions_on_income
      -- ở trên — config cấp-goal mà goal đã liên kết category thì bỏ qua, dù
      -- `enabled` có lỡ vẫn true. Config cấp-category (`acc.goal_id is null`)
      -- không bị ảnh hưởng bởi điều kiện này — luôn hợp lệ.
      -- [0040, FIX] dùng alias `acc.goal_id` thay vì `v_config.goal_id`.
      and (
        acc.goal_id is null
        or not exists (
          select 1 from public.saving_goals g
          where g.id = acc.goal_id and g.linked_category_id is not null
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
    -- KHÁC T-S138 (chỉ so với 1 khoản thu cụ thể) — xem CONSTITUTION §1.28.2.
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

-- Sau khi chạy migration này, BẮT BUỘC reload schema cache PostgREST (bài
-- học T-S86) để loại trừ khả năng cache giữ định nghĩa hàm cũ:
--   NOTIFY pgrst, 'reload schema';
-- hoặc Supabase Dashboard -> Settings -> API -> Reload schema cache.

commit;
