# Checklist test tay — T-S06f-b3 (di trú `household` khỏi App.tsx + xoá hẳn chuông cũ)

File đã sửa: `src/App.tsx`, `src/types.ts` (xem file đính kèm trước đó).
Không đổi schema/RLS/RPC — thuần refactor phía client.

## 0. Verify tĩnh (làm trước, trên máy bạn)

```
npx tsc --noEmit   # kỳ vọng: 32 lỗi, khớp baseline hiện tại, 0 lỗi mới trong App.tsx/types.ts
npm run build      # kỳ vọng: build sạch (sandbox này không chạy được do thiếu
                    # binary rollup native — lỗi môi trường, không phải lỗi code)
```

## 1. Chuông thông báo — phải MẤT HẲN (CONSTITUTION §1.23)

1. Đăng nhập, quan sát toàn bộ header (desktop lẫn mobile) — **không còn icon 🔔 nào**, dù ở scope Cá nhân hay Hộ gia đình.
2. Mở DevTools → Elements, tìm `Bell`/dropdown thông báo — xác nhận không còn trong DOM (không phải bị ẩn bằng CSS).
3. *(Kỳ vọng đã biết, không phải bug)*: tạm thời KHÔNG có cách nào xem "hoạt động gia đình" nữa cho tới khi T-S27 code xong — đây là đánh đổi đã xác nhận.

## 2. Không còn polling / gọi Express API household

1. Mở DevTools → Network, lọc `household`.
2. Đăng nhập, chuyển qua lại tab Cá nhân ↔ Hộ gia đình vài lần → **không thấy** request nào tới `/api/household/get` hay `/api/household/sync`.
3. Để yên trang 60 giây, quan sát Network → **không còn request lặp lại mỗi 4 giây** (polling cũ đã xoá).
4. Mở 2 tab trình duyệt (2 tài khoản khác nhau cùng 1 hộ) → xác nhận không tab nào còn bắn request polling (đổi dữ liệu ở tab A sẽ CHƯA tự cập nhật sang tab B ngay — đúng kỳ vọng, Realtime thay polling là T-S08, chưa tới lượt).

## 3. Household đọc đúng từ Supabase thật (useHousehold/useHouseholdMembers)

1. Tài khoản đã có hộ gia đình → vào tab "Hộ Gia Đình", xác nhận tên hộ + danh sách thành viên hiển thị đúng (khớp Table Editor Supabase).
2. Chuyển sang tab "Hộ Gia Đình" ở màn hình chưa đăng nhập (màn Auth) → phần hiển thị mã mời (nếu có) trong `AuthAndTelegram` vẫn đúng.
3. Tài khoản CHƯA có hộ gia đình, chuyển sang scope "Hộ gia đình" → hiện đúng banner cam "Bạn chưa tham gia hay khởi tạo Hộ gia đình nào" (không lỗi, không màn trắng).
4. Sau khi TẠO hộ mới hoặc THAM GIA bằng mã mời (qua tab Hộ Gia Đình) → tên hộ/thành viên cập nhật đúng ngay (không cần F5) — xác nhận `refreshHousehold`/invalidate cache hoạt động.
5. Refresh trang (F5) khi đang ở hộ gia đình → household load lại đúng, không mất dữ liệu.

## 4. `isOwner` — quyền chủ hộ vẫn đúng (đã đổi từ match theo tên → match theo id)

1. Đăng nhập bằng tài khoản CHỦ HỘ → vào tab Ngân Sách/Smart Advisor, xác nhận vẫn thấy đầy đủ nút thêm/sửa/xoá (không bị khoá nhầm).
2. Đăng nhập bằng tài khoản THÀNH VIÊN (không phải chủ hộ) → tab Ngân Sách/Smart Advisor vẫn đúng hành vi khoá cũ (banner amber, nút disabled) — **regression test**, hành vi phải giống hệt trước khi sửa.
3. Đổi tên hiển thị 2 thành viên trùng nhau (nếu có thể) → xác nhận quyền chủ hộ vẫn đúng theo ĐÚNG NGƯỜI (match theo id, không còn bị nhầm do trùng tên — cải thiện so với logic cũ).

## 5. Regression toàn diện (đảm bảo không phá gì đang chạy tốt)

1. Đăng nhập → đăng xuất → đăng nhập lại bằng tài khoản khác — không lỗi, không data lẫn giữa 2 tài khoản.
2. Đổi tab Cá nhân ↔ Hộ gia đình nhiều lần liên tiếp — dữ liệu giao dịch/ngân sách/mục tiêu đổi đúng theo scope, không lẫn.
3. Nút "Đặt lại dữ liệu mẫu" vẫn chạy được, không lỗi (categories legacy vẫn còn, chưa xoá tới b4).
4. Toàn bộ 7 tab (Phân Tích, Nhập Liệu AI, Sổ Giao Dịch, Ngân Sách, Tích Lũy, Smart Advisor, Hộ Gia Đình) mở được bình thường, không crash, không lỗi Console mới.
5. Test trên mobile viewport (hoặc DevTools responsive) — header/menu mobile không còn khoảng trống/lỗi layout do bỏ chuông.

---

**Báo lại theo format**: mục nào PASS/FAIL, kèm ảnh chụp Console/Network nếu FAIL, để tôi cập nhật CHANGELOG.md + đóng 🔒 T-S06f-b3 trong TASKS.md.
