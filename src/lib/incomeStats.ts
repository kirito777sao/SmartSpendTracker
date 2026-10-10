/**
 * [T-S41, 10-11/08/2026] Helper tính thu nhập dùng chung, tách ra từ đúng
 * cách tính `totalIncome` đã có ở `FinancialDashboard.tsx` (dùng
 * `isIncomeTx`/`txClassify.ts` — nguồn sự thật `t.type`, KHÔNG so tên
 * category) — theo CONSTITUTION §1.15/quy tắc bắt buộc txClassify.ts và
 * theo yêu cầu PRD T-S41: "tái dùng đúng cách tính totalIncome ở
 * FinancialDashboard.tsx, KHÔNG viết lại logic mới".
 *
 * Dùng ở `SmartAllocator.tsx`:
 *   - `getCurrentMonthIncomeStats` -> tự điền ô "Tổng thu nhập tháng này" +
 *     breakdown theo category (T-S41 điểm 1).
 *   - `getRecentMonthsIncomeAverage` -> banner gợi ý đổi công thức
 *     "Tối giản/Khẩn cấp" khi thu nhập tháng này thấp bất thường so với
 *     trung bình các tháng gần nhất CÓ dữ liệu thu nhập (T-S41 điểm 3,
 *     KHÔNG tự động đổi công thức — chỉ gợi ý, đúng CONSTITUTION §5).
 */
import type { Transaction } from "../types";
import { isIncomeTx, isExpenseTx } from "./txClassify";
// (isExpenseTx dùng lại ở getCurrentMonthCategorySpending bên dưới, T-S112)

export interface IncomeBreakdownItem {
  category: string;
  total: number;
}

export interface CurrentMonthIncomeStats {
  total: number;
  breakdown: IncomeBreakdownItem[];
}

// `t.date` luôn dạng "YYYY-MM-DD" (xem types.ts) -> lấy "YYYY-MM" bằng cách
// cắt chuỗi, tránh lệch timezone khi parse qua `new Date()`.
function monthKeyOf(dateStr: string): string {
  return dateStr.slice(0, 7);
}

/**
 * Tổng thu nhập (`isIncomeTx`) của THÁNG HIỆN TẠI (theo đồng hồ máy khi
 * gọi hàm) + breakdown theo từng category có phát sinh trong tháng đó, sắp
 * xếp giảm dần theo số tiền để hiển thị mục lớn nhất trước.
 */
export function getCurrentMonthIncomeStats(
  transactions: Transaction[]
): CurrentMonthIncomeStats {
  const currentMonthKey = monthKeyOf(new Date().toISOString());
  const byCategory = new Map<string, number>();
  let total = 0;

  transactions.forEach((t) => {
    if (!isIncomeTx(t)) return;
    if (monthKeyOf(t.date) !== currentMonthKey) return;
    const amount = Math.abs(t.amount);
    total += amount;
    byCategory.set(t.category, (byCategory.get(t.category) ?? 0) + amount);
  });

  const breakdown: IncomeBreakdownItem[] = Array.from(byCategory.entries())
    .map(([category, categoryTotal]) => ({ category, total: categoryTotal }))
    .sort((a, b) => b.total - a.total);

  return { total, breakdown };
}

export interface RecentMonthsIncomeAverage {
  average: number;
  monthsWithData: number;
}

/**
 * Trung bình thu nhập của các tháng GẦN NHẤT CÓ dữ liệu thu nhập, tính từ
 * tháng liền trước tháng hiện tại lùi lại tối đa `lookbackMonths` tháng
 * (mặc định 6) — tháng nào không có giao dịch thu nhập nào thì bỏ qua,
 * không tính là "0đ" vào trung bình (tránh trung bình bị kéo xuống sai do
 * tháng chưa có dữ liệu, khác với tháng thu nhập thật sự bằng 0).
 */
export function getRecentMonthsIncomeAverage(
  transactions: Transaction[],
  lookbackMonths = 6
): RecentMonthsIncomeAverage {
  const now = new Date();
  const currentMonthKey = monthKeyOf(now.toISOString());

  const totalsByMonth = new Map<string, number>();
  transactions.forEach((t) => {
    if (!isIncomeTx(t)) return;
    const key = monthKeyOf(t.date);
    if (key === currentMonthKey) return; // chỉ tính các tháng TRƯỚC tháng hiện tại
    totalsByMonth.set(key, (totalsByMonth.get(key) ?? 0) + Math.abs(t.amount));
  });

  // Danh sách N tháng gần nhất trước tháng hiện tại (kể cả tháng không có
  // dữ liệu, để giới hạn đúng "gần nhất" thay vì quét toàn bộ lịch sử).
  const candidateKeys: string[] = [];
  for (let i = 1; i <= lookbackMonths; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    candidateKeys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }

  const dataPoints = candidateKeys
    .map((key) => totalsByMonth.get(key))
    .filter((v): v is number => v !== undefined && v > 0);

  if (dataPoints.length === 0) {
    return { average: 0, monthsWithData: 0 };
  }

  const average = dataPoints.reduce((sum, v) => sum + v, 0) / dataPoints.length;
  return { average, monthsWithData: dataPoints.length };
}

/**
 * [T-S50/T-S51, CONSTITUTION §1.15] "Số dư luỹ kế" — tổng TẤT CẢ giao dịch
 * `isIncomeTx()` trừ tổng TẤT CẢ giao dịch `isExpenseTx()`, tính từ TOÀN BỘ
 * lịch sử giao dịch (mốc đã XÁC NHẬN 10/08/2026, không giới hạn/không cấu
 * hình thêm) — KHÔNG lọc theo tháng/khoảng thời gian nào, khác hẳn 2 hàm
 * phía trên. Tách ra đây để dùng CHUNG giữa `FinancialDashboard.tsx` (T-S50,
 * hiện KPI) và `SmartAllocator.tsx` (T-S51, checkbox gộp vào tổng phân bổ)
 * — đúng nguyên tắc bắt buộc "1 công thức tài chính, 1 hàm dùng chung"
 * (CONSTITUTION §5, bài học rút ra từ bug T-S64). `type='transfer'` không
 * rơi vào isIncomeTx/isExpenseTx nên tự động không ảnh hưởng số này.
 */
/**
 * [T-S112, 19/08/2026 — bugfix phát hiện qua audit logic dòng tiền toàn hệ
 * thống theo yêu cầu người dùng] "Đã chi TRONG THÁNG HIỆN TẠI" của 1
 * category cụ thể — nguồn sự thật DUY NHẤT cho khái niệm "đã chi so với hạn
 * mức ngân sách" (`categories.limit_amount` LUÔN là hạn mức THEO THÁNG,
 * không phải theo bất kỳ khoảng thời gian tuỳ chọn nào khác).
 *
 * Trước bản vá này, `BudgetLimits.tsx` (`getCurrentMonthSpending`, đúng
 * nghĩa tháng hiện tại) và `FinancialDashboard.tsx` (`budgetLimitsWithStatus`,
 * SAI — dùng `filteredTransactions` đã lọc theo `timeFilter` Dashboard đang
 * chọn: today/week/month/year/custom/all) tự viết 2 công thức riêng cho
 * CÙNG 1 khái niệm — vi phạm nguyên tắc "1 công thức tài chính, 1 hàm dùng
 * chung" (CONSTITUTION §5, bài học T-S64). Khi người dùng đổi Dashboard
 * sang "Năm nay"/"Tự chọn" khoảng dài, widget "Kiểm Soát Hạn Mức Ngân Sách"
 * cộng dồn chi tiêu CẢ KỲ DÀI rồi so với hạn mức 1 THÁNG → % sai nghiêm
 * trọng, không khớp tab Ngân Sách thật, không có lỗi build nào báo (chỉ lộ
 * khi đổi filter). Tách ra đây, CỐ Ý KHÔNG nhận `timeFilter`/khoảng ngày
 * nào làm tham số — luôn tự tính đúng tháng hiện tại theo đồng hồ máy khi
 * gọi, bất kể tầng gọi đang hiển thị khoảng thời gian nào khác trên UI.
 * [T-S114, 19/08/2026 — phương án B, bugfix double-count khi 2 category
 * trùng tên] Trước đây match theo `categoryName` (so TÊN) — nếu 2 category
 * khác `id` trùng tên (không có ràng buộc UNIQUE nào chặn tạo trùng), chi
 * tiêu của CẢ HAI bị cộng dồn vào MỖI thẻ hạn mức khớp tên đó, double-count.
 * Đổi sang match theo `categoryId` (nguồn sự thật, luôn duy nhất theo
 * `categories.id`) — `category` (tên) chỉ còn dùng để hiển thị UI, không
 * còn dùng cho bất kỳ phép tính nào ở đây.
 */
export function getCurrentMonthCategorySpending(
  categoryId: string,
  transactions: Transaction[]
): number {
  const today = new Date();
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth(); // 0-indexed

  return transactions
    .filter((t) => {
      if (t.categoryId !== categoryId || !isExpenseTx(t)) return false;
      const tDate = new Date(t.date);
      return tDate.getFullYear() === currentYear && tDate.getMonth() === currentMonth;
    })
    .reduce((sum, t) => sum + t.amount, 0);
}

export function getCumulativeBalance(transactions: Transaction[]): number {
  let balance = 0;
  transactions.forEach((t) => {
    if (isIncomeTx(t)) {
      balance += Math.abs(t.amount);
    } else if (isExpenseTx(t)) {
      balance -= t.amount;
    }
  });
  return balance;
}

/**
 * [T-S139/T-S143, CONSTITUTION §1.28.2] Tổng thu nhập (`isIncomeTx`) của
 * THÁNG NGAY TRƯỚC tháng hiện tại (theo đồng hồ máy khi gọi hàm) — mốc %
 * mà `run_monthly_auto_contributions()` (migration 0038) THẬT SỰ dùng cho
 * trigger `monthly_schedule` ("mốc % = tháng vừa hoàn tất", KHÁC hẳn
 * `getCurrentMonthIncomeStats` ở trên dùng cho trigger `on_income` của
 * T-S138 — 2 trigger có 2 mốc tính % khác nhau, PHẢI dùng đúng hàm tương
 * ứng khi hiển thị "xem trước ước tính", không trộn lẫn). Tách thành hàm
 * dùng chung ở đây (thay vì viết riêng trong từng component) vì cả
 * `AutoContributionConfig.tsx` (T-S139, target goal) và UI target category
 * (T-S143, `BudgetLimits.tsx`/`SmartAllocator.tsx`) đều cần đúng 1 công
 * thức này cho preview — tránh lặp lại đúng bug lớp T-S64 (§5) nếu viết
 * tay 2 lần ở 2 file khác nhau.
 */
export function getPreviousMonthIncomeTotal(transactions: Transaction[]): number {
  const now = new Date();
  const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonthKey = `${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, "0")}`;

  let total = 0;
  transactions.forEach((t) => {
    if (!isIncomeTx(t)) return;
    if (monthKeyOf(t.date) !== prevMonthKey) return;
    total += Math.abs(t.amount);
  });
  return total;
}