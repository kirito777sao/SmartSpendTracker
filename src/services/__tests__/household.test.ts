import { describe, it, expect, beforeAll } from "vitest";
import { supabase } from "../../lib/supabaseClient";
import { setupAuthedTestUser } from "./testSetup";
import {
  createHousehold,
  getMyHousehold,
  listHouseholdMembers,
  leaveHousehold,
  deleteHousehold,
} from "../household";

/**
 * T-S05 — test còn thiếu, bổ sung để đủ acceptance criteria ("mỗi service"
 * = categories, transactions, goals, household — cả 4). household.ts chỉ
 * wrap RPC (create_household/join_household_by_code/leave_household/
 * remove_member/transfer_ownership) + đọc bảng, không có insert/update
 * thẳng — nên bài test tương đương insert/select/soft-delete ở đây là
 * create (RPC) → select → cleanup (leave, RPC). Test user chỉ 1 mình
 * (không có member thứ 2 trong project TEST) nên KHÔNG test
 * remove_member/transfer_ownership ở đây — 2 RPC đó đã có 🔒 riêng từ
 * T-S03b, không lặp lại effort (đúng lý do goals.ts từng ghi ở T-S05).
 *
 * Tự dọn trạng thái trước khi chạy: nếu user test đang dở dang ở 1 household
 * từ lần chạy trước bị crash giữa chừng (leaveHousehold() ở cuối chưa kịp
 * chạy), rời hộ đó trước — tránh createHousehold() raise "đang ở hộ khác"
 * làm test này fail vì lý do không liên quan tới code đang kiểm tra.
 */
describe("services/household (test project thật)", () => {
  setupAuthedTestUser();

  beforeAll(async () => {
    const leftover = await getMyHousehold();
    if (leftover) {
      console.log("Dọn household còn sót từ lần chạy trước:", leftover.id);
      await leaveHousehold();
    }
  });

  it("create → select → member list → leave (T-S15: solo owner rời -> hộ trở thành ownerless, KHÔNG còn tự giải tán/xoá như hành vi cũ)", async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Không có session — kiểm tra TEST_USER_EMAIL/PASSWORD.");

    // ---- STEP 1: create (RPC create_household) ----
    let householdId: string;
    try {
      householdId = await createHousehold("T-S05 test household");
      console.log("STEP 1 (create) OK:", householdId);
    } catch (e) {
      console.log("STEP 1 (create) FAILED:", JSON.stringify(e, null, 2));
      throw e;
    }
    expect(householdId).toBeTruthy();

    // ---- STEP 2: select (getMyHousehold) ----
    let mine;
    try {
      mine = await getMyHousehold();
      console.log("STEP 2 (select) OK:", mine);
    } catch (e) {
      console.log("STEP 2 (select) FAILED:", JSON.stringify(e, null, 2));
      throw e;
    }
    expect(mine?.id).toBe(householdId);
    expect(mine?.owner_id).toBe(user.id);

    // ---- STEP 3: member list (owner phải thấy chính mình) ----
    let members;
    try {
      members = await listHouseholdMembers(householdId);
      console.log("STEP 3 (member list) OK, count:", members.length);
    } catch (e) {
      console.log("STEP 3 (member list) FAILED:", JSON.stringify(e, null, 2));
      throw e;
    }
    expect(members.some((m) => m.id === user.id)).toBe(true);

    // ---- STEP 4: leave (T-S15 — solo owner rời, household KHÔNG bị xoá,
    // chỉ trở thành "ownerless"; getMyHousehold() vẫn trả null cho CHÍNH
    // người vừa rời vì RLS mới chỉ cho xem hộ đang là member/owner hoạt
    // động HOẶC hộ đã deleted_at — ownerless (chưa xoá) thì không nhánh
    // nào khớp -> đúng ý đồ thiết kế, KHÔNG phải vì hộ đã bị xoá) ----
    try {
      await leaveHousehold();
      console.log("STEP 4 (leave) OK");
    } catch (e) {
      console.log("STEP 4 (leave) FAILED:", JSON.stringify(e, null, 2));
      throw e;
    }
    const afterLeave = await getMyHousehold();
    expect(afterLeave).toBeNull();

    // LƯU Ý (không phải thiếu sót — giới hạn môi trường test hiện tại):
    // không verify được ở đây rằng invite_code cũ đã bị xoay (cần đọc thẳng
    // bảng households bằng service-role, hoặc cần 1 user thứ 2 gọi
    // joinHouseholdByCode bằng mã CŨ để xác nhận bị raise) — dự án chỉ có
    // 1 test user trong project TEST (xem comment đầu file). Kiểm tra thủ
    // công qua Supabase Table Editor sau khi chạy test này: `invite_code`
    // của household vừa tạo phải KHÁC giá trị lúc STEP 1.
  });

  it("T-S15: delete_household() — chủ hộ đơn độc xoá hộ tường minh, soft-delete", async () => {
    // Không phải chủ hộ nào (chưa từng tạo/join hộ) -> raise.
    await expect(deleteHousehold()).rejects.toBeTruthy();

    const householdId = await createHousehold("T-S15 delete_household test");
    expect(householdId).toBeTruthy();

    await deleteHousehold();

    // Sau khi xoá: profile của chủ hộ đã gỡ về cá nhân, giống hệt sau
    // leaveHousehold() — getMyHousehold() (RLS "đang là member hoạt động")
    // trả null. Việc archive-view (đọc lại hộ đã deleted_at bằng chính
    // owner_id) cần xác nhận thủ công qua Table Editor: `deleted_at` phải
    // có giá trị, `categories/saving_goals/transactions/activity_log` của
    // hộ này (nếu test trước đó có tạo) phải KHÔNG bị đổi gì.
    const afterDelete = await getMyHousehold();
    expect(afterDelete).toBeNull();

    // Gọi lại lần 2 khi đã xoá rồi -> raise ("không ở trong hộ nào").
    await expect(deleteHousehold()).rejects.toBeTruthy();
  });
});