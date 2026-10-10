# Checklist test tay — T-S07 (Optimistic UI thêm/xoá giao dịch + Undo)

## A. Optimistic UI — thêm giao dịch

- [ ] Thêm 1 giao dịch bất kỳ → xuất hiện **NGAY LẬP TỨC** trong danh sách,
      không phải đợi loading/spinner rồi mới thấy.
- [ ] Giao dịch tạm biến mất và được thay bằng dữ liệu thật sau khi server
      xác nhận (không nhấp nháy, không hiện trùng 2 dòng).

## B. Rollback khi mất mạng — thêm giao dịch

- [ ] Mở DevTools → tab Network → chọn "Offline" (hoặc tắt wifi/mạng máy).
- [ ] Thêm 1 giao dịch → thấy xuất hiện ngay (optimistic), nhưng vài giây
      sau **tự động biến mất** (rollback) vì request thất bại.
- [ ] Bật lại mạng, load lại trang → xác nhận giao dịch đó **không** thực
      sự được lưu (đúng vì optimistic rollback, không phải bug).

## C. Optimistic UI — xoá giao dịch

- [ ] Xoá 1 giao dịch → biến mất khỏi danh sách **NGAY LẬP TỨC**, không đợi
      server phản hồi.
- [ ] Toast "Đã xoá giao dịch "..."." xuất hiện góc dưới bên phải màn hình,
      có nút "Hoàn tác".

## D. Rollback khi mất mạng — xoá giao dịch

- [ ] Bật "Offline" ở DevTools như mục B.
- [ ] Xoá 1 giao dịch → biến mất ngay, nhưng vài giây sau **tự xuất hiện
      lại** (rollback) vì request thất bại.

## E. Undo (Hoàn tác)

- [ ] Xoá 1 giao dịch **có gắn mục tiêu tiết kiệm** (góp quỹ, `type=transfer`)
      → bấm "Hoàn tác" trong toast (trong vòng 5s) → giao dịch xuất hiện lại
      ĐÚNG vị trí cũ, và số dư mục tiêu tiết kiệm (`current_amount`) cộng
      lại đúng số tiền đã góp (không lệch, không cộng thiếu/thừa).
- [ ] Để toast tự biến mất sau 5s (không bấm gì) → giao dịch vẫn ở trạng
      thái đã xoá (không tự phục hồi).
- [ ] Bấm nút ✕ đóng toast sớm → không còn cơ hội hoàn tác qua toast đó nữa
      (đúng hành vi mong đợi, không phải bug).

## F. Xoá hàng loạt

- [ ] Chọn nhiều giao dịch (tick chọn) → "Xoá hàng loạt" → xác nhận trong
      hộp thoại → tất cả biến mất ngay lập tức.
- [ ] Toast "Đã xoá N giao dịch." với nút "Hoàn tác tất cả" xuất hiện.
- [ ] Bấm "Hoàn tác tất cả" → toàn bộ N giao dịch xuất hiện lại đúng.

## G. Tương tác với Realtime (T-S08)

- [ ] Mở 2 tab cùng tài khoản (hoặc 2 tài khoản cùng hộ) — thêm giao dịch ở
      tab A → tab B nhận được qua Realtime bình thường như trước (T-S08
      không bị phá bởi optimistic UI mới).
- [ ] Không thấy hiện tượng nhấp nháy/trùng lặp dòng khi cả optimistic
      update (tab A) và Realtime event (tab B) cùng xảy ra gần như đồng
      thời.

## H. UI Toast tổng quát

- [ ] Toast không bị che bởi chuông thông báo 🔔 hay bất kỳ modal/dropdown
      nào khác đang mở.
- [ ] Nhiều toast liên tiếp (xoá nhiều lần nhanh) xếp chồng gọn gàng, không
      đè lên nhau.
- [ ] Trên màn hình điện thoại (mobile width) toast không tràn ra ngoài
      viewport.

---

**Sau khi test xong, báo lại mục nào PASS/FAIL kèm mô tả ngắn.**
