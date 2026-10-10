-- 0032_activity_log_retention_cleanup.sql
-- T-S97 (đề xuất quản lý thông báo, người dùng xác nhận làm 18/08/2026) —
-- `activity_log` được 7 trigger (0030/0031) ghi liên tục theo mọi giao
-- dịch/mục tiêu/hạn mức thật, KHÔNG có cơ chế xoá/lưu trữ nào từ trước tới
-- giờ -> bảng phình vô hạn theo thời gian dù UI chỉ luôn đọc N dòng mới
-- nhất (không ảnh hưởng UI, nhưng ảnh hưởng kích thước DB/tốc độ index về
-- lâu dài). Ở quy mô app cá nhân/hộ gia đình (không phải app doanh
-- nghiệp), xoá thẳng dữ liệu cũ là đủ — không cần archive sang bảng riêng.
--
-- Giữ lại 90 ngày (đủ dài để không ai cần xem thông báo cũ hơn 3 tháng
-- trong 1 app chi tiêu cá nhân). Chạy 1 lần/ngày lúc 03:00 UTC (giờ thấp
-- điểm) qua pg_cron — extension có sẵn trên mọi project Supabase, chỉ cần
-- bật.
--
-- LƯU Ý: cần chạy migration này trên Supabase THẬT — sandbox không verify
-- được pg_cron (không có quyền tạo extension/lịch chạy nền trong môi
-- trường code review). Sau khi chạy, kiểm tra bằng:
--   select * from cron.job where jobname = 'cleanup_old_activity_log';

begin;

create extension if not exists pg_cron with schema extensions;

create or replace function public.cleanup_old_activity_log()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.activity_log
  where created_at < now() - interval '90 days';
$$;

comment on function public.cleanup_old_activity_log() is
  'T-S97: xoá activity_log cũ hơn 90 ngày, chạy định kỳ qua pg_cron (xem cron.job "cleanup_old_activity_log"). Không archive, xoá thẳng — đủ dùng ở quy mô app cá nhân/hộ gia đình.';

-- Gỡ job cũ cùng tên nếu re-run migration (idempotent).
select cron.unschedule(jobid)
from cron.job
where jobname = 'cleanup_old_activity_log';

select cron.schedule(
  'cleanup_old_activity_log',
  '0 3 * * *',
  $$select public.cleanup_old_activity_log();$$
);

commit;
