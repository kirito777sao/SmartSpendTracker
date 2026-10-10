# Checklist test tay — T-S60 → T-S67 (phần CHƯA được xác nhận qua T-S70/71/72/73)

Migration 0019/0020/0021 đã chạy thật — không cần chạy lại. T-S70/71/72/73 đã 🔒 nên các mục có đánh dấu **[đã cover]** bên dưới có thể bỏ qua, không cần test lại.

---

## T-S60 — Rút quỹ (khung sườn cơ bản)
- [ ] Goal có **cả 2 nguồn** số dư (vừa liên kết vừa thủ công) → mở form Rút quỹ, radio chọn nguồn **hiện ra**.
- [ ] Goal chỉ có **1 loại** số dư → radio **ẩn**, tự dùng đúng nguồn đó.
- [ ] Rút chọn **"phần thủ công"** → tạo đúng 1 giao dịch `expense` thật trong Sổ Giao Dịch, trừ đúng số tiền.
- [ ] Rút chọn **"phần liên kết"** → chỉ thêm dòng lịch sử (khối rose), **KHÔNG** có giao dịch mới trong Sổ Giao Dịch. *(⚠ phần trừ tổng khi rút liên kết đã cover qua T-S70, chỉ cần xác nhận KHÔNG tạo giao dịch)*
- [ ] Tick **"Đóng mục tiêu"** mà không nhập số tiền → vẫn lưu được, chỉ set `completed_at`.
- [ ] Rút nhiều lần liên tiếp, không tick đóng → goal vẫn nằm trong danh sách **active**, rút tiếp được.

## T-S61 — Idempotency link/unlink (migration 0019)
- [ ] Link category A → unlink (đóng băng tổng A lần 1) → link lại A → unlink lần nữa → `carried_over_spent_amount` **chỉ cộng đúng 1 lần** tổng A, không nhân đôi.
- [ ] Không có dòng `linked_history` rác trùng khi không phát sinh giao dịch mới giữa 2 lần đóng băng liên tiếp.
- [ ] Modal "Lịch sử" mở rộng được từng giai đoạn (linked/manual) để xem chi tiết giao dịch gốc snapshot.
- [ ] Chuyển từ thủ công → liên kết: lịch sử góp thủ công **cũ vẫn hiện đầy đủ**, không biến mất.
- [ ] Dòng "Tổng" ở chân modal khớp đúng số "Đã có" ở thẻ ngoài.
- [ ] **Còn treo riêng, cần xác nhận thêm**: dữ liệu goal nào đã bị nhân tiền THẬT do bug cũ (trước khi có fix 0019) — có cần chạy script rà soát `fix_and_audit_goal_link_duplication.sql` không, hay dữ liệu hiện tại đã sạch?

## T-S62 — Dedup ID cho phần "đang sống"
- [ ] Link A → unlink (đóng băng 23k, ví dụ) → link lại A (không có giao dịch mới) → tổng hiển thị **vẫn đúng 23k**, không nhảy lên 46k.
- [ ] Modal "Lịch sử" không hiện trùng cùng 1 giao dịch ở cả snapshot đóng băng lẫn danh sách đang sống.
- [ ] Regression: goal thủ công thường (chưa từng link) vẫn tính đúng như cũ.

## T-S64 / T-S64b — goalCurrentAmount & card "Đã hoàn thành" (nhánh THỦ CÔNG)
- [ ] Goal **thủ công** có sẵn tiền, rút 1 phần → "Đã có" ở card chính **giảm đúng**, khớp 100% với số hiện trong form Rút quỹ lúc rút.
- [ ] Rút nhiều lần liên tiếp (nguồn thủ công) → trừ dồn đúng, không trừ trùng/thiếu.
- [ ] Đóng 1 goal **thủ công thường** (không liên kết) đang có tiền → card "Đã hoàn thành" hiện đúng "Đã tích lũy", badge Dư/Thiếu tính đúng. *(phần liên kết đã cover qua T-S72, chỉ cần test nhánh thủ công thuần)*

## T-S65 — Modal Lịch sử hiện dòng "Đã rút" (nguồn thủ công)
- [ ] Rút 1 phần từ nguồn **thủ công** → mở modal "Lịch sử" của đúng goal → thấy dòng **"Đã rút"** mới, số tiền đúng, ngày đúng.
- [ ] Dòng "Tổng" ở chân modal khớp đúng số sau khi trừ rút.
- [ ] Goal liên kết category: khối "Đã rút từ phần liên kết" (rose) không đổi. *(đã cover gián tiếp qua T-S73 — chỉ cần liếc qua, không cần test sâu lại)*

## T-S66 — Validate rút vượt số dư (đơn nguồn)
- [ ] Nhập số tiền rút **lớn hơn** số dư khả dụng của nguồn **thủ công** đang chọn → nút xác nhận bị chặn, hiện lỗi rõ số dư thật, KHÔNG tạo giao dịch. *(nguồn liên kết đơn thuần đã test qua T-S70/71 rồi, chỉ cần xác nhận lại nguồn thủ công)*
- [ ] Sửa lại số tiền ≤ số dư khả dụng → rút thành công như cũ (regression).

## T-S67 / T-S67b — Banner tự động hoàn thành qua SmartInput/AIAssistantBubble
- [ ] Nhập giao dịch qua **SmartInput** khớp tên 1 goal thủ công đang active, xác nhận banner "Đánh dấu hoàn thành" → giao dịch lưu đúng, `completed_at` được set.
- [ ] Cùng kịch bản qua **AIAssistantBubble** (chat) → hành vi giống hệt SmartInput.
- [ ] Nhập/chat khớp tên goal, số tiền **vượt** số dư khả dụng của goal đó → bị **chặn toàn bộ lượt lưu**, hiện lỗi rõ số dư khả dụng thật, KHÔNG lưu bất kỳ giao dịch nào (kể cả dòng khác hợp lệ cùng lượt).
- [ ] Số tiền ≤ số dư khả dụng → lưu như cũ (regression).
- [ ] Goal liên kết category → không bị ảnh hưởng bởi banner này (danh sách goal ở 2 file đã lọc từ trước).

---

**Sau khi test xong từng mục, báo lại cho tôi mục nào PASS / mục nào FAIL kèm mô tả ngắn (không cần chụp ảnh trừ khi có bug) — tôi sẽ cập nhật TASKS.md + CHANGELOG.md tương ứng.**
