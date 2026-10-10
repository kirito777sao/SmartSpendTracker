-- Chạy trong Supabase SQL editor (dùng quyền service role / dashboard, bỏ qua RLS)
-- để xem TẤT CẢ dòng transfer gắn goal này, KHÔNG lọc theo scope.

select
  id, owner_id, household_id, member_id, type, amount, date,
  deleted_at, description, created_at
from public.transactions
where goal_id = '<GOAL_ID>'
order by created_at;

-- So tổng thật (mọi scope, còn sống) với current_amount đang lưu:
select
  (select current_amount from public.saving_goals where id = '<GOAL_ID>') as db_current_amount,
  (select coalesce(sum(amount), 0) from public.transactions
     where goal_id = '<GOAL_ID>' and type = 'transfer' and deleted_at is null) as sum_all_scope,
  (select owner_id from public.saving_goals where id = '<GOAL_ID>') as goal_owner_id,
  (select household_id from public.saving_goals where id = '<GOAL_ID>') as goal_household_id;
