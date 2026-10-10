# T-S12 — Danh sách file đã thêm mới

## File MỚI
| File | Nội dung |
|---|---|
| `src/services/__tests__/rlsHardening.test.ts` | Test tích hợp thật — cố tình UPDATE thẳng `profiles.household_id`/`household_role` bằng 1 `household_id` **THẬT** (tạo qua RPC hợp lệ rồi rời hộ → ownerless, xem T-S15), bypass hẳn RPC `join_household_by_code`, kỳ vọng bị chặn ở tầng DB/RLS thật. |

## ⚠️ Lịch sử phát hiện (đọc để hiểu vì sao test được sửa 1 lần)

**Lần chạy đầu (UUID giả toàn số 0)**: test PASS, nhưng vì lý do SAI — bị chặn
bởi FK constraint (`profiles_household_fk`, "Key is not present in table
households"), không phải vì RLS/quyền theo cột. Đây là **false positive** —
không loại trừ được khả năng dùng 1 `household_id` **có thật** vẫn tấn công
thành công.

**Đã sửa lại 18/08/2026**: test giờ tự tạo 1 household thật (`createHousehold`
RPC), rồi rời hộ (`leaveHousehold`) để có 1 `household_id` thật đang ở trạng
thái "ownerless" (T-S15 — không bị xoá cứng), sau đó thử UPDATE thẳng gán lại
đúng id đó + `household_role='owner'`, bỏ qua hẳn logic invite-code của
`join_household_by_code`. Đây mới là bài test đúng nghĩa cho acceptance
criteria gốc.

Rà lại CONSTITUTION §3, policy hiện có trên `profiles`:

```sql
create policy "update own profile fields"
on public.profiles for update using (id = auth.uid());
```

Policy này chỉ giới hạn **hàng nào** được sửa — RLS không có khái niệm chặn
theo cột. Không tìm thấy `REVOKE UPDATE(column)` hay trigger `BEFORE UPDATE`
nào canh 2 cột này trong migration. Bảo vệ hiện có chỉ nằm ở tầng TypeScript.
**Kết quả test bằng id thật mới là bằng chứng đáng tin** cho việc lỗ hổng có
tồn tại hay không.

## Không tự vá ở đây

Việc vá (trigger `BEFORE UPDATE` canh 2 cột, hoặc `REVOKE
UPDATE(household_id, household_role) FROM authenticated`) thuộc "Đổi cấu
trúc/quyền đã chốt ở §2-§3" — theo bảng ranh giới §5, KHÔNG tự viết migration
vá trong task T-S12 (phạm vi chỉ là "viết test xác nhận"). Sẽ đề xuất hướng
vá cụ thể sau khi có kết quả chạy thật.

## Cách chạy

```bash
npm test -- rlsHardening
```

