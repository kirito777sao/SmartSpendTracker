select
  g.id, g.name, g.current_amount as db_current_amount,
  coalesce(t.sum_live, 0) as real_sum,
  g.current_amount - coalesce(t.sum_live, 0) as diff
from public.saving_goals g
left join (
  select goal_id, sum(amount) as sum_live
  from public.transactions
  where type = 'transfer' and deleted_at is null and goal_id is not null
  group by goal_id
) t on t.goal_id = g.id
where g.deleted_at is null
  and g.linked_category_id is null
  and g.current_amount <> coalesce(t.sum_live, 0);
