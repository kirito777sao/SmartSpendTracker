import { describe, it, expect } from "vitest";
import { supabase } from "../../lib/supabaseClient";
import { setupAuthedTestUser } from "./testSetup";
import {
  createTransaction,
  listTransactions,
  softDeleteTransaction,
  restoreTransaction,
} from "../transactions";

describe("services/transactions (test project thật)", () => {
  setupAuthedTestUser();

  it("insert → select → soft-delete → restore", async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Không có session — kiểm tra TEST_USER_EMAIL/PASSWORD.");

    // ---- STEP 1: insert ----
    let created;
    try {
      created = await createTransaction({
        owner_id: user.id,
        type: "expense",
        description: "T-S05 test transaction",
        amount: 20000,
        date: new Date().toISOString().slice(0, 10),
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
      listed = await listTransactions({ ownerId: user.id });
      console.log("STEP 2 (list) OK, count:", listed.length);
    } catch (e) {
      console.log("STEP 2 (list) FAILED:", JSON.stringify(e, null, 2));
      throw e;
    }
    expect(listed.some((t) => t.id === created.id)).toBe(true);

    // ---- STEP 3: soft delete ----
    try {
      await softDeleteTransaction(created.id);
      console.log("STEP 3 (soft delete) OK");
    } catch (e) {
      console.log("STEP 3 (soft delete) FAILED:", JSON.stringify(e, null, 2));
      throw e;
    }
    const afterDelete = await listTransactions({ ownerId: user.id });
    expect(afterDelete.some((t) => t.id === created.id)).toBe(false);

    // ---- STEP 4: restore ----
    try {
      await restoreTransaction(created.id);
      console.log("STEP 4 (restore) OK");
    } catch (e) {
      console.log("STEP 4 (restore) FAILED:", JSON.stringify(e, null, 2));
      throw e;
    }
    const afterRestore = await listTransactions({ ownerId: user.id });
    expect(afterRestore.some((t) => t.id === created.id)).toBe(true);
  });
});