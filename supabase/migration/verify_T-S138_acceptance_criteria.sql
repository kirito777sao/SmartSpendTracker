-- =========================================================
-- verify_T-S138_acceptance_criteria.sql
-- Chạy TAY trong Supabase SQL Editor (project thật) để đối chiếu đúng 5
-- kịch bản Acceptance Criteria ghi ở TASKS.md T-S138, SAU KHI đã apply
-- migration 0037_auto_contribution_schema.sql.
--
-- Cách dùng: chạy TỪNG KHỐI một (không chạy nguyên file 1 lần), đọc kết
-- quả SELECT sau mỗi khối trước khi qua khối kế tiếp. Thay :owner_id bằng
-- đúng uuid profile cá nhân bạn đang test (auth.uid() của user đang đăng
-- nhập trong SQL Editor, hoặc lấy từ `select id from public.profiles
-- where email = '...'`). Không chạy trên production đang có dữ liệu thật
-- của người dùng khác — nên test bằng 1 tài khoản/1 goal riêng, hoặc trên
-- project staging.
-- =========================================================

-- 0. CHUẨN BỊ: tạo 1 goal thủ công (không linked_category_id) để test.
-- Copy uuid trả về, dùng lại cho các bước sau (thay :goal_id).
insert into public.saving_goals (owner_id, name, target_amount, created_by)
values (:owner_id, 'TEST T-S138 — xoá sau khi test xong', 10000000, :owner_id)
returning id as goal_id;

-- =========================================================
-- KỊCH BẢN 1 — fixed 500k, thu 2tr → trích đúng 500k
-- =========================================================
select public.create_auto_contribution_config(
  :goal_id, 'on_income', 'fixed', 500000
) as config_id_1;

select public.toggle_auto_contribution_config(:config_id_1, true);

insert into public.transactions (owner_id, type, description, amount, date, source)
values (:owner_id, 'income', 'TEST kịch bản 1', 2000000, current_date, 'web')
returning id as income_tx_id_1;

-- Kỳ vọng: 1 dòng type='transfer', amount=500000, goal_id đúng, applied.
select id, type, amount, goal_id from public.transactions
where note like '%' || :income_tx_id_1 || '%';
select status, computed_amount from public.auto_contribution_log
where triggered_by_transaction_id = :income_tx_id_1;
-- current_amount của goal phải = 500000
select current_amount from public.saving_goals where id = :goal_id;
-- phải có 1 dòng activity_log action='goal.auto_contribution'
select action, message from public.activity_log
where entity_id in (select id from public.transactions where note like '%' || :income_tx_id_1 || '%');

select public.toggle_auto_contribution_config(:config_id_1, false);

-- =========================================================
-- KỊCH BẢN 2 — percent 10%, thu 3tr → trích đúng 300k (làm tròn)
-- =========================================================
select public.update_auto_contribution_config(:config_id_1, 'on_income', 'percent', 10);
select public.toggle_auto_contribution_config(:config_id_1, true);

insert into public.transactions (owner_id, type, description, amount, date, source)
values (:owner_id, 'income', 'TEST kịch bản 2', 3000000, current_date, 'web')
returning id as income_tx_id_2;

select amount from public.transactions
where note like '%' || :income_tx_id_2 || '%'; -- kỳ vọng 300000

select public.toggle_auto_contribution_config(:config_id_1, false);

-- =========================================================
-- KỊCH BẢN 3 — cấu hình 5tr cố định, thu chỉ 2tr → KHÔNG tạo giao dịch,
-- log status='skipped_insufficient', activity_log có cảnh báo hiện thật.
-- =========================================================
select public.update_auto_contribution_config(:config_id_1, 'on_income', 'fixed', 5000000);
select public.toggle_auto_contribution_config(:config_id_1, true);

insert into public.transactions (owner_id, type, description, amount, date, source)
values (:owner_id, 'income', 'TEST kịch bản 3', 2000000, current_date, 'web')
returning id as income_tx_id_3;

-- Kỳ vọng: KHÔNG có dòng transfer nào liên quan.
select count(*) as phai_bang_0 from public.transactions
where note like '%' || :income_tx_id_3 || '%';
-- Kỳ vọng: 1 dòng status='skipped_insufficient'.
select status, skip_reason from public.auto_contribution_log
where triggered_by_transaction_id = :income_tx_id_3;
-- Kỳ vọng: 1 dòng activity_log action='goal.auto_contribution_skipped'
-- (đây chính là "cảnh báo hiện thật" — phải xuất hiện, không chỉ nằm câm
-- trong auto_contribution_log).
select action, message from public.activity_log
where entity_id = :income_tx_id_3 and action = 'goal.auto_contribution_skipped';

select public.toggle_auto_contribution_config(:config_id_1, false);

-- =========================================================
-- KỊCH BẢN 4 — tắt config → ghi income mới → KHÔNG tự trích, giao dịch
-- trích cũ (kịch bản 1) vẫn còn nguyên.
-- =========================================================
-- (config đã tắt ở cuối kịch bản 3, giữ nguyên trạng thái tắt)
insert into public.transactions (owner_id, type, description, amount, date, source)
values (:owner_id, 'income', 'TEST kịch bản 4', 5000000, current_date, 'web')
returning id as income_tx_id_4;

select count(*) as phai_bang_0 from public.transactions
where note like '%' || :income_tx_id_4 || '%';
-- Giao dịch transfer của kịch bản 1 vẫn phải còn nguyên (không bị xoá/rollback):
select id, amount, deleted_at from public.transactions
where note like '%' || :income_tx_id_1 || '%';

-- =========================================================
-- KỊCH BẢN 5 — 2 khoản thu insert gần như đồng thời → mỗi khoản trích
-- đúng theo đúng số của chính nó (không lệch/không mất).
-- Test tay: mở 2 tab SQL Editor, bật lại config fixed 100000, rồi chạy
-- gần như cùng lúc ở 2 tab:
-- =========================================================
select public.update_auto_contribution_config(:config_id_1, 'on_income', 'fixed', 100000);
select public.toggle_auto_contribution_config(:config_id_1, true);

-- TAB A:
insert into public.transactions (owner_id, type, description, amount, date, source)
values (:owner_id, 'income', 'TEST kịch bản 5 - tab A', 1000000, current_date, 'web')
returning id as income_tx_id_5a;
-- TAB B (chạy gần như cùng lúc với TAB A):
insert into public.transactions (owner_id, type, description, amount, date, source)
values (:owner_id, 'income', 'TEST kịch bản 5 - tab B', 2000000, current_date, 'web')
returning id as income_tx_id_5b;

-- Kỳ vọng: mỗi khoản có ĐÚNG 1 dòng transfer 100000 riêng, không trùng/mất.
select id, amount, note from public.transactions
where note like '%' || :income_tx_id_5a || '%' or note like '%' || :income_tx_id_5b || '%';

select public.toggle_auto_contribution_config(:config_id_1, false);

-- =========================================================
-- DỌN DẸP sau khi test xong (xoá sạch dữ liệu test, không để lẫn dữ liệu
-- thật của người dùng):
-- =========================================================
-- select public.delete_auto_contribution_config(:config_id_1);
-- select public.delete_goal(:goal_id); -- soft-delete goal test + toàn bộ giao dịch liên quan theo đúng cơ chế sẵn có
