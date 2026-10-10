import { describe, it, expect } from "vitest";
import { supabase } from "../../lib/supabaseClient";
import { setupAuthedTestUser } from "./testSetup";
import { createGoal, listGoals, softDeleteGoal, updateGoal } from "../goals";

describe("services/goals (test project thật)", () => {
  setupAuthedTestUser();

  it("insert → select → update", async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Không có session — kiểm tra TEST_USER_EMAIL/PASSWORD.");

    const created = await createGoal({
      owner_id: user.id,
      name: "T-S05 test goal",
      target_amount: 1000000,
      created_by: user.id,
    });
    expect(created.current_amount).toBe(0); // default DB, chưa có transaction nào gắn goal_id

    const listed = await listGoals({ ownerId: user.id });
    expect(listed.some((g) => g.id === created.id)).toBe(true);

    const updated = await updateGoal(created.id, { target_amount: 2000000 });
    expect(updated.target_amount).toBe(2000000);
  });

  /**
   * T-S05b — RPC delete_goal đã có (0008_rpc_delete_goal.sql). Test nhánh
   * ĐƯỢC PHÉP: owner cá nhân tự xoá goal của mình (owner_id = created_by =
   * user.id, household_id null → nhánh "phạm vi cá nhân" trong RPC).
   *
   * KHÔNG test nhánh bị từ chối ("member không phải người tạo/không phải
   * chủ hộ gọi → raise") ở đây — cần user thứ 2 trong cùng 1 household để
   * mô phỏng đúng, mà project TEST hiện chỉ có 1 user thật (lý do giống hệt
   * đã áp dụng khi bỏ qua remove_member/transfer_ownership ở
   * household.test.ts). Ghi lại như 1 gap còn treo, không tự ý tạo user thứ
   * 2 (đổi phạm vi hạ tầng test — thuộc ASK FIRST).
   */
  it("delete_goal: owner cá nhân xoá goal của mình → thành công, biến mất khỏi list", async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Không có session — kiểm tra TEST_USER_EMAIL/PASSWORD.");

    const created = await createGoal({
      owner_id: user.id,
      name: "T-S05b test goal (delete)",
      target_amount: 500000,
      created_by: user.id,
    });

    await softDeleteGoal(created.id);

    const afterDelete = await listGoals({ ownerId: user.id });
    expect(afterDelete.some((g) => g.id === created.id)).toBe(false);
  });
});