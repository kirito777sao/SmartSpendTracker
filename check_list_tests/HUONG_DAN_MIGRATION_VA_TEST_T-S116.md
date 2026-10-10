# T-S116 — Chặn trùng tên category (phương án A)

## ⚠️ BƯỚC BẮT BUỘC ĐẦU TIÊN: chạy migration

Sandbox không có kết nối tới Supabase thật, nên tôi **không tự chạy được**
migration này — bạn cần tự chạy trước khi test.

### Cách 1: Supabase Dashboard (dễ nhất)

1. Mở project Supabase → **SQL Editor**.
2. Mở file `supabase/migration/0034_categories_prevent_duplicate_name.sql`
   (có trong zip đính kèm), copy TOÀN BỘ nội dung.
3. **Khuyến nghị**: trước khi chạy migration thật, chạy riêng đoạn kiểm tra
   này để xem trước sẽ ảnh hưởng bao nhiêu category (an toàn, chỉ đọc):

```sql
select owner_id, household_id, name, type, count(*), array_agg(id order by created_at)
from public.categories
where deleted_at is null
group by owner_id, household_id, name, type
having count(*) > 1;
```

   Nếu ra kết quả — đó chính là 2 category "Ăn uống Test" bạn tạo lúc test
   T-S114 (và bất kỳ trùng lặp nào khác đã có từ trước). Migration sẽ tự
   động soft-delete category TẠO SAU trong mỗi nhóm trùng, giữ lại cái tạo
   sớm nhất.

4. Paste toàn bộ nội dung migration vào SQL Editor, bấm **Run**.
5. Nếu chạy thành công, không có lỗi đỏ nào hiện ra.

### Cách 2: Supabase CLI (nếu bạn dùng)

```bash
supabase db push
# hoặc
psql "$DATABASE_URL" -f supabase/migration/0034_categories_prevent_duplicate_name.sql
```

---

## Checklist test SAU KHI đã chạy migration

- [ ] Vào tab **Ngân Sách**, thử tạo category mới trùng TÊN + trùng LOẠI
      (thu/chi) với 1 category đã có sẵn → **PHẢI bị chặn**, hiện thông báo:
      *"Tên danh mục này đã được dùng cho 1 danh mục khác cùng loại..."*
      (không phải lỗi Postgres thô như `duplicate key value violates...`).
- [ ] Thử tạo category trùng tên nhưng KHÁC loại (1 cái expense, 1 cái
      income, cùng tên) → PHẢI cho phép tạo bình thường (constraint chỉ áp
      trong cùng loại).
- [ ] Xoá 1 category bất kỳ (soft-delete qua nút Xoá trong app) → tạo lại
      1 category MỚI trùng đúng tên category vừa xoá → **PHẢI cho phép**
      (không bị chặn nhầm — constraint chỉ áp cho category CHƯA xoá).
- [ ] Kiểm tra 2 category "Ăn uống Test" bạn tạo lúc test T-S114 trước đó:
      sau migration, 1 trong 2 sẽ tự động bị soft-delete (cái tạo sau) —
      xác nhận cái còn lại (tạo sớm hơn) vẫn hiển thị đúng, hạn mức và giao
      dịch liên quan không bị mất.
- [ ] Vào tab **Nhập Liệu AI → Smart Advisor/Phân bổ tự động** (nơi dùng
      `SmartAllocator.tsx`), bấm "Áp Dụng" 1 lần bình thường — vẫn chạy
      trơn tru, không lỗi (đường này đã tự kiểm tra trùng tên từ trước nên
      không bị ảnh hưởng).

---

**Sau khi ✅ hết**: báo lại để khoá 🔒 T-S116, hoàn tất toàn bộ đợt audit
logic dòng tiền 19/08/2026 (T-S112/113/114/115/116).
