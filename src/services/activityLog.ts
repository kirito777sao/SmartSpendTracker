import { supabase } from "../lib/supabaseClient";
import type { Database } from "../lib/database.types";

type ActivityLogRow = Database["public"]["Tables"]["activity_log"]["Row"];

/**
 * [T-S27] Khác `listCategories`/`listGoals` (nhận `scope` tường minh vì
 * "2 chế độ tách biệt" — PRD.md), chuông KHÔNG tách theo scope hiện tại:
 * người dùng cần thấy CẢ thông báo cá nhân (budget.exceeded ở sổ cá nhân)
 * LẪN thông báo hộ gia đình cùng lúc, bất kể đang xem sổ nào. RLS
 * ("read own or household activity", migration 0030) đã tự trả đúng đúng 2
 * scope đó — không cần (và không nên) lọc thêm ở query, tránh lệch nếu RLS
 * đổi sau này mà quên sửa lại chỗ này.
 */
export async function listActivityLog(limit = 50): Promise<ActivityLogRow[]> {
  const { data, error } = await supabase
    .from("activity_log")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

/** p_ids undefined -> đánh dấu mọi hoạt động đang xem được là đã đọc. */
export async function markActivityRead(ids?: string[]): Promise<void> {
  const { error } = await supabase.rpc("mark_activity_read", { p_ids: ids ?? null });
  if (error) throw error;
}
