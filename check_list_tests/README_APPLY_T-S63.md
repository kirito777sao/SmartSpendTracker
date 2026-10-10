# T-S63 — Danh sách file thay đổi + checklist test

Fix 2 vấn đề bạn phát hiện khi tạo nhiều goal cùng liên kết 1 category:
1. **Bug tài chính thật**: nhiều goal khác nhau cùng liên kết 1 category với
   khoảng ngày chồng lấp → cùng 1 khoản tiền bị nhiều goal cùng tính là
   "đã để dành". → **Chặn cứng ở DB** (migration mới).
2. **Gap ngữ nghĩa**: liên kết category tiêu dùng thường (không phải tiết
   kiệm/đầu tư) vẫn cộng tiền đã tiêu như tiền đã để dành. → **Cảnh báo mềm**
   (banner UI, không chặn — hệ thống không thể tự biết category nào là
   "tiết kiệm").

Xem đầy đủ phân tích + backlog dự phòng ở CONSTITUTION §1.13.1.

---

## 1. File CẦN CHẠY trên Supabase (bắt buộc, mới)

| File | Việc cần làm |
|---|---|
| `0020_saving_goals_prevent_cross_goal_link_overlap.sql` | Copy vào `supabase/migration/`, soát lại, rồi **tự chạy trên Supabase SQL Editor** (bật extension `btree_gist` + thêm 1 constraint mới trên `saving_goals`) |

## 2. File CODE đã SỬA (2 file — copy đè vào đúng vị trí cũ)

| File | Đường dẫn trong project | Thay đổi gì |
|---|---|---|
| `goals.ts` | `src/services/goals.ts` | Thêm helper `rethrowFriendlyLinkOverlapError()` — bắt lỗi Postgres `23P01` (vi phạm constraint mới), dịch sang thông báo tiếng Việt; áp dụng ở `createGoal()` và `updateGoalLink()` |
| `SavingGoals.tsx` | `src/components/SavingGoals.tsx` | Thêm banner cảnh báo mềm (màu vàng) ở CẢ form "Tạo Mục Tiêu" lẫn form "Sửa liên kết", hiện khi bật liên kết category |

Tìm đúng vị trí bằng comment `T-S63` trong 2 file.

## 3. File TÀI LIỆU đã cập nhật (tham khảo, không cần "apply")

| File | Thay đổi gì |
|---|---|
| `CONSTITUTION.md` | Thêm mục **§1.13.1** — mô tả đầy đủ 2 vấn đề, giải pháp, và **backlog phương án B** (cờ `is_savings_kind` cho category) dự phòng tương lai |
| `TASKS.md` | Thêm dòng **T-S63** (🟡 — chờ bạn chạy migration + test tay) |
| `CHANGELOG.md` | Thêm entry đầy đủ, gồm cả phần rà soát lỗ hổng tương tự đã kiểm tra |

## 4. Cách áp dụng

1. Copy `0020_...sql` vào `supabase/migration/`, soát lại, chạy trên Supabase.
2. Copy đè `goals.ts`, `SavingGoals.tsx` vào project.
3. Copy đè 3 file tài liệu (hoặc tự merge nếu bạn đã sửa thêm gì khác).
4. `npx tsc --noEmit` — kỳ vọng: 33 lỗi baseline, **0 lỗi mới**.
5. Test theo checklist bên dưới.

---

## 5. Checklist test tay

### A. Bug chính — chặn overlap giữa các goal khác nhau

1. Tạo goal A, liên kết category X, khoảng ngày **1/7 – 31/7**.
2. Tạo goal B MỚI, liên kết **CÙNG category X**, khoảng ngày **chồng lấp** (VD 15/7 – 15/8).
   - ✅ Kỳ vọng: bị **chặn**, hiện thông báo *"Danh mục này đang được liên kết với 1 mục tiêu khác trong khoảng thời gian trùng lặp..."* — KHÔNG tạo được goal B.
3. Đổi khoảng ngày goal B sang **KHÔNG chồng lấp** với goal A (VD 1/8 – 31/8) → tạo lại.
   - ✅ Kỳ vọng: tạo được bình thường.
4. Với 1 goal ĐÃ TỒN TẠI (thủ công hoặc liên kết category khác) → sửa liên kết sang category X, khoảng ngày chồng lấp goal A.
   - ✅ Kỳ vọng: cũng bị chặn y hệt (đi qua RPC `update_goal_link`), có thông báo lỗi rõ ràng trong form.
5. Với 1 goal đang liên kết category X — chỉ đổi khoảng ngày (giữ category X), đổi sang khoảng KHÔNG chồng lấp goal khác cũng đang liên kết X.
   - ✅ Kỳ vọng: lưu được bình thường.

### B. Banner cảnh báo mềm

6. Mở form "Tạo Mục Tiêu" → tick "Liên kết với 1 danh mục ngân sách" → banner vàng cảnh báo phải hiện ra, không chặn việc bấm Lưu.
7. Mở form "Sửa liên kết" của 1 goal → tick liên kết → banner vàng tương tự phải hiện.

### C. Regression

8. Tạo/sửa 1 goal liên kết category **không chồng lấp** với bất kỳ goal nào khác → hoạt động đúng như trước (không bị chặn nhầm).
9. Goal thủ công (không liên kết category) — tạo/sửa/góp quỹ bình thường, không bị ảnh hưởng.
10. Toàn bộ checklist T-S62 (đã PASS trước đó) vẫn phải PASS — không bị fix T-S63 làm hỏng lại.

### D. Kỹ thuật

11. `npx tsc --noEmit`: đúng 33 lỗi baseline, không phát sinh lỗi mới.
12. Migration `0020` chạy sạch trên Supabase — không lỗi (lưu ý: nếu dữ liệu HIỆN CÓ trên project của bạn đã có sẵn 2 goal chồng lấp category — VD "test tý"/"test he" trong ảnh bạn gửi — migration sẽ **BÁO LỖI khi thêm constraint** vì dữ liệu cũ đã vi phạm. Cần xử lý dữ liệu cũ (đổi ngày 1 trong 2 goal hoặc unlink bớt 1 cái) TRƯỚC khi chạy migration — báo lại nếu gặp lỗi này, tôi sẽ viết thêm bước dọn dữ liệu).

---

Báo lại PASS/FAIL từng mục (A1-A5, B6-B7, C8-C10, D11-D12) để mark T-S63 🔒.
