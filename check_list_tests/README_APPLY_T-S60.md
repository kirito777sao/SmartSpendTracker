# T-S60 — "Rút quỹ" (thay "Hoàn thành" 1 lần) — Danh sách file + checklist test

## 1. File CẦN CHẠY trên Supabase (bắt buộc, mới)

| File | Việc cần làm |
|---|---|
| `0021_saving_goals_withdraw_from_linked.sql` | Copy vào `supabase/migration/`, soát lại, chạy trên Supabase SQL Editor (thêm RPC `withdraw_from_linked_goal` — KHÔNG đổi cột/bảng nào) |

## 2. File CODE đã SỬA/THÊM (6 file — copy đè vào đúng vị trí cũ)

| File | Đường dẫn trong project | Thay đổi gì |
|---|---|---|
| `types.ts` | `src/types.ts` | `LinkedHistoryEntry` thêm `type:"withdrawal_log"` + field `note` |
| `database.types.ts` | `src/lib/database.types.ts` | Đồng bộ `LinkedHistoryEntry` + khai báo `Functions.withdraw_from_linked_goal` |
| `mapRows.ts` | `src/lib/mapRows.ts` | Map thêm `note` |
| `goals.ts` | `src/services/goals.ts` | Thêm `withdrawFromLinkedGoal()` |
| `useGoals.ts` | `src/hooks/useGoals.ts` | Thêm `useWithdrawFromLinkedGoal()` + `useWithdrawFromManualGoal()` |
| `SavingGoals.tsx` | `src/components/SavingGoals.tsx` | Đổi nút "Hoàn thành" → "Rút quỹ" (lặp lại được), form chọn nguồn rút, modal Lịch sử thêm khối "Đã rút từ phần liên kết" |

Tìm đúng vị trí bằng comment `T-S60` trong các file.

## 3. Cách áp dụng

1. Copy `0021_...sql` vào `supabase/migration/`, chạy trên Supabase.
2. Copy đè 6 file code vào project.
3. `npx tsc --noEmit` — kỳ vọng: 34 lỗi (33 baseline cũ + đúng 1 lỗi mới cùng lớp "RPC-typing" đã biết ở `update_goal_link`/`delete_goal`, không phải bug thật).
4. Build lại/restart dev server + hard-refresh trình duyệt (bài học từ T-S63 — đừng quên bước này).
5. Test theo checklist bên dưới.

---

## 4. Checklist test tay

### A. Rút từ phần liên kết (chỉ ghi log)
1. Chọn 1 goal đang liên kết category, có "đã chi qua liên kết" > 0 → bấm "Rút quỹ".
2. Nếu goal CHỈ có số dư liên kết (không có phần thủ công) → KHÔNG thấy radio chọn nguồn, chỉ có ô ghi chú + số tiền.
3. Nhập số tiền + ghi chú → Lưu → kiểm tra **Sổ Giao Dịch KHÔNG có giao dịch mới nào được tạo**.
4. Mở modal "Lịch sử" của goal đó → thấy khối MỚI "Đã rút từ phần liên kết" (nền hồng), hiện đúng ghi chú + số tiền + ngày.
5. Tổng "Đã có" của goal **không đổi** sau khi rút phần liên kết (đúng thiết kế — chỉ log, không trừ gì).

### B. Rút từ phần thủ công (tạo giao dịch thật)
6. Chọn 1 goal có phần thủ công (carriedOverSaved hoặc current_amount thủ công > 0) → "Rút quỹ".
7. Nếu CHỈ có phần thủ công → không thấy radio, chỉ hiện category dropdown bắt buộc chọn.
8. Nhập số tiền + chọn category + Lưu → kiểm tra Sổ Giao Dịch có đúng 1 giao dịch `expense` mới, gắn đúng goal.

### C. Goal có CẢ 2 loại số dư
9. Bấm "Rút quỹ" → thấy radio "Phần liên kết (còn X)" / "Phần thủ công (còn Y)", số tiền hiển thị đúng.
10. Không chọn radio, nhập số tiền, bấm Lưu → bị chặn, báo lỗi "vui lòng chọn nguồn rút".

### D. Đóng mục tiêu
11. Tick "Đóng mục tiêu sau khi rút" (không nhập số tiền) → Lưu được, goal chuyển sang danh sách "Đã hoàn thành".
12. Rút tiền nhưng KHÔNG tick đóng → goal vẫn ở danh sách active, nút "Rút quỹ" vẫn hiện, rút tiếp lần 2 được bình thường.

### E. Regression
13. Goal thủ công/liên kết bình thường không thao tác gì → không đổi hành vi.
14. Banner tự động "Đánh dấu hoàn thành" ở `SmartInput`/`AIAssistantBubble` (T-S20/T-S59) vẫn hoạt động như cũ (không bị ảnh hưởng bởi thay đổi này).

### F. Kỹ thuật
15. `npx tsc --noEmit`: đúng 34 lỗi, không có lỗi mới ngoài 1 lỗi RPC-typing đã nêu.

---

Báo lại PASS/FAIL từng mục để mark T-S60 🔒.
