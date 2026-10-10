// Standalone verification of T-S157 new detectQueryIntent logic (Node, no Deno/Supabase deps)

function findMatchingCategoryName(text, categoriesList) {
  const lower = text.toLowerCase();
  for (const name of categoriesList) {
    const nameLower = name.trim().toLowerCase();
    if (!nameLower) continue;
    if (lower.includes(nameLower) || nameLower.includes(lower)) return name;
  }
  return null;
}

const AMOUNT_REGEX = /\d+(?:\.\d+)?\s*(k|nghìn|ngàn|tr|triệu|đ|d|vnd)?/i;

const STRONG_QUERY_KEYWORDS = [
  "tổng chi tiêu", "tổng thu nhập", "còn bao nhiêu", "bao nhiêu tiền",
  "số dư", "luỹ kế", "lũy kế", "so sánh", "giao dịch gần đây",
  "chi những gì", "khoản chi lớn nhất", "tiến độ", "mục tiêu tiết kiệm",
  "trích tự động", "hạn mức ngân sách", "hết bao nhiêu",
];

function isStrongQueryPhrase(text) {
  const lower = text.toLowerCase();
  return STRONG_QUERY_KEYWORDS.some((kw) => lower.includes(kw));
}

function detectQueryIntent(text, categoriesList, _goalsList, hasAmount) {
  const lower = text.toLowerCase();
  const strong = isStrongQueryPhrase(lower);

  if (!strong) {
    if (hasAmount) return null;
    if (findMatchingCategoryName(lower, categoriesList)) return "category_spending";
    return null;
  }

  if (lower.includes("so sánh")) return "compare_months";
  if (lower.includes("số dư") || lower.includes("luỹ kế") || lower.includes("lũy kế")) return "cumulative_balance";
  if (lower.includes("còn bao nhiêu") && (lower.includes("ngân sách") || lower.includes("hạn mức")))
    return "budget_remaining";
  if (lower.includes("bao nhiêu tiền")) return "cumulative_balance";
  if (lower.includes("trích tự động")) return "auto_contribution_status";
  if (lower.includes("tiến độ") || lower.includes("mục tiêu tiết kiệm")) return "goal_progress";
  if (lower.includes("khoản chi lớn nhất")) return "top_expense";
  if (lower.includes("giao dịch gần đây") || lower.includes("chi những gì")) return "recent_transactions";
  if (lower.includes("tổng chi tiêu") || lower.includes("tổng thu nhập")) return "total_spending_income";
  if (lower.includes("hết bao nhiêu")) return "category_spending";
  if (findMatchingCategoryName(lower, categoriesList)) return "category_spending";
  return null;
}

// Helper mô phỏng đúng logic gọi thật trong handleMessage (T-S157):
function classify(text, categoriesList) {
  const hasAmount = AMOUNT_REGEX.test(text);
  const fetched = isStrongQueryPhrase(text) || !hasAmount ? categoriesList : [];
  return detectQueryIntent(text, fetched, [], hasAmount);
}

const categories = ["ăn uống", "di chuyển", "giải trí", "hoá đơn"];

let pass = 0, fail = 0;
function check(desc, actual, expected) {
  const ok = actual === expected;
  if (ok) pass++; else fail++;
  console.log(`${ok ? "PASS" : "FAIL"} | expected=${expected} actual=${actual} | ${desc}`);
}

// --- Case gốc AC T-S157 đã báo bug ---
check('"ngân sách test nè là bao nhiêu ở hộ gia đình" (category "test nè" KHÔNG tồn tại thật) -> không khớp category nào -> null (KHÔNG bịa, coi là khai báo giao dịch cũ, đúng AC "không match không lỗi")',
  classify("ngân sách test nè là bao nhiêu ở hộ gia đình", categories), null);

// --- Case chính cần fix: "<category> là bao nhiêu" ---
check('"ăn uống là bao nhiêu" -> category thật, không số tiền -> category_spending',
  classify("ăn uống là bao nhiêu", categories), "category_spending");

check('"di chuyển còn bao nhiêu tiền ngân sách" -> có cụm mạnh "còn bao nhiêu"+"ngân sách" -> budget_remaining (nhánh strong, không đổi hành vi cũ)',
  classify("di chuyển còn bao nhiêu tiền ngân sách", categories), "budget_remaining");

check('"giải trí" (chỉ đúng 1 từ, không số tiền) -> khớp category thật -> category_spending',
  classify("giải trí", categories), "category_spending");

// --- Regression: có số tiền -> PHẢI vẫn null (không đổi hành vi khai báo giao dịch) ---
check('"ăn uống 50k" (category thật + có số tiền) -> null, vẫn đi handleExpenseText như cũ',
  classify("ăn uống 50k", categories), null);

check('"đổ xăng di chuyển 100000đ" (có số tiền) -> null',
  classify("đổ xăng di chuyển 100000đ", categories), null);

// --- Regression: câu không liên quan, không số tiền, không khớp category nào -> null ---
check('"chào bot" (không số tiền, không khớp category) -> null',
  classify("chào bot", categories), null);

check('"cảm ơn nhé" -> null',
  classify("cảm ơn nhé", categories), null);

// --- Regression: 8 intent mạnh khác vẫn hoạt động y hệt cũ (không bị nhánh mới can thiệp) ---
check('"tổng chi tiêu tháng này" -> total_spending_income',
  classify("tổng chi tiêu tháng này", categories), "total_spending_income");
check('"số dư hiện tại" -> cumulative_balance',
  classify("số dư hiện tại", categories), "cumulative_balance");
check('"tiến độ mục tiêu tiết kiệm mua nhà" -> goal_progress',
  classify("tiến độ mục tiêu tiết kiệm mua nhà", categories), "goal_progress");
check('"khoản chi lớn nhất tháng này" -> top_expense',
  classify("khoản chi lớn nhất tháng này", categories), "top_expense");
check('"giao dịch gần đây" -> recent_transactions',
  classify("giao dịch gần đây", categories), "recent_transactions");
check('"trích tự động thế nào" -> auto_contribution_status',
  classify("trích tự động thế nào", categories), "auto_contribution_status");
check('"so sánh tháng này với tháng trước" -> compare_months',
  classify("so sánh tháng này với tháng trước", categories), "compare_months");
check('"ăn uống hết bao nhiêu" (T-S149 case, vẫn PASS) -> category_spending',
  classify("ăn uống hết bao nhiêu", categories), "category_spending");

// --- Case paraphrase khác nhau cùng ý định ngân sách (AC yêu cầu 3-5 câu paraphrase) ---
check('"hoá đơn là bao nhiêu" -> category_spending',
  classify("hoá đơn là bao nhiêu", categories), "category_spending");
check('"tiền ăn uống của tôi là bao nhiêu" -> category_spending (chứa "ăn uống")',
  classify("tiền ăn uống của tôi là bao nhiêu", categories), "category_spending");
check('"hạn mức ăn uống" (không số tiền, khớp category) -> category_spending',
  classify("hạn mức ăn uống", categories), "category_spending");

// --- Case rủi ro đã cảnh báo: câu không có category thật, không số tiền, không cụm mạnh -> vẫn null (không bừa bãi) ---
check('"bạn khoẻ không" -> null (không khớp category thật, an toàn)',
  classify("bạn khoẻ không", categories), null);

console.log(`\n${pass} PASS / ${fail} FAIL / ${pass + fail} total`);
process.exit(fail > 0 ? 1 : 0);
