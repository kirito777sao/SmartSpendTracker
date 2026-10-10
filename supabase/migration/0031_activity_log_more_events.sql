-- 0031_activity_log_more_events.sql
-- T-S27 — MỞ RỘNG lần 2 (CHỐT 18/08/2026, người yêu cầu xác nhận qua 3 câu
-- hỏi trực tiếp sau khi test thực tế phát hiện thiếu). Thêm 3 action mới,
-- KHÔNG có trong phạm vi gốc §1.11 — xem CONSTITUTION §1.11 mục mở rộng lần
-- 2 (18/08/2026) để biết đầy đủ lý do quyết định.
--
--   1. action='transaction.update' — AFTER UPDATE trên transactions, MỌI
--      lần sửa 1 giao dịch hộ gia đình (không phân biệt sửa gì) đều báo cho
--      thành viên còn lại. CHỈ hộ gia đình (giống transaction.create, sổ cá
--      nhân không có ai khác để báo). Loại trừ 2 nhánh UPDATE đã có trigger
--      riêng: soft-delete (deleted_at null->not null) và phục hồi
--      (deleted_at not null->null, nếu sau này có tính năng khôi phục giao
--      dịch) — không double-fire với `trg_activity_transaction_soft_delete`.
--   2. action='category.budget_created' — AFTER INSERT OR UPDATE OF
--      limit_amount trên categories, edge-triggered (chỉ bắn lần ĐẦU TIÊN
--      category có hạn mức — từ null sang có giá trị, không bắn lại mỗi
--      lần chỉnh sửa số tiền hạn mức sau đó). CHỈ hộ gia đình.
--   3. action='goal.contribution' — MỞ RỘNG hàm
--      log_transaction_create_activity() đã có ở 0030: giao dịch
--      type='transfer' có goal_id (góp quỹ) sinh thông báo RIÊNG, chi tiết
--      hơn ("đã góp X vào mục tiêu Y"), THAY THẾ transaction.create chung
--      chung cho đúng giao dịch đó (tránh bắn 2 thông báo trùng lặp cho
--      cùng 1 hành động). Áp dụng CẢ 2 SCOPE (khác 2 mục trên) — góp quỹ cá
--      nhân cũng đáng được xác nhận lại, không chỉ hộ gia đình.

begin;

-- =========================================================
-- 1. transaction.update — sửa giao dịch hộ gia đình
-- =========================================================
create or replace function public.log_transaction_update_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_name text;
begin
  -- Loại trừ nhánh soft-delete/phục hồi (đã có trigger riêng xử lý) — chỉ
  -- xử lý sửa THẬT SỰ trong lúc giao dịch vẫn đang active ở cả 2 đầu.
  if old.deleted_at is not null or new.deleted_at is not null then
    return new;
  end if;

  if new.household_id is null then
    return new;
  end if;

  select name into v_actor_name from public.profiles where id = new.member_id;

  insert into public.activity_log (household_id, actor_id, action, entity_type, entity_id, message, source)
  values (
    new.household_id, new.member_id, 'transaction.update', 'transaction', new.id,
    coalesce(v_actor_name, 'Một thành viên') || ' đã sửa giao dịch "' || new.description || '" ('
      || to_char(new.amount, 'FM999,999,999,999') || ' ₫)',
    'system'
  );

  return new;
end;
$$;

create trigger trg_activity_transaction_update
after update on public.transactions
for each row
when (
  old.deleted_at is null and new.deleted_at is null
  and old is distinct from new
)
execute function public.log_transaction_update_activity();

-- =========================================================
-- 2. category.budget_created — đặt ngân sách mới cho 1 category (lần đầu)
-- =========================================================
create or replace function public.log_category_budget_created_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_actor_name text;
begin
  if new.household_id is null then
    return new;
  end if;
  if new.limit_amount is null then
    return new;
  end if;
  -- Edge-triggered: chỉ bắn lần ĐẦU TIÊN có hạn mức, không bắn lại mỗi lần
  -- sửa số tiền hạn mức sau đó (giống nguyên tắc budget.exceeded ở 0030).
  if tg_op = 'UPDATE' and old.limit_amount is not null then
    return new;
  end if;

  v_actor := coalesce(new.created_by, auth.uid());
  select name into v_actor_name from public.profiles where id = v_actor;

  insert into public.activity_log (household_id, actor_id, action, entity_type, entity_id, message, source)
  values (
    new.household_id, v_actor, 'category.budget_created', 'category', new.id,
    coalesce(v_actor_name, 'Một thành viên') || ' đã đặt ngân sách cho danh mục "' || new.name || '" ('
      || to_char(new.limit_amount, 'FM999,999,999,999') || ' ₫/tháng)',
    'system'
  );

  return new;
end;
$$;

create trigger trg_activity_category_budget_created
after insert or update of limit_amount on public.categories
for each row
when (new.limit_amount is not null)
execute function public.log_category_budget_created_activity();

-- =========================================================
-- 3. goal.contribution — mở rộng log_transaction_create_activity() (0030)
--    để tách riêng thông báo góp quỹ, thay vì dùng chung
--    transaction.create; áp dụng CẢ 2 scope (cá nhân lẫn hộ gia đình).
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
  v_goal_name text;
  v_goal_owner uuid;
  v_goal_household uuid;
  v_actor uuid;
begin
  if new.deleted_at is not null then
    return new;
  end if;

  -- (goal.contribution) Góp quỹ tiết kiệm — type='transfer' + goal_id, áp
  -- dụng cả 2 scope, THAY THẾ transaction.create chung chung cho đúng giao
  -- dịch này (tránh bắn trùng 2 thông báo cho cùng 1 hành động).
  if new.type = 'transfer' and new.goal_id is not null then
    select name, owner_id, household_id into v_goal_name, v_goal_owner, v_goal_household
      from public.saving_goals where id = new.goal_id;

    if v_goal_name is not null then
      v_actor := coalesce(new.member_id, new.owner_id);
      select name into v_actor_name from public.profiles where id = v_actor;

      insert into public.activity_log (owner_id, household_id, actor_id, action, entity_type, entity_id, message, source)
      values (
        v_goal_owner, v_goal_household, v_actor,
        'goal.contribution', 'saving_goal', new.goal_id,
        coalesce(v_actor_name, 'Một thành viên') || ' đã góp ' || to_char(new.amount, 'FM999,999,999,999')
          || ' ₫ vào mục tiêu "' || v_goal_name || '"',
        'system'
      );
    end if;

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

-- (Không cần tạo lại trigger trg_activity_transaction_create — đã trỏ đúng
-- tên hàm này từ 0030, create or replace ở trên đủ để áp dụng logic mới.)

commit;
