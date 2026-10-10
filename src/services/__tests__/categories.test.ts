import { describe, it, expect } from "vitest";
import { supabase } from "../../lib/supabaseClient";
import { setupAuthedTestUser } from "./testSetup";
import { createCategory, listCategories, softDeleteCategory, updateCategory } from "../categories";

const TEST_CATEGORY_NAME = "T-S05 test category";

describe("services/categories (test project thật)", () => {
  setupAuthedTestUser();

  it("insert → select → soft-delete → không còn xuất hiện trong list", async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Không có session — kiểm tra TEST_USER_EMAIL/PASSWORD.");

    // ---- STEP 0: dọn category cùng tên còn sót từ lần chạy trước bị crash
    // giữa chừng (trước STEP 4 soft-delete kịp chạy) — bắt buộc từ khi có
    // ràng buộc `categories_unique_active_name_per_scope` (migration
    // 0034-0036, thêm SAU khi test này được viết ban đầu), cùng pattern
    // `household.test.ts` đã dọn household leftover ở beforeAll ----
    const leftover = (await listCategories({ ownerId: user.id })).filter(
      (c) => c.name === TEST_CATEGORY_NAME
    );
    for (const c of leftover) {
      console.log("Dọn category còn sót từ lần chạy trước:", c.id);
      await softDeleteCategory(c.id);
    }

    // ---- STEP 1: insert ----
    let created;
    try {
      created = await createCategory({
        owner_id: user.id,
        name: TEST_CATEGORY_NAME,
        icon: "🧪",
        created_by: user.id,
      });
      console.log("STEP 1 (create) OK:", created);
    } catch (e) {
      console.log("STEP 1 (create) FAILED:", JSON.stringify(e, null, 2));
      throw e;
    }

    expect(created.id).toBeTruthy();
    expect(created.deleted_at).toBeNull();

    // ---- STEP 2: list ----
    let listed;
    try {
      listed = await listCategories({ ownerId: user.id });
      console.log("STEP 2 (list) OK, count:", listed.length);
    } catch (e) {
      console.log("STEP 2 (list) FAILED:", JSON.stringify(e, null, 2));
      throw e;
    }
    expect(listed.some((c) => c.id === created.id)).toBe(true);

    // ---- STEP 3: update ----
    let updated;
    try {
      updated = await updateCategory(created.id, { limit_amount: 500000 });
      console.log("STEP 3 (update) OK:", updated);
    } catch (e) {
      console.log("STEP 3 (update) FAILED:", JSON.stringify(e, null, 2));
      throw e;
    }
    expect(updated.limit_amount).toBe(500000);

    // ---- STEP 4: soft delete ----
    try {
      await softDeleteCategory(created.id);
      console.log("STEP 4 (soft delete) OK");
    } catch (e) {
      console.log("STEP 4 (soft delete) FAILED:", JSON.stringify(e, null, 2));
      throw e;
    }

    const afterDelete = await listCategories({ ownerId: user.id });
    expect(afterDelete.some((c) => c.id === created.id)).toBe(false);
  });
});