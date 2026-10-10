import { describe, it, expect } from "vitest";
import { supabase } from "../../lib/supabaseClient";
import { setupAuthedTestUser } from "./testSetup";
import { createHousehold, getMyHousehold, leaveHousehold } from "../household";

/**
 * T-S12 — Hardening review: xác nhận `household_id`/`household_role` trong
 * `profiles` KHÔNG thể bị đổi qua UPDATE trực tiếp từ client, kể cả khi
 * client cố tình bypass TypeScript (Update type ở database.types.ts đã loại
 * bỏ 2 field này khỏi phía TS — nhưng đó chỉ là rào chắn Ở TẦNG BIÊN DỊCH,
 * không chặn được 1 client bị sửa/tự viết gọi thẳng REST/anon key).
 *
 * ⚠️ SỬA LẠI 18/08/2026 sau lần chạy đầu tiên: bản đầu dùng 1 UUID giả
 * (toàn số 0) làm `household_id` — bị chặn bởi FK constraint
 * `profiles_household_fk` ("Key is not present in table households"), KHÔNG
 * phải bị chặn bởi RLS/quyền theo cột như acceptance criteria thật sự cần
 * verify. Đó là FALSE POSITIVE — nếu kẻ tấn công dùng 1 `household_id` CÓ
 * THẬT, phép chặn do FK không còn tác dụng, và giả thuyết ban đầu ("RLS chỉ
 * chặn theo hàng, không chặn theo cột") vẫn chưa được loại trừ.
 *
 * Test sửa lại: tự tạo 1 household THẬT qua RPC hợp lệ (`createHousehold`),
 * rồi RỜI hộ đó (`leaveHousehold`) — theo đúng thiết kế T-S15 (CONSTITUTION
 * §1.6), hộ KHÔNG bị xoá mà trở thành "ownerless" với `household_id` vẫn
 * tồn tại thật trong bảng `households`. Sau đó thử UPDATE thẳng
 * `household_id` = đúng id ownerless đó + `household_role = 'owner'` —
 * bỏ qua hẳn RPC `join_household_by_code` (vốn có invite-code check, xoay
 * mã sau khi rời — xem CONSTITUTION §1.6 mục 5). Nếu UPDATE này thành công,
 * đây là bằng chứng THẬT của lỗ hổng leo thang quyền (tự phong owner 1 hộ
 * bất kỳ mà không cần đúng invite code).
 */
describe("RLS hardening — profiles.household_id / household_role (T-S12)", () => {
  setupAuthedTestUser();

  it("UPDATE thẳng household_id/household_role bằng 1 household THẬT (bypass join_household_by_code) bị chặn", async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Không có session — kiểm tra TEST_USER_EMAIL/PASSWORD.");

    // ---- STEP 0: dọn trạng thái — đảm bảo user đang KHÔNG ở hộ nào ----
    const leftover = await getMyHousehold();
    if (leftover) {
      console.log("Dọn household còn sót từ lần chạy trước:", leftover.id);
      await leaveHousehold();
    }

    // ---- STEP 1: tạo 1 household THẬT qua đúng RPC hợp lệ ----
    const realHouseholdId = await createHousehold("T-S12 hardening test household");
    console.log("STEP 1 (tạo household thật) OK:", realHouseholdId);

    // ---- STEP 2: rời hộ ngay — theo T-S15, hộ KHÔNG bị xoá, trở thành
    // "ownerless" nhưng household_id vẫn tồn tại thật trong DB ----
    await leaveHousehold();
    const afterLeave = await getMyHousehold();
    expect(afterLeave).toBeNull(); // xác nhận đã rời, không còn household active

    const { data: beforeAttack } = await supabase
      .from("profiles")
      .select("household_id, household_role")
      .eq("id", user.id)
      .single();
    console.log("STEP 2 (đã rời hộ, trạng thái trước tấn công):", beforeAttack);
    expect(beforeAttack?.household_id).toBeNull();
    expect(beforeAttack?.household_role).toBeNull();

    // ---- STEP 3: TẤN CÔNG — tự gán lại đúng household_id thật (ownerless)
    // + tự phong household_role='owner', BỎ QUA join_household_by_code ----
    const maliciousPayload = {
      household_id: realHouseholdId,
      household_role: "owner",
    };
    const { data: updateData, error: updateErr } = await supabase
      .from("profiles")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update(maliciousPayload as any)
      .eq("id", user.id)
      .select("household_id, household_role");
    console.log("STEP 3 (kết quả UPDATE ác ý, household_id CÓ THẬT):", {
      updateData,
      updateErr,
    });

    // ---- STEP 4: re-SELECT bằng request riêng — không tin response của
    // chính lệnh UPDATE ----
    const { data: after, error: afterErr } = await supabase
      .from("profiles")
      .select("household_id, household_role")
      .eq("id", user.id)
      .single();
    if (afterErr) throw afterErr;
    console.log("STEP 4 (trạng thái sau khi cố tấn công bằng id THẬT):", after);

    // ---- Acceptance thật: PHẢI vẫn null — RLS/DB phải tự chặn được việc
    // gán household_id/household_role mà KHÔNG đi qua RPC, bất kể id đó có
    // tồn tại thật hay không ----
    expect(after.household_id).toBeNull();
    expect(after.household_role).toBeNull();

    // ---- Cleanup: household tạo ra trong test này không cần xoá — đúng
    // thiết kế T-S15 (ownerless household không bị xoá cứng), không phải
    // rác cần dọn thủ công, và bảng households không cho DELETE từ client.
  });
});