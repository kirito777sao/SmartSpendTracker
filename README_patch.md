# Đợt vá: Realtime rớt event ở phía không-phải-actor (18/08/2026)

Không có file MỚI nào trong đợt này — chỉ sửa 2 file code + ghi log:

| File | Đổi gì |
|---|---|
| `src/hooks/useActivityLog.ts` | Thêm `refetchOnWindowFocus: true` + `staleTime: 15_000` cho `useActivityLog()` — tự fetch lại khi tab được focus lại. |
| `src/components/NotificationBell.tsx` | `handleToggle` giờ `await refetch()` trước, đợi xong mới xét đánh dấu đã đọc — mỗi lần MỞ chuông sẽ tự đối soát lại với server thay vì tin tưởng tuyệt đối Realtime đã đẩy kịp. |
| `CHANGELOG.md` | Thêm entry "T-S27 — vá lỗ hổng Realtime rớt event ở phía không-phải-actor", ghi rõ bug thật đã xác nhận, đã loại trừ (không phải bug), fix đã áp dụng, và giới hạn còn lại chưa xử lý. |

**Còn thiếu để đóng 🔒 T-S27**: bạn test lại "Điện nước" (2 tài khoản cùng hộ,
mở chuông thay vì F5) + xác nhận `goal.completed` PASS/FAIL.
