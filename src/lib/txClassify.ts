/**
 * [BUGFIX 08/08/2026] Nguồn sự thật DUY NHẤT để phân loại 1 giao dịch là
 * thu/chi/chuyển khoản cho các phép TÍNH TỔNG (ngân sách, biểu đồ, top chi
 * tiêu) là `t.type` (cột `transactions.type` thật, DB — luôn được set bởi
 * `buildTransactionInsert`/`resolveTransactionType`, xem `toTransactionInsert.ts`).
 *
 * Bug thật đã sửa: `BudgetLimits.getCurrentMonthSpending` và
 * `FinancialDashboard.{budgetLimitsWithStatus,categoryChartData,dailySpendData,topExpenses}`
 * trước đây lọc "spent"/"expense" chỉ bằng `t.category === categoryName`
 * hoặc so tên chuỗi cứng `"Thu nhập"`/`"Lương"` — KHÔNG kiểm tra `t.type`.
 * Hậu quả:
 *   1. Giao dịch góp quỹ tiết kiệm (`type='transfer'`, vẫn giữ `category_id`
 *      để hiện badge lịch sử theo CONSTITUTION §1.9/T-S14) bị cộng dồn vào
 *      "Đã chi" của category đó — hạn mức ngân sách tăng sai dù tiền đang
 *      chuyển vào tiết kiệm, không phải chi tiêu thật.
 *   2. Giao dịch thu nhập (`type='income'`) có category KHÔNG tên
 *      "Thu nhập"/"Lương" (vd category "Khác" do user tự đặt) lọt vào biểu
 *      đồ/pie chart/"Top 5 khoản chi" chi tiêu — số liệu sai nghiêm trọng
 *      (pie chart tỉ lệ >1900%, "Lương" xuất hiện trong Top chi tiêu).
 *
 * Chỉ dùng fallback so tên category cho dữ liệu KHÔNG có `type` (mock data
 * cũ/optional field, xem types.ts) — không bao giờ override khi `type` đã
 * có giá trị thật.
 */
import type { Transaction } from "../types";

export function isIncomeTx(t: Transaction): boolean {
  if (t.type) return t.type === "income";
  return t.category === "Thu nhập" || t.category === "Lương" || t.amount < 0;
}

export function isTransferTx(t: Transaction): boolean {
  return t.type === "transfer";
}

/**
 * "Chi tiêu thật" theo đúng nghĩa ngân sách/biểu đồ: KHÔNG phải thu nhập,
 * KHÔNG phải chuyển khoản góp quỹ (transfer). Đây là hàm PHẢI dùng cho mọi
 * phép tính "đã chi"/"top chi tiêu"/pie chart chi tiêu — thay cho so tên
 * category thủ công.
 */
export function isExpenseTx(t: Transaction): boolean {
  if (isTransferTx(t)) return false;
  if (t.type) return t.type === "expense";
  return !isIncomeTx(t);
}
