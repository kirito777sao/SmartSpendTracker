/**
 * T-S06d — Mapping shim: Supabase row -> shape app cũ (Transaction/Category/
 * SavingGoal ở src/types.ts).
 *
 * LÝ DO TỒN TẠI FILE NÀY (nợ kỹ thuật CÓ CHỦ ĐÍCH, xem CHANGELOG T-S06d):
 * 4 component đích (FinancialDashboard/BudgetLimits/SavingGoals/
 * TransactionHistory) đang viết theo shape cũ trên khắp file (tính tổng,
 * lọc, sort, export CSV...). Sửa thẳng toàn bộ logic đó sang đọc trực tiếp
 * DB row (category_id, type, snake_case...) là phạm vi RỘNG hơn nhiều so
 * với "migrate nhánh đọc" — rủi ro regression cao, khó verify độc lập
 * trong 1 task. Quyết định (đã xác nhận với người yêu cầu trước khi làm
 * T-S06d): giữ nguyên business logic hiển thị, chỉ đổi NGUỒN data bằng lớp
 * map mỏng này. Dọn hẳn 2 shape song song là việc của 1 task riêng sau này
 * (ghi vào TASKS.md nếu cần), không phải bây giờ.
 *
 * KHÔNG dùng cho luồng ghi — mutation hook (T-S06c) nhận thẳng
 * TransactionInsert/CategoryInsert/GoalInsert (snake_case, đúng DB), không
 * đi qua map ngược lại ở đây.
 */
import type { Database } from "./database.types";
import type { Category, SavingGoal, Transaction, LinkedHistoryEntry, ActivityLogEntry } from "../types";

type TransactionRow = Database["public"]["Tables"]["transactions"]["Row"];
type CategoryRow = Database["public"]["Tables"]["categories"]["Row"];
type GoalRow = Database["public"]["Tables"]["saving_goals"]["Row"];
type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];
type ActivityLogRow = Database["public"]["Tables"]["activity_log"]["Row"];

// [T-S27] activity_log không có shape "cũ" song song nào (khác Transaction/
// Category/SavingGoal) — chuông là tính năng MỚI viết từ đầu (CONSTITUTION
// §1.23), nhưng vẫn đặt map ở đây cho nhất quán 1 chỗ duy nhất map DB row.
export function rowToActivityLogEntry(row: ActivityLogRow): ActivityLogEntry {
  return {
    id: row.id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id ?? undefined,
    message: row.message,
    source: row.source,
    readAt: row.read_at ?? undefined,
    createdAt: row.created_at,
  };
}

export function rowToCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon,
    type: row.type,
    limitAmount: row.limit_amount ?? undefined,
    isRecurring: row.is_recurring,
  };
}

export function rowToGoal(row: GoalRow): SavingGoal {
  return {
    id: row.id,
    name: row.name,
    targetAmount: row.target_amount ?? undefined,
    currentAmount: row.current_amount,
    targetDate: row.target_date ?? undefined,
    createdAt: row.created_at,
    // T-S19 (migration 0016).
    completedAt: row.completed_at ?? undefined,
    // T-S48 (migration 0017) — currentAmount ở trên vẫn map từ row.current_amount
    // như cũ; với goal liên kết category, component (SavingGoals.tsx) tự
    // OVERRIDE giá trị này bằng số tính lại từ transactions, không đọc field
    // trên cho loại goal này. Map thô ở đây, không tính toán gì thêm.
    linkedCategoryId: row.linked_category_id ?? undefined,
    linkedStartDate: row.linked_start_date ?? undefined,
    linkedEndDate: row.linked_end_date ?? undefined,
    // T-S57 (migration 0018) — map thô, không tính toán gì thêm ở đây
    // (component tự cộng vào công thức "Tổng đã tích luỹ", xem §1.20).
    carriedOverSavedAmount: row.carried_over_saved_amount,
    carriedOverSpentAmount: row.carried_over_spent_amount,
    // T-S62 (CONSTITUTION §1.20.2) — map thô, component dùng để loại trừ
    // giao dịch đã đóng băng khỏi mọi phép tính "đang sống" (tránh đếm đúp
    // khi giao dịch cũ vẫn rơi vào category/khoảng ngày hiện tại).
    carriedOverTransactionIds: row.carried_over_transaction_ids ?? [],
    // T-S80 (migration 0022) — map thô. `?? false`/`?? row.created_at`
    // phòng trường hợp đọc dữ liệu cũ trước khi migration 0022 chạy (cột
    // NOT NULL DEFAULT nên về lý thuyết luôn có giá trị sau khi chạy xong,
    // fallback chỉ để code không vỡ nếu gọi rowToGoal trước khi migrate).
    isSavingsLink: row.is_savings_link ?? false,
    linkedAt: row.linked_at ?? row.created_at,
    // T-S61 (migration 0019, CONSTITUTION §1.20 tu chỉnh) — `type`/
    // `transactions_snapshot` optional ở DB row vì dữ liệu ghi TRƯỚC T-S61
    // (bởi RPC 0018) không có 2 field này. Mặc định `type: "linked"`,
    // `transactionsSnapshot: []` khi thiếu — giữ đúng hành vi hiển thị cũ
    // cho dữ liệu lịch sử, không crash/hiện rỗng sai.
    linkedHistory: (row.linked_history ?? []).map(
      (h): LinkedHistoryEntry => ({
        type: h.type ?? "linked",
        categoryName: h.category_name,
        startDate: h.start_date,
        endDate: h.end_date,
        amount: h.amount,
        endedAt: h.ended_at,
        transactionsSnapshot: h.transactions_snapshot ?? [],
        note: h.note,
        // T-S83 (migration 0023)
        withdrawalGroupId: h.withdrawal_group_id ?? undefined,
        // T-S79 (migration 0024)
        manualAmount: h.manual_amount ?? undefined,
        linkedAmount: h.linked_amount ?? undefined,
      })
    ),
  };
}

/**
 * `categories`/`members` dùng để resolve `category_id -> tên` và
 * `member_id -> tên hiển thị` — 2 field mà shape cũ lưu trực tiếp thành
 * string thay vì id. Nếu không tìm thấy (vd category đã bị soft-delete
 * nhưng transaction còn tham chiếu id cũ), fallback "Khác" thay vì crash.
 */
export function rowToTransaction(
  row: TransactionRow,
  categories: CategoryRow[],
  members: ProfileRow[]
): Transaction {
  const categoryName =
    categories.find((c) => c.id === row.category_id)?.name ?? "Khác";
  // T-S17 (migration 0011): ưu tiên tra tên qua danh sách thành viên HIỆN
  // TẠI (mới nhất, đúng nếu họ vừa đổi tên hiển thị); nếu không resolve
  // được (đã rời hộ) fallback về `member_name_snapshot` — bản chụp tên lúc
  // tạo giao dịch, do trigger DB set, không mất khi thành viên rời hộ.
  const memberName = row.member_id
    ? members.find((m) => m.id === row.member_id)?.name ?? row.member_name_snapshot ?? undefined
    : undefined;

  return {
    id: row.id,
    description: row.description,
    amount: row.amount,
    category: categoryName,
    date: row.date,
    note: row.note ?? undefined,
    createdAt: row.created_at,
    member: memberName,
    // [BUGFIX 08/08/2026] id thô đi kèm, xem ghi chú ở types.ts Transaction.
    memberId: row.member_id ?? undefined,
    ownerId: row.owner_id ?? undefined,
    goalId: row.goal_id ?? undefined,
    type: row.type,
    // T-S83 (migration 0023)
    withdrawalGroupId: row.withdrawal_group_id ?? undefined,
    // T-S114 (19/08/2026, phương án B) — id thô, dùng cho mọi phép TÍNH
    // TOÁN theo category (ngân sách...); `category` (tên) ở trên chỉ để hiển thị.
    categoryId: row.category_id ?? undefined,
  };
}

export function rowsToTransactions(
  rows: TransactionRow[],
  categories: CategoryRow[],
  members: ProfileRow[]
): Transaction[] {
  return rows.map((row) => rowToTransaction(row, categories, members));
}