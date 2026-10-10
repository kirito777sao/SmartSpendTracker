import { supabase } from "../lib/supabaseClient";
import type { Database } from "../lib/database.types";

type GoalRow = Database["public"]["Tables"]["saving_goals"]["Row"];
type GoalInsert = Database["public"]["Tables"]["saving_goals"]["Insert"];
type GoalUpdate = Database["public"]["Tables"]["saving_goals"]["Update"];

/**
 * T-S63 (CONSTITUTION §1.13.1, migration 0020) — ràng buộc
 * `saving_goals_linked_category_no_overlap` (EXCLUDE USING gist) chặn 2
 * goal khác nhau cùng liên kết 1 category với khoảng ngày chồng lấp, raise
 * lỗi Postgres `23P01` (exclusion_violation). Dịch sang thông báo tiếng
 * Việt dễ hiểu thay vì để lộ message SQL thô ra UI. Dùng ở MỌI nơi có thể
 * đụng ràng buộc này (`createGoal` — insert thẳng lúc tạo goal mới, VÀ
 * `updateGoalLink` — RPC sửa liên kết) để không sót đường nào, đúng bài
 * học rút ra từ chính bug T-S63 (thiếu check ở 1 trong 2 entry point).
 *
 * [T-S75, 15/08/2026] Trước chỉ báo 1 câu chung chung "trùng lặp với 1 mục
 * tiêu khác" — không nói rõ GOAL NÀO/KHOẢNG NGÀY NÀO, khó nhất với goal đã
 * ẩn/hoàn thành (không hiện trong danh sách chính) vì người dùng phải đoán
 * mò mới sửa lại ngày cho hợp lệ. Thêm `findOverlappingGoal()` — truy vấn
 * lại đúng `saving_goals` theo `linked_category_id` + khoảng ngày chồng lấp
 * (kể cả goal `completed_at IS NOT NULL`, chỉ loại `deleted_at`), rồi chèn
 * tên + khoảng ngày trực tiếp vào thông báo lỗi. Query CHỈ chạy khi đã xác
 * nhận đúng lỗi `23P01` (không tốn round-trip cho các lỗi khác).
 */
function formatVNDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
}

async function findOverlappingGoal(params: {
  linkedCategoryId: string;
  linkedStartDate: string;
  linkedEndDate: string;
  excludeGoalId?: string;
}): Promise<{ name: string; startDate: string; endDate: string } | null> {
  let query = supabase
    .from("saving_goals")
    .select("name, linked_start_date, linked_end_date")
    .eq("linked_category_id", params.linkedCategoryId)
    .is("deleted_at", null)
    .lte("linked_start_date", params.linkedEndDate)
    .gte("linked_end_date", params.linkedStartDate);
  if (params.excludeGoalId) {
    query = query.neq("id", params.excludeGoalId);
  }
  const { data, error } = await query.limit(1);
  if (error || !data || data.length === 0) return null;
  const row = data[0] as { name: string; linked_start_date: string; linked_end_date: string };
  return { name: row.name, startDate: row.linked_start_date, endDate: row.linked_end_date };
}

async function rethrowFriendlyLinkOverlapError(
  error: { code?: string; message?: string },
  context?: { linkedCategoryId: string; linkedStartDate: string; linkedEndDate: string; excludeGoalId?: string }
): Promise<never> {
  if (error.code === "23P01" || error.message?.includes("saving_goals_linked_category_no_overlap")) {
    let detail = "";
    if (context) {
      // Best-effort — nếu query tra cứu tự nó lỗi (vd mất mạng ngay sau lỗi
      // gốc), vẫn rơi về câu chung chung thay vì che mất lỗi gốc đã xác nhận.
      const overlapping = await findOverlappingGoal(context).catch(() => null);
      if (overlapping) {
        detail = ` (đang liên kết với mục tiêu "${overlapping.name}" từ ${formatVNDate(overlapping.startDate)} đến ${formatVNDate(overlapping.endDate)})`;
      }
    }
    throw new Error(
      `Danh mục này đang được liên kết với 1 mục tiêu khác trong khoảng thời gian trùng lặp${detail}. Vui lòng chọn danh mục hoặc đổi khoảng ngày khác.`
    );
  }
  throw error;
}

export async function listGoals(scope: {
  ownerId?: string;
  householdId?: string;
}): Promise<GoalRow[]> {
  let query = supabase.from("saving_goals").select("*").order("created_at", { ascending: true });

  if (scope.householdId) {
    query = query.eq("household_id", scope.householdId);
  } else if (scope.ownerId) {
    query = query.eq("owner_id", scope.ownerId);
  } else {
    throw new Error("listGoals cần ownerId hoặc householdId.");
  }

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

/** Mọi thành viên hộ tạo được mục tiêu chung (đúng PRD) — không giới hạn thêm ở đây. */
export async function createGoal(input: GoalInsert): Promise<GoalRow> {
  const { data, error } = await supabase.from("saving_goals").insert(input).select().single();
  if (error) {
    await rethrowFriendlyLinkOverlapError(
      error,
      input.linked_category_id && input.linked_start_date && input.linked_end_date
        ? {
            linkedCategoryId: input.linked_category_id,
            linkedStartDate: input.linked_start_date,
            linkedEndDate: input.linked_end_date,
          }
        : undefined
    );
    throw error; // không bao giờ chạy tới đây thật (hàm trên luôn throw) — chỉ để TS hiểu nhánh này không "return normally"
  }
  return data;
}

/**
 * Sửa mục tiêu (tên, target_amount, target_date) — RLS update cho phép mọi
 * thành viên hộ sửa, đúng PRD ("mọi thành viên sửa được"). current_amount
 * không nằm trong GoalUpdate type nên không thể vô tình ghi đè giá trị do
 * trigger DB tính (CONSTITUTION §2.6).
 */
export async function updateGoal(id: string, patch: GoalUpdate): Promise<GoalRow> {
  const { data, error } = await supabase
    .from("saving_goals")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Xoá mục tiêu (soft delete) — RBAC chặt hơn RLS thô của saving_goals: mọi
 * thành viên hộ update được field khác (target_amount, name...) nhưng CHỈ
 * chủ hộ hoặc created_by được xoá (PRD, gap phát hiện ở T-S05). Đi qua RPC
 * SECURITY DEFINER (T-S05b, 0008_rpc_delete_goal.sql) — hàm tự kiểm tra
 * đúng RBAC này trước khi UPDATE, đồng thời né lỗi 42501 vì deleted_at nằm
 * trong SELECT policy (CONSTITUTION §5, cùng lớp bug đã fix ở 0005/0006).
 */
export async function softDeleteGoal(id: string): Promise<void> {
  const { error } = await supabase.rpc("delete_goal", { p_goal_id: id });
  if (error) throw error;
}

/**
 * T-S57 (CONSTITUTION §1.20, migration 0018) — sửa linked_category_id/
 * linked_start_date/linked_end_date của 1 goal đã tồn tại (đổi category,
 * unlink về thủ công, hoặc link 1 goal thủ công sẵn có sang category).
 * BẮT BUỘC đi qua RPC `update_goal_link` (SECURITY DEFINER), KHÔNG dùng
 * `updateGoal()` thường cho 3 field này — RPC tự đóng băng số đang tính
 * động (nếu có) vào carried_over_saved_amount/carried_over_spent_amount +
 * append linked_history ATOMIC trong 1 transaction DB, tránh race condition
 * nếu có giao dịch mới chen vào giữa lúc đọc và lúc ghi (không thể đảm bảo
 * atomic nếu tự tính ở client rồi update() 2 bước riêng).
 *
 * Truyền `null` cho cả 3 tham số linked = target "thủ công" (unlink).
 *
 * [T-S80, migration 0022] `link.isSavingsLink` BẮT BUỘC khi `link` khác null
 * — người dùng tự chọn tường minh qua radio (T-S81 UI), không có giá trị
 * mặc định ở tầng gọi RPC này (SQL có `default false` chỉ để không phá vỡ
 * lời gọi cũ trước T-S80, KHÔNG có nghĩa là lựa chọn hợp lệ bỏ qua được).
 */
export async function updateGoalLink(
  goalId: string,
  link: { linkedCategoryId: string; linkedStartDate: string; linkedEndDate: string; isSavingsLink: boolean } | null
): Promise<GoalRow> {
  const { data, error } = await supabase.rpc("update_goal_link", {
    p_goal_id: goalId,
    p_new_linked_category_id: link?.linkedCategoryId ?? null,
    p_new_linked_start_date: link?.linkedStartDate ?? null,
    p_new_linked_end_date: link?.linkedEndDate ?? null,
    p_is_savings_link: link?.isSavingsLink ?? false,
  });
  if (error) {
    await rethrowFriendlyLinkOverlapError(
      error,
      link
        ? {
            linkedCategoryId: link.linkedCategoryId,
            linkedStartDate: link.linkedStartDate,
            linkedEndDate: link.linkedEndDate,
            excludeGoalId: goalId,
          }
        : undefined
    );
    throw error; // không bao giờ chạy tới đây thật (hàm trên luôn throw) — chỉ để TS hiểu nhánh này không "return normally"
  }
  return data;
}

/**
 * T-S60 (CONSTITUTION §1.21, migration 0021) — "Rút quỹ" từ PHẦN LIÊN KẾT
 * của 1 goal. KHÔNG tạo giao dịch `transactions` mới (tiền đã chi tiêu thật
 * ở category gốc rồi, tạo thêm sẽ trừ đúp) — chỉ ghi 1 dòng log vào
 * `linked_history` qua RPC (đọc-sửa-ghi atomic, tránh lost-update). Rút từ
 * PHẦN THỦ CÔNG dùng lại nguyên xi `useCompleteGoal` (hooks/useGoals.ts) —
 * KHÔNG có hàm riêng ở đây, vì đó là tạo giao dịch thật, thuộc luồng khác.
 *
 * `amount = null` khi người dùng chỉ muốn tick "Đóng mục tiêu" mà không rút
 * gì thêm (đúng AC §1.21: không bắt buộc nhập số tiền mới đóng được).
 *
 * `withdrawalGroupId` (T-S83, migration 0023) — CHỈ truyền khi lần rút này
 * bị cascade sang CẢ 2 nguồn (thủ công + liên kết, xem handleSaveWithdraw ở
 * SavingGoals.tsx) — dùng để gom hiển thị chung 1 nhóm với dòng
 * `transactions` phần thủ công cùng `withdrawal_group_id` ở modal "Lịch
 * sử". `undefined`/không truyền = hành vi cũ (rút 1 nguồn, không gom).
 */
export async function withdrawFromLinkedGoal(
  goalId: string,
  amount: number | null,
  note: string,
  closeGoal: boolean,
  withdrawalGroupId?: string
): Promise<GoalRow> {
  const { data, error } = await supabase.rpc("withdraw_from_linked_goal", {
    p_goal_id: goalId,
    p_amount: amount,
    p_note: note,
    p_close_goal: closeGoal,
    p_withdrawal_group_id: withdrawalGroupId ?? null,
  });
  if (error) throw error;
  return data;
}

/**
 * [T-S79, CONSTITUTION §1.22.4, migration 0024] Đánh dấu goal hoàn thành mà
 * KHÔNG ghi bất kỳ giao dịch chi tiêu/log rút quỹ nào — dùng khi tiền (đặc
 * biệt phần liên kết) vẫn còn nguyên ở ví khác ngoài đời, chưa thật sự tiêu
 * đồng nào. Ghi 1 dòng lịch sử `completed_unspent` làm snapshot breakdown
 * thủ công/liên kết TẠI THỜI ĐIỂM đóng — thuần thông tin, KHÔNG trừ vào
 * `goalCurrentAmount` (khác hẳn `withdrawFromLinkedGoal`/rút quỹ thật).
 */
export async function completeGoalUnspent(
  goalId: string,
  manualAmount: number,
  linkedAmount: number,
  note: string
): Promise<GoalRow> {
  const { data, error } = await supabase.rpc("complete_goal_unspent", {
    p_goal_id: goalId,
    p_manual_amount: manualAmount,
    p_linked_amount: linkedAmount,
    p_note: note,
  });
  if (error) throw error;
  return data;
}