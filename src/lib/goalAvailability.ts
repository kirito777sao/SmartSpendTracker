import { SavingGoal } from "../types";

/**
 * Shape tối thiểu cần để tính "đã rút thật" — cố ý KHÔNG bắt buộc kiểu
 * `Transaction` đầy đủ (đã map tên category/member), để `SmartInput.tsx`/
 * `AIAssistantBubble.tsx` dùng được thẳng `transactionRows` thô (từ
 * `useTransactions()`, field `goal_id`/`type`/`amount`) mà không phải gọi
 * thêm `useHouseholdMembers`/`rowsToTransactions` chỉ để lấy 3 field này.
 */
export interface GoalSpendLike {
  goalId?: string | null;
  type?: string;
  amount: number;
}

/**
 * [T-S67 patch, 12/08/2026] Tổng đã rút THẬT (giao dịch `expense` gắn
 * `goal_id`) của 1 goal — tạo bởi `useWithdrawFromManualGoal` (nút "Rút quỹ",
 * T-S60) HOẶC `useCompleteGoal` (banner tự động T-S20/T-S59, nay dùng chung
 * `performGoalPurchaseTransaction` từ T-S67). Trước bản vá này, hàm này chỉ
 * tồn tại dạng cục bộ bên trong `SavingGoals.tsx` (`completionSpendByGoal`)
 * — không dùng lại được ở `SmartInput.tsx`/`AIAssistantBubble.tsx`, nên 2
 * nơi đó chưa validate được số dư trước khi banner tự động đóng goal.
 */
export function manualWithdrawnTotal(goalId: string, transactions: GoalSpendLike[]): number {
  let total = 0;
  for (const t of transactions) {
    if (t.goalId === goalId && t.type === "expense") total += Math.abs(t.amount);
  }
  return total;
}

/**
 * [T-S67 patch] Số dư "thủ công" còn rút được của 1 goal KHÔNG liên kết
 * category — CÙNG công thức đang dùng ở `manualPortionAmount()`/
 * `goalManualAvailable()` trong `SavingGoals.tsx` (T-S64), tách ra đây để
 * dùng chung, đúng quy tắc bắt buộc "1 công thức, 1 nơi" (CONSTITUTION,
 * bug T-S64/64b). `SavingGoals.tsx` vẫn giữ nguyên các biến nội bộ của nó
 * (`completionSpendByGoal`, đã memo hoá theo transactions) — hàm này chỉ
 * phục vụ nơi CHƯA có sẵn memo đó (banner tự động).
 *
 * CHỈ áp dụng cho goal KHÔNG liên kết category (`!goal.linkedCategoryId`) —
 * gọi hàm này cho goal liên kết là gọi sai ngữ cảnh (không có ý nghĩa,
 * xem CONSTITUTION §1.21).
 */
export function goalManualAvailable(goal: SavingGoal, transactions: GoalSpendLike[]): number {
  return (goal.carriedOverSavedAmount ?? 0) + goal.currentAmount - manualWithdrawnTotal(goal.id, transactions);
}

/**
 * [T-S76, CONSTITUTION §1.22.1] Tổng GỘP (gross, chưa trừ rút) của goal
 * KHÔNG đang liên kết category — dùng ở nơi cần biết goal đã gom đủ %
 * mục tiêu hay chưa mà KHÔNG có sẵn `linkedAmountByGoal` (chỉ
 * `SavingGoals.tsx` mới tính được, cần transactions+categories theo
 * khoảng ngày). Công thức giống hệt nhánh `!linkedCategoryId` của
 * `goalGrossAccumulated()` cục bộ trong `SavingGoals.tsx` (T-S64b) — tách
 * ra đây để 3 nơi nhập liệu (SmartInput/AIAssistantBubble/
 * TransactionHistory) dùng lại đúng 1 công thức, không viết lại
 * (CONSTITUTION §1.21 — "1 công thức, 1 nơi"). CHỈ gọi cho goal
 * `!goal.linkedCategoryId` — cả 3 nơi trên đã loại goal đang liên kết
 * khỏi danh sách match từ trước (§1.13), nên luôn đúng ngữ cảnh khi gọi
 * từ đó. Gọi cho goal đang liên kết là gọi sai ngữ cảnh (thiếu phần
 * linked đang tính động, không có ý nghĩa).
 */
export function goalGrossAccumulatedUnlinked(goal: SavingGoal): number {
  return (goal.carriedOverSavedAmount ?? 0) + (goal.carriedOverSpentAmount ?? 0) + goal.currentAmount;
}

/**
 * [T-S76, CONSTITUTION §1.22.1] True nếu goal đã gom đủ >= 100% mục tiêu —
 * dùng để gate banner tự động "Đánh dấu hoàn thành" (đảo ngược có chủ đích
 * hành vi cũ T-S20/T-S74, vốn không có ngưỡng %). Goal KHÔNG đặt
 * `targetAmount` ("tiết kiệm không giới hạn", xem types.ts) không có khái
 * niệm "đủ 100%" để so sánh — giữ nguyên hành vi cũ (banner vẫn hiện,
 * không chặn) thay vì luôn false, nhất quán với T-S19 ("bấm Hoàn thành
 * được bất kỳ lúc nào, không bắt buộc đủ target" ở nút thủ công).
 */
export function isGoalFullyFundedForCompletionBanner(goal: SavingGoal): boolean {
  if (!goal.targetAmount) return true;
  return goalGrossAccumulatedUnlinked(goal) >= goal.targetAmount;
}

/**
 * [T-S77, CONSTITUTION §1.22.2] Số dư phần "liên kết ĐÃ ĐÓNG BĂNG"
 * (`carriedOverSpentAmount`) còn lại của goal, đã trừ các lần rút trước đó
 * (`linkedWithdrawnTotal`, qua log `withdrawal_log`). Dùng làm `linkedPool`
 * cho `computeGoalCompletionCascade()` bên dưới — xem docstring hàm đó để
 * biết cách phối hợp với `manualPool` (`goalManualAvailable`) theo đúng 3
 * dải đã chốt.
 *
 * CHỈ dùng `carriedOverSpentAmount` (tĩnh, đã đóng băng) — KHÔNG dùng
 * `linkedAmountByGoal` (phần liên kết ĐANG SỐNG) vì banner "Hoàn thành" chỉ
 * hiện cho goal `!goal.linkedCategoryId` (đã huỷ liên kết hoặc chưa từng
 * liên kết) — nếu goal ĐANG liên kết, không cần tính ở đây (không có
 * category+khoảng ngày, dữ liệu đó chỉ `SavingGoals.tsx` mới có — đúng lý
 * do hàm `goalManualAvailable` ở trên giới hạn phạm vi tương tự).
 */
export function goalFrozenLinkedAvailable(goal: SavingGoal): number {
  const withdrawn = (goal.linkedHistory ?? [])
    .filter((h) => h.type === "withdrawal_log")
    .reduce((sum, h) => sum + h.amount, 0);
  return Math.max(0, (goal.carriedOverSpentAmount ?? 0) - withdrawn);
}

export interface GoalCompletionCascade {
  /** Phần trừ vào "liên kết đã đóng băng" — CHỈ ghi log, KHÔNG tạo giao dịch. */
  linkedAmount: number;
  /** Phần trở thành giao dịch `expense` thật MỚI — chính là số tiền GHI VÀO SỔ GIAO DỊCH. */
  manualAmount: number;
  /** Chỉ có giá trị khi CẢ 2 phần trên đều > 0 (cascade thật) — dùng gom
   * hiển thị chung 1 nhóm ở modal "Lịch sử" (T-S83/T-S84), CÙNG cơ chế với
   * form "Rút quỹ" thủ công ở `SavingGoals.tsx`. */
  withdrawalGroupId?: string;
}

/**
 * [T-S77, CONSTITUTION §1.22.2 — CHỐT 14/08/2026, xác nhận lại qua bug
 * report thật 15/08/2026 (goal "mua giày")] Chia `spend` (số tiền THẬT
 * người dùng nhập khi hoàn thành goal qua banner tự động) thành phần
 * "liên kết đã đóng băng" (`linkedAmount`, chỉ ghi log) và phần "thủ công"
 * (`manualAmount`, GIÁ TRỊ CHÍNH XÁC ghi vào Sổ Giao Dịch) theo ĐÚNG 3 dải
 * đã chốt — **CỐ Ý bất đối xứng thứ tự ưu tiên** giữa dải 2 và dải 3,
 * không phải lỗi đánh máy (xem giải thích + ví dụ đã xác nhận ở CONSTITUTION):
 *
 * - Dải 1 — `spend <= manualPool`: chỉ trừ thủ công. Ghi Sổ Giao Dịch =
 *   đúng `spend`. Linked KHÔNG đụng tới (`linkedAmount=0`).
 * - Dải 2 — `manualPool < spend <= manualPool + linkedPool`: ưu tiên trừ
 *   HẾT `manualPool` trước, phần dư bù sang linked (log-only). Ghi Sổ Giao
 *   Dịch = `manualPool` (cap tối đa, không vượt).
 * - Dải 3 — `spend > manualPool + linkedPool` (vượt cả tổng đã gom):
 *   **đảo thứ tự** — trừ HẾT `linkedPool` trước (log-only, vì tiền đó vốn
 *   đã là chi tiêu thật trong quá khứ), phần còn thiếu = `spend - linkedPool`
 *   ghi thành giao dịch thật MỚI, KHÔNG cap theo `manualPool` (được phép
 *   vượt — đây là tiền thật phát sinh ngay bây giờ, `manualPool` chỉ là
 *   con số tiến độ tiết kiệm, không phải quỹ tiền mặt có hạn — đúng triết
 *   lý T-S74 "không chặn/không cắt bớt chi tiêu thật").
 *
 * `manualPool`/`linkedPool` PHẢI là số dư khả dụng đã trừ rút trước đó
 * (`goalManualAvailable`/`goalFrozenLinkedAvailable`) — tầng gọi tự tính
 * rồi truyền vào, hàm này không tự fetch transactions (giữ thuần/dễ test).
 */
export function computeGoalCompletionCascade(
  manualPool: number,
  linkedPool: number,
  spend: number
): GoalCompletionCascade {
  const clampedSpend = Math.max(spend, 0);
  let linkedAmount: number;
  let manualAmount: number;
  if (clampedSpend <= manualPool) {
    // Dải 1
    linkedAmount = 0;
    manualAmount = clampedSpend;
  } else if (clampedSpend <= manualPool + linkedPool) {
    // Dải 2 — ưu tiên thủ công trước
    manualAmount = manualPool;
    linkedAmount = clampedSpend - manualPool;
  } else {
    // Dải 3 — đảo thứ tự: liên kết hết trước, thủ công KHÔNG cap
    linkedAmount = linkedPool;
    manualAmount = clampedSpend - linkedPool;
  }
  const withdrawalGroupId = linkedAmount > 0 && manualAmount > 0 ? crypto.randomUUID() : undefined;
  return { linkedAmount, manualAmount, withdrawalGroupId };
}