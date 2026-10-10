-- =========================================================
-- verify_T-S140_acceptance_criteria.sql
-- Chạy TAY trong Supabase SQL Editor (project thật) SAU KHI đã apply
-- migration 0038_auto_contribution_monthly_schedule.sql (bản đã sửa
-- 26/08/2026 — có DROP FUNCTION overload cũ + chặn category.type).
--
-- Cách dùng: chạy TỪNG KHỐI một, đọc kết quả SELECT trước khi qua khối kế
-- tiếp. Thay :owner_id bằng uuid profile cá nhân bạn đang test. Dùng 1
-- tài khoản/dữ liệu riêng để test, không chạy trên dữ liệu người dùng
-- khác. RPC run_monthly_auto_contributions() được gọi TRỰC TIẾP ở đây
-- (không cần chờ pg_cron/nửa đêm) — đúng cách test tay đã ghi ở AC gốc.
-- =========================================================

-- =========================================================
-- BƯỚC 0 — Xác nhận KHÔNG còn overload cũ của create_auto_contribution_config
-- Kỳ vọng: ĐÚNG 1 dòng, chữ ký có 6 tham số (kết thúc bằng category_id uuid).
-- Nếu ra 2 dòng -> migration 0038 (bản có DROP FUNCTION) CHƯA được apply
-- đúng, DỪNG LẠI, không chạy tiếp các bước dưới.
-- =========================================================
select oid::regprocedure
from pg_proc
where proname = 'create_auto_contribution_config';

-- =========================================================
-- BƯỚC 0b — Chuẩn bị dữ liệu test
-- =========================================================
insert into public.saving_goals (owner_id, name, target_amount, created_by)
values (:owner_id, 'TEST T-S140 — goal, xoá sau khi test xong', 10000000, :owner_id)
returning id as goal_id_140;

insert into public.categories (owner_id, name, icon, type, created_by)
values (:owner_id, 'TEST T-S140 — category chi tiêu', '💰', 'expense', :owner_id)
returning id as expense_cat_id_140;

insert into public.categories (owner_id, name, icon, type, created_by)
values (:owner_id, 'TEST T-S140 — category thu nhập', '💵', 'income', :owner_id)
returning id as income_cat_id_140;

-- =========================================================
-- KỊCH BẢN 1 — chặn category type='income' (bugfix "cả (a)+(b)" 26/08/2026)
-- Kỳ vọng: RPC raise exception, KHÔNG tạo được config.
-- =========================================================
select public.create_auto_contribution_config(
  p_goal_id := null,
  p_trigger_type := 'monthly_schedule',
  p_amount_type := 'fixed',
  p_amount_value := 100000,
  p_day_of_month := 5,
  p_category_id := :income_cat_id_140
); -- kỳ vọng lỗi: "Chỉ áp dụng trích tự động cho danh mục CHI TIÊU..."

-- =========================================================
-- KỊCH BẢN 2 — target category_id hợp lệ + trigger_type sai (on_income)
-- Kỳ vọng: RPC raise exception (chk_category_only_monthly / check ở RPC).
-- =========================================================
select public.create_auto_contribution_config(
  p_goal_id := null,
  p_trigger_type := 'on_income',
  p_amount_type := 'fixed',
  p_amount_value := 100000,
  p_day_of_month := null,
  p_category_id := :expense_cat_id_140
); -- kỳ vọng lỗi: "Trích tự động vào danh mục ngân sách chỉ hỗ trợ lịch cố định hàng tháng."

-- =========================================================
-- KỊCH BẢN 3 — target goal_id, monthly_schedule, ngày 31, tháng chạy thử
-- chỉ có 30 ngày (hoặc 28/29 nếu test vào tháng 2) -> fallback chạy đúng
-- ngày cuối tháng, không skip/lỗi.
-- LƯU Ý: sửa day_of_month bên dưới thành 31 rồi kiểm tra current_date có
-- đúng là ngày cuối tháng của tháng hiện tại hay không trước khi kỳ vọng
-- kịch bản này chạy (nếu hôm nay không phải ngày cuối tháng, dòng RPC gọi
-- tay ở cuối kịch bản 3 vẫn chạy được nhưng sẽ KHÔNG match config này —
-- test đúng nghĩa "ngày 31 fallback" cần chạy vào đúng ngày cuối tháng).
-- =========================================================
insert into public.transactions (owner_id, type, description, amount, date, source)
values (:owner_id, 'income', 'TEST T-S140 nạp trước để có Số dư luỹ kế', 5000000, current_date, 'web');

select public.create_auto_contribution_config(
  p_goal_id := :goal_id_140,
  p_trigger_type := 'monthly_schedule',
  p_amount_type := 'fixed',
  p_amount_value := 200000,
  p_day_of_month := 31,
  p_category_id := null
) as config_id_goal_140;

select public.toggle_auto_contribution_config(:config_id_goal_140, true);

-- Gọi trực tiếp thay vì chờ pg_cron:
select public.run_monthly_auto_contributions();

-- Kỳ vọng (nếu hôm nay là ngày cuối tháng, hoặc day_of_month<=số ngày
-- tháng này): 1 dòng transfer 200000 vào goal, current_amount goal +200000.
select id, type, amount, goal_id from public.transactions
where goal_id = :goal_id_140 and note like '%cấu hình #' || :config_id_goal_140 || '%';
select current_amount from public.saving_goals where id = :goal_id_140;
select status, computed_amount from public.auto_contribution_log
where config_id = :config_id_goal_140;

select public.toggle_auto_contribution_config(:config_id_goal_140, false);

-- =========================================================
-- KỊCH BẢN 4 — target category_id, monthly_schedule, percent 10% trên
-- tổng thu nhập THÁNG TRƯỚC (không phải tháng đang chạy dở).
-- LƯU Ý: cần có sẵn giao dịch income ở THÁNG TRƯỚC để có số > 0; nếu
-- project test chưa có, insert thêm 1 dòng income với date lùi lại đúng
-- tháng trước rồi mới chạy khối này.
-- =========================================================
select public.create_auto_contribution_config(
  p_goal_id := null,
  p_trigger_type := 'monthly_schedule',
  p_amount_type := 'percent',
  p_amount_value := 10,
  p_day_of_month := extract(day from current_date)::int, -- để khớp chạy ngay hôm nay
  p_category_id := :expense_cat_id_140
) as config_id_cat_140;

select public.toggle_auto_contribution_config(:config_id_cat_140, true);
select public.run_monthly_auto_contributions();

-- Kỳ vọng: 1 dòng type='expense', category_id đúng, amount = round(10% *
-- tổng income tháng trước). So sánh thủ công với:
select coalesce(sum(amount), 0) as thu_nhap_thang_truoc
from public.transactions
where owner_id = :owner_id and type = 'income' and deleted_at is null
  and date >= date_trunc('month', current_date) - interval '1 month'
  and date <  date_trunc('month', current_date);

select id, type, amount, category_id from public.transactions
where category_id = :expense_cat_id_140
  and note like '%cấu hình #' || :config_id_cat_140 || '%';

-- category liên kết goal (nếu có) phải tự cộng đúng qua SUM sẵn có (§1.13)
-- — chỉ verify được nếu bạn đã link :expense_cat_id_140 vào 1 goal khác
-- trước đó; bỏ qua nếu chưa setup.

select public.toggle_auto_contribution_config(:config_id_cat_140, false);

-- =========================================================
-- KỊCH BẢN 5 — Số dư luỹ kế KHÔNG đủ -> skip, KHÔNG tạo giao dịch nào,
-- có dòng skipped_insufficient + activity_log cảnh báo.
-- =========================================================
select public.update_auto_contribution_config(
  :config_id_goal_140, 'monthly_schedule', 'fixed', 999999999, extract(day from current_date)::int
);
select public.toggle_auto_contribution_config(:config_id_goal_140, true);
select public.run_monthly_auto_contributions();

select count(*) as phai_bang_0 from public.transactions
where goal_id = :goal_id_140 and amount = 999999999;
select status, skip_reason from public.auto_contribution_log
where config_id = :config_id_goal_140 order by created_at desc limit 1;
select action, message from public.activity_log
where entity_id = :goal_id_140 and action = 'goal.auto_contribution_skipped'
order by created_at desc limit 1;

select public.toggle_auto_contribution_config(:config_id_goal_140, false);

-- =========================================================
-- DỌN DẸP SAU KHI TEST XONG (tuỳ chọn — xoá sạch dữ liệu test)
-- =========================================================
-- delete from public.auto_contribution_configs where goal_id = :goal_id_140 or category_id in (:expense_cat_id_140, :income_cat_id_140);
-- update public.saving_goals set deleted_at = now() where id = :goal_id_140;
-- update public.categories set deleted_at = now() where id in (:expense_cat_id_140, :income_cat_id_140);
