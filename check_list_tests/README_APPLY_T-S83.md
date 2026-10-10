# T-S83 — Gom lịch sử "Rút quỹ" bị cascade cả 2 nguồn thành 1 nhóm — Danh sách file + checklist test

## 1. File CẦN CHẠY trên Supabase (bắt buộc, mới)

| File | Việc cần làm |
|---|---|
| `0023_transactions_withdrawal_group_id.sql` | Copy vào `supabase/migration/`, soát lại, chạy trên Supabase SQL Editor. Thêm cột `transactions.withdrawal_group_id` (uuid, nullable — KHÔNG phá dữ liệu cũ) + `CREATE OR REPLACE` lại RPC `withdraw_from_linked_goal` (thêm 1 tham số mới có `default null` — lời gọi cũ vẫn chạy y hệt). KHÔNG đổi/xoá 0018-0022 đã chạy trước đó. |

## 2. File CODE đã SỬA/THÊM (7 file — copy đè vào đúng vị trí cũ)

| File | Đường dẫn trong project | Thay đổi gì |
|---|---|---|
| `types.ts` | `src/types.ts` | Thêm `Transaction.withdrawalGroupId` + `LinkedHistoryEntry.withdrawalGroupId` |
| `database.types.ts` | `src/lib/database.types.ts` | Đồng bộ cột `withdrawal_group_id` ở `transactions` (Row/Insert) + `LinkedHistoryEntry` (jsonb shape) |
| `mapRows.ts` | `src/lib/mapRows.ts` | Map `row.withdrawal_group_id` → `withdrawalGroupId` (transaction) và `h.withdrawal_group_id` → `withdrawalGroupId` (linked history entry) |
| `goals.ts` | `src/services/goals.ts` | `withdrawFromLinkedGoal()` nhận thêm tham số tuỳ chọn `withdrawalGroupId`, truyền `p_withdrawal_group_id` xuống RPC |
| `useGoals.ts` | `src/hooks/useGoals.ts` | `useWithdrawFromLinkedGoal()` nhận thêm `withdrawalGroupId` trong object truyền vào `.mutate()` |
| `SavingGoals.tsx` | `src/components/SavingGoals.tsx` | `handleSaveWithdraw` sinh `withdrawalGroupId` khi cascade thật; hàm mới `withdrawalGroupsFor()`; khối "Đã rút quỹ" trong modal Lịch sử gom hiển thị theo nhóm; `goalHistoryFor` lọc tránh hiện trùng |

Tìm đúng vị trí bằng comment `T-S83` trong các file.

## 3. Tài liệu đã cập nhật (tham khảo, không cần "áp dụng")

- `CONSTITUTION.md` — thêm §1.23 (quyết định thiết kế đầy đủ).
- `TASKS.md` — thêm dòng `T-S83`, trạng thái 🟡 (chờ test tay xác nhận).
- `CHANGELOG.md` — entry `[T-S83] 14/08/2026`.

## 4. Cách áp dụng

1. Copy `0023_...sql` vào `supabase/migration/`, đọc lại 1 lượt, chạy trên Supabase SQL Editor.
2. Copy đè 6 file code vào đúng vị trí trong project (giữ nguyên đường dẫn ở bảng trên).
3. `npm install` lại nếu trước đó project bị xoá `node_modules` (bản zip gửi không kèm `node_modules`/`dist` để nhẹ file — cần cài lại bằng `npm install`).
4. `npx tsc --noEmit` — kỳ vọng: không có lỗi MỚI nào phát sinh ở 6 file vừa sửa (baseline lỗi cũ thuộc lớp generic Supabase client — pre-existing, không liên quan task này).
5. Build lại/restart dev server + hard-refresh trình duyệt (bài học từ T-S63 — đừng quên bước này).
6. Test theo checklist bên dưới (cũng có ở `checklist-T-S83.md`).

---

## 5. Checklist test tay

### A. Rút cascade thật (trọng tâm của T-S83)
1. Chọn 1 goal có **CẢ 2 nguồn** khả dụng (vd liên kết còn 135.000đ, thủ công còn 165.000đ).
2. Bấm "Rút quỹ" → chọn 1 nguồn bất kỳ (vd "Phần thủ công"), nhập số tiền **lớn hơn** số dư nguồn đã chọn nhưng **nhỏ hơn hoặc bằng** tổng cả 2 nguồn (vd nhập 300.000đ) → chọn category cho phần thủ công → Lưu.
3. Sổ Giao Dịch: có đúng 1 giao dịch `expense` mới, đúng số tiền phần thủ công (vd 165.000đ) — **không đổi so với hành vi cũ**.
4. Mở modal "Lịch sử" của đúng goal đó:
   - Thấy khối "Đã rút quỹ" (nền hồng) hiện **ĐÚNG 1 dòng** cho lần rút này, KHÔNG phải 2 dòng rời rạc.
   - Dòng đó có badge nhỏ "Gộp 2 nguồn".
   - Dòng phụ ghi rõ "liên kết 135.000đ + thủ công 165.000đ" (đúng số thật).
   - Số tổng bên phải hiện đúng tổng đã rút (vd −300.000đ).
5. Danh sách "đang sống" bên dưới khối rose — **KHÔNG** còn thấy dòng "💸 rút quỹ" phần thủ công của lần rút này lặp lại lần nữa (đã gom lên khối phía trên).

### B. Rút chỉ 1 nguồn (regression — phải giống hệt trước T-S83)
6. Goal chỉ đủ 1 nguồn (hoặc nhập số tiền không vượt nguồn đã chọn) → rút bình thường.
7. Modal "Lịch sử" → khối "Đã rút quỹ" hiện dòng bình thường, **KHÔNG có badge "Gộp 2 nguồn"**.
8. Nếu là rút thuần thủ công → dòng "💸 rút quỹ" vẫn hiện đúng như cũ ở danh sách "đang sống" (không bị ẩn nhầm — chỉ ẩn khi có `withdrawalGroupId`).

### C. Sắp xếp
9. Thực hiện 2-3 lần rút (mix cascade + đơn nguồn) cách nhau vài phút → khối "Đã rút quỹ" hiện đúng thứ tự **mới nhất trước**, xuyên suốt cả 2 loại (gộp lẫn không gộp).

### D. Kỹ thuật
10. `npx tsc --noEmit`: không có lỗi mới ở 6 file đã sửa.
11. Migration `0023` chạy sạch trên Supabase thật, không phá dữ liệu cũ (dữ liệu `transactions`/`linked_history` hiện có đọc lại vẫn đúng như trước, cột mới mặc định `null`).

---

Báo lại PASS/FAIL từng mục để mark T-S83 🔒.
