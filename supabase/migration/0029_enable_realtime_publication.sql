-- [T-S08] Bật Supabase Realtime (postgres_changes) cho transactions/
-- categories/saving_goals — thay polling 4 giây đã xoá khỏi App.tsx từ
-- T-S06f-b3. Xem CONSTITUTION.md §1 "Đồng bộ realtime: Supabase Realtime
-- (postgres_changes), thay hoàn toàn cơ chế poll 4 giây" — quyết định stack
-- đã CHỐT từ đầu dự án, migration này chỉ hiện thực hoá phần hạ tầng DB.
--
-- REPLICA IDENTITY FULL: mặc định Postgres chỉ gửi kèm primary key trong
-- payload sự kiện UPDATE/DELETE qua logical replication. Client-side filter
-- (`household_id=eq.<id>`/`owner_id=eq.<id>`, xem src/hooks/useRealtimeSync.ts)
-- cần cột đó có mặt trong payload để so khớp đúng — đặc biệt quan trọng cho
-- sự kiện DELETE (OLD record), khi client cần biết row vừa xoá thuộc hộ/
-- user nào để quyết định có bắn event hay không. Không ảnh hưởng RLS/bảo
-- mật — RLS vẫn là lớp chặn thật (CONSTITUTION §3), filter này thuần tối ưu
-- giảm nhiễu event không liên quan.
alter table public.transactions replica identity full;
alter table public.categories replica identity full;
alter table public.saving_goals replica identity full;

-- Idempotent: bỏ qua nếu bảng đã có sẵn trong publication (chạy lại migration
-- này không lỗi nếu ai đó đã bật thủ công qua Dashboard trước đó).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'transactions'
  ) then
    alter publication supabase_realtime add table public.transactions;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'categories'
  ) then
    alter publication supabase_realtime add table public.categories;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'saving_goals'
  ) then
    alter publication supabase_realtime add table public.saving_goals;
  end if;
end $$;
