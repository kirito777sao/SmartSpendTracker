import { useScope } from "../context/ScopeContext";
import { useCurrentUserId } from "./useCurrentUserId";
import { useHousehold } from "./useHousehold";

/**
 * Helper nội bộ dùng chung bởi useCategories/useGoals/useTransactions
 * (CONSTITUTION §1.1 query key factory). Không export ra ngoài src/hooks —
 * component không gọi thẳng hook này, chỉ 3 hook domain ở trên dùng.
 */
export function useDataScope() {
  const { scopeMode } = useScope();
  const userId = useCurrentUserId();
  const { data: household } = useHousehold();
  const householdId = household?.id;

  const isReady = scopeMode === "household" ? !!householdId : !!userId;
  // Phần thứ 2 của query key (§1.1): id tương ứng với scopeMode hiện tại.
  const scopeKey = scopeMode === "household" ? householdId : userId;

  const serviceScope =
    scopeMode === "household" ? { householdId } : { ownerId: userId };

  return { scopeMode, userId, householdId, isReady, scopeKey, serviceScope };
}
