# T-S117 — Chặn trùng tên category không phân biệt hoa/thường + khoảng trắng

## Bước bắt buộc: chạy migration 0035 (SAU khi đã có 0034)

1. Mở Supabase → **SQL Editor**.
2. Copy toàn bộ nội dung `supabase/migration/0035_categories_case_insensitive_unique_name.sql`.
3. Paste vào SQL Editor, bấm **Run**.
4. Không có lỗi đỏ nào hiện ra là thành công.

(Không cần chạy lại 0034 — 0035 tự `drop index if exists` cái cũ trước khi
tạo lại, an toàn để chạy nối tiếp.)

## Checklist test lại

- [ ] Thử tạo category tên **"học tập"** (chữ thường hết) khi ĐÃ có sẵn
      **"Học tập"** (như ảnh bạn gửi) → giờ PHẢI bị chặn, hiện đúng thông
      báo *"Tên danh mục này đã được dùng..."*
- [ ] Thử tạo category tên **"  Học tập  "** (thừa khoảng trắng đầu/cuối)
      khi đã có "Học tập" → PHẢI bị chặn.
- [ ] Test lại nhanh 4 mục cũ đã pass ở T-S116 (không được bị ảnh hưởng bởi
      lần vá này):
  - [ ] Tạo 2 category tên giống hệt ký tự → vẫn bị chặn.
  - [ ] Tạo 2 category trùng tên nhưng KHÁC loại (thu/chi) → vẫn cho phép.
  - [ ] Xoá 1 category rồi tạo lại đúng tên → vẫn cho phép, không bị chặn
        nhầm.
  - [ ] Smart Advisor bấm "Áp Dụng" → vẫn chạy trơn tru, không lỗi.

---

**Sau khi ✅ hết**: báo lại để khoá 🔒 cả T-S116 lẫn T-S117 cùng lúc — hoàn
tất trọn vẹn toàn bộ đợt audit logic dòng tiền (T-S112 → T-S117).
