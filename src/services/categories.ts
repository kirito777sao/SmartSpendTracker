import { supabase } from "../lib/supabaseClient";
import type { Database } from "../lib/database.types";

type CategoryRow = Database["public"]["Tables"]["categories"]["Row"];
type CategoryInsert = Database["public"]["Tables"]["categories"]["Insert"];
type CategoryUpdate = Database["public"]["Tables"]["categories"]["Update"];

/**
 * Đọc danh mục theo đúng 1 phạm vi (cá nhân hoặc hộ gia đình) — không merge
 * 2 phạm vi trong 1 lần gọi, khớp nguyên tắc "2 chế độ tách biệt" ở PRD.md.
 * RLS tự lọc deleted_at is null + quyền đọc, hàm này không lọc lại thủ công.
 *
 * [T-S158, migration 0041, hướng A — CHỐT 01/09/2026] `categories.limit_amount`
 * đọc thẳng từ bảng chỉ còn là "mẫu" (template — giá trị set/sửa gần nhất),
 * KHÔNG còn là hạn mức ÁP DỤNG thật của tháng hiện tại nữa (is_recurring=false
 * hết hạn sau tháng tạo, is_recurring=true có thể lệch nếu chưa ai đọc RPC
 * để materialize tháng mới — xem 0041_category_budget_periods.sql). Vì
 * MỌI component tiêu thụ `listCategories` qua `useCategories()` (7 nơi:
 * BudgetLimits/FinancialDashboard/SmartAllocator/SmartInput/AIAssistantBubble/
 * TransactionHistory/SavingGoals) đều chỉ cần hạn mức ÁP DỤNG (không nơi
 * nào cần phân biệt "mẫu" riêng), field `limit_amount` trả về ở ĐÂY được
 * GHI ĐÈ bằng giá trị hiệu lực từ RPC `get_effective_categories` (tháng
 * hiện tại) trước khi trả về — giữ nguyên 100% shape `CategoryRow` (không
 * đổi type, không lan thay đổi ra 7 component đang dùng, đúng nguyên tắc
 * "map mỏng" đã áp cho T-S06d/T-S114). Gọi 2 query riêng (select thô +
 * RPC) thay vì gộp, để KHÔNG mất các field khác của `categories` (owner_id/
 * household_id/created_by/created_by_display_snapshot/deleted_at/...) mà
 * RPC không trả về. Nếu người dùng thật sự cần "hạn mức MẪU" (vd form sửa
 * ở BudgetLimits.tsx) — hiện KHÔNG cần, vì field trống khi hạn mức hết hạn
 * là đúng hành vi mong muốn (cho phép đặt lại từ đầu cho tháng hiện tại,
 * xem giải thích ở đầu migration 0041 mục 4).
 */
export async function listCategories(scope: {
  ownerId?: string;
  householdId?: string;
}): Promise<CategoryRow[]> {
  let query = supabase.from("categories").select("*").order("created_at", { ascending: true });

  if (scope.householdId) {
    query = query.eq("household_id", scope.householdId);
  } else if (scope.ownerId) {
    query = query.eq("owner_id", scope.ownerId);
  } else {
    throw new Error("listCategories cần ownerId hoặc householdId.");
  }

  const { data, error } = await query;
  if (error) throw error;
  const rows = data ?? [];
  if (rows.length === 0) return rows;

  const { data: effective, error: effError } = await supabase.rpc("get_effective_categories", {
    p_owner_id: scope.householdId ? null : scope.ownerId ?? null,
    p_household_id: scope.householdId ?? null,
    p_year_month: null, // null = tháng hiện tại (giờ VN), xem 0041
  });
  // Không fallback âm thầm về limit_amount thô khi RPC lỗi — hiện hạn mức
  // SAI (đã hết hạn/lệch tháng) mà không ai biết còn nguy hiểm hơn là báo
  // lỗi rõ ràng cho tầng gọi (React Query sẽ hiện lỗi query như bình thường).
  if (effError) throw effError;

  const effectiveMap = new Map((effective ?? []).map((e) => [e.id, e.limit_amount]));
  return rows.map((row) =>
    effectiveMap.has(row.id) ? { ...row, limit_amount: effectiveMap.get(row.id) ?? null } : row
  );
}

export async function createCategory(input: CategoryInsert): Promise<CategoryRow> {
  const { data, error } = await supabase.from("categories").insert(input).select().single();
  if (error) throw error;
  return data;
}

export async function updateCategory(id: string, patch: CategoryUpdate): Promise<CategoryRow> {
  const { data, error } = await supabase
    .from("categories")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Soft delete — RBAC vẫn đúng như đã chốt (chủ sở hữu cá nhân hoặc chủ hộ)
 * — KHÔNG đổi. Đổi CÁCH gọi: bug thật phát hiện ở T-S05 test — UPDATE
 * deleted_at trực tiếp qua PostgREST (hoặc qua bất kỳ UPDATE có WHERE nào,
 * kể cả RPC không RETURNING) đều bị Postgres chặn 42501. Lý do THẬT (đã xác
 * nhận bằng thực nghiệm A/B trên project TEST + đối chiếu nguồn Postgres —
 * xem CHANGELOG.md mục T-S05 "sửa lần 2"): Postgres yêu cầu dòng kết quả của
 * 1 UPDATE có WHERE phải thoả SELECT policy của bảng CẢ TRƯỚC LẪN SAU khi
 * update, không liên quan RETURNING. SELECT policy của categories lọc
 * `deleted_at is null`, nên mọi UPDATE đổi deleted_at đều tự vi phạm.
 * Fix: gọi qua RPC SECURITY DEFINER
 * (0005_fix_soft_delete_restore_category_security_definer.sql — file 0004
 * cùng thư mục là 1 lần sửa SAI trước đó, đã bị thay thế, giữ lại làm hồ sơ)
 * — hàm tự kiểm tra quyền thủ công y hệt điều kiện RLS đã CHỐT rồi mới
 * UPDATE bằng quyền definer (bỏ qua lớp RLS gây vướng), nên không đổi RBAC,
 * chỉ đổi cơ chế thực thi. Không phải gap giống saving_goals (đó là thiếu
 * RBAC chặt hơn ở tầng quyền, đây là giới hạn cơ chế RLS-vs-UPDATE của
 * Postgres — 2 vấn đề khác nhau).
 */
export async function softDeleteCategory(id: string): Promise<void> {
  const { error } = await supabase.rpc("soft_delete_category", { p_id: id });
  if (error) throw error;
}

/** Hoàn tác xoá (T-S07 dùng) — set lại deleted_at = null. */
export async function restoreCategory(id: string): Promise<void> {
  const { error } = await supabase.rpc("restore_category", { p_id: id });
  if (error) throw error;
}