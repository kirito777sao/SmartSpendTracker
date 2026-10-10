-- =========================================================
-- 0041_category_budget_periods.sql
-- T-S158 (CHỐT 01/09/2026, hướng A — theo xác nhận trực tiếp người yêu cầu)
--
-- GAP GỐC (xem TASKS.md T-S158, src/types.ts:64): `categories.limit_amount`
-- KHÔNG có khái niệm "tháng áp dụng" — 1 category chỉ có đúng 1 hạn mức
-- sống mãi. Toggle `is_recurring` chỉ đổi badge/filter hiển thị ở
-- BudgetLimits.tsx, KHÔNG có tác dụng chức năng thật nào — hạn mức tạo
-- tháng trước, KHÔNG bật lặp lại, vẫn tồn tại nguyên vẹn sang tháng sau
-- (đúng bug người dùng báo).
--
-- HƯỚNG A ĐÃ CHỐT: thêm bảng `category_budget_periods` (category_id,
-- year_month, limit_amount) — giữ được lịch sử hạn mức từng tháng cho báo
-- cáo sau này (đổi schema nhiều hơn hướng B, nhưng KHÔNG mất dữ liệu quá
-- khứ khi is_recurring=false hết hạn).
--
-- CƠ CHẾ (đọc kỹ trước khi dùng RPC `get_effective_categories` ở nơi gọi):
--   - `categories.limit_amount`/`is_recurring` VẪN GIỮ NGUYÊN Ý NGHĨA làm
--     "mẫu" (template): đây là giá trị người dùng set/sửa gần nhất qua UI
--     (BudgetLimits.tsx/SmartAllocator.tsx — KHÔNG đổi code ghi ở các file
--     này, trigger bên dưới tự đồng bộ).
--   - Mỗi khi `categories.limit_amount` được INSERT/UPDATE (khác null),
--     trigger `trg_sync_category_budget_period` tự upsert 1 dòng
--     `category_budget_periods` cho ĐÚNG tháng hiện tại (giờ VN) — đây
--     chính là "tháng tạo/tháng sửa" theo đúng nghĩa AC đã chốt.
--   - Đọc hạn mức ÁP DỤNG cho 1 tháng cụ thể PHẢI qua RPC
--     `get_effective_categories(p_owner_id, p_household_id, p_year_month)`
--     (year_month NULL = tháng hiện tại), KHÔNG đọc thẳng
--     `categories.limit_amount` nữa ở bất kỳ nơi nào cần "hạn mức đang áp
--     dụng" (BudgetLimits.tsx list/badge, FinancialDashboard.tsx widget,
--     telegram-webhook budget_remaining — các thay đổi code tương ứng là
--     T-S158b/c/d, TÁCH RIÊNG task, CHƯA làm ở migration này).
--   - Khi đọc tháng HIỆN TẠI và category `is_recurring=true` nhưng CHƯA có
--     dòng period cho tháng đó: RPC tự "vật chất hoá" (materialize) —
--     copy hạn mức từ dòng period GẦN NHẤT trước đó (hoặc từ
--     `categories.limit_amount` nếu chưa từng có dòng nào) sang tháng hiện
--     tại. Đây là cách triển khai "tự copy sang tháng mới" đã ghi trong AC
--     gốc, nhưng dùng LAZY MATERIALIZE-ON-READ thay vì cron/pg_cron thật —
--     xem LƯU Ý bên dưới, đây là 1 lựa chọn triển khai, KHÔNG đổi kiến trúc
--     đã chốt.
--   - Khi đọc tháng hiện tại và category `is_recurring=false` mà KHÔNG có
--     dòng period cho tháng đó (đã qua khỏi tháng tạo): trả về
--     `limit_amount = null` — đúng nghĩa "tự ẩn khỏi danh sách Ngân Sách,
--     KHÔNG xoá" (dòng lịch sử tháng cũ trong `category_budget_periods`
--     giữ nguyên, vẫn đọc được khi truy vấn đúng `p_year_month` quá khứ đó
--     cho mục đích báo cáo sau này).
--
-- LƯU Ý (ghi rõ để KHÔNG bị hiểu nhầm là đã làm cron thật): AC gốc T-S158
-- nêu "is_recurring=true → hạn mức tự copy sang tháng mới (cron/job)".
-- Sandbox không có quyền chạy `pg_cron`/verify hành vi cron thật (đúng hạn
-- chế đã ghi nhận từ T-S140 — pg_cron cần người yêu cầu tự bật qua
-- Supabase Dashboard). Chọn LAZY MATERIALIZE-ON-READ (tự tạo dòng period
-- ngay trong RPC đọc, không cần job nền riêng) vì: (1) không phụ thuộc
-- pg_cron phải được bật thủ công, (2) kết quả tương đương — tháng hiện tại
-- LUÔN có dòng period đúng ngay khi có bất kỳ ai đọc (web hoặc bot), (3) dễ
-- verify tĩnh hơn cron chạy nền. Nếu người yêu cầu vẫn muốn cron thật chạy
-- độc lập không phụ thuộc lượt đọc nào (vd để báo cáo/notify đầu tháng),
-- đây là ASK FIRST riêng — chưa làm ở migration này, có thể bổ sung sau
-- bằng 1 migration riêng (`select cron.schedule(...)`) mà không cần đổi gì
-- ở RPC/trigger đã có tại đây.
-- =========================================================

begin;

-- =========================================================
-- 1. Bảng category_budget_periods — lưu lịch sử hạn mức theo từng tháng
-- =========================================================
create table if not exists public.category_budget_periods (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories(id) on delete cascade,
  year_month text not null, -- 'YYYY-MM', giờ VN (Asia/Ho_Chi_Minh), khớp quy ước sẵn có ở telegram-webhook (todayVN)
  limit_amount numeric not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_year_month_format check (year_month ~ '^\d{4}-\d{2}$'),
  constraint uq_category_budget_period unique (category_id, year_month)
);

comment on table public.category_budget_periods is
  'T-S158/§5 (CHỐT hướng A) — snapshot hạn mức ngân sách theo TỪNG THÁNG cho '
  '1 category, giữ lịch sử cho báo cáo. category_id + year_month là khoá tự '
  'nhiên (UNIQUE). Không đọc/ghi trực tiếp từ client — luôn qua trigger '
  'trg_sync_category_budget_period (ghi) hoặc RPC get_effective_categories '
  '(đọc), xem chi tiết đầu file 0041.';

create index if not exists idx_category_budget_periods_category_month
  on public.category_budget_periods (category_id, year_month desc);

-- RLS bật nhưng KHÔNG thêm policy nào — chặn hoàn toàn truy cập trực tiếp
-- qua PostgREST bằng anon/authenticated key (kể cả SELECT), đúng nguyên
-- tắc "hàng rào mặc định deny" đã dùng cho các bảng phụ trợ khác trong dự
-- án. Mọi truy cập PHẢI qua RPC `security definer` bên dưới (đã tự kiểm
-- tra quyền thủ công), hoặc qua SERVICE_ROLE_KEY (Edge Function, tự bypass
-- RLS như các bảng khác).
alter table public.category_budget_periods enable row level security;

-- =========================================================
-- 2. Trigger: mỗi lần categories.limit_amount được set (insert hoặc
--    update, khác null) -> tự upsert dòng period cho ĐÚNG tháng hiện tại
--    (giờ VN). Đây chính là bước ghi "tháng tạo/tháng sửa" — KHÔNG cần đổi
--    code ghi ở BudgetLimits.tsx/SmartAllocator.tsx/services/categories.ts
--    (các nơi đó vẫn UPDATE/INSERT thẳng bảng categories như cũ).
-- =========================================================
create or replace function public.sync_category_budget_period()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year_month text := to_char(now() at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM');
begin
  if NEW.limit_amount is not null and NEW.deleted_at is null then
    insert into public.category_budget_periods (category_id, year_month, limit_amount, updated_at)
    values (NEW.id, v_year_month, NEW.limit_amount, now())
    on conflict (category_id, year_month)
    do update set limit_amount = excluded.limit_amount, updated_at = now();
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_sync_category_budget_period on public.categories;
create trigger trg_sync_category_budget_period
after insert or update of limit_amount on public.categories
for each row
execute function public.sync_category_budget_period();

comment on function public.sync_category_budget_period() is
  'T-S158 — tự ghi/cập nhật category_budget_periods cho THÁNG HIỆN TẠI mỗi '
  'khi categories.limit_amount được set khác null. Không đụng is_recurring '
  '(cờ đó chỉ ảnh hưởng bước materialize-forward ở get_effective_categories, '
  'không cần đồng bộ ngay lúc ghi).';

-- =========================================================
-- 3. Backfill 1 lần: category ĐANG CÓ limit_amount (tạo trước migration
--    này) -> đảm bảo có dòng period cho THÁNG HIỆN TẠI ngay sau khi apply,
--    tránh hạn mức "biến mất" đột ngột ngay sau migrate trong lúc chờ RPC
--    đọc mới được nối vào code (T-S158b/c/d). Không đụng is_recurring —
--    category is_recurring=false vẫn được backfill đúng 1 lần cho tháng
--    hiện tại (đúng nghĩa "tháng tạo" cho những category tạo TRƯỚC migration
--    này, tháng SAU migration mới bắt đầu áp luật ẩn/không ẩn).
-- =========================================================
insert into public.category_budget_periods (category_id, year_month, limit_amount)
select c.id, to_char(now() at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM'), c.limit_amount
from public.categories c
where c.limit_amount is not null and c.deleted_at is null
on conflict (category_id, year_month) do nothing;

-- =========================================================
-- 4. RPC get_effective_categories — nguồn đọc DUY NHẤT cho "category kèm
--    hạn mức áp dụng đúng 1 tháng cụ thể". p_year_month NULL = tháng hiện
--    tại (giờ VN). Trả thêm template_limit_amount (= categories.limit_amount
--    thô, không qua period) để form sửa (BudgetLimits.tsx) có giá trị
--    pre-fill đúng, tách biệt với limit_amount (giá trị ÁP DỤNG thật, có
--    thể null nếu category đã "hết hạn" theo is_recurring=false).
-- =========================================================
create or replace function public.get_effective_categories(
  p_owner_id uuid default null,
  p_household_id uuid default null,
  p_year_month text default null
)
returns table (
  id uuid,
  name text,
  icon text,
  type text,
  limit_amount numeric,
  is_recurring boolean,
  template_limit_amount numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_month text := to_char(now() at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM');
  v_year_month text := coalesce(p_year_month, v_current_month);
  v_cat record;
  v_period_limit numeric;
  v_carry numeric;
begin
  if v_year_month !~ '^\d{4}-\d{2}$' then
    raise exception 'p_year_month phải đúng định dạng YYYY-MM.';
  end if;

  -- Hàng rào quyền THỦ CÔNG (security definer bypass RLS gốc của
  -- categories) — lặp lại đúng điều kiện policy SELECT đã CHỐT ở
  -- 0002_rls.sql, KHÔNG nới thêm quyền nào: chỉ đọc được sổ CỦA CHÍNH
  -- MÌNH (owner_id = auth.uid()) hoặc sổ hộ MÌNH ĐANG THAM GIA
  -- (is_household_member).
  --
  -- [T-S158b] Hàng rào CHỈ áp dụng khi `auth.uid()` khác null — tức có
  -- JWT người dùng thật (web app, dùng anon/authenticated key). Khi
  -- `auth.uid()` là null (gọi bằng SERVICE_ROLE_KEY, không có JWT — đúng
  -- cách `telegram-webhook` Edge Function đang gọi MỌI bảng khác trong dự
  -- án này, xem comment đầu file `telegram-webhook-*.ts` "SERVICE_ROLE_KEY
  -- ... bypass RLS"), bỏ qua hàng rào — tin tưởng caller ĐÃ tự resolve và
  -- truyền đúng `p_owner_id`/`p_household_id` (đúng mô hình tin cậy nhất
  -- quán đã áp dụng cho MỌI query khác trong `fetchCategoriesFull` cùng
  -- file, không phải lỗ hổng mới). Cho phép RPC này dùng CHUNG cho cả web
  -- app lẫn bot — đúng nguyên tắc "1 công thức, 1 hàm dùng chung" (§5).
  if auth.uid() is not null and not (
    (p_owner_id is not null and p_owner_id = auth.uid())
    or (p_household_id is not null and public.is_household_member(p_household_id))
  ) then
    raise exception 'Không có quyền đọc hạn mức ngân sách của phạm vi này.';
  end if;

  for v_cat in
    select c.id, c.name, c.icon, c.type, c.limit_amount, c.is_recurring
    from public.categories c
    where c.deleted_at is null
      and (
        (p_household_id is not null and c.household_id = p_household_id)
        or (p_household_id is null and c.owner_id = p_owner_id)
      )
  loop
    v_period_limit := null;

    select cbp.limit_amount into v_period_limit
    from public.category_budget_periods cbp
    where cbp.category_id = v_cat.id and cbp.year_month = v_year_month;

    -- Materialize-on-read CHỈ áp dụng khi đang hỏi đúng THÁNG HIỆN TẠI
    -- thật (không vọc dữ liệu khi client truy vấn 1 tháng quá khứ/tương
    -- lai để xem báo cáo — những truy vấn đó phải phản ánh ĐÚNG những gì
    -- đã tồn tại, không được tự bịa thêm dòng).
    if v_period_limit is null and v_cat.is_recurring and v_year_month = v_current_month then
      select cbp2.limit_amount into v_carry
      from public.category_budget_periods cbp2
      where cbp2.category_id = v_cat.id and cbp2.year_month < v_year_month
      order by cbp2.year_month desc
      limit 1;

      if v_carry is null then
        v_carry := v_cat.limit_amount;
      end if;

      if v_carry is not null then
        insert into public.category_budget_periods (category_id, year_month, limit_amount)
        values (v_cat.id, v_year_month, v_carry)
        on conflict (category_id, year_month) do nothing;
        v_period_limit := v_carry;
      end if;
    end if;

    id := v_cat.id;
    name := v_cat.name;
    icon := v_cat.icon;
    type := v_cat.type;
    limit_amount := v_period_limit;
    is_recurring := v_cat.is_recurring;
    template_limit_amount := v_cat.limit_amount;
    return next;
  end loop;
end;
$$;

comment on function public.get_effective_categories(uuid, uuid, text) is
  'T-S158 — nguồn đọc DUY NHẤT cho "category kèm hạn mức áp dụng đúng 1 '
  'tháng". Thay cho select * from categories khi cần limit_amount ÁP DỤNG '
  '(BudgetLimits.tsx/FinancialDashboard.tsx/telegram-webhook budget_remaining, '
  'T-S158b/c/d nối vào code). category KHÔNG có hạn mức áp dụng tháng đó '
  '(is_recurring=false đã qua tháng tạo, hoặc chưa từng đặt hạn mức) -> '
  'limit_amount = null, KHÔNG bị lọc khỏi kết quả (để UI vẫn thấy category '
  'tồn tại, chỉ không có badge hạn mức — quyết định lọc/ẩn hẳn khỏi 1 tab cụ '
  'thể nào là việc của code gọi, không phải RPC này).';

commit;
