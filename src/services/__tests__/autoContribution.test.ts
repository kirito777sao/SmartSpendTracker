import { describe, it, expect, afterEach } from "vitest";
import { supabase } from "../../lib/supabaseClient";
import type { Database } from "../../lib/database.types";
import { setupAuthedTestUser } from "./testSetup";
import { createGoal, softDeleteGoal } from "../goals";
import { createTransaction } from "../transactions";
import {
  listAutoContributionConfigs,
  createAutoContributionConfig,
  toggleAutoContributionConfig,
} from "../autoContribution";

// [T-S141] Cùng lớp lỗi kiểu generic đã ghi nhận nhiều lần trong dự án cho
// `supabase.rpc()` (VD `autoContribution.ts`, CHANGELOG T-S139) — ở đây xảy
// ra với `supabase.from(...).select("*")...` khi gọi trực tiếp (KHÔNG qua 1
// hàm service đã có kiểu trả về rõ ràng, như `createTransaction`/`createGoal`
// vẫn dùng bình thường không lỗi ở trên): trình biên dịch suy luận kiểu dữ
// liệu trả về thành `never` khi chain `.eq().eq().is()` được truyền thẳng
// vào `await` mà không có điểm neo kiểu tường minh. Ép kiểu qua alias `Row`
// đã có sẵn (không phải `any` — vẫn giữ đúng shape cột) là cách xử lý NHẤT
// QUÁN với cách `autoContribution.ts` đã chấp nhận hạn chế này, không phải
// giải pháp riêng của file test này.
type TransactionRow = Database["public"]["Tables"]["transactions"]["Row"];
type GoalRow = Database["public"]["Tables"]["saving_goals"]["Row"];
type AutoContributionLogRow = Database["public"]["Tables"]["auto_contribution_log"]["Row"];

/**
 * T-S141 — [CHỐT 25/08/2026, phụ thuộc T-S138+T-S139, cả 2 đã 🔒 27/08/2026]
 * Test tích hợp THẬT cho nhóm trigger `on_income` (T-S138) của trích ngân
 * sách tự động — đúng pattern `goals.test.ts`/`rlsHardening.test.ts`: gọi
 * thẳng vào project Supabase TEST qua `supabase-js`, KHÔNG mock. Nhóm
 * `monthly_schedule` (T-S140/T-S143, cron-driven, không có sự kiện client
 * nào để "insert rồi verify ngay" như on_income) và test target `category_id`
 * NẰM NGOÀI phạm vi T-S141 như AC gốc đã ghi rõ — không tự mở rộng phạm vi.
 *
 * ⚠️ KHÔNG chạy được trong sandbox viết code này (không có quyền truy cập
 * mạng ra *.supabase.co, xem `testSetup.ts`) — cùng cơ chế UNVERIFIED-by-me
 * đã áp dụng nhất quán cho mọi file `__tests__/*.test.ts` khác trong dự án
 * (T-S04/T-S04b/T-S05). Người yêu cầu tự chạy `npx vitest run` với
 * `.env.test` trỏ đúng project TEST để verify PASS thật.
 *
 * Ràng buộc quan trọng cần biết trước khi đọc test bên dưới (CONSTITUTION
 * §1.28, `toggle_auto_contribution_config`): mỗi SCOPE (owner/household)
 * chỉ được có ĐÚNG 1 config `enabled=true` tại 1 thời điểm — không phân
 * biệt theo goal. Vì vậy mỗi test PHẢI tắt config của chính nó ở `afterEach`
 * trước khi test kế tiếp cố bật config MỚI, nếu không sẽ dính lỗi RPC "Đã
 * có 1 cấu hình... đang bật" không liên quan gì tới acceptance criteria
 * đang test.
 */
describe("services/autoContribution — nhóm on_income (T-S138/T-S139, T-S141)", () => {
  setupAuthedTestUser();

  // Config vừa tạo/bật trong mỗi `it`, để `afterEach` tự dọn — tránh phải
  // lặp lại try/finally giống hệt nhau ở cả 3 test.
  let activeConfigId: string | null = null;
  let activeGoalId: string | null = null;

  afterEach(async () => {
    // Tắt config trước — bắt buộc, vì RPC chặn tạo/bật config mới nếu scope
    // còn 1 config khác đang enabled=true (xem ràng buộc ghi ở JSDoc trên).
    if (activeConfigId) {
      await toggleAutoContributionConfig(activeConfigId, false).catch(() => {
        // Có thể đã tắt sẵn trong chính thân test (case 3) — bỏ qua lỗi
        // "chưa từng bật"/không đổi gì, không phải lỗi cần test biết tới.
      });
      activeConfigId = null;
    }
    if (activeGoalId) {
      await softDeleteGoal(activeGoalId).catch(() => {});
      activeGoalId = null;
    }
  });

  it("khoản trích ĐỦ tiền: ghi giao dịch income → tự sinh transfer đúng số + current_amount cộng đúng", async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Không có session — kiểm tra TEST_USER_EMAIL/PASSWORD.");

    // ---- Dọn trạng thái: đảm bảo scope KHÔNG có config nào khác đang bật
    // từ lần chạy trước bị lỗi giữa chừng (afterEach không chạy tới) ----
    const leftover = await listAutoContributionConfigs({ ownerId: user.id });
    for (const c of leftover.filter((c) => c.enabled)) {
      await toggleAutoContributionConfig(c.id, false);
    }

    // ---- STEP 1: tạo 1 goal thủ công (KHÔNG linked_category_id) ----
    const goal = await createGoal({
      owner_id: user.id,
      name: "T-S141 test goal (đủ tiền)",
      target_amount: 5_000_000,
      created_by: user.id,
    });
    activeGoalId = goal.id;
    expect(goal.current_amount).toBe(0);

    // ---- STEP 2: tạo config fixed 200.000đ, trigger on_income — mặc định
    // enabled=false (đúng thiết kế `create_auto_contribution_config`,
    // 0037), phải BẬT riêng bằng toggle ----
    const configId = await createAutoContributionConfig({
      goalId: goal.id,
      triggerType: "on_income",
      amountType: "fixed",
      amountValue: 200_000,
      dayOfMonth: null,
    });
    activeConfigId = configId;

    await toggleAutoContributionConfig(configId, true);

    // ---- STEP 3: ghi 1 giao dịch income ĐỦ tiền (500.000đ > 200.000đ) ----
    const incomeTx = await createTransaction({
      owner_id: user.id,
      type: "income",
      description: "T-S141 test income (đủ tiền)",
      amount: 500_000,
      date: new Date().toISOString().slice(0, 10),
    });

    // ---- STEP 4: verify — trigger `apply_auto_contributions_on_income`
    // (AFTER INSERT, cùng transaction DB với INSERT income) đã chạy XONG
    // trước khi REST call ở STEP 3 trả về — không cần polling/chờ ----
    const { data: transferTxsRaw, error: transferErr } = await supabase
      .from("transactions")
      .select("*")
      .eq("goal_id", goal.id)
      .eq("type", "transfer")
      .is("deleted_at", null);
    if (transferErr) throw transferErr;
    const transferTxs = (transferTxsRaw ?? []) as TransactionRow[];

    expect(transferTxs).toHaveLength(1);
    expect(transferTxs[0].amount).toBe(200_000);
    expect(transferTxs[0].note).toContain(String(incomeTx.id));

    // current_amount phải được TRIGGER DB (0001/0015) tự cộng đúng 200.000đ
    // — không phải logic client tính lại.
    const { data: goalAfterRaw, error: goalErr } = await supabase
      .from("saving_goals")
      .select("current_amount")
      .eq("id", goal.id)
      .single();
    if (goalErr) throw goalErr;
    const goalAfter = goalAfterRaw as Pick<GoalRow, "current_amount">;
    expect(goalAfter.current_amount).toBe(200_000);

    // auto_contribution_log phải có đúng 1 dòng status='applied' khớp config
    // này — audit trail đúng nguyên văn §1.28, không chỉ tin vào kết quả
    // giao dịch transfer đã insert được.
    const { data: logsRaw, error: logErr } = await supabase
      .from("auto_contribution_log")
      .select("*")
      .eq("config_id", configId);
    if (logErr) throw logErr;
    const logs = (logsRaw ?? []) as AutoContributionLogRow[];
    expect(logs).toHaveLength(1);
    expect(logs[0].status).toBe("applied");
    expect(logs[0].computed_amount).toBe(200_000);
  });

  it("khoản trích LỚN HƠN khoản thu: skipped_insufficient — KHÔNG tạo giao dịch transfer", async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Không có session — kiểm tra TEST_USER_EMAIL/PASSWORD.");

    const leftover = await listAutoContributionConfigs({ ownerId: user.id });
    for (const c of leftover.filter((c) => c.enabled)) {
      await toggleAutoContributionConfig(c.id, false);
    }

    const goal = await createGoal({
      owner_id: user.id,
      name: "T-S141 test goal (không đủ tiền)",
      target_amount: 5_000_000,
      created_by: user.id,
    });
    activeGoalId = goal.id;

    // Cấu hình trích CỐ Ý lớn hơn khoản thu sẽ ghi ở STEP 2 — 1.000.000đ
    // trích so với chỉ 50.000đ thu vào.
    const configId = await createAutoContributionConfig({
      goalId: goal.id,
      triggerType: "on_income",
      amountType: "fixed",
      amountValue: 1_000_000,
      dayOfMonth: null,
    });
    activeConfigId = configId;
    await toggleAutoContributionConfig(configId, true);

    await createTransaction({
      owner_id: user.id,
      type: "income",
      description: "T-S141 test income (không đủ tiền)",
      amount: 50_000,
      date: new Date().toISOString().slice(0, 10),
    });

    const { data: transferTxsRaw, error: transferErr } = await supabase
      .from("transactions")
      .select("*")
      .eq("goal_id", goal.id)
      .eq("type", "transfer")
      .is("deleted_at", null);
    if (transferErr) throw transferErr;
    const transferTxs = (transferTxsRaw ?? []) as TransactionRow[];
    expect(transferTxs).toHaveLength(0); // KHÔNG được tạo giao dịch nào

    const { data: goalAfterRaw, error: goalErr } = await supabase
      .from("saving_goals")
      .select("current_amount")
      .eq("id", goal.id)
      .single();
    if (goalErr) throw goalErr;
    const goalAfter = goalAfterRaw as Pick<GoalRow, "current_amount">;
    expect(goalAfter.current_amount).toBe(0); // không đổi

    const { data: logsRaw, error: logErr } = await supabase
      .from("auto_contribution_log")
      .select("*")
      .eq("config_id", configId);
    if (logErr) throw logErr;
    const logs = (logsRaw ?? []) as AutoContributionLogRow[];
    expect(logs).toHaveLength(1);
    expect(logs[0].status).toBe("skipped_insufficient");
    expect(logs[0].contribution_transaction_id).toBeNull(); // không gắn giao dịch nào
    expect(logs[0].computed_amount).toBe(1_000_000);
  });

  it("config TẮT (enabled=false): ghi giao dịch income → hoàn toàn không trích, không log", async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Không có session — kiểm tra TEST_USER_EMAIL/PASSWORD.");

    const leftover = await listAutoContributionConfigs({ ownerId: user.id });
    for (const c of leftover.filter((c) => c.enabled)) {
      await toggleAutoContributionConfig(c.id, false);
    }

    const goal = await createGoal({
      owner_id: user.id,
      name: "T-S141 test goal (config tắt)",
      target_amount: 5_000_000,
      created_by: user.id,
    });
    activeGoalId = goal.id;

    // Tạo config nhưng CỐ Ý KHÔNG bật — `create_auto_contribution_config`
    // (0037) luôn insert với enabled=false mặc định, đây chính là hành vi
    // cần verify: KHÔNG gọi toggleAutoContributionConfig() ở test này.
    const configId = await createAutoContributionConfig({
      goalId: goal.id,
      triggerType: "on_income",
      amountType: "fixed",
      amountValue: 100_000,
      dayOfMonth: null,
    });
    activeConfigId = configId; // afterEach vẫn tắt phòng hờ dù đã false sẵn — vô hại

    await createTransaction({
      owner_id: user.id,
      type: "income",
      description: "T-S141 test income (config tắt)",
      amount: 500_000,
      date: new Date().toISOString().slice(0, 10),
    });

    const { data: transferTxsRaw, error: transferErr } = await supabase
      .from("transactions")
      .select("*")
      .eq("goal_id", goal.id)
      .eq("type", "transfer")
      .is("deleted_at", null);
    if (transferErr) throw transferErr;
    const transferTxs = (transferTxsRaw ?? []) as TransactionRow[];
    expect(transferTxs).toHaveLength(0);

    // Trigger chỉ quét `where enabled = true` (0037) — config tắt thì
    // KHÔNG được xét tới, nên không có dòng log nào cho config này, kể cả
    // 'skipped_other' — khác hẳn case skipped_insufficient ở test trên
    // (case đó CÓ log vì config có bật, chỉ là không đủ tiền).
    const { data: logsRaw, error: logErr } = await supabase
      .from("auto_contribution_log")
      .select("*")
      .eq("config_id", configId);
    if (logErr) throw logErr;
    const logs = (logsRaw ?? []) as AutoContributionLogRow[];
    expect(logs).toHaveLength(0);

    const { data: goalAfterRaw, error: goalErr } = await supabase
      .from("saving_goals")
      .select("current_amount")
      .eq("id", goal.id)
      .single();
    if (goalErr) throw goalErr;
    const goalAfter = goalAfterRaw as Pick<GoalRow, "current_amount">;
    expect(goalAfter.current_amount).toBe(0);
  });
});
