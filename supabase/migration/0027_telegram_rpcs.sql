-- =========================================================
-- T-S10 (16/08/2026) — 5 RPC cho Telegram integration mới (4 RPC theo
-- TASKS.md + 1 RPC bổ sung phát hiện khi code, xem mục 5 bên dưới), thay
-- hẳn server.ts §Telegram (mock/localStorage cũ). Theo đúng CONSTITUTION §4
-- (LOCKED): 1 bot dùng chung toàn hệ thống, người gửi phân biệt bằng
-- `profiles.telegram_chat_id` (unique).
--
-- Không cần cột mới — `telegram_chat_id`/`telegram_username`/
-- `telegram_link_token`/`telegram_active_scope` (profiles) và
-- `telegram_batch_id`/`source` (transactions) đã có sẵn từ 0001_init_schema.
--
-- QUYẾT ĐỊNH KỸ THUẬT (ghi rõ vì lệch chữ nghĩa CONSTITUTION §4 mục 4,
-- xem TASKS.md T-S10 để biết đầy đủ lý do): §4 mô tả
-- `add_transactions_via_bot(p_actor uuid, p_text text)` — literal nhận TEXT
-- thô rồi tự "Parse... (rule-first + AI fallback)" bên trong RPC. Không khả
-- thi/không nhất quán với mọi RPC khác trong dự án (thuần SQL/plpgsql, chưa
-- từng có RPC nào tự gọi HTTP ra ngoài) — việc parse (gọi Gemini/Groq/
-- OpenAI/DeepSeek) ĐÃ có sẵn, viết đầy đủ trong Edge Function
-- parse-transaction (T-S09). Quyết định: Edge Function telegram-webhook tự
-- parse text (dùng lại logic dùng chung ở supabase/functions/_shared/),
-- RPC add_transactions_via_bot nhận THẲNG mảng JSONB đã parse sẵn — đúng
-- kết quả cuối (batch_id + ghi đúng scope + activity_log) như mô tả, chỉ
-- khác nơi thực hiện bước parse.
-- =========================================================

-- 1. refresh_telegram_link_token — user tự gọi từ web (auth.uid()), tạo mã
--    liên kết 6 số mới, ghi đè mã cũ (nếu có). Có retry chống trùng mã đang
--    active ở người khác (an toàn hơn, dù xác suất trùng cực thấp).
create or replace function public.refresh_telegram_link_token()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text;
  v_attempts int := 0;
begin
  loop
    v_token := lpad(floor(random() * 1000000)::text, 6, '0');
    exit when not exists (
      select 1 from public.profiles where telegram_link_token = v_token
    );
    v_attempts := v_attempts + 1;
    if v_attempts > 10 then
      raise exception 'Không tạo được mã liên kết duy nhất, thử lại sau.';
    end if;
  end loop;

  update public.profiles
  set telegram_link_token = v_token
  where id = auth.uid();

  return v_token;
end;
$$;

grant execute on function public.refresh_telegram_link_token() to authenticated;


-- 2. link_telegram_account — CHỈ gọi từ Edge Function (service_role), KHÔNG
--    grant cho authenticated: nhận p_chat_id do Telegram cung cấp, không
--    phải thứ 1 user web tự xác thực được là chính mình.
--    Edge case CONSTITUTION §4 bắt buộc: gỡ liên kết cũ nếu chat_id đang
--    gán ở 1 profile KHÁC trước khi gán cho profile đích (tránh vi phạm
--    unique constraint + tránh ghi đè âm thầm).
create or replace function public.link_telegram_account(
  p_token text,
  p_chat_id text,
  p_username text
)
returns table (id uuid, name text, household_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target_id uuid;
  v_target_name text;
  v_target_household uuid;
begin
  select p.id, p.name, p.household_id
  into v_target_id, v_target_name, v_target_household
  from public.profiles p
  where p.telegram_link_token = p_token
  limit 1;

  if v_target_id is null then
    raise exception 'invalid_token';
  end if;

  -- Gỡ liên kết cũ nếu chat_id này đang gán ở 1 profile KHÁC (không phải
  -- đích) — chạy TRƯỚC bước gán mới để không vi phạm unique constraint.
  update public.profiles
  set telegram_chat_id = null, telegram_username = null
  where telegram_chat_id = p_chat_id and id is distinct from v_target_id;

  update public.profiles
  set telegram_chat_id = p_chat_id,
      telegram_username = nullif(p_username, ''),
      telegram_link_token = null
  where id = v_target_id;

  return query select v_target_id, v_target_name, v_target_household;
end;
$$;

grant execute on function public.link_telegram_account(text, text, text) to service_role;


-- 3. add_transactions_via_bot — CHỈ gọi từ Edge Function (service_role).
--    p_items: jsonb array [{ "description": text, "amount": numeric,
--    "category": text, "is_savings": boolean, "savings_goal_name": text }]
--    (đã parse sẵn ở Edge Function, xem quyết định kỹ thuật ở đầu file).
--    Category/goal resolve theo TÊN trong đúng phạm vi scope hiện tại
--    (household hoặc cá nhân của actor) — khớp `resolveCategoryId`/
--    `resolveTransactionType` (toTransactionInsert.ts) nhưng viết lại bằng
--    SQL vì chạy phía server, không có state `categories`/`goals` client.
--    Goal: CHỈ match goal ACTIVE có sẵn theo tên gần đúng (ilike 2 chiều) —
--    KHÔNG tự tạo goal mới nếu không khớp (khác `buildTransactionInserts`
--    ở web, vốn tạo goal mới qua token "new_goal_" do người dùng XÁC NHẬN
--    trên UI — bot không có bước xác nhận tương đương, tự tạo hộ rủi ro
--    sinh nhiều goal rác không mong muốn). Nếu không khớp goal nào, KHÔNG
--    chặn/từ chối ghi sổ — ghi as giao dịch thường (category resolve bình
--    thường, goal_id null), đúng hành vi cũ ở server.ts, và vì CONSTITUTION
--    §1.12 (bắt buộc chọn goal cho khoản liên quan tiết kiệm) là chặn cứng
--    ở TẦNG UI (dropdown), không có UI tương đương qua Telegram (fire-and-
--    forget, không phải form nhiều bước) — ghi nhận đây là khoảng trống đã
--    biết, chưa có task riêng, không tự mở rộng phạm vi vá ở đây.
create or replace function public.add_transactions_via_bot(
  p_actor uuid,
  p_items jsonb
)
returns table (out_batch_id uuid, out_scope text, out_inserted_count int, out_warning text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch_id uuid := gen_random_uuid();
  v_household_id uuid;
  v_scope text;
  v_actor_name text;
  v_item jsonb;
  v_category_id uuid;
  v_category_type text;
  v_goal_id uuid;
  v_warning text := null;
  v_count int := 0;
begin
  select household_id, telegram_active_scope, name
  into v_household_id, v_scope, v_actor_name
  from public.profiles where id = p_actor;

  if not found then
    raise exception 'actor_not_found';
  end if;

  -- Race condition CONSTITUTION §4 mục 4: scope='household' nhưng đã rời hộ
  -- (household_id null) giữa lúc đổi scope và lúc nhắn tin — fallback về
  -- personal, báo rõ trong response để Edge Function nêu trong tin xác nhận.
  if v_scope = 'household' and v_household_id is null then
    v_scope := 'personal';
    v_warning := 'Bạn đã rời hộ gia đình nên khoản này được ghi vào sổ CÁ NHÂN.';
  end if;

  if p_items is null or jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'empty_items';
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_category_id := null;
    v_category_type := null;

    if v_scope = 'household' then
      select id, type into v_category_id, v_category_type
      from public.categories
      where household_id = v_household_id and deleted_at is null
        and name = (v_item->>'category')
      limit 1;
    else
      select id, type into v_category_id, v_category_type
      from public.categories
      where owner_id = p_actor and deleted_at is null
        and name = (v_item->>'category')
      limit 1;
    end if;

    v_goal_id := null;
    if coalesce((v_item->>'is_savings')::boolean, false)
       and coalesce(v_item->>'savings_goal_name', '') <> '' then
      if v_scope = 'household' then
        select id into v_goal_id from public.saving_goals
        where household_id = v_household_id and deleted_at is null and completed_at is null
          and (
            name ilike '%' || (v_item->>'savings_goal_name') || '%'
            or (v_item->>'savings_goal_name') ilike '%' || name || '%'
          )
        order by created_at desc
        limit 1;
      else
        select id into v_goal_id from public.saving_goals
        where owner_id = p_actor and deleted_at is null and completed_at is null
          and (
            name ilike '%' || (v_item->>'savings_goal_name') || '%'
            or (v_item->>'savings_goal_name') ilike '%' || name || '%'
          )
        order by created_at desc
        limit 1;
      end if;
    end if;

    insert into public.transactions (
      owner_id, household_id, member_id, type, description, amount, date, note,
      category_id, goal_id, source, telegram_batch_id
    ) values (
      case when v_scope = 'personal' then p_actor else null end,
      case when v_scope = 'household' then v_household_id else null end,
      case when v_scope = 'household' then p_actor else null end,
      case when v_goal_id is not null then 'transfer' else coalesce(v_category_type, 'expense') end,
      v_item->>'description',
      (v_item->>'amount')::numeric,
      current_date,
      'Nhập tự động qua Telegram Bot',
      v_category_id,
      v_goal_id,
      'telegram',
      v_batch_id
    );
    v_count := v_count + 1;
  end loop;

  insert into public.activity_log (household_id, actor_id, action, entity_type, entity_id, message, source)
  values (
    v_household_id, p_actor, 'transaction.create_via_bot', 'transaction', v_batch_id,
    coalesce(v_actor_name, 'Một thành viên') || ' đã ghi ' || v_count || ' khoản qua Telegram ('
      || case when v_scope = 'household' then 'Hộ gia đình' else 'Cá nhân' end || ')',
    'telegram'
  );

  return query select v_batch_id, v_scope, v_count, v_warning;
end;
$$;

grant execute on function public.add_transactions_via_bot(uuid, jsonb) to service_role;


-- 4. reassign_transaction_scope — CHỈ gọi từ Edge Function (service_role),
--    trigger bởi bấm inline button trên Telegram. Idempotent: bấm lại khi
--    đã đúng scope vẫn chạy được (re-affirm cùng giá trị), không lỗi.
create or replace function public.reassign_transaction_scope(
  p_batch_id uuid,
  p_actor uuid,
  p_new_scope text
)
returns table (out_updated_count int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_household_id uuid;
  v_actor_name text;
  v_count int;
begin
  if p_new_scope not in ('personal', 'household') then
    raise exception 'invalid_scope';
  end if;

  select household_id, name into v_household_id, v_actor_name
  from public.profiles where id = p_actor;

  if not found then
    raise exception 'actor_not_found';
  end if;

  if p_new_scope = 'household' and v_household_id is null then
    raise exception 'no_household';
  end if;

  -- Chỉ chuyển các dòng CÙNG batch VÀ thuộc quyền actor (đang là owner
  -- hoặc đang là member đúng hộ hiện tại) — không cho chuyển batch của
  -- người khác dù trùng UUID đoán được (phòng thủ, dù batch_id là uuid
  -- ngẫu nhiên khó đoán).
  update public.transactions
  set owner_id = case when p_new_scope = 'personal' then p_actor else null end,
      household_id = case when p_new_scope = 'household' then v_household_id else null end,
      member_id = case when p_new_scope = 'household' then p_actor else null end,
      updated_at = now()
  where telegram_batch_id = p_batch_id
    and deleted_at is null
    and (
      owner_id = p_actor
      or (household_id is not distinct from v_household_id and member_id = p_actor)
    );

  get diagnostics v_count = row_count;

  update public.profiles
  set telegram_active_scope = p_new_scope
  where id = p_actor;

  if v_count > 0 then
    insert into public.activity_log (household_id, actor_id, action, entity_type, entity_id, message, source)
    values (
      v_household_id, p_actor, 'transaction.reassign_scope', 'transaction', p_batch_id,
      coalesce(v_actor_name, 'Một thành viên') || ' đã chuyển ' || v_count || ' khoản (Telegram) sang sổ '
        || case when p_new_scope = 'household' then 'HỘ GIA ĐÌNH' else 'CÁ NHÂN' end,
      'telegram'
    );
  end if;

  return query select v_count;
end;
$$;

grant execute on function public.reassign_transaction_scope(uuid, uuid, text) to service_role;


-- 5. unlink_telegram_account — user tự gọi từ web (auth.uid()), tự huỷ liên
--    kết Telegram của CHÍNH MÌNH. Bổ sung ngoài 4 RPC đã liệt kê ở TASKS.md
--    T-S10 — phát hiện khi code: `database.types.ts` (T-S12 hardening) CỐ
--    Ý không cho `telegram_chat_id` xuất hiện trong `profiles.Update` (chỉ
--    được ghi qua RPC, tránh client tự gán chat_id bất kỳ) — unlink (tự xoá
--    liên kết CỦA MÌNH) hợp lệ về nghiệp vụ nhưng cần đi đúng đường RPC như
--    mọi thay đổi telegram_chat_id khác, không phải ngoại lệ update thẳng.
create or replace function public.unlink_telegram_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
  set telegram_chat_id = null, telegram_username = null
  where id = auth.uid();
end;
$$;

grant execute on function public.unlink_telegram_account() to authenticated;
