import { supabase } from "../lib/supabaseClient";
import type { Database } from "../lib/database.types";

type AutoContributionConfigRow = Database["public"]["Tables"]["auto_contribution_configs"]["Row"];

/**
 * [T-S139] Đọc trực tiếp qua PostgREST (KHÔNG qua RPC) — bảng có RLS SELECT
 * policy sẵn ("read own or household auto_contribution_configs", migration
 * 0037) cho phép đọc thẳng, chỉ INSERT/UPDATE/DELETE mới bắt buộc qua RPC
 * (xem comment `Insert: never`/`Update: never` ở database.types.ts). Trả về
 * TOÀN BỘ config trong scope hiện tại (không lọc theo goal ở tầng query) —
 * để component tự `.find(c => c.goal_id === goalId)`, giống đúng cách
 * `listGoals`/`listCategories` trả nguyên danh sách rồi component tự lọc,
 * tránh 1 query riêng cho từng goal khi render nhiều thẻ cùng lúc.
 */
export async function listAutoContributionConfigs(scope: {
  ownerId?: string;
  householdId?: string;
}): Promise<AutoContributionConfigRow[]> {
  let query = supabase.from("auto_contribution_configs").select("*").order("created_at", { ascending: true });

  if (scope.householdId) {
    query = query.eq("household_id", scope.householdId);
  } else if (scope.ownerId) {
    query = query.eq("owner_id", scope.ownerId);
  } else {
    throw new Error("listAutoContributionConfigs cần ownerId hoặc householdId.");
  }

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

/**
 * [T-S139, target goal_id — T-S138 migration 0037] [T-S143, 27/08/2026 —
 * mở rộng nhận thêm target `categoryId`, đúng CONSTITUTION §1.28.2] Tạo
 * config mới cho 1 goal thủ công HOẶC 1 category ngân sách — XOR, chỉ
 * truyền ĐÚNG 1 trong 2 `goalId`/`categoryId` (khớp `chk_target_xor` ở DB).
 * `dayOfMonth` chỉ có ý nghĩa khi `triggerType='monthly_schedule'` (T-S140,
 * RPC tự raise exception nếu thiếu — không validate lại ở đây, tránh trùng
 * logic 2 nơi). Target `categoryId` CHỈ được phép `triggerType='monthly_schedule'`
 * (RPC tự chặn `on_income`, đúng `chk_category_only_monthly` — không
 * validate lại ở đây).
 */
export async function createAutoContributionConfig(params: {
  goalId?: string | null;
  categoryId?: string | null;
  triggerType: "on_income" | "monthly_schedule";
  amountType: "fixed" | "percent";
  amountValue: number;
  dayOfMonth: number | null;
}): Promise<string> {
  const { data, error } = await supabase.rpc("create_auto_contribution_config", {
    p_goal_id: params.goalId ?? null,
    p_trigger_type: params.triggerType,
    p_amount_type: params.amountType,
    p_amount_value: params.amountValue,
    p_day_of_month: params.dayOfMonth,
    p_category_id: params.categoryId ?? null,
  });
  if (error) throw error;
  return data;
}

export async function updateAutoContributionConfig(params: {
  configId: string;
  triggerType: "on_income" | "monthly_schedule";
  amountType: "fixed" | "percent";
  amountValue: number;
  dayOfMonth: number | null;
}): Promise<void> {
  const { error } = await supabase.rpc("update_auto_contribution_config", {
    p_config_id: params.configId,
    p_trigger_type: params.triggerType,
    p_amount_type: params.amountType,
    p_amount_value: params.amountValue,
    p_day_of_month: params.dayOfMonth,
  });
  if (error) throw error;
}

export async function deleteAutoContributionConfig(configId: string): Promise<void> {
  const { error } = await supabase.rpc("delete_auto_contribution_config", { p_config_id: configId });
  if (error) throw error;
}

/**
 * [T-S138, CONSTITUTION §1.28] `p_enabled=true` bị RPC chặn (raise
 * exception) nếu SCOPE hiện tại (owner hoặc household) đã có 1 config KHÁC
 * đang bật — v1 chỉ cho đúng 1 cấu hình active/lúc, KHÔNG phân biệt theo
 * goal. Component gọi hàm này PHẢI bắt lỗi và hiển thị thông báo rõ (không
 * để lộ message SQL thô), xem `AutoContributionConfig.tsx`.
 */
export async function toggleAutoContributionConfig(configId: string, enabled: boolean): Promise<void> {
  const { error } = await supabase.rpc("toggle_auto_contribution_config", {
    p_config_id: configId,
    p_enabled: enabled,
  });
  if (error) throw error;
}
