# Đợt mở rộng lần 2 — T-S27 (18/08/2026)

## File MỚI
| File | Nội dung |
|---|---|
| `supabase/migration/0031_activity_log_more_events.sql` | 3 action mới: `transaction.update` (sửa giao dịch hộ), `category.budget_created` (đặt ngân sách lần đầu), `goal.contribution` (mỗi lần góp quỹ). |

## File ĐÃ SỬA
| File | Đổi gì |
|---|---|
| `src/components/NotificationBell.tsx` | Thêm icon cho 3 action mới. |
| `CONSTITUTION.md` | Ghi quyết định CHỐT lần 2 (§1.11) trước khi code — bắt buộc theo quy trình ASK FIRST cho thay đổi trigger DB. |
| `CHANGELOG.md` | Entry mới. |

## Việc cần bạn làm
1. Chạy `0031_activity_log_more_events.sql` trên Supabase (SAU khi đã chạy `0030` — 2 file phụ thuộc thứ tự, không đảo được).
2. Test lại: sửa 1 giao dịch trong hộ, tạo/sửa ngân sách mới, góp quỹ tiết kiệm — cả 2 tài khoản (chủ hộ + thành viên) đều phải thấy đúng phạm vi (xem `CONSTITUTION.md` §1.11 để biết ai thấy gì).
3. Vẫn còn nợ: xác nhận `goal.completed` PASS/FAIL, và test lại vụ Realtime rớt event ở bản vá trước.
