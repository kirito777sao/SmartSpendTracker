import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createGoal, listGoals, softDeleteGoal, updateGoal, updateGoalLink, withdrawFromLinkedGoal, completeGoalUnspent } from "../services/goals";
// T-S19 — `useCompleteGoal` ghi giao dịch mua thật (bảng transactions), nằm
// ngoài phạm vi services/goals.ts thuần (chỉ đụng saving_goals) nên import
// trực tiếp service transactions ở đây thay vì thêm 1 file lib/ mới chỉ để
// gói 1 hàm compose 2 bước.
import { createTransaction } from "../services/transactions";
import { useDataScope } from "./useDataScope";
import type { Database } from "../lib/database.types";
import type { SavingGoal } from "../types";
import { computeGoalCompletionCascade, goalManualAvailable, goalFrozenLinkedAvailable, GoalSpendLike } from "../lib/goalAvailability";

type GoalInsert = Database["public"]["Tables"]["saving_goals"]["Insert"];
type GoalUpdate = Database["public"]["Tables"]["saving_goals"]["Update"];
type TransactionInsert = Database["public"]["Tables"]["transactions"]["Insert"];

/**
 * [T-S67] Logic dùng chung cho `useCompleteGoal` (banner tự động T-S20/T-S59)
 * và `useWithdrawFromManualGoal` (nút "Rút quỹ" T-S60) — trước T-S67, 2 hook
 * này tự viết lặp lại đúng 2 bước giống hệt nhau (ghi giao dịch mua thật rồi
 * tuỳ chọn đóng goal), chỉ khác `useCompleteGoal` LUÔN đóng còn
 * `useWithdrawFromManualGoal` đóng có điều kiện. Gộp về 1 hàm để tránh lệch
 * dần nếu sau này 1 trong 2 chỗ được sửa mà quên sửa chỗ kia (đúng lớp bug
 * vừa gặp ở T-S64/64b, xem CONSTITUTION §5).
 *
 * **Ghi chú phạm vi (CHƯA làm, cần xác nhận riêng trước khi mở rộng)**:
 * dedupe này KHÔNG đổi hành vi hiện có — `useCompleteGoal` vẫn LUÔN đóng
 * goal (đúng scope đã chốt từ T-S60: "useCompleteGoal GIỮ NGUYÊN... khác
 * luồng, ngoài phạm vi task này"), và luồng banner ở `SmartInput.tsx`/
 * `AIAssistantBubble.tsx` VẪN CHƯA có validate số dư khả dụng như
 * `handleSaveWithdraw` (T-S66, chỉ áp cho form "Rút quỹ" ở `SavingGoals.tsx`)
 * — vì 2 file đó không có sẵn `goalManualAvailable()`/`completionSpendByGoal`
 * (2 hàm nội bộ của `SavingGoals.tsx`, chưa tách dùng chung). Thêm validate
 * cho luồng banner là thay đổi HÀNH VI sản phẩm (không chỉ dedupe code) —
 * đúng CONSTITUTION §5 "Hỏi trước khi làm", cần xác nhận riêng trước khi
 * làm tiếp (không tự mở rộng phạm vi task này).
 */
async function performGoalPurchaseTransaction(
  transaction: TransactionInsert,
  goalId: string,
  closeGoal: boolean
): Promise<Awaited<ReturnType<typeof updateGoal>> | undefined> {
  await createTransaction(transaction);
  if (closeGoal) {
    return updateGoal(goalId, { completed_at: new Date().toISOString() });
  }
  return undefined;
}

export function useGoals() {
  const { scopeMode, isReady, scopeKey, serviceScope } = useDataScope();

  return useQuery({
    queryKey: ["goals", scopeMode, scopeKey],
    queryFn: () => listGoals(serviceScope),
    enabled: isReady,
  });
}

export function useCreateGoal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: GoalInsert) => createGoal(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["goals"] }),
  });
}

export function useUpdateGoal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: GoalUpdate }) => updateGoal(id, patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["goals"] }),
  });
}

/**
 * update_goal_link RPC (T-S57, CONSTITUTION §1.20) — sửa liên kết category
 * đã tồn tại (đổi category/khoảng ngày, unlink, hoặc link goal thủ công sẵn
 * có sang category). KHÔNG dùng `useUpdateGoal` cho 3 field liên kết, xem
 * chú thích ở `updateGoalLink` (services/goals.ts).
 */
export function useUpdateGoalLink() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      goalId,
      link,
    }: {
      goalId: string;
      link: { linkedCategoryId: string; linkedStartDate: string; linkedEndDate: string; isSavingsLink: boolean } | null;
    }) => updateGoalLink(goalId, link),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["goals"] }),
  });
}

/** delete_goal RPC (T-S05b) — chỉ chủ hộ hoặc created_by, RPC tự kiểm tra RBAC. */
export function useSoftDeleteGoal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => softDeleteGoal(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["goals"] }),
  });
}

/**
 * "Hoàn thành" mục tiêu tiết kiệm — T-S19 (nút thủ công cũ) và T-S20/T-S59
 * (banner tự động, SmartInput.tsx/AIAssistantBubble.tsx). Từ T-S60, nút thủ
 * công đã đổi qua `useWithdrawFromManualGoal` (lặp lại được) — hook này giờ
 * CHỈ còn phục vụ banner tự động, luôn đóng goal ngay (`closeGoal=true` cố
 * định qua `performGoalPurchaseTransaction`, xem T-S67).
 *
 * `transaction` phải là 1 TransactionInsert ĐÃ DỰNG SẴN ĐẦY ĐỦ ở tầng gọi
 * (`type='expense'`, `category_id` người dùng tự chọn, `goal_id` = goal
 * đang hoàn thành) — hook này KHÔNG tự suy category/type, tránh đúng cái
 * bẫy đã ghi chú sẵn ở `buildTransactionInsert` (toTransactionInsert.ts):
 * hàm đó hiện ép `type='transfer'` bất cứ khi nào `goal_id` khác null (giả
 * định chỉ đúng cho luồng góp quỹ cũ), nên KHÔNG được dùng `buildTransactionInsert`
 * cho giao dịch "mua thật" lúc hoàn thành goal — phải dựng object thủ công.
 *
 * 2 bước KHÔNG atomic ở tầng DB (không cần RPC riêng — cả 2 thao tác đã
 * được phép qua RLS hiện có, không phát sinh RBAC mới):
 *   1. Ghi giao dịch mua thật — đây mới là chỗ "tiền bị trừ" đúng nghĩa.
 *   2. Set `completed_at = now()` trên goal — `current_amount` GIỮ NGUYÊN.
 * Nếu bước 1 lỗi, dừng luôn (throw), KHÔNG chạy bước 2 — tránh 1 goal bị
 * đánh dấu hoàn thành mà không có giao dịch mua thật tương ứng nào.
 */
export function useCompleteGoal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ goalId, transaction }: { goalId: string; transaction: TransactionInsert }) =>
      performGoalPurchaseTransaction(transaction, goalId, true),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["goals"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
    },
  });
}

/**
 * T-S60 (CONSTITUTION §1.21) — "Rút quỹ" từ PHẦN LIÊN KẾT (RPC
 * `withdraw_from_linked_goal`, ghi log, KHÔNG tạo giao dịch). Thay hẳn nút
 * "Hoàn thành" 1-lần-duy-nhất (T-S19) — dùng lặp lại được, `p_close_goal`
 * tuỳ chọn thay vì luôn set `completed_at`.
 */
export function useWithdrawFromLinkedGoal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      goalId,
      amount,
      note,
      closeGoal,
      withdrawalGroupId,
    }: {
      goalId: string;
      amount: number | null;
      note: string;
      closeGoal: boolean;
      // T-S83 (migration 0023) — chỉ truyền khi cascade cả 2 nguồn, xem
      // chú thích ở services/goals.ts withdrawFromLinkedGoal.
      withdrawalGroupId?: string;
    }) => withdrawFromLinkedGoal(goalId, amount, note, closeGoal, withdrawalGroupId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["goals"] }),
  });
}

/**
 * [T-S79, CONSTITUTION §1.22.4] Đánh dấu goal hoàn thành mà KHÔNG ghi bất kỳ
 * giao dịch/log rút quỹ nào — dùng khi tiền (đặc biệt phần liên kết) vẫn
 * còn nguyên ở ví khác ngoài đời, chưa thật sự tiêu đồng nào. KHÁC hẳn
 * `useCompleteGoal`/`useWithdrawFromManualGoal` (LUÔN bắt buộc có 1
 * `transaction`) — nhánh này không tạo transaction, chỉ gọi RPC
 * `complete_goal_unspent` (migration 0024) ghi 1 dòng lịch sử
 * `completed_unspent` làm snapshot breakdown thủ công/liên kết.
 */
export function useCompleteGoalUnspent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      goalId,
      manualAmount,
      linkedAmount,
      note,
    }: {
      goalId: string;
      manualAmount: number;
      linkedAmount: number;
      note: string;
    }) => completeGoalUnspent(goalId, manualAmount, linkedAmount, note),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["goals"] }),
  });
}

/**
 * T-S60 (CONSTITUTION §1.21) — "Rút quỹ" từ PHẦN THỦ CÔNG: tạo 1 giao dịch
 * `expense` thật (trừ tiền thật lần đầu tiên, gắn `goal_id`), sau đó CHỈ
 * đóng goal nếu `closeGoal=true` (khác `useCompleteGoal` cũ — luôn đóng).
 * Dùng lại đúng nguyên tắc dựng `transaction` thủ công ở tầng gọi (KHÔNG
 * qua `buildTransactionInsert`, xem chú thích ở `useCompleteGoal` — vẫn áp
 * dụng nguyên vẹn ở đây, chỉ khác action lặp lại được nhiều lần/goal).
 */
export function useWithdrawFromManualGoal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      goalId,
      transaction,
      closeGoal,
    }: {
      goalId: string;
      transaction: TransactionInsert;
      closeGoal: boolean;
    }) => performGoalPurchaseTransaction(transaction, goalId, closeGoal),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["goals"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
    },
  });
}

/**
 * [T-S77, CONSTITUTION §1.22.2] Thay thế `useCompleteGoal` ở CẢ 3 nơi
 * banner tự động (SmartInput.tsx, AIAssistantBubble.tsx,
 * TransactionHistory.tsx) — trước T-S77, banner luôn ghi NGUYÊN số tiền
 * người dùng nhập thành 1 giao dịch `expense` MỚI, kể cả khi goal đó ĐÃ
 * TỪNG liên kết category rồi huỷ liên kết (`carriedOverSpentAmount` còn
 * dư) — TRỪ ĐÚP phần đã liên kết (tiền đó đã là chi tiêu thật từ trước,
 * lúc còn liên kết). Hook này dùng `computeGoalCompletionCascade`
 * (goalAvailability.ts) chia số tiền THẬT nhập vào theo ĐÚNG 3 dải đã chốt
 * ở CONSTITUTION §1.22.2 (bất đối xứng có chủ đích giữa dải 2 và dải 3 —
 * xem docstring `computeGoalCompletionCascade` để biết chi tiết + ví dụ đã
 * xác nhận). Phần "liên kết" chỉ ghi log `withdrawal_log` qua
 * `useWithdrawFromLinkedGoal` (KHÔNG tạo giao dịch mới); phần "thủ công"
 * (= số tiền THẬT ghi vào Sổ Giao Dịch) qua `useCompleteGoal` (tái dùng
 * nguyên hook cũ, KHÔNG viết lại logic ghi giao dịch). Gắn
 * `withdrawalGroupId` (T-S83/T-S84) khi cascade thật (cả 2 phần > 0) để
 * modal "Lịch sử" ở `SavingGoals.tsx` tự động gom hiển thị đúng 1 nhóm —
 * dùng lại NGUYÊN hạ tầng đã có, không cần sửa gì thêm ở `SavingGoals.tsx`.
 * Goal chưa từng liên kết (`carriedOverSpentAmount=0`, `linkedPool=0`) →
 * luôn rơi vào dải 1 → hành vi giữ NGUYÊN 100% như T-S74 cũ (1 giao dịch
 * full số tiền, không cascade) — an toàn ngược cho trường hợp phổ biến nhất.
 *
 * `transaction.amount` truyền vào PHẢI là số tiền THẬT gốc người dùng
 * nhập (chưa chia) — hook tự chia lại và ghi đè `amount` xuống
 * `manualAmount` trước khi gọi `useCompleteGoal`. Cả 2 mutation con đều
 * luôn `closeGoal=true` — an toàn lặp gọi nhờ RPC/`updateGoal` đều chỉ set
 * `completed_at` khi đang `null` (idempotent, đã xác nhận từ T-S83).
 */
export function useCompleteGoalCascade() {
  const completeGoal = useCompleteGoal();
  const withdrawLinked = useWithdrawFromLinkedGoal();

  return useMutation({
    mutationFn: async ({
      goal,
      transaction,
      note,
      goalSpendRows,
    }: {
      goal: SavingGoal;
      /** `amount` = số tiền THẬT gốc người dùng nhập, CHƯA chia — hook tự chia. */
      transaction: TransactionInsert;
      note: string;
      /** [T-S77] Transactions thô (chỉ cần goalId/type/amount) để tính
       * `manualPool` qua `goalManualAvailable` — tầng gọi đã có sẵn
       * (`goalSpendRows`, dùng chung với cảnh báo mềm T-S74), truyền
       * thẳng vào đây thay vì hook tự fetch lại. */
      goalSpendRows: GoalSpendLike[];
    }) => {
      const manualPool = goalManualAvailable(goal, goalSpendRows);
      const linkedPool = goalFrozenLinkedAvailable(goal);
      const { linkedAmount, manualAmount, withdrawalGroupId } = computeGoalCompletionCascade(
        manualPool,
        linkedPool,
        transaction.amount
      );
      const tasks: Promise<unknown>[] = [];
      if (linkedAmount > 0) {
        tasks.push(
          withdrawLinked.mutateAsync({
            goalId: goal.id,
            amount: linkedAmount,
            note,
            closeGoal: true,
            withdrawalGroupId,
          })
        );
      }
      if (manualAmount > 0) {
        tasks.push(
          completeGoal.mutateAsync({
            goalId: goal.id,
            transaction: { ...transaction, amount: manualAmount, withdrawal_group_id: withdrawalGroupId ?? null },
          })
        );
      }
      await Promise.all(tasks);
    },
  });
}