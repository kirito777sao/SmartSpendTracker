-- 0034_categories_prevent_duplicate_name.sql
-- T-S114 (phương án A) — CHỐT 19/08/2026, xem CONSTITUTION.md + CHANGELOG.md
-- cùng ngày.
--
-- Vấn đề gốc: `categories.name` không có ràng buộc UNIQUE nào. 2 category
-- khác `id` có thể trùng tên (cùng owner/household + cùng type). Toàn bộ
-- form chọn category ở UI (SmartInput/TransactionHistory/AIAssistantBubble/
-- SavingGoals — 10 vị trí `<select><option value={c.name}>`) dùng TÊN làm
-- giá trị chọn, không phải id — với HTML `<select>`, 2 `<option>` cùng
-- `value` KHÔNG THỂ phân biệt được ở tầng trình duyệt, nên khi trùng tên,
-- người dùng dù chọn dòng nào trong dropdown, giá trị gửi về luôn giống
-- nhau, sau đó `resolveCategoryId()` (`toTransactionInsert.ts`) luôn khớp
-- vào category ĐẦU TIÊN cùng tên — mọi giao dịch bị gán nhầm category_id,
-- ngân sách 1 thẻ cộng dồn sai, thẻ kia không bao giờ nhận được giao dịch
-- nào. Bug thật, người dùng tự phát hiện qua test tay T-S114.
--
-- Đã cân nhắc "phương án B" (đổi toàn bộ 10 dropdown + resolveCategoryId
-- sang dùng id) nhưng từ chối — rủi ro cao hơn hẳn (động vào đúng luồng ghi
-- giao dịch tiền thật ở 5 file khác nhau) mà không giải quyết thêm gì so
-- với chặn trùng tên từ gốc. Chọn phương án A: ngăn trạng thái mơ hồ đó
-- KHÔNG BAO GIỜ được tạo ra, thay vì cố phân biệt 2 thứ vốn dĩ không thể
-- phân biệt được bằng tên.

begin;

-- ==========================================================================
-- BƯỚC 1 — dọn dữ liệu cũ đang vi phạm (nếu có) TRƯỚC khi tạo unique index,
-- nếu không migration sẽ fail thẳng ở BƯỚC 2. Giữ lại row TẠO SỚM NHẤT
-- (created_at nhỏ nhất) trong mỗi nhóm trùng tên — khớp đúng hành vi bug
-- cũ (`resolveCategoryId` luôn khớp category ĐẦU TIÊN theo thứ tự query,
-- không đảm bảo là created_at sớm nhất, nhưng đây là quy ước hợp lý nhất
-- để không mất dữ liệu người dùng đã cố ý đặt hạn mức cho category giữ
-- lại). Các category TRÙNG bị xoá theo kiểu SOFT DELETE (đúng quy ước dự
-- án, xem `deleted_at`), KHÔNG xoá cứng — người dùng vẫn xem lại được nếu
-- cần, và các giao dịch cũ tham chiếu `category_id` của category đã xoá
-- vẫn hiển thị đúng qua fallback "Khác" ở `mapRows.ts` (đã có sẵn).
--
-- CHẠY THỬ TRƯỚC (không sửa gì) — bỏ comment đoạn SELECT dưới đây để tự
-- kiểm tra sẽ ảnh hưởng bao nhiêu category trước khi chạy migration thật:
--
-- select owner_id, household_id, name, type, count(*), array_agg(id order by created_at)
-- from public.categories
-- where deleted_at is null
-- group by owner_id, household_id, name, type
-- having count(*) > 1;

with duplicates as (
  select
    id,
    row_number() over (
      partition by coalesce(owner_id::text, ''), coalesce(household_id::text, ''), name, type
      order by created_at asc, id asc
    ) as rn
  from public.categories
  where deleted_at is null
)
update public.categories c
set deleted_at = now()
from duplicates d
where c.id = d.id
  and d.rn > 1;

-- ==========================================================================
-- BƯỚC 2 — ràng buộc UNIQUE thật, chỉ áp cho category CHƯA xoá
-- (`deleted_at is null`) — cho phép tạo lại tên đã dùng bởi 1 category đã
-- xoá trước đó (không khoá vĩnh viễn 1 cái tên chỉ vì từng bị xoá).
-- Dùng PARTIAL UNIQUE INDEX (không phải `constraint ... unique`) vì cần
-- điều kiện `where deleted_at is null` — Postgres chỉ hỗ trợ điều kiện lọc
-- qua index, không qua table constraint thường.
-- ==========================================================================
create unique index categories_unique_active_name_per_scope
  on public.categories (
    coalesce(owner_id::text, ''),
    coalesce(household_id::text, ''),
    name,
    type
  )
  where deleted_at is null;

commit;

-- ==========================================================================
-- GHI CHÚ VẬN HÀNH
-- ==========================================================================
-- - Sau migration này, INSERT/UPDATE category trùng tên (cùng scope + cùng
--   type, category kia chưa xoá) sẽ bị Postgres từ chối với lỗi
--   `duplicate key value violates unique constraint
--   "categories_unique_active_name_per_scope"` (mã lỗi 23505).
-- - `BudgetLimits.tsx` (`handleSaveAdd`/`handleSaveEdit`) CẦN bắt lỗi 23505
--   này và hiện thông báo dễ hiểu ("Tên danh mục này đã được dùng") thay vì
--   để lỗi Postgres thô lộ ra UI — xem thay đổi kèm theo ở T-S114 phần code
--   client, không nằm trong file migration này.
-- - KHÔNG áp constraint cho category ĐÃ xoá (`deleted_at` khác null) — nếu
--   không, người dùng xoá 1 category rồi tạo lại đúng tên đó sẽ bị chặn vô
--   lý dù không còn xung đột thật nào.
