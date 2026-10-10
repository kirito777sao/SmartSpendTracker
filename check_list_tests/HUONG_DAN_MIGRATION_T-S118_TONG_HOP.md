# T-S118 — Chuẩn hoá khoảng trắng giữa + Unicode (chạy sau 0034 + 0035)

## Bước bắt buộc: chạy migration 0036

1. Supabase → **SQL Editor**.
2. Copy toàn bộ `supabase/migration/0036_categories_normalize_whitespace_unique_name.sql`.
3. Paste, bấm **Run**.
4. Nếu báo lỗi liên quan tới `normalize` (hàm không tồn tại) — báo lại
   ngay, khả năng project Supabase đang chạy Postgres cũ hơn 13, cần bỏ bớt
   phần đó.

## Checklist test — GỘP LẠI TOÀN BỘ (T-S116 + T-S117 + T-S118) để chắc chắn 1 lần

### Các ca PHẢI bị chặn (trùng tên theo nghĩa rộng)

- [ ] Tên giống hệt ký tự: "Học tập" (khi đã có "Học tập")
- [ ] Khác hoa/thường: "học tập" (khi đã có "Học tập")
- [ ] Thừa khoảng trắng đầu/cuối: "  Học tập  " (khi đã có "Học tập")
- [ ] Thừa khoảng trắng ở giữa: "học   tập" (khi đã có "Học tập") — **ca vừa
      phát hiện, quan trọng nhất lần này**
- [ ] Kết hợp nhiều lỗi cùng lúc: "  HỌC   TẬP  " (khi đã có "Học tập")

### Các ca PHẢI cho phép (không phải trùng thật)

- [ ] Tên trùng nhưng KHÁC loại (1 category "Ăn uống" thu, 1 category "Ăn
      uống" chi) → cho phép.
- [ ] Xoá 1 category rồi tạo lại đúng tên đó → cho phép.
- [ ] Tên gần giống nhưng THỰC SỰ khác nghĩa (vd "Học tập" và "Học phí") →
      cho phép — đảm bảo migration không chặn nhầm quá tay.

### Regression

- [ ] Smart Advisor → "Áp Dụng" → vẫn chạy trơn tru, không lỗi.
- [ ] Toàn bộ category hiện có (không phải category test) vẫn hiển thị,
      hạn mức, "Đã chi" đúng như trước — không bị mất dữ liệu do bước dọn
      trùng của migration.

---

**Sau khi ✅ hết**: báo lại để khoá 🔒 GỘP cả 3 task T-S116, T-S117, T-S118
— hoàn tất trọn vẹn đợt audit logic dòng tiền T-S112 → T-S118.
