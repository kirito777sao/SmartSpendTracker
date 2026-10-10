# T-S27 — Danh sách file đã sửa/thêm mới + việc cần làm

## 1. File MỚI (chưa từng tồn tại)

| File | Nội dung |
|---|---|
| `supabase/migration/0030_activity_log_notifications.sql` | Cột `owner_id`/`read_at`, constraint xor, RLS mở rộng, RPC `mark_activity_read`, 3 trigger (`transaction.create`+`budget.exceeded`, `transaction.delete_by_member`, `goal.completed`), bật Realtime cho `activity_log`. |
| `src/services/activityLog.ts` | `listActivityLog()`, `markActivityRead(ids?)`. |
| `src/hooks/useActivityLog.ts` | `useActivityLog()` (React Query), `useMarkActivityRead()`. |
| `src/components/NotificationBell.tsx` | Component chuông thông báo — viết mới hoàn toàn. |
| `check_list_tests/checklist-T-S27.md` | Checklist test tay cho task này. |

## 2. File ĐÃ SỬA (đổi 1 phần, không phải viết mới toàn bộ)

| File | Đổi gì |
|---|---|
| `src/lib/database.types.ts` | Type `activity_log.Row` thêm `owner_id`/`read_at`; thêm RPC `mark_activity_read`. |
| `src/types.ts` | Thêm `interface ActivityLogEntry`. |
| `src/lib/mapRows.ts` | Thêm `rowToActivityLogEntry()`. |
| `src/hooks/useRealtimeSync.ts` | Thêm `"activity_log"` vào `SYNCED_TABLES` + map query key `activityLog`. |
| `src/App.tsx` | Import + render `<NotificationBell />`, thay placeholder comment cũ (T-S06f-b3). |
| `TASKS.md` | T-S08: 🟡→🔒 (đã bạn xác nhận PASS). T-S27: ⚪→🟡 (code xong, chờ verify). |
| `CHANGELOG.md` | Thêm 2 entry: "T-S08 — người yêu cầu XÁC NHẬN PASS" và "T-S27 — code xong, chờ verify". |

## 3. Việc CẦN BẠN LÀM trước khi T-S27 được đóng 🔒

1. Chạy `supabase/migration/0030_activity_log_notifications.sql` trên Supabase thật.
2. Làm theo `check_list_tests/checklist-T-S27.md` (6 mục A–F), báo lại PASS/FAIL.

Sandbox này không verify được 2 việc trên — không có mạng ra `*.supabase.co`
và không thể mở 2 tài khoản thật để test Realtime/RBAC.
