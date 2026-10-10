-- =========================================================
-- 0037_auto_contribution_schema.sql
-- T-S138 (CONSTITUTION §1.28) — "Trích ngân sách tự động", kiểu (a) on_income.
--
-- Nguồn thiết kế: CONSTITUTION.md §1.28 (CHỐT 25/08/2026) + PRD.md
-- "Chốt 25/08/2026" + CẬP NHẬT 25/08/2026 (cảnh báo skipped_insufficient
-- phải hiện thật, không chỉ nằm trong audit log) + SỬA LỖI phát hiện khi
-- code T-S138 (owner_id/actor_id cho scope cá nhân).
--
-- Phạm vi: CHỈ schema + trigger + 4 RPC CRUD cho kiểu (a). KHÔNG đụng
-- monthly_schedule (T-S140) và KHÔNG đụng UI (T-S139).
-- =========================================================

begin;

-- =========================================================
-- 1. Bảng auto_contribution_configs (đúng nguyên văn §1.28)
-- =========================================================
create table public.auto_contribution_configs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references public.profiles(id),
  household_id uuid references public.households(id) on delete cascade,
  goal_id uuid not null references public.saving_goals(id) on delete cascade,
  trigger_type text not null check (trigger_type in ('on_income', 'monthly_schedule')),
  amount_type text not null check (amount_type in ('fixed', 'percent')),
  amount_value numeric not null check (amount_value > 0),
  day_of_month int check (day_of_month between 1 and 31),
  enabled boolean not null default false,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_percent_range check (amount_type <> 'percent' or (amount_value > 0 and amount_value <= 100)),
  constraint chk_schedule_needs_day check (trigger_type <> 'monthly_schedule' or day_of_month is not null),
  constraint chk_scope_xor check ((owner_id is not null) <> (household_id is not null))
);

create index idx_acc_configs_owner_id on public.auto_contribution_configs(owner_id);
create index idx_acc_configs_household_id on public.auto_contribution_configs(household_id);
create index idx_acc_configs_goal_id on public.auto_contribution_configs(goal_id);
-- Truy vấn nóng nhất là trong trigger: lọc trigger_type='on_income' AND enabled=true
-- theo đúng owner_id/household_id của giao dịch income vừa insert.
create index idx_acc_configs_on_income_lookup
  on public.auto_contribution_configs(trigger_type, enabled)
  where trigger_type = 'on_income' and enabled = true;

create trigger trg_acc_configs_updated_at before update on public.auto_contribution_configs
  for each row execute function public.set_updated_at();

comment on table public.auto_contribution_configs is
  'T-S138/§1.28 — cấu hình trích ngân sách tự động vào 1 saving_goal thủ công. '
  'Ghi/sửa/xoá CHỈ qua RPC SECURITY DEFINER (create/update/delete/toggle_auto_contribution_config), '
  'không qua PostgREST insert/update/delete trực tiếp.';

-- =========================================================
-- 2. Bảng auto_contribution_log (đúng nguyên văn §1.28)
--    config_id: ON DELETE SET NULL (không phải RESTRICT/CASCADE mặc định) —
--    ĐÂY LÀ 1 QUYẾT ĐỊNH THÊM CỦA TÔI (Claude), CHƯA được người yêu cầu xác
--    nhận trực tiếp, vì §1.28 gốc không ghi rõ on-delete behavior cho FK
--    này. Lý do chọn SET NULL: bảng configs KHÔNG có deleted_at (xoá =
--    xoá cứng qua delete_auto_contribution_config), nếu để RESTRICT thì
--    xoá config sẽ luôn FAIL một khi đã có ít nhất 1 dòng log — chặn tính
--    năng "xoá cấu hình" ngay từ giao dịch trích đầu tiên; nếu CASCADE thì
--    mất trắng lịch sử applied/skipped, trái nguyên tắc "không mất lịch sử
--    tài chính" áp dụng nhất quán cho categories/saving_goals (soft-delete)
--    ở toàn dự án. SET NULL giữ được dòng log (audit) nhưng vẫn cho xoá
--    config. CẦN NGƯỜI YÊU CẦU XÁC NHẬN LẠI — nếu muốn khác (vd chặn xoá
--    hẳn khi còn log, hoặc đổi delete_auto_contribution_config thành
--    soft-delete thay vì hard-delete), báo tôi sửa lại migration này
--    trước khi chạy trên project thật.
-- =========================================================
create table public.auto_contribution_log (
  id uuid primary key default gen_random_uuid(),
  config_id uuid references public.auto_contribution_configs(id) on delete set null,
  triggered_by_transaction_id uuid references public.transactions(id) on delete set null,
  contribution_transaction_id uuid references public.transactions(id) on delete set null,
  computed_amount numeric not null,
  status text not null check (status in ('applied', 'skipped_insufficient', 'skipped_other')),
  skip_reason text,
  created_at timestamptz not null default now()
);

create index idx_acc_log_config_id on public.auto_contribution_log(config_id);
create index idx_acc_log_triggered_by on public.auto_contribution_log(triggered_by_transaction_id);

comment on table public.auto_contribution_log is
  'T-S138/§1.28 — audit trail riêng cho auto-contribution (KHÔNG phải nguồn '
  'notification thứ 2 — notification thật đi qua activity_log như mọi tính '
  'năng khác, xem trigger apply_auto_contributions_on_income bên dưới).';

-- =========================================================
-- 3. RLS — chỉ SELECT cho client, mọi ghi đi qua RPC/trigger SECURITY
--    DEFINER (đúng nguyên tắc đã CHỐT ở §1.28, giống pattern các bảng tài
--    chính nhạy cảm khác trong dự án).
-- =========================================================
alter table public.auto_contribution_configs enable row level security;
alter table public.auto_contribution_log enable row level security;

create policy "read own or household auto_contribution_configs"
  on public.auto_contribution_configs for select using (
    owner_id = auth.uid() or is_household_member(household_id)
  );

-- auto_contribution_log không có owner_id/household_id trực tiếp — join
-- qua config_id để xác định quyền xem (đúng scope của config, kể cả khi
-- config đã bị xoá cứng thì config_id null -> không ai xem được dòng log
-- mồ côi đó qua policy này, chấp nhận được vì mục đích chỉ là audit UI
-- gắn liền với 1 config đang tồn tại).
create policy "read own or household auto_contribution_log"
  on public.auto_contribution_log for select using (
    exists (
      select 1 from public.auto_contribution_configs c
      where c.id = auto_contribution_log.config_id
        and (c.owner_id = auth.uid() or is_household_member(c.household_id))
    )
  );

-- =========================================================
-- 4. Trigger apply_auto_contributions_on_income — đúng nguyên văn §1.28
--    ĐÃ BAO GỒM SẴN 2 amendment 25/08 (không viết 2 lần):
--    (a) nhánh skipped_insufficient insert thêm 1 dòng activity_log
--        (action 'goal.auto_contribution_skipped') để nổi lên
--        NotificationBell.tsx qua đúng cơ chế sẵn có.
--    (b) nhánh applied insert activity_log với ĐỦ owner_id lẫn household_id
--        (không chỉ 1 trong 2) và actor_id = coalesce(member_id, owner_id)
--        — tránh lỗi NOT NULL/scope_xor cho giao dịch thu nhập CÁ NHÂN đã
--        phát hiện.
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

create trigger trg_apply_auto_contributions_on_income
after insert on public.transactions
for each row execute function public.apply_auto_contributions_on_income();

-- =========================================================
-- 5. 4 RPC SECURITY DEFINER — mỗi RPC tự re-check auth.uid() đúng quyền sở
--    hữu config qua chính goal_id (không nhận actor qua tham số).
-- =========================================================

-- 5.1 create_auto_contribution_config — scope (owner_id/household_id) LUÔN
-- suy ra từ chính goal_id, KHÔNG nhận từ client, để không thể giả mạo scope.
create or replace function public.create_auto_contribution_config(
  p_goal_id uuid,
  p_trigger_type text,
  p_amount_type text,
  p_amount_value numeric,
  p_day_of_month int default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_goal record;
  v_new_id uuid;
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

  insert into public.auto_contribution_configs (
    owner_id, household_id, goal_id, trigger_type, amount_type, amount_value, day_of_month, created_by, enabled
  ) values (
    v_goal.owner_id, v_goal.household_id, p_goal_id, p_trigger_type, p_amount_type, p_amount_value, p_day_of_month,
    auth.uid(), false
  ) returning id into v_new_id;

  return v_new_id;
end;
$$;

-- 5.2 update_auto_contribution_config — sửa tham số trích (KHÔNG đổi
-- enabled ở đây — dùng toggle_auto_contribution_config riêng cho rõ ràng).
create or replace function public.update_auto_contribution_config(
  p_config_id uuid,
  p_trigger_type text,
  p_amount_type text,
  p_amount_value numeric,
  p_day_of_month int default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_config record;
begin
  select * into v_config from public.auto_contribution_configs where id = p_config_id;
  if v_config.id is null then
    raise exception 'Không tìm thấy cấu hình.';
  end if;
  if v_config.owner_id is not null and v_config.owner_id <> auth.uid() then
    raise exception 'Bạn không có quyền sửa cấu hình này.';
  end if;
  if v_config.household_id is not null and not is_household_member(v_config.household_id) then
    raise exception 'Bạn không có quyền sửa cấu hình này.';
  end if;

  update public.auto_contribution_configs
  set trigger_type = p_trigger_type,
      amount_type = p_amount_type,
      amount_value = p_amount_value,
      day_of_month = p_day_of_month
  where id = p_config_id;
end;
$$;

-- 5.3 delete_auto_contribution_config — hard delete (bảng không có
-- deleted_at, xem ghi chú mục 2 ở trên về ON DELETE SET NULL cho log).
create or replace function public.delete_auto_contribution_config(p_config_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_config record;
begin
  select * into v_config from public.auto_contribution_configs where id = p_config_id;
  if v_config.id is null then
    raise exception 'Không tìm thấy cấu hình.';
  end if;
  if v_config.owner_id is not null and v_config.owner_id <> auth.uid() then
    raise exception 'Bạn không có quyền xoá cấu hình này.';
  end if;
  if v_config.household_id is not null and not is_household_member(v_config.household_id) then
    raise exception 'Bạn không có quyền xoá cấu hình này.';
  end if;

  delete from public.auto_contribution_configs where id = p_config_id;
end;
$$;

-- 5.4 toggle_auto_contribution_config — bật/tắt. Khi BẬT: chặn nếu đã có
-- 1 config khác ĐANG BẬT trong cùng scope (owner/household) — đúng câu
-- "v1 chỉ cho 1 cấu hình active tại 1 thời điểm" ở §1.28. Khi TẮT: luôn
-- cho phép, không cần check gì thêm (các giao dịch đã trích giữ nguyên).
create or replace function public.toggle_auto_contribution_config(p_config_id uuid, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_config record;
  v_other_enabled_count int;
begin
  select * into v_config from public.auto_contribution_configs where id = p_config_id;
  if v_config.id is null then
    raise exception 'Không tìm thấy cấu hình.';
  end if;
  if v_config.owner_id is not null and v_config.owner_id <> auth.uid() then
    raise exception 'Bạn không có quyền bật/tắt cấu hình này.';
  end if;
  if v_config.household_id is not null and not is_household_member(v_config.household_id) then
    raise exception 'Bạn không có quyền bật/tắt cấu hình này.';
  end if;

  if p_enabled then
    select count(*) into v_other_enabled_count
      from public.auto_contribution_configs
      where id <> p_config_id and enabled = true
        and (
          (v_config.owner_id is not null and owner_id = v_config.owner_id)
          or (v_config.household_id is not null and household_id = v_config.household_id)
        );
    if v_other_enabled_count > 0 then
      raise exception 'Đã có 1 cấu hình trích tự động khác đang bật. Tắt cấu hình đó trước khi bật cấu hình này (v1 chỉ cho phép 1 cấu hình hoạt động cùng lúc).';
    end if;
  end if;

  update public.auto_contribution_configs set enabled = p_enabled where id = p_config_id;
end;
$$;

commit;
