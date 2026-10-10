export interface User {
  id: string;
  email: string;
  passwordHash?: string;
  name: string;
  role: string;
  displayName: string;
  linkToken: string;
  telegramChatId?: string;
  telegramUsername?: string;
  householdInviteCode?: string;
}

export interface Transaction {
  id: string;
  description: string;
  amount: number;
  category: string;
  date: string; // YYYY-MM-DD
  note?: string;
  createdAt: string; // ISO string
  member?: string; // Household member who made this transaction
  // [BUGFIX 08/08/2026] Cần id thô (không chỉ tên hiển thị) để component tự
  // tính quyền sửa/xoá THEO TỪNG DÒNG (member chỉ own row, chủ hộ override
  // tất cả) — trước đây chỉ có `member` (string tên), không đủ để so khớp
  // với auth.uid() hiện tại, khiến nút Sửa/Xoá không thể gate đúng theo hàng.
  memberId?: string;
  ownerId?: string;
  goalId?: string; // Associated saving goal ID (if a contribution)
  // T-S06d: field cộng thêm khi Transaction được map từ Supabase row
  // (`transactions.type`, xem CONSTITUTION §2 — "thay quy ước amount âm").
  // Optional để không phá kiểu dữ liệu cũ (mock data, luồng ghi chưa
  // migrate ở T-S06e) — nơi nào có `type` PHẢI ưu tiên dùng field này thay
  // vì so khớp tên category "Thu nhập"/"Lương", vốn không còn đáng tin khi
  // category do người dùng tự đặt tên tuỳ ý qua DB thật.
  // T-S14 (0013) — 'transfer' = đóng góp quỹ tiết kiệm, KHÔNG tính thu/chi.
  type?: "income" | "expense" | "transfer";
  // T-S83 (migration 0023) — chỉ có giá trị ở dòng "Rút quỹ" phần thủ công
  // khi lần rút đó bị cascade sang CẢ 2 nguồn (thủ công + liên kết) — dùng
  // để gom hiển thị chung 1 nhóm với phần tử `withdrawal_log` cùng
  // `withdrawalGroupId` trong `LinkedHistoryEntry` (xem SavingGoals.tsx,
  // modal "Lịch sử"). undefined ở mọi giao dịch khác.
  withdrawalGroupId?: string;
  // T-S114 (19/08/2026, phương án B) — id thô của category, đi kèm `category`
  // (tên đã resolve, chỉ để HIỂN THỊ). Trước đây các phép match ngân sách
  // (`getCurrentMonthCategorySpending`) so theo TÊN category — nếu 2
  // category khác `id` trùng tên (không có ràng buộc UNIQUE nào chặn), chi
  // tiêu của CẢ HAI bị cộng dồn vào MỖI thẻ hạn mức khớp tên, double-count.
  // Mọi chỗ cần biết "giao dịch này thuộc category nào" cho mục đích TÍNH
  // TOÁN (ngân sách, tổng theo category...) PHẢI dùng `categoryId`, không so
  // `category` (tên) nữa — `category` chỉ còn dùng để hiển thị UI.
  categoryId?: string;
}

export interface Category {
  id: string;
  name: string;
  icon: string; // Emoji character or Lucide icon name
  // T-S06e1b — 'income' | 'expense', từ categories.type (DB thật). Thay cho
  // chuỗi "Thu nhập" hard-code trước đây — mọi nơi cần biết category dùng
  // cho thu hay chi PHẢI đọc field này, không so tên nữa.
  type: "income" | "expense";
  limitAmount?: number; // Optional monthly limit, e.g., 5000000 VNĐ
  isRecurring: boolean; // Auto-renew in the next month
}

export interface SavingGoal {
  id: string;
  name: string;
  targetAmount?: number; // Optional target, null means unlimited saving target
  currentAmount: number;
  targetDate?: string; // YYYY-MM-DD
  createdAt: string;
  // T-S19 (CONSTITUTION §1.9 mục 3) — undefined/không có giá trị = đang
  // tiết kiệm. Có giá trị = đã "Hoàn thành" (thủ công hoặc qua banner tự
  // động T-S20). `currentAmount` giữ nguyên làm lịch sử, KHÔNG bị reset.
  completedAt?: string;
  // T-S48 (CONSTITUTION §1.13) — "Goal liên kết Danh mục Ngân sách". Có giá
  // trị = loại goal thứ 2, SONG SONG với goal thủ công (không trộn, xem
  // §1.13 mục 3): currentAmount ở loại này KHÔNG lấy từ DB — luôn tự TÍNH
  // ở component (SUM giao dịch expense của category này, trong khoảng
  // ngày), không nhận góp quỹ transfer, không xuất hiện ở dropdown "Gắn
  // vào mục tiêu" của SmartInput/AIAssistantBubble/TransactionHistory.
  linkedCategoryId?: string;
  linkedStartDate?: string; // YYYY-MM-DD, bắt buộc có giá trị khi linkedCategoryId khác null
  linkedEndDate?: string; // YYYY-MM-DD, bắt buộc >= linkedStartDate
  // T-S57 (CONSTITUTION §1.20) — dồn theo đúng nguồn dòng tiền, chỉ ghi qua
  // RPC `update_goal_link` (services/goals.ts updateGoalLink). "Tổng đã tích
  // luỹ" hiển thị = carriedOverSavedAmount + carriedOverSpentAmount + (tính
  // động category hiện tại nếu đang liên kết, hoặc currentAmount nếu thủ công).
  carriedOverSavedAmount: number;
  carriedOverSpentAmount: number;
  linkedHistory: LinkedHistoryEntry[];
  // T-S62 (CONSTITUTION §1.20.2, migration 0019 đã có cột này ở DB, chỉ map
  // sang client) — ID mọi giao dịch gốc đã từng được cộng vào carriedOver*
  // ở bất kỳ lần đóng băng nào trước đó. BẮT BUỘC dùng để loại trừ khỏi MỌI
  // phép tính "đang sống" (linkedAmountByGoal, contributionsByGoal) — nếu
  // không, giao dịch đã đóng băng mà vẫn rơi vào khoảng ngày/category hiện
  // tại (do đổi ngày chồng lấp, hoặc link lại đúng category cũ) sẽ bị cộng
  // đúp: 1 lần trong carried_over_*, 1 lần trong phần đang sống.
  carriedOverTransactionIds: string[];
  // T-S80 (migration 0022, CONSTITUTION §1.22.5) — xem giải thích đầy đủ ở
  // database.types.ts. true = category liên kết là "tiết kiệm/theo dõi
  // dòng tiền" (hồi tố đầy đủ), false = "chi tiêu thường" (chỉ tính từ
  // linkedAt trở đi). Vô nghĩa khi không có linkedCategoryId.
  isSavingsLink: boolean;
  linkedAt: string;
}

// T-S61 (migration 0019, CONSTITUTION §1.20 tu chỉnh 11/08/2026) — 1 dòng
// giao dịch gốc đã được "đóng băng" vào 1 giai đoạn linkedHistory, snapshot
// BẤT BIẾN tại thời điểm đóng băng (không đổi dù sau này sửa/xoá giao dịch
// gốc). Dùng để hiện chi tiết từng dòng trong modal "Lịch sử" (T-S56) thay
// vì chỉ 1 con số tổng trần trụi.
export interface TransactionSnapshotEntry {
  id: string;
  description: string;
  date: string;
  amount: number;
}

// T-S57 (migration 0018) + T-S61 (migration 0019, CONSTITUTION §1.20 tu
// chỉnh) — 1 giai đoạn đã kết thúc, hiển thị ở modal "Lịch sử" (T-S56) như 1
// dòng chỉ đọc. `type: "linked"` = giai đoạn liên kết category đã kết thúc
// (đổi category khác hoặc unlink); `type: "manual"` = giai đoạn thủ công
// đóng băng lúc chuyển sang liên kết (T-S61 — trước đây bị bỏ sót, lịch sử
// góp thủ công cũ biến mất trắng khỏi modal). `categoryName`/`startDate`/
// `endDate` chỉ có giá trị khi `type === "linked"`.
// T-S60 (migration 0021, CONSTITUTION §1.21) — `type: "withdrawal_log"` =
// 1 lần "Rút quỹ" từ PHẦN LIÊN KẾT (tiền đã chi tiêu thật ở category gốc
// rồi, KHÔNG tạo giao dịch mới) — chỉ có `amount`/`note`/`endedAt`, các
// field còn lại null/rỗng. Rút từ PHẦN THỦ CÔNG không tạo phần tử ở đây
// (xem `completionSpendByGoal`, SavingGoals.tsx — đọc trực tiếp từ giao
// dịch `expense`+`goal_id` thật, không cần log trùng).
export interface LinkedHistoryEntry {
  type: "linked" | "manual" | "withdrawal_log" | "completed_unspent";
  categoryName: string | null;
  startDate: string | null;
  endDate: string | null;
  amount: number;
  endedAt: string;
  transactionsSnapshot: TransactionSnapshotEntry[];
  note?: string;
  // T-S83 (migration 0023) — chỉ có giá trị khi `type === "withdrawal_log"`
  // VÀ lần rút đó bị cascade sang cả phần thủ công (dòng `transactions`
  // tương ứng có cùng `withdrawalGroupId`, xem `Transaction.withdrawalGroupId`
  // ở trên). undefined khi rút chỉ 1 nguồn (hành vi cũ, không đổi).
  withdrawalGroupId?: string;
  // T-S79 (migration 0024) — chỉ có giá trị khi `type === "completed_unspent"`
  // (đánh dấu hoàn thành mà chưa tiêu gì, xem `complete_goal_unspent` RPC).
  manualAmount?: number;
  linkedAmount?: number;
}

export interface HouseholdMember {
  id: string;
  name: string;
  role: "Cá nhân" | "Bố" | "Mẹ" | "Chồng" | "Vợ" | "Con trai" | "Con gái" | "Khác";
  displayName: string;
  joinedAt: string;
  telegramChatId?: string;
  isOwner?: boolean;
}

export interface Household {
  id: string;
  name: string;
  inviteCode: string;
  createdAt: string;
  members: HouseholdMember[];
}

export type AllocationFormula =
  | "50_30_20"
  | "6_jars"
  | "zero_based"
  | "pay_yourself_first"
  | "kakeibo"
  | "bare_bones"
  | "custom";

export interface AllocationItem {
  categoryName: string;
  percent: number;
  suggestedAmount: number;
  description: string;
  // T-S35 — id category thật nếu dòng này bắt nguồn từ 1 category có sẵn
  // (không phải dòng "Tự chọn" thêm mới tay). Dùng để Áp Dụng khớp ĐÚNG
  // category đó dù người dùng có sửa tên hiển thị trong lúc chỉnh phân bổ,
  // tránh tạo trùng category mới khi tên bị đổi.
  categoryId?: string;
  // T-S44 (09/08/2026) — icon người dùng tự chọn qua IconPicker ở dòng "Tự
  // chọn". Không có -> Áp Dụng tự đoán qua iconForCategoryName như cũ.
  icon?: string;
}

export interface DashboardStats {
  totalIncome: number;
  totalExpense: number;
  netSavings: number;
  savingsRate: number;
}

// [T-S27, CONSTITUTION §1.11] Chuông thông báo — đọc trực tiếp từ
// `activity_log` (mở rộng, không phải bảng riêng). Chỉ đọc, không có
// Insert/Update type tương ứng ở FE — mọi dòng sinh bởi DB trigger, đánh
// dấu đã đọc qua RPC `mark_activity_read` (xem services/activityLog.ts).
export interface ActivityLogEntry {
  id: string;
  action: string;
  entityType: string;
  entityId?: string;
  message: string;
  source: "web" | "telegram" | "system";
  readAt?: string;
  createdAt: string;
}