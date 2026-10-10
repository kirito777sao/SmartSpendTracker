-- 0030_activity_log_notifications.sql
-- T-S27 (CONSTITUTION §1.11) — Hệ thống thông báo: MỞ RỘNG activity_log có
-- sẵn (không tạo bảng mới), sinh bởi DB trigger. Người yêu cầu đã xác nhận
-- "bắt đầu code" 18/08/2026 (§5 Hỏi trước khi làm).
--
-- Phạm vi đúng như CHỐT ở CONSTITUTION §1.11 (gốc + 2 lần mở rộng):
--   1. Thêm cột owner_id (scope cá nhân) + read_at (đã đọc) vào activity_log.
--   2. action='budget.exceeded' — edge-triggered, AFTER INSERT trên
--      transactions, so tổng trước/sau, chỉ bắn khi CHUYỂN từ chưa-vượt
--      sang vượt.
--   3. action='transaction.create' — AFTER INSERT trên transactions, CHỈ
--      cho giao dịch hộ gia đình (thông báo "có giao dịch mới trong hộ";
--      giao dịch cá nhân không có ai khác để thông báo).
--   4. action='goal.completed' — AFTER UPDATE trên saving_goals, khi
--      completed_at chuyển từ null sang có giá trị (T-S19/20 đã xong, xem
--      migration 0016/0021/0024 — completed_at đã tồn tại thật).
--   5. action='transaction.delete_by_member' — AFTER UPDATE trên
--      transactions (nhánh soft-delete), CHỈ khi người xoá không phải chủ hộ
--      hiện tại. CHỈ chủ hộ nhận (dùng owner_id, KHÔNG dùng household_id, để
--      không lộ cho thành viên khác).
--   6. RLS đọc mở rộng thêm owner_id. RPC mark_activity_read cho đánh dấu
--      đã đọc (activity_log vẫn giữ nguyên tắc "chỉ đọc trực tiếp, ghi qua
--      RPC/trigger SECURITY DEFINER" — không thêm policy UPDATE/INSERT cho
--      client).
--
-- KHÔNG thuộc phạm vi lần này (đã ghi rõ trong CONSTITUTION §1.11): gửi qua
-- Telegram thật, email/push.

begin;

-- =========================================================
-- 1. Cột mới + ràng buộc scope (xor, giống categories/saving_goals)
-- =========================================================
alter table public.activity_log
  add column owner_id uuid references auth.users(id),
  add column read_at timestamptz;

-- Mọi dòng hiện có đều là sự kiện hộ gia đình (household_id not null,
-- owner_id sẽ mặc định null) -> đã tự thoả xor, không cần backfill.
alter table public.activity_log
  add constraint activity_log_scope_xor check (
    (owner_id is not null and household_id is null) or
    (owner_id is null and household_id is not null)
  );

create index idx_activity_log_owner_id on public.activity_log(owner_id);

-- =========================================================
-- 2. RLS: mở rộng policy đọc thêm scope cá nhân (owner_id)
-- =========================================================
drop policy "read household activity" on public.activity_log;

create policy "read own or household activity" on public.activity_log for select using (
  owner_id = auth.uid() or is_household_member(household_id)
);

-- =========================================================
-- 3. RPC đánh dấu đã đọc — SECURITY DEFINER, không mở UPDATE trực tiếp
--    cho client (giữ nguyên tắc "chỉ đọc, ghi qua RPC" đã CHỐT ở §3).
--    p_ids = null -> đánh dấu TẤT CẢ hoạt động đang xem được (chưa đọc)
--    là đã đọc; p_ids not null -> chỉ đánh dấu đúng các id đó (vẫn lọc lại
--    theo đúng điều kiện scope, không tin id truyền vào mù quáng).
-- =========================================================
create or replace function public.mark_activity_read(p_ids uuid[] default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.activity_log
  set read_at = now()
  where read_at is null
    and (owner_id = auth.uid() or is_household_member(household_id))
    and (p_ids is null or id = any(p_ids));
end;
$$;

-- =========================================================
-- 4. Trigger AFTER INSERT trên transactions:
--    (a) action='transaction.create' cho giao dịch hộ gia đình.
--    (b) action='budget.exceeded' edge-triggered theo category_id.
-- =========================================================
create or replace function public.log_transaction_create_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_name text;
  v_limit numeric;
  v_cat_owner uuid;
  v_cat_household uuid;
  v_cat_name text;
  v_total_after numeric;
  v_total_before numeric;
begin
  if new.deleted_at is not null then
    return new;
  end if;

  -- (a) transaction.create — chỉ giao dịch hộ gia đình (member_id not null
  -- theo đúng tx_scope_xor); giao dịch cá nhân không có người xem khác.
  if new.household_id is not null then
    select name into v_actor_name from public.profiles where id = new.member_id;

    insert into public.activity_log (household_id, actor_id, action, entity_type, entity_id, message, source)
    values (
      new.household_id, new.member_id, 'transaction.create', 'transaction', new.id,
      coalesce(v_actor_name, 'Một thành viên') || ' đã thêm giao dịch "' || new.description || '" ('
        || to_char(new.amount, 'FM999,999,999,999') || ' ₫)',
      'system'
    );
  end if;

  -- (b) budget.exceeded — chỉ tính chi tiêu thật (đúng nguyên tắc
  -- isExpenseTx ở FE, xem src/lib/txClassify.ts), edge-triggered.
  if new.type = 'expense' and new.category_id is not null then
    select limit_amount, owner_id, household_id, name
      into v_limit, v_cat_owner, v_cat_household, v_cat_name
      from public.categories
      where id = new.category_id and deleted_at is null;

    if v_limit is not null then
      select coalesce(sum(amount), 0) into v_total_after
        from public.transactions
        where category_id = new.category_id
          and type = 'expense'
          and deleted_at is null
          and date_trunc('month', date) = date_trunc('month', new.date);

      v_total_before := v_total_after - new.amount;

      if v_total_before < v_limit and v_total_after >= v_limit then
        insert into public.activity_log (owner_id, household_id, actor_id, action, entity_type, entity_id, message, source)
        values (
          v_cat_owner, v_cat_household, coalesce(new.member_id, new.owner_id),
          'budget.exceeded', 'category', new.category_id,
          'Danh mục "' || v_cat_name || '" đã vượt hạn mức ngân sách tháng này ('
            || to_char(v_total_after, 'FM999,999,999,999') || ' / '
            || to_char(v_limit, 'FM999,999,999,999') || ' ₫)',
          'system'
        );
      end if;
    end if;
  end if;

  return new;
end;
$$;

create trigger trg_activity_transaction_create
after insert on public.transactions
for each row execute function public.log_transaction_create_activity();

-- =========================================================
-- 5. Trigger AFTER UPDATE (soft-delete) trên transactions:
--    action='transaction.delete_by_member' — chỉ báo chủ hộ, chỉ khi
--    người xoá không phải chủ hộ hiện tại.
-- =========================================================
create or replace function public.log_transaction_delete_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
  v_actor_name text;
begin
  if new.household_id is null then
    return new;
  end if;

  select owner_id into v_owner_id from public.households where id = new.household_id;

  if v_owner_id is null or new.member_id = v_owner_id then
    return new;
  end if;

  select name into v_actor_name from public.profiles where id = new.member_id;

  insert into public.activity_log (owner_id, actor_id, action, entity_type, entity_id, message, source)
  values (
    v_owner_id, new.member_id, 'transaction.delete_by_member', 'transaction', new.id,
    coalesce(v_actor_name, 'Một thành viên') || ' đã xoá giao dịch "' || new.description || '" ('
      || to_char(new.amount, 'FM999,999,999,999') || ' ₫)',
    'system'
  );

  return new;
end;
$$;

create trigger trg_activity_transaction_soft_delete
after update of deleted_at on public.transactions
for each row
when (old.deleted_at is null and new.deleted_at is not null)
execute function public.log_transaction_delete_activity();

-- =========================================================
-- 6. Trigger AFTER UPDATE trên saving_goals:
--    action='goal.completed' khi completed_at chuyển null -> có giá trị.
-- =========================================================
-- LƯU Ý (giới hạn đã biết, không mở rộng xử lý ở đây): actor_id NOT NULL
-- nên trigger này giả định auth.uid() luôn có giá trị — đúng cho MỌI đường
-- gọi hiện tại (updateGoal client trực tiếp, RPC withdraw ở 0021/0023/0024
-- đều chạy trong request đã đăng nhập). Nếu sau này có script/service_role
-- tự đổi completed_at ngoài 1 request user thật, UPDATE đó sẽ FAIL do vi
-- phạm NOT NULL — cố ý chấp nhận (thà lỗi rõ còn hơn ghi actor sai/rỗng).
create or replace function public.log_goal_completed_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_name text;
begin
  select name into v_actor_name from public.profiles where id = auth.uid();

  insert into public.activity_log (owner_id, household_id, actor_id, action, entity_type, entity_id, message, source)
  values (
    new.owner_id, new.household_id, auth.uid(), 'goal.completed', 'saving_goal', new.id,
    coalesce(v_actor_name, 'Một thành viên') || ' đã hoàn thành mục tiêu tiết kiệm "' || new.name || '"',
    'system'
  );

  return new;
end;
$$;

create trigger trg_activity_goal_completed
after update of completed_at on public.saving_goals
for each row
when (old.completed_at is null and new.completed_at is not null)
execute function public.log_goal_completed_activity();

-- =========================================================
-- 7. Bật Realtime cho activity_log (đúng pattern đã CHỐT ở T-S08, migration
--    0029) — chuông cần cập nhật tức thời qua postgres_changes, không phải
--    polling/refetch thủ công. Client filter theo owner_id/household_id
--    (xem src/hooks/useRealtimeSync.ts) cần REPLICA IDENTITY FULL để có đủ
--    cột trong payload, giống hệt lý do đã giải thích ở 0029.
-- =========================================================
alter table public.activity_log replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'activity_log'
  ) then
    alter publication supabase_realtime add table public.activity_log;
  end if;
end $$;

commit;
