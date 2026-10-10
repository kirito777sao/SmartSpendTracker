# Checklist test tay — T-S114 (phương án B: match theo categoryId)

## Kịch bản: tạo 2 category TRÙNG TÊN, khác hạn mức, để phân biệt rõ

- [ ] Vào tab **Ngân Sách**, tạo category chi tiêu mới: tên **"Ăn uống Test"**,
      hạn mức **1.000.000đ**.
- [ ] Tạo tiếp 1 category chi tiêu KHÁC, đặt CÙNG TÊN **"Ăn uống Test"**
      (ứng dụng sẽ KHÔNG chặn — đây đúng là kịch bản cần test), hạn mức
      **5.000.000đ**. Giờ có 2 category cùng tên, khác `id`, khác hạn mức.
- [ ] Tạo 1 giao dịch chi **200.000đ**, chọn category "Ăn uống Test" — ở
      dropdown chọn category, khả năng cao sẽ thấy 2 mục "Ăn uống Test"
      giống hệt tên (khác nhau ở `id` ẩn) — chọn mục **THỨ NHẤT**.
- [ ] Tạo tiếp 1 giao dịch chi **300.000đ**, cũng chọn "Ăn uống Test" nhưng
      lần này chọn mục **THỨ HAI** trong dropdown.

## Kiểm tra: mỗi thẻ hạn mức chỉ cộng ĐÚNG giao dịch của chính nó

- [ ] Ở tab **Ngân Sách**: PHẢI thấy **2 thẻ riêng biệt**, cùng tên "Ăn uống
      Test" nhưng khác hạn mức (1.000.000đ và 5.000.000đ):
  - [ ] Thẻ hạn mức 1.000.000đ: "Đã chi" = **200.000đ** (chỉ giao dịch đầu),
        KHÔNG cộng thêm 300.000đ của thẻ kia.
  - [ ] Thẻ hạn mức 5.000.000đ: "Đã chi" = **300.000đ** (chỉ giao dịch sau),
        KHÔNG cộng thêm 200.000đ của thẻ kia.
- [ ] Ở tab **Tổng Quan** (Dashboard), widget "Kiểm Soát Hạn Mức Ngân Sách":
      lặp lại đúng kiểm tra trên — 2 thẻ, mỗi thẻ CHỈ hiện đúng giao dịch của
      chính nó, KHÔNG bị cộng dồn 500.000đ vào cả hai.

## Dọn dẹp sau test

- [ ] Xoá 2 giao dịch thử + 2 category "Ăn uống Test" (tránh lẫn dữ liệu thật).

---

**Nếu cả 4 ô ✅**: báo lại để khoá 🔒 T-S114 — bug double-count đã hết hẳn.

**Nếu vẫn thấy 1 thẻ cộng nhầm cả 500.000đ**: báo ngay, có thể do dropdown
chọn category ở form tạo giao dịch đang tự gộp 2 mục trùng tên lại thành 1
(vấn đề UI khác, không phải lỗi tính toán) — cần xem thêm.
