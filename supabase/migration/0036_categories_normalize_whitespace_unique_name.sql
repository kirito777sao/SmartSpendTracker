-- 0036_categories_normalize_whitespace_unique_name.sql
-- T-S118 — CHỐT 20/08/2026, xem CONSTITUTION.md + CHANGELOG.md cùng ngày.
--
-- Bug thật, người dùng tự phát hiện qua test tay T-S117: `trim(name)` (0035)
-- chỉ bỏ khoảng trắng ĐẦU/CUỐI chuỗi, KHÔNG xử lý khoảng trắng thừa Ở GIỮA
-- — "học   tập" (nhiều dấu cách liên tiếp giữa 2 từ) vẫn được coi là KHÁC
-- "học tập" (1 dấu cách) về mặt kỹ thuật, dù mắt người đọc thấy gần như
-- giống hệt. Sửa: chuẩn hoá triệt để bằng `regexp_replace(trim(name),
-- '\s+', ' ', 'g')` — bỏ đầu/cuối RỒI gộp mọi dải khoảng trắng liên tiếp ở
-- giữa thành đúng 1 dấu cách, trước khi hạ thường bằng `lower()`.
--
-- NHÂN TIỆN vá luôn 1 lỗ hổng CHƯA CÓ BÁO CÁO THẬT nhưng cùng lớp vấn đề,
-- để tránh vòng lặp bug thứ 4: chuẩn hoá Unicode NFC (xem chi tiết ở BƯỚC 1
-- bên dưới) — rẻ để vá ngay lúc đang sửa cùng biểu thức, đắt hơn nhiều nếu
-- để người dùng tự gõ trúng rồi báo lại lần nữa.

begin;

-- ==========================================================================
-- BƯỚC 1 — dọn dữ liệu cũ vi phạm theo tiêu chuẩn MỚI (chuẩn hoá khoảng
-- trắng đầy đủ + hạ thường + chuẩn hoá Unicode NFC). 0035 mới xử lý trim
-- đầu/cuối + hoa/thường, chưa xử lý khoảng trắng thừa Ở GIỮA — ca thật vừa
-- phát hiện: "học   tập" và "Học tập" là 2 row khác nhau theo tiêu chuẩn
-- 0035, giờ mới coi là trùng.
--
-- [CHỦ ĐỘNG VÁ THÊM, chưa có báo cáo lỗi thật] Tiếng Việt có dấu có thể mã
-- hoá theo 2 dạng Unicode NHÌN GIỐNG HỆT NHAU nhưng KHÁC BYTE: NFC (ký tự
-- dựng sẵn, 1 codepoint/chữ có dấu — phổ biến khi gõ bằng bộ gõ chuẩn như
-- Unikey/Telex) và NFD (ký tự gốc + dấu tổ hợp riêng — phổ biến khi copy từ
-- 1 số nguồn macOS/web cũ). "Học" (NFC) và "Học" (NFD, nhìn giống hệt) sẽ
-- vẫn lọt qua unique index nếu không chuẩn hoá — đúng lớp bug y hệt 2 lần
-- trước (hoa/thường ở T-S117, khoảng trắng ở T-S118), chỉ là chưa ai gõ
-- trúng ca này để báo. Vá luôn bằng `normalize(name, nfc)` (hàm chuẩn SQL,
-- có sẵn từ Postgres 13+) TRƯỚC khi trim/gộp khoảng trắng/hạ thường.
-- ==========================================================================
with duplicates as (
  select
    id,
    row_number() over (
      partition by
        coalesce(owner_id::text, ''),
        coalesce(household_id::text, ''),
        lower(regexp_replace(trim(normalize(name, nfc)), '\s+', ' ', 'g')),
        type
      order by created_at asc, id asc
    ) as rn
  from public.categories
  where deleted_at is null
)
update public.categories c
set deleted_at = now()
from duplicates d
where c.id = d.id
  and d.rn > 1;

-- ==========================================================================
-- BƯỚC 2 — xoá unique index cũ (0035, chưa chuẩn hoá Unicode + khoảng
-- trắng giữa), tạo lại theo chuẩn hoá đầy đủ: NFC → trim → gộp khoảng
-- trắng giữa → hạ thường.
-- ==========================================================================
drop index if exists public.categories_unique_active_name_per_scope;

create unique index categories_unique_active_name_per_scope
  on public.categories (
    coalesce(owner_id::text, ''),
    coalesce(household_id::text, ''),
    lower(regexp_replace(trim(normalize(name, nfc)), '\s+', ' ', 'g')),
    type
  )
  where deleted_at is null;

commit;

-- ==========================================================================
-- GHI CHÚ VẬN HÀNH
-- ==========================================================================
-- - Sau migration này, các biến thể sau đều bị coi là CÙNG 1 TÊN (chỉ tạo
--   được 1 trong số đó): "Học tập", "học tập", "HỌC TẬP", "  Học tập  ",
--   "học   tập" (nhiều dấu cách giữa), "học  tập   " (kết hợp cả 2 lỗi),
--   và bản mã Unicode NFD của "Học tập" (nhìn giống hệt, khác byte).
-- - `\s` trong regex Postgres khớp mọi loại khoảng trắng (space, tab,
--   newline) — chặn được cả trường hợp dán nhầm tab từ Excel/Word vào ô
--   tên category, không chỉ riêng phím cách.
-- - `normalize(name, nfc)` yêu cầu Postgres 13+ (dùng ICU) — nếu Supabase
--   project đang chạy phiên bản cũ hơn, câu lệnh sẽ báo lỗi hàm không tồn
--   tại; hầu hết project Supabase mới đều ≥ 15 nên không đáng lo, nhưng
--   nếu gặp lỗi này khi chạy migration, báo lại để bỏ phần `normalize()`
--   (mất lớp phòng thủ Unicode nhưng vẫn giữ được phần hoa/thường +
--   khoảng trắng).
-- - Không cần đổi code client — `BudgetLimits.tsx` `friendlyWriteError()`
--   đã bắt chung mã lỗi `23505` từ T-S116, áp dụng đúng cho mọi nguyên
--   nhân trùng tên (y hệt ký tự / khác hoa-thường / khoảng trắng thừa /
--   khác dạng mã hoá Unicode).
-- - Tên HIỂN THỊ của category vẫn giữ nguyên y hệt người dùng gõ (migration
--   này không tự sửa cột `name` — chỉ chuẩn hoá lúc SO SÁNH để phát hiện
--   trùng, không đụng dữ liệu hiển thị).
