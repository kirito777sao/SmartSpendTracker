-- =========================================================
-- T-S02 verify v2 — sửa 2 lỗi phát hiện ở lượt test trước:
-- (1) dòng "set role/jwt" từng bị để dạng comment → test chạy bằng
--     postgres superuser (bypass RLS) mà không ai nhận ra.
-- (2) pattern đếm '%(A)%' / '%(B)%' sai vì text thật là "(cá nhân A)".
-- Mỗi block dưới đây TỰ ĐỦ (role switch + query trong cùng 1 lần bấm Run),
-- không tách dòng riêng để tránh bị comment nhầm lần nữa.
-- Thay <A_ID> / <B_ID> / <HH_ID> bằng giá trị thật trước khi chạy.
-- =========================================================

-- ---- Đếm lại cho đúng (sửa pattern) ----
select
  (select count(*) from public.households where invite_code = 'TEST01') as households,
  (select count(*) from public.categories where name in ('Ăn uống cá nhân (A)','Ăn uống chung')) as categories,
  (select count(*) from public.saving_goals where name in ('Mua laptop (B)','Du lịch hè')) as goals,
  (select count(*) from public.transactions where description in (
    'Cà phê sáng (cá nhân A)','Sách (cá nhân B)','Đi chợ (hộ, A tạo)',
    'Góp quỹ du lịch (hộ, B tạo)','Giao dịch lỗi đã xoá (hộ)'
  )) as transactions;
-- Kỳ vọng: 1, 2, 2, 5

-- =========================================================
-- TEST A1 — A đọc transactions (chạy nguyên block này 1 lần Run)
-- =========================================================
set local role authenticated;
set local request.jwt.claim.sub = '<A_ID>';
select description from public.transactions order by created_at;
-- Kỳ vọng CHỈ 3 dòng: "Cà phê sáng (cá nhân A)", "Đi chợ (hộ, A tạo)", "Góp quỹ du lịch (hộ, B tạo)"
-- Nếu thấy "Sách (cá nhân B)" hoặc "Giao dịch lỗi đã xoá (hộ)" xuất hiện → RLS thật sự có vấn đề, báo lại.

-- =========================================================
-- TEST A2 — A (owner) sửa limit_amount category hộ — PHẢI thành công
-- =========================================================
set local role authenticated;
set local request.jwt.claim.sub = '<A_ID>';
update public.categories set limit_amount = 9999999 where name = 'Ăn uống chung'
returning id, limit_amount;
-- Kỳ vọng: trả về đúng 1 dòng

-- =========================================================
-- TEST B1 — B đọc transactions
-- =========================================================
set local role authenticated;
set local request.jwt.claim.sub = '<B_ID>';
select description from public.transactions order by created_at;
-- Kỳ vọng CHỈ 3 dòng: "Sách (cá nhân B)", "Đi chợ (hộ, A tạo)", "Góp quỹ du lịch (hộ, B tạo)"
-- Nếu thấy "Cà phê sáng (cá nhân A)" hoặc "Giao dịch lỗi đã xoá (hộ)" → báo lại, đây mới là bug thật.

-- =========================================================
-- TEST B2 — B (member) sửa limit_amount category hộ — PHẢI bị chặn (0 dòng)
-- =========================================================
set local role authenticated;
set local request.jwt.claim.sub = '<B_ID>';
update public.categories set limit_amount = 1 where name = 'Ăn uống chung'
returning id, limit_amount;
-- Kỳ vọng: KHÔNG trả về dòng nào. Nếu trả về 1 dòng → đây là RLS bug thật, báo ngay.

-- =========================================================
-- TEST B3 — B sửa transaction do A tạo trong hộ — PHẢI bị chặn (0 dòng)
-- =========================================================
set local role authenticated;
set local request.jwt.claim.sub = '<B_ID>';
update public.transactions set description = 'Sửa bởi B' where description = 'Đi chợ (hộ, A tạo)'
returning id, description;
-- Kỳ vọng: KHÔNG trả về dòng nào.
