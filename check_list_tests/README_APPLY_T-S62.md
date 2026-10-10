# T-S62 — Danh sách file thay đổi + checklist test

Fix bug: link → unlink → link lại cùng category → tổng bị nhân đôi (dù
migration `0019`/T-S61 đã fix xong bước "đóng băng"). Gốc rễ: cột
`carried_over_transaction_ids` (đã có sẵn ở DB từ 0019) chưa được đưa sang
client để lọc phần "đang sống". Xem đầy đủ ở CONSTITUTION §1.20.2.

**KHÔNG cần chạy migration nào** — chỉ đổi code client, cột DB đã có sẵn.

---

## 1. File CODE đã SỬA (3 file — copy đè vào đúng vị trí cũ trong project)

| File | Đường dẫn trong project | Thay đổi gì |
|---|---|---|
| `types.ts` | `src/types.ts` | Thêm field `carriedOverTransactionIds: string[]` vào interface `SavingGoal` |
| `mapRows.ts` | `src/lib/mapRows.ts` | `rowToGoal` map thêm `row.carried_over_transaction_ids ?? []` |
| `SavingGoals.tsx` | `src/components/SavingGoals.tsx` | Thêm `carriedIdsByGoal` (lookup goalId → Set ID giao dịch đã đóng băng); lọc theo ID này trong `contributionsByGoal` (goal thủ công) VÀ `linkedAmountByGoal`/`linkedHistoryByGoal` (goal liên kết) trước khi cộng/hiện |

Tìm đúng vị trí sửa bằng comment `T-S62` trong 3 file (đã đánh dấu rõ).

## 2. File TÀI LIỆU đã cập nhật (đối chiếu/tham khảo, không cần "apply" vào code)

| File | Thay đổi gì |
|---|---|
| `CONSTITUTION.md` | Thêm mục **§1.20.2** — mô tả đầy đủ bug, gốc rễ, giải pháp, quy tắc rút ra |
| `TASKS.md` | Thêm dòng **T-S62** (trạng thái 🟡 — chờ bạn test tay) |
| `CHANGELOG.md` | Thêm entry **"T-S62 — dedup ID chưa áp cho phần đang sống"** ở cuối file |

## 3. Cách áp dụng

1. Copy đè 3 file code (mục 1) vào đúng đường dẫn cũ trong project của bạn.
2. Copy đè 3 file tài liệu (mục 2) — hoặc tự merge tay nếu bạn đã sửa thêm gì khác kể từ lần trước.
3. Chạy `npx tsc --noEmit` — kỳ vọng: 33 lỗi (khớp baseline cũ), **0 lỗi mới**.
4. `npm run build` (hoặc `npm run dev`) rồi test theo checklist bên dưới.

---

## 4. Checklist test tay (bắt buộc làm đủ trước khi báo lại để đóng 🔒 T-S62)

### A. Test chính — tái hiện đúng kịch bản đã lỗi

1. Mở 1 goal **đang liên kết** category (vd "test tý" liên kết "test nè") — ghi lại số "Đã có" hiện tại (VD: 23.000đ).
2. Bấm sửa liên kết → **bỏ tick** liên kết (Unlink) → Lưu.
   - ✅ Kỳ vọng: số "Đã có" **không đổi** hoặc giảm đúng phần "đang sống" cũ, dòng "đã chi qua liên kết" giữ nguyên (không tăng).
3. Bấm sửa liên kết lại → **tick liên kết** → chọn lại ĐÚNG category vừa gỡ (có thể đổi khoảng ngày khác, miễn category giống) → Lưu.
   - ✅ Kỳ vọng: số "Đã có" **giữ nguyên đúng bằng bước 1** (KHÔNG nhân đôi). Đây là điểm bug cũ sai nhiều nhất (23k → 46k).
4. Lặp lại bước 2-3 thêm 1-2 lần nữa (unlink → link lại) — số phải **luôn ổn định**, không tăng dần theo số lần thao tác.

### B. Test modal "Lịch sử"

5. Mở modal "Lịch sử" của goal vừa test → giao dịch từng bị đóng băng (VD "Mua test") chỉ được hiện **đúng 1 lần** — trong khối "Giai đoạn trước đó (đã đóng băng)" — **KHÔNG** xuất hiện lặp lại ở danh sách "đang sống" bên dưới.
6. Dòng "Tổng đã tích luỹ" ở chân modal khớp đúng với "Đã có" ở thẻ ngoài.

### C. Regression — không phá vỡ case cũ đang chạy đúng

7. Goal **thủ công thường** (chưa từng link category lần nào, ví dụ "mua xịt"): góp quỹ vào bình thường → số "Đã có" tính đúng như trước, không bị lọc nhầm giao dịch nào (vì `carriedOverTransactionIds` rỗng).
8. Goal **liên kết category lần đầu** (chưa từng unlink/relink): số "đang sống" vẫn tính đúng = tổng chi tiêu thật trong category+khoảng ngày, không bị lọc thiếu.
9. **Chỉ đổi khoảng ngày, giữ nguyên category** (không unlink) trên 1 goal đang liên kết: số phải tính lại đúng theo khoảng ngày mới, không dồn gì thêm — case này vẫn hoạt động như thiết kế §1.20 gốc.
10. Goal đã liên kết rồi chuyển sang **thủ công có góp quỹ mới** (transfer sau khi unlink): khoản góp mới phải hiện đúng trong "Lịch sử góp quỹ" (không bị lọc nhầm — chỉ lọc giao dịch CŨ đã đóng băng, không lọc giao dịch mới).

### D. Kiểm tra kỹ thuật

11. `npx tsc --noEmit`: đúng 33 lỗi baseline, không phát sinh lỗi mới ở `types.ts`/`mapRows.ts`/`SavingGoals.tsx`.

---

Báo lại PASS/FAIL từng mục (A1-A4, B5-B6, C7-C10, D11) để mark T-S62 🔒 trong TASKS.md.
