# Checklist test tay — T-S115 (phiên tiếp theo, 19/08/2026)

T-S112 ✅ và T-S113 ✅ đã đóng 🔒 (bạn xác nhận qua ảnh + lời). Chỉ còn
**T-S115** cần test — bug mới phát hiện ngay trong lúc rà ảnh test T-S112.

## Dùng lại đúng giao dịch đã có sẵn (không cần tạo mới)

Bạn đã có sẵn giao dịch **"Đổ xăng xe máy"** (category "Thu nhập", ngày
19/8/2026, 50.000đ) từ lúc test T-S113 — dùng lại luôn.

- [ ] Vào tab **Tổng Quan** (Dashboard), cuộn xuống 2 widget **"Top 5 Khoản
      Chi Lớn Nhất"** và **"Giao Dịch Gần Đây Nhất"** (2 cột cạnh nhau).
- [ ] Tìm giao dịch "Đổ xăng xe máy" ở CẢ HAI widget (nếu nó không lọt vào
      Top 5 nữa vì có giao dịch lớn hơn thì đổi filter về "Tất cả" hoặc tạo
      lại 1 giao dịch tương tự).
- [ ] **"Top 5 Khoản Chi Lớn Nhất"**: số tiền phải màu **đỏ**, hiện
      `50.000 đ` (không dấu +) — như trước giờ vẫn đúng.
- [ ] **"Giao Dịch Gần Đây Nhất"**: số tiền PHẢI ĐỔI từ xanh `+50.000 đ`
      SANG **đỏ `50.000 đ`** (không dấu +) — đây là chỗ vừa sửa.
- [ ] 2 widget giờ phải hiện **NHẤT QUÁN** — cùng màu đỏ, cùng không dấu +,
      cho cùng 1 giao dịch.

## Kiểm luôn báo cáo Excel của Dashboard (vị trí thứ 6 vừa phát hiện thêm)

- [ ] Ở tab Tổng Quan, bấm nút **"Xuất phân tích Excel"** (góc trên phải,
      cạnh bộ lọc thời gian).
- [ ] Mở file CSV vừa tải, tìm tới mục **"6. DANH SÁCH CHI TIẾT GIAO DỊCH
      TRONG CHU KỲ LỌC"**.
- [ ] Dòng giao dịch "Đổ xăng xe máy": cột **"Loại giao dịch"** phải ghi
      đúng **"Chi tiêu"** (không phải "Thu nhập"), cột **"Số tiền thực tế"**
      phải là số ÂM (vì là chi tiêu thật).

## Regression nhanh — đảm bảo giao dịch thu nhập THẬT vẫn đúng

- [ ] Tìm 1 giao dịch thu nhập THẬT trong dữ liệu (vd lương, hoặc giao dịch
      bạn tạo với loại "Thu nhập" đúng nghĩa, category tên bất kỳ không phải
      "Thu nhập"/"Lương") — xác nhận vẫn hiện **xanh, có dấu +** ở cả "Giao
      Dịch Gần Đây Nhất" lẫn báo cáo CSV cột "Loại giao dịch" = "Thu nhập".
      (Đảm bảo bản sửa không làm hỏng luồng thu nhập bình thường.)

---

**Sau khi ✅ hết**: báo lại để khoá 🔒 chính thức T-S115.

**Còn T-S114 đang chờ bạn chọn phương án (A: ràng buộc UNIQUE tên category
/ B: đổi sang match theo categoryId) trước khi tôi code** — chưa nằm trong
checklist này.
