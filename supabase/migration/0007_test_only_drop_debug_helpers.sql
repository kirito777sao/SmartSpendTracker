-- =========================================================
-- CHỈ CHẠY TRÊN PROJECT TEST (smart-spend-test) — KHÔNG chạy trên production,
-- production chưa từng có 2 hàm debug này (không tồn tại trong bất kỳ
-- migration nào trước 0007, được tạo tay ngoài migration trong lúc điều tra
-- RLS 42501 cho categories).
--
-- Quyết định (T-S05, xem CHANGELOG.md): xoá, không giữ lại. Nguyên nhân bug
-- đã xác nhận và ghi đầy đủ (categories 0005, transactions 0006) — 2 hàm
-- debug không còn phục vụ mục đích gì, và để chúng tồn tại ngoài migration
-- file là đúng loại drift DB-vs-code mà HARNESS đang cố tránh. Nếu cần điều
-- tra tương tự trong tương lai, viết SQL debug tại chỗ trong SQL Editor.
-- =========================================================

drop function if exists public.debug_check_insert(uuid);
drop function if exists public.debug_check_insert();
drop function if exists public.debug_update_check(uuid);
drop function if exists public.debug_update_check();
drop function if exists public.debug_whoami();
