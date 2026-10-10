# Checklist test tay — T-S83 (Gom lịch sử "Rút quỹ" bị cascade cả 2 nguồn)

Migration `0023` phải chạy xong trên Supabase trước khi test các mục dưới đây.

---

## A. Rút cascade thật (trọng tâm)
- [ ] Goal có **cả 2 nguồn** khả dụng (vd liên kết còn 135.000đ, thủ công còn 165.000đ).
- [ ] Rút số tiền **vượt 1 nguồn nhưng ≤ tổng cả 2** (vd 300.000đ) → chọn category cho phần thủ công → Lưu.
- [ ] Sổ Giao Dịch: đúng 1 giao dịch `expense` mới = đúng phần thủ công (vd 165.000đ) — không đổi so với trước T-S83.
- [ ] Modal "Lịch sử": khối "Đã rút quỹ" hiện **ĐÚNG 1 dòng** cho lần rút này (không phải 2 dòng rời rạc).
- [ ] Dòng đó có badge "Gộp 2 nguồn".
- [ ] Dòng phụ ghi đúng "liên kết X + thủ công Y".
- [ ] Số tổng bên phải = đúng tổng đã rút (vd −300.000đ).
- [ ] Danh sách "đang sống" bên dưới **không** hiện lặp lại dòng thủ công của lần rút đã gộp này.

## B. Rút chỉ 1 nguồn (regression)
- [ ] Rút không vượt nguồn đã chọn → hành vi/hiển thị **giống hệt trước T-S83**.
- [ ] Khối "Đã rút quỹ" hiện dòng bình thường, **không có** badge "Gộp 2 nguồn".
- [ ] Rút thuần thủ công (không cascade) → dòng "💸 rút quỹ" vẫn hiện đúng ở danh sách "đang sống" như cũ.

## C. Sắp xếp
- [ ] Thực hiện nhiều lần rút (mix cascade + đơn nguồn) → khối "Đã rút quỹ" sắp đúng thứ tự mới nhất trước, xuyên suốt cả 2 loại.

## D. Regression khác (không thuộc phạm vi T-S83, chỉ liếc qua)
- [ ] Card tóm tắt "Đã hoàn thành" (T-S82) vẫn hiện đúng breakdown thủ công/liên kết + Dư/Thiếu — không đổi.
- [ ] Goal chỉ có 1 loại nguồn (không bao giờ cascade được) → không có gì thay đổi.

## E. Kỹ thuật
- [ ] Migration `0023` chạy sạch trên Supabase thật, không phá dữ liệu `transactions`/`saving_goals` hiện có.
- [ ] `npx tsc --noEmit`: không có lỗi mới so với baseline ở 6 file đã sửa.

---

**Sau khi test xong, báo lại mục nào PASS / FAIL kèm mô tả ngắn — sẽ cập nhật TASKS.md (T-S83 → 🔒) + CHANGELOG.md tương ứng.**
