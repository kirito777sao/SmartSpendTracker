# Checklist test tay — T-S27 (Hệ thống thông báo — activity_log mở rộng)

Migration `0030_activity_log_notifications.sql` phải chạy xong trên Supabase
thật trước khi test các mục dưới đây.

---

## A. budget.exceeded (edge-triggered)

- [ ] Có 1 category chi tiêu đã đặt hạn mức (vd 1.000.000đ), tháng này đang
      chi dưới hạn mức.
- [ ] Thêm 1 giao dịch chi khiến tổng tháng này **vượt** hạn mức → chuông 🔔
      xuất hiện đúng **1** thông báo mới "Danh mục ... đã vượt hạn mức...".
- [ ] Thêm tiếp 1 giao dịch khác **vẫn thuộc category đó, vẫn đang vượt** →
      **KHÔNG** sinh thêm dòng thông báo mới (không lặp lại).
- [ ] Test ở **scope cá nhân** (không chỉ hộ gia đình) — category cá nhân
      vượt hạn mức cũng phải sinh thông báo.
- [ ] Giao dịch `type='transfer'` (góp quỹ tiết kiệm) gắn category có hạn
      mức → **KHÔNG** được tính vào tổng chi, không kích hoạt thông báo dù
      cộng vào có vẻ vượt (đúng nguyên tắc `isExpenseTx`).

## B. transaction.create (giao dịch mới trong hộ)

- [ ] Mở 2 tài khoản khác nhau cùng 1 hộ (2 tab/2 trình duyệt).
- [ ] Tài khoản A thêm 1 giao dịch bất kỳ trong sổ hộ gia đình → tài khoản
      B (KHÔNG phải người tạo) thấy thông báo mới gần như ngay lập tức
      (qua Realtime, không cần refresh).
- [ ] Chính tài khoản A (người tạo) — **không bắt buộc** không thấy thông
      báo về giao dịch của chính mình (AC không yêu cầu ẩn với chính actor,
      chỉ yêu cầu "mọi thành viên còn lại" thấy — ghi lại thực tế quan sát
      được).
- [ ] Giao dịch tạo ở **sổ cá nhân** → **không** sinh `transaction.create`
      (đúng thiết kế, chỉ áp dụng hộ gia đình).

## C. transaction.delete_by_member

- [ ] Trong 1 hộ có ≥ 2 thành viên, đăng nhập bằng tài khoản **KHÔNG phải
      chủ hộ**, xoá 1 giao dịch của chính mình.
- [ ] Tài khoản **chủ hộ** thấy thông báo "... đã xoá giao dịch ...".
- [ ] Tài khoản thành viên khác (không phải chủ hộ, không phải người xoá)
      **KHÔNG** thấy thông báo này.
- [ ] Chủ hộ tự xoá giao dịch của chính mình → **KHÔNG** sinh thông báo
      (đúng điều kiện `actor_id <> owner_id`).

## D. goal.completed

- [ ] Bấm "Hoàn thành" 1 mục tiêu tiết kiệm (thủ công, `SavingGoals.tsx`)
      → sinh đúng 1 dòng thông báo "... đã hoàn thành mục tiêu tiết kiệm
      ...".
- [ ] Test cả ở scope cá nhân lẫn hộ gia đình (nếu có thể tạo goal cả 2
      scope).

## E. Đánh dấu đã đọc + UI chuông

- [ ] Có thông báo chưa đọc → badge số đỏ hiện đúng số lượng trên icon 🔔.
- [ ] Bấm mở chuông → badge biến mất (đã đọc), dòng thông báo hết in đậm/
      hết chấm xanh.
- [ ] Đóng rồi mở lại chuông khi không có thông báo mới → không có gì thay
      đổi bất thường (không lỗi, không gọi lại `mark_activity_read` gây
      nhiễu).
- [ ] Có thông báo mới tới (qua Realtime) trong lúc panel đang MỞ sẵn → nút
      "Đánh dấu tất cả" xuất hiện lại, bấm vào → chấm chưa đọc biến mất.
- [ ] Đăng nhập lại (session mới) → trạng thái đã đọc **giữ nguyên** (đọc
      từ `read_at` thật trong DB, không phải state tạm ở client).

## F. Kỹ thuật

- [ ] Migration `0030` chạy sạch trên Supabase thật, không phá dữ liệu
      `activity_log`/`transactions`/`saving_goals` hiện có.
- [ ] `npx tsc --noEmit`: không có lỗi logic mới ngoài baseline drift đã ghi
      nhận (xem CHANGELOG "T-S27 — code xong, chờ verify").
- [ ] Bell dropdown không lỗi UI khi danh sách rỗng ("Không có hoạt động
      nào.") và khi đang tải ("Đang tải...").

---

**Sau khi test xong, báo lại mục nào PASS / FAIL kèm mô tả ngắn — sẽ cập
nhật TASKS.md (T-S27 → 🔒) + CHANGELOG.md tương ứng.**
