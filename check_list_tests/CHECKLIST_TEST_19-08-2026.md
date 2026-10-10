# Checklist test tay — phiên 19/08/2026

Chạy `npm run dev`, đăng nhập tài khoản thật, kiểm từng mục theo đúng thứ tự.
Đánh dấu ✅/❌ từng dòng, ghi rõ nếu ❌ để báo lại.

---

## 1. T-S112 — Widget "Kiểm Soát Hạn Mức Ngân Sách" trên Dashboard

**Mục tiêu**: đổi bộ lọc thời gian ở Dashboard KHÔNG được làm đổi số liệu widget này.

- [ ] Vào tab **Tổng Quan** (Dashboard), để `timeFilter` mặc định ("Tháng này").
      Ghi lại % và số tiền "Đã chi" của 2-3 category đang có hạn mức ở widget
      "Kiểm Soát Hạn Mức Ngân Sách".
- [ ] So với tab **Ngân Sách** — cùng category đó phải hiện ĐÚNG cùng % và
      cùng số tiền "Đã chi" (sai lệch = ❌, báo lại ngay).
- [ ] Quay lại Dashboard, đổi `timeFilter` sang **"Năm nay"**.
      → % và số tiền ở widget Ngân Sách PHẢI **giữ nguyên y hệt** bước đầu
      (không được tăng lên dù các số khác trên Dashboard như "Tổng chi" đổi
      theo năm là đúng).
- [ ] Đổi `timeFilter` sang **"Hôm nay"** → widget Ngân Sách vẫn PHẢI giữ
      nguyên số như bước đầu.
- [ ] Đổi `timeFilter` sang **"Tự chọn"**, chọn 1 khoảng ngày bất kỳ (vd chỉ
      3 ngày gần nhất) → widget Ngân Sách vẫn PHẢI giữ nguyên số như bước đầu.
- [ ] Trở lại "Tháng này" — số liệu về đúng như ban đầu, không có gì "kẹt"
      lại từ lần đổi filter trước.

## 2. T-S113 — Phân loại thu/chi không còn dựa theo tên category

**Mục tiêu**: badge và CSV export dùng đúng `type` thật của giao dịch, không
bị đánh lừa bởi tên category.

- [ ] Vào tab **Ngân Sách**, tạo 1 category mới: loại **Chi tiêu (expense)**,
      đặt tên là **"Lương"** (hoặc "Thu nhập" — tên nào cũng được, cốt để
      trùng với heuristic cũ).
- [ ] Vào tab **Sổ Giao Dịch** (hoặc Nhập Liệu AI), tạo 1 giao dịch **Chi
      tiêu**, chọn category "Lương" vừa tạo, số tiền bất kỳ (vd 50.000đ).
- [ ] Ở bảng Sổ Giao Dịch (cả bản desktop lẫn mobile nếu test được cả 2):
      badge loại giao dịch của dòng này PHẢI hiện **"Chi tiêu"** (màu đỏ/rose),
      KHÔNG được hiện "Thu nhập" (xanh lá).
- [ ] Bấm **Xuất CSV** ở tab Sổ Giao Dịch. Mở file CSV vừa tải:
  - [ ] Dòng giao dịch "Lương" 50.000đ này phải mang đúng nhãn **Chi tiêu**
        trong cột loại giao dịch.
  - [ ] Dòng tổng kết cuối file: **"Tổng chi tiêu lọc"** phải CỘNG ĐÚNG
        50.000đ này vào; **"Tổng thu nhập lọc"** KHÔNG được cộng nhầm.
  - [ ] "Số dư ròng" (net) trong CSV = đúng công thức thu − chi sau khi đã
        phân loại đúng ở trên.
- [ ] Dọn dẹp sau test: xoá giao dịch thử + category "Lương" thử (tránh lẫn
      vào dữ liệu thật).

## 3. T-S107 (đã đóng, xác nhận lại) — Xoá 2 component debug

- [ ] Ứng dụng chạy bình thường, không có lỗi console nào liên quan đến
      `DebugHooksSmokeTest`/`DebugMutationsSmokeTest` (2 file đã bị xoá hẳn).
- [ ] `npm run build` chạy thành công (không lỗi import module không tồn tại).

## 4. Regression nhanh — light mode không đổi hành vi

- [ ] Tắt dark mode, lặp lại nhanh mục 1 và mục 2 — kết quả số liệu/badge
      phải giống hệt dark mode (2 bug này không liên quan theme, chỉ là kiểm
      tra không có tác dụng phụ ngoài ý muốn).

---

**Sau khi tất cả ✅**: báo lại để khoá 🔒 chính thức T-S112 và T-S113 trong
TASKS.md/CHANGELOG.md (hiện đang ở trạng thái 🟡 — code xong, chờ xác nhận
test tay theo đúng quy trình PHASE 3 của harness).

**T-S114 vẫn đang chờ bạn chọn phương án (A/B) trước khi code** — chưa nằm
trong phạm vi checklist này.
