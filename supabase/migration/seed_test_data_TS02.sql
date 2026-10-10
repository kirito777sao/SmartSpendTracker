-- =========================================================
-- Seed test data cho T-S02 (RLS verification)
-- CHẠY SAU 0001 + 0002. Chỉ dùng để test, không phải seed production.
-- Bước 1: Vào Authentication → Add user, tạo 2 user thật:
--   user_a@test.com  → lấy id, gán vào :a_id bên dưới
--   user_b@test.com  → lấy id, gán vào :b_id bên dưới
-- Bước 2: Thay 2 giá trị <A_ID> và <B_ID> bằng uuid thật, chạy toàn bộ file.
-- =========================================================

do $$
declare
  a_id uuid := '<A_ID>';   -- thay bằng id thật của user_a
  b_id uuid := '<B_ID>';   -- thay bằng id thật của user_b
  hh_id uuid := gen_random_uuid();
  cat_personal_a uuid := gen_random_uuid();
  cat_household uuid := gen_random_uuid();
  goal_personal_b uuid := gen_random_uuid();
  goal_household uuid := gen_random_uuid();
begin

  -- 1) household: A là chủ hộ
  insert into public.households (id, name, invite_code, owner_id)
  values (hh_id, 'Nhà Test', 'TEST01', a_id);

  -- 2) gán A = owner, B = member (thay cho RPC join_household chưa có ở T-S03)
  update public.profiles set household_id = hh_id, household_role = 'owner' where id = a_id;
  update public.profiles set household_id = hh_id, household_role = 'member' where id = b_id;

  -- 3) categories: 1 cá nhân (A), 1 hộ gia đình
  insert into public.categories (id, owner_id, name, icon, created_by)
  values (cat_personal_a, a_id, 'Ăn uống cá nhân (A)', '🍜', a_id);

  insert into public.categories (id, household_id, name, icon, limit_amount, created_by)
  values (cat_household, hh_id, 'Ăn uống chung', '🍚', 3000000, a_id);

  -- 4) saving_goals: 1 cá nhân (B), 1 hộ gia đình
  insert into public.saving_goals (id, owner_id, name, target_amount, created_by)
  values (goal_personal_b, b_id, 'Mua laptop (B)', 20000000, b_id);

  insert into public.saving_goals (id, household_id, name, target_amount, created_by)
  values (goal_household, hh_id, 'Du lịch hè', 15000000, a_id);

  -- 5) transactions — 5 dòng, mỗi dòng test 1 tình huống RLS khác nhau
  -- (a) cá nhân của A — B KHÔNG được thấy
  insert into public.transactions (owner_id, type, description, amount, date, category_id)
  values (a_id, 'expense', 'Cà phê sáng (cá nhân A)', 25000, current_date, cat_personal_a);

  -- (b) cá nhân của B — A KHÔNG được thấy
  insert into public.transactions (owner_id, type, description, amount, date)
  values (b_id, 'expense', 'Sách (cá nhân B)', 150000, current_date);

  -- (c) hộ gia đình, do A (owner) tạo — cả A và B đều thấy
  insert into public.transactions (household_id, member_id, type, description, amount, date, category_id)
  values (hh_id, a_id, 'expense', 'Đi chợ (hộ, A tạo)', 200000, current_date, cat_household);

  -- (d) hộ gia đình, do B (member) tạo — cả A và B đều thấy
  insert into public.transactions (household_id, member_id, type, description, amount, date, category_id, goal_id)
  values (hh_id, b_id, 'income', 'Góp quỹ du lịch (hộ, B tạo)', 500000, current_date, null, goal_household);

  -- (e) hộ gia đình, đã soft-delete — KHÔNG ai được thấy qua SELECT policy (deleted_at is null)
  insert into public.transactions (household_id, member_id, type, description, amount, date, deleted_at)
  values (hh_id, a_id, 'expense', 'Giao dịch lỗi đã xoá (hộ)', 999000, current_date, now());

  raise notice 'Seed xong. household_id = %', hh_id;
end $$;

-- =========================================================
-- Test queries — chạy lần lượt, đối chiếu đúng kỳ vọng ghi kèm
-- =========================================================

-- Đếm tổng để soát seed đã vào đủ 10 dòng nghiệp vụ (1 household + 2 category + 2 goal + 5 transaction)
select
  (select count(*) from public.households where invite_code = 'TEST01') as households,
  (select count(*) from public.categories where name in ('Ăn uống cá nhân (A)','Ăn uống chung')) as categories,
  (select count(*) from public.saving_goals where name in ('Mua laptop (B)','Du lịch hè')) as goals,
  (select count(*) from public.transactions where description like '%(A)%' or description like '%(B)%' or description like '%(hộ%') as transactions;
-- Kỳ vọng: 1, 2, 2, 5

-- ---- Đóng vai A, kiểm tra RLS ----
-- set role authenticated; set request.jwt.claim.sub = '<A_ID>';
select description from public.transactions order by created_at;
-- Kỳ vọng A thấy: "Cà phê sáng (cá nhân A)", "Đi chợ (hộ, A tạo)", "Góp quỹ du lịch (hộ, B tạo)"
-- KHÔNG thấy: "Sách (cá nhân B)", "Giao dịch lỗi đã xoá (hộ)"

update public.categories set limit_amount = 9999999 where name = 'Ăn uống chung' returning id, limit_amount;
-- A là owner → kỳ vọng trả về đúng 1 dòng (limit_amount = 9999999)

-- ---- Đóng vai B, kiểm tra RLS ----
-- set request.jwt.claim.sub = '<B_ID>';
select description from public.transactions order by created_at;
-- Kỳ vọng B thấy: "Sách (cá nhân B)", "Đi chợ (hộ, A tạo)", "Góp quỹ du lịch (hộ, B tạo)"
-- KHÔNG thấy: "Cà phê sáng (cá nhân A)", "Giao dịch lỗi đã xoá (hộ)"

update public.categories set limit_amount = 1 where name = 'Ăn uống chung' returning id, limit_amount;
-- B là member, không phải owner → kỳ vọng KHÔNG trả về dòng nào (RLS chặn, không phải lỗi cứng)

update public.transactions set description = 'Sửa bởi B' where description = 'Đi chợ (hộ, A tạo)' returning id, description;
-- Giao dịch này member_id = A, B không khớp "member_id=auth.uid()" và không phải owner
-- → kỳ vọng KHÔNG trả về dòng nào
