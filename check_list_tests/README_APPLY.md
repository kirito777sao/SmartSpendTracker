# Cách áp T-S52 + T-S53 vào dự án thật của bạn

2 việc UI độc lập, không phụ thuộc nhau — thuần state phía client, không đổi
API/hook/RLS/schema.

## File đã sửa
- `src/components/BudgetLimits.tsx` (T-S52) — thêm phân trang 10 mục/trang
  cho danh sách category (khối chi tiêu + khối nguồn thu, 2 bộ trang độc
  lập), áp SAU ô tìm kiếm + toggle "Hiện nguồn thu" đã có sẵn từ trước.
- `src/components/SavingGoals.tsx` (T-S53) — thêm mới: ô tìm kiếm theo tên
  mục tiêu, toggle "Ẩn/Hiện đã hoàn thành" (mặc định ẨN), phân trang 10
  mục/trang riêng cho khối "đang tiết kiệm" và khối "đã hoàn thành".
- `CONSTITUTION.md`, `TASKS.md`, `CHANGELOG.md` — cập nhật trạng thái
  T-S52/T-S53 (⚪ → 🟡, chờ bạn test tay để đóng 🔒).

## Sau khi copy, chạy trên máy bạn

```
npx tsc --noEmit   # kỳ vọng: 29 lỗi (khớp baseline cũ), 0 lỗi mới
npm run build
```

(Trong sandbox này `npm run build`/`vite build` không chạy được do thiếu
binary native `@rollup/rollup-linux-x64-gnu` — lỗi môi trường sandbox, không
phải lỗi code. Trên máy bạn lệnh này sẽ chạy bình thường.)

## Test tay cần làm trước khi báo lại để đóng 🔒

**Ngân Sách (T-S52):**
1. Tạo (hoặc đã có sẵn) hơn 10 category chi tiêu → danh sách chỉ hiện đúng
   10 mục/trang, có nút chuyển trang trước/sau + "Trang X / Y".
2. Gõ từ khoá tìm kiếm → danh sách lọc đúng theo tên, tự nhảy về trang 1.
3. Bật "Hiện nguồn thu" (nếu có > 10 nguồn thu) → khối nguồn thu có phân
   trang RIÊNG, đổi trang khối này không ảnh hưởng trang khối chi tiêu đang
   xem và ngược lại.
4. Chọn "Chọn/Bỏ chọn tất cả đang hiện" khi đang ở trang 2 → chỉ chọn đúng
   các category đang hiện TRÊN TRANG 2, không chọn nhầm toàn bộ danh sách
   đã lọc (hành vi đổi có chủ đích, xem CHANGELOG).
5. Có ≤10 category → không thấy nút chuyển trang (ẩn hẳn).

**Tích Lũy (T-S53):**
1. Tạo (hoặc đã có sẵn) hơn 10 goal đang active → phân trang 10/trang cho
   khối này.
2. Bấm "Hiện đã hoàn thành" (mặc định đang ẨN) → nếu có > 10 goal đã hoàn
   thành, khối này có phân trang RIÊNG, độc lập với khối active.
3. Gõ từ khoá tìm kiếm → lọc đúng theo tên ở CẢ 2 khối cùng lúc, cả 2 trang
   tự nhảy về 1.
4. Mới vào tab Tích Lũy lần đầu → khối "Đã hoàn thành" phải đang ẨN theo
   mặc định (chỉ thấy 1 nút bấm "Hiện đã hoàn thành (N)").
5. Có ≤10 goal mỗi khối → không thấy nút chuyển trang khối đó.

**Regression cả 2 màn hình:** các hành động sẵn có (tạo/sửa/xoá category,
đóng góp quỹ, hoàn thành goal, dọn dẹp hàng loạt, toggle "Hiện nguồn thu"
cũ) vẫn hoạt động đúng như trước, không bị đổi hành vi bởi phân trang.

Báo lại kết quả (PASS/FAIL từng điểm) để mark T-S52/T-S53 🔒.
