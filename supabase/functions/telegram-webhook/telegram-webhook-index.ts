// T-S10 (16/08/2026): Edge Function thay hẳn server.ts §Telegram (mock/
// localStorage cũ). Theo đúng CONSTITUTION §4 (LOCKED) — xem file đó để
// biết đầy đủ luồng thiết kế. Dùng SERVICE_ROLE_KEY (không phải JWT người
// dùng) vì Telegram không mang theo Supabase session — mọi "xác thực"
// người gửi dựa vào `profiles.telegram_chat_id` (unique) sau khi đã /link.
//
// Deploy: supabase functions deploy telegram-webhook
// Secret bắt buộc: supabase secrets set TELEGRAM_BOT_TOKEN=<token từ BotFather>
// Secret khuyến nghị (chống giả mạo request tới webhook):
//   supabase secrets set TELEGRAM_WEBHOOK_SECRET=<chuỗi ngẫu nhiên tự chọn>
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY: Supabase TỰ ĐỘNG cung cấp cho
// mọi Edge Function, không cần tự set.
//
// QUAN TRỌNG: function này PHẢI deploy với verify_jwt = false (xem
// supabase/config.toml) — Telegram gọi tới đây không mang JWT Supabase.

import { createClient } from "npm:@supabase/supabase-js@^2.45.4";
import { runParseTransaction } from "../_shared/parseTransactionLogic.ts";

const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
const WEBHOOK_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

async function sendTelegramMessage(chatId: string, text: string, replyMarkup?: unknown) {
  try {
    await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "Markdown",
        reply_markup: replyMarkup,
      }),
    });
  } catch (err) {
    console.error("sendTelegramMessage failed:", err);
  }
}

async function answerCallbackQuery(callbackQueryId: string, text?: string) {
  try {
    await fetch(`${TELEGRAM_API}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackQueryId, text, show_alert: false }),
    });
  } catch (err) {
    console.error("answerCallbackQuery failed:", err);
  }
}

const WELCOME_MESSAGE = `👋 *Chào mừng đến với Smart Spend AI Bot!* 🏡

Đây là bot ghi chép tài chính, liên kết trực tiếp với tài khoản web của bạn.

⚙️ *Cách liên kết:*
1. Đăng nhập tài khoản trên website.
2. Vào phần *Cá Nhân / Hộ Gia Đình* lấy *Mã liên kết Telegram* (6 chữ số).
3. Gửi tin nhắn vào đây theo cú pháp: \`/link <mã_của_bạn>\` (Ví dụ: \`/link 123456\`).

🎯 *Sau khi kết nối:* Bạn chỉ cần nhập chi tiêu tự do bằng tiếng Việt, bot sẽ tự động nhận dạng và ghi thẳng vào sổ trên web!

📌 *Lệnh khác:* \`/ca_nhan\` (ghi vào sổ cá nhân), \`/ho_gia_dinh\` (ghi vào sổ hộ gia đình).`;

const NOT_LINKED_MESSAGE = `⚠️ *Tài khoản Telegram chưa được liên kết!*

Vui lòng đăng nhập vào website, lấy mã liên kết của bạn và gửi tin nhắn vào đây theo cú pháp:

\`/link <mã_liên_kết>\``;

interface ProfileRow {
  id: string;
  name: string;
  household_id: string | null;
  telegram_active_scope: string;
}

// [T-S147, CONSTITUTION §4.1] Nguồn sự thật DUY NHẤT cho scope hiệu lực —
// BẮT BUỘC dùng ở MỌI hàm truy vấn mới. Đây chính là logic race-condition
// fallback đã đúng từ T-S90 trên bản `telegram-webhook-merged.ts` (scope=
// 'household' mà household_id đã null do vừa rời hộ -> fallback
// 'personal') — file này TRƯỚC ĐÓ vẫn còn thiếu fix T-S90 (chỉ xét
// `household_id` có tồn tại hay không, lệch với `telegram_active_scope`
// mà RPC `add_transactions_via_bot` dùng làm nguồn sự thật). Đồng bộ vào
// đây luôn khi thêm hạ tầng T-S147 để 3 bản file không tiếp tục lệch nhau.
type EffectiveScope = { scope: "personal" | "household"; ownerId?: string; householdId?: string };

function getEffectiveScope(profile: ProfileRow): EffectiveScope {
  const isHousehold = profile.telegram_active_scope === "household" && !!profile.household_id;
  return isHousehold
    ? { scope: "household", householdId: profile.household_id! }
    : { scope: "personal", ownerId: profile.id };
}

// [T-S156, CONSTITUTION §4.1.1, CHỐT 01/09/2026] Override scope NGAY
// TRONG câu hỏi — CHỈ áp dụng nhánh hỏi-đáp (handleMessage/handleQuery
// dưới đây), KHÔNG đụng `handleExpenseText`/`getEffectiveScope` (khai báo
// giao dịch vẫn dùng nguyên `telegram_active_scope`, không đổi hành vi).
// Chỉ khớp CHÍNH XÁC 2 cụm đã dùng làm nhãn/lệnh sẵn có của bot ("hộ gia
// đình", "cá nhân") — không đoán biến thể khác, đúng tinh thần rule-first
// "không bịa" của toàn khối hỏi-đáp T-S147 trở đi. Câu có CẢ 2 cụm cùng
// lúc (mơ hồ) -> null, không đoán.
function detectScopeOverride(text: string): "personal" | "household" | null {
  const lower = text.toLowerCase();
  const hasHousehold = lower.includes("hộ gia đình");
  const hasPersonal = lower.includes("cá nhân");
  if (hasHousehold && hasPersonal) return null;
  if (hasHousehold) return "household";
  if (hasPersonal) return "personal";
  return null;
}

// Scope dùng RIÊNG cho 1 câu hỏi cụ thể — override (nếu khớp) chỉ có hiệu
// lực cho CÂU ĐÓ, KHÔNG ghi đè `telegram_active_scope` lưu trong DB (khác
// hẳn lệnh `/ca_nhan`/`/ho_gia_dinh`, vốn đổi vĩnh viễn). Không khớp
// override nào -> fallback nguyên vẹn `getEffectiveScope(profile)` (hành
// vi cũ, không đổi). `deniedHousehold=true` -> nơi gọi BẮT BUỘC tự chặn
// trước khi truy vấn (không được âm thầm rơi về cá nhân — đúng lỗi gốc
// đang sửa ở task này: trước đây im lặng trả lời cá nhân khiến người
// dùng tưởng bot đã hiểu household nhưng thực ra bỏ qua hoàn toàn).
function resolveQueryScope(
  profile: ProfileRow,
  text: string
): EffectiveScope & { deniedHousehold?: boolean } {
  const override = detectScopeOverride(text);
  if (override === "household") {
    if (!profile.household_id) {
      return { scope: "personal", deniedHousehold: true };
    }
    return { scope: "household", householdId: profile.household_id };
  }
  if (override === "personal") {
    return { scope: "personal", ownerId: profile.id };
  }
  return getEffectiveScope(profile);
}

// [T-S149, CONSTITUTION §4.1 mục 3-4] Bản đầy đủ hơn của fetchCategoryNames
// — cần thêm `id`/`limit_amount`/`type` để giải ra category thật cho
// `category_spending`/`budget_remaining` (không chỉ tên để log như trước).
// fetchCategoryNames giờ gọi lại hàm này (không tự viết query riêng lần 2,
// đúng nguyên tắc §5 "1 công thức, 1 hàm dùng chung").
// [T-S156, 01/09/2026] Nhận thẳng `EffectiveScope` đã tính sẵn thay vì
// `ProfileRow` — để nhánh hỏi-đáp (`resolveQueryScope`, có override) và
// nhánh khai báo giao dịch (`getEffectiveScope`, không đổi) cùng dùng
// chung 1 hàm fetch mà không đá lẫn 2 công thức scope khác nhau. Nơi gọi
// tự chọn dùng hàm nào rồi truyền kết quả vào đây — hàm này không tự
// quyết định override.
// [T-S158b, migration 0041, CHỐT hướng A 01/09/2026] `categories.limit_amount`
// đọc thẳng từ bảng giờ chỉ còn là "mẫu" (template), KHÔNG còn là hạn mức
// ÁP DỤNG thật của tháng hiện tại (is_recurring=false hết hạn sau tháng
// tạo, is_recurring=true có thể lệch nếu chưa ai đọc để materialize tháng
// mới — xem đầu file 0041_category_budget_periods.sql). `budget_remaining`
// PHẢI thấy đúng hạn mức đang áp dụng, không phải giá trị thô đã hết hạn —
// nếu không sẽ trả lời SAI (hạn mức tháng trước dù category không
// recurring). Gọi thêm RPC `get_effective_categories` (CÙNG hàm web app
// dùng ở services/categories.ts, đúng nguyên tắc §5 "1 công thức, 1 hàm
// dùng chung") rồi merge limit_amount hiệu lực vào kết quả — vẫn giữ
// nguyên query `categories` gốc để không mất field nào khác đang dùng
// (name/type). RPC bỏ qua hàng rào auth.uid() khi gọi bằng SERVICE_ROLE_KEY
// (auth.uid() null ở ngữ cảnh này) — xem comment trong chính RPC ở
// migration 0041, KHÔNG phải lỗ hổng mới, đúng mô hình tin cậy sẵn có của
// toàn bộ Edge Function này (đã tự resolve + truyền đúng scope).
async function fetchCategoriesFull(
  effective: EffectiveScope
): Promise<{ id: string; name: string; limit_amount: number | null; type: string }[]> {
  const query = supabase.from("categories").select("id, name, limit_amount, type").is("deleted_at", null);
  const { data } =
    effective.scope === "household"
      ? await query.eq("household_id", effective.householdId)
      : await query.eq("owner_id", effective.ownerId);
  const rows = (data || []) as { id: string; name: string; limit_amount: number | null; type: string }[];
  if (rows.length === 0) return rows;

  const { data: effectiveRows, error: effError } = await supabase.rpc("get_effective_categories", {
    p_owner_id: effective.scope === "household" ? null : effective.ownerId,
    p_household_id: effective.scope === "household" ? effective.householdId : null,
    p_year_month: null, // null = tháng hiện tại (giờ VN)
  });
  if (effError) {
    console.error("[T-S158b] get_effective_categories error:", effError);
    return rows; // fallback về giá trị thô hơn là chatbot lỗi trắng hoàn toàn
  }

  const effectiveMap = new Map(
    ((effectiveRows || []) as { id: string; limit_amount: number | null }[]).map((e) => [e.id, e.limit_amount])
  );
  return rows.map((row) =>
    effectiveMap.has(row.id) ? { ...row, limit_amount: effectiveMap.get(row.id) ?? null } : row
  );
}

async function fetchCategoryNames(effective: EffectiveScope): Promise<string[]> {
  const categories = await fetchCategoriesFull(effective);
  return categories.map((c) => c.name);
}

// [T-S149, CONSTITUTION §4.1 mục 3] Khớp tên category trong câu hỏi — TÁI
// DÙNG đúng kiểu fuzzy includes() 2 chiều đã có ở `assignSavingGoal`/T-S20
// (`findMatchingActiveGoalsByName`, src/lib/savingsDetect.ts: `descLower.
// includes(gName) || gName.includes(descLower)`), KHÔNG viết thuật toán so
// khớp thứ 2. Dùng CHUNG ở cả `detectQueryIntent` (phân loại intent) lẫn
// `handleQuery` (giải ra category thật để SUM) — 1 hàm, gọi 2 nơi, tránh 2
// bản fuzzy match lệch nhau (đúng bài học §5).
function findMatchingCategoryName(text: string, categoriesList: string[]): string | null {
  const lower = text.toLowerCase();
  for (const name of categoriesList) {
    const nameLower = name.trim().toLowerCase();
    if (!nameLower) continue;
    if (lower.includes(nameLower) || nameLower.includes(lower)) return name;
  }
  return null;
}

// ---------------------------------------------------------------
// [T-S147, CONSTITUTION §4.1] Hạ tầng "Chế độ Hỏi-Đáp qua Telegram".
// Task này CHƯA trả lời câu hỏi thật (handleQuery nối từ T-S148 trở đi) —
// chỉ dựng: múi giờ VN cho mốc thời gian tương đối, AMOUNT_REGEX dùng
// chung để phân biệt với khai báo giao dịch, và khung detectQueryIntent
// (nhận diện thô bằng từ khoá mạnh, CHƯA khớp tên category/goal thật —
// việc đó thuộc T-S149/T-S150).
// ---------------------------------------------------------------

// "YYYY-MM-DD" theo giờ VN, không phụ thuộc múi giờ server Deno (UTC).
function todayVN(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function lastDayOfMonthVN(year: number, month1to12: number): number {
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

// Nhận diện "hôm nay"/"hôm qua"/"tuần này"/"tháng này"/"tháng trước"/
// "tháng M"/"tháng M/YYYY"/"năm nay"/"DD/MM/YYYY". Không khớp gì -> null,
// bên gọi tự mặc định "tháng này" cho intent cần kỳ (đúng quy ước đã
// dùng cho hạn mức ngân sách, §1.15/T-S112) — hàm này KHÔNG tự áp default.
function parseVietnameseDateRange(text: string): { start: string; end: string; label: string } | null {
  const lower = text.toLowerCase();
  const today = todayVN();
  const [ty, tm, td] = today.split("-").map(Number);

  if (lower.includes("hôm nay")) {
    return { start: today, end: today, label: "hôm nay" };
  }
  if (lower.includes("hôm qua")) {
    const d = new Date(Date.UTC(ty, tm - 1, td - 1));
    const s = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
    return { start: s, end: s, label: "hôm qua" };
  }
  if (lower.includes("tuần này")) {
    // Quy ước tuần bắt đầu Thứ Hai (phổ biến ở VN).
    const d = new Date(Date.UTC(ty, tm - 1, td));
    const dow = d.getUTCDay(); // 0 = Chủ Nhật .. 6 = Thứ Bảy
    const diffToMonday = dow === 0 ? 6 : dow - 1;
    const monday = new Date(d);
    monday.setUTCDate(d.getUTCDate() - diffToMonday);
    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);
    const fmt = (x: Date) => `${x.getUTCFullYear()}-${pad2(x.getUTCMonth() + 1)}-${pad2(x.getUTCDate())}`;
    return { start: fmt(monday), end: fmt(sunday), label: "tuần này" };
  }
  if (lower.includes("tháng trước")) {
    const m = tm === 1 ? 12 : tm - 1;
    const y = tm === 1 ? ty - 1 : ty;
    const end = lastDayOfMonthVN(y, m);
    return { start: `${y}-${pad2(m)}-01`, end: `${y}-${pad2(m)}-${pad2(end)}`, label: `tháng ${m}/${y}` };
  }
  if (lower.includes("tháng này")) {
    const end = lastDayOfMonthVN(ty, tm);
    return { start: `${ty}-${pad2(tm)}-01`, end: `${ty}-${pad2(tm)}-${pad2(end)}`, label: `tháng ${tm}/${ty}` };
  }
  if (lower.includes("năm nay")) {
    return { start: `${ty}-01-01`, end: `${ty}-12-31`, label: `năm ${ty}` };
  }

  // "tháng M" hoặc "tháng M/YYYY" (không phải "tháng này"/"tháng trước").
  const monthMatch = lower.match(/tháng\s+(\d{1,2})(?:[\/\-](\d{4}))?/);
  if (monthMatch) {
    const m = Number(monthMatch[1]);
    const y = monthMatch[2] ? Number(monthMatch[2]) : ty;
    if (m >= 1 && m <= 12) {
      const end = lastDayOfMonthVN(y, m);
      return { start: `${y}-${pad2(m)}-01`, end: `${y}-${pad2(m)}-${pad2(end)}`, label: `tháng ${m}/${y}` };
    }
  }

  // "DD/MM/YYYY" — ngày cụ thể.
  const dateMatch = text.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (dateMatch) {
    const dd = Number(dateMatch[1]);
    const mm = Number(dateMatch[2]);
    const yyyy = Number(dateMatch[3]);
    const s = `${yyyy}-${pad2(mm)}-${pad2(dd)}`;
    return { start: s, end: s, label: `ngày ${pad2(dd)}/${pad2(mm)}/${yyyy}` };
  }

  return null;
}

// Regex số tiền đã có sẵn ở `parseWithRules` (_shared/parseTransactionLogic.ts)
// — GIỮ NGUYÊN Y HỆT pattern đó (không viết công thức thứ 2). Bản copy cục
// bộ vì entrypoint Edge Function không re-export hằng số từ module dùng
// chung, chỉ import hàm `runParseTransaction`.
const AMOUNT_REGEX = /\d+(?:\.\d+)?\s*(k|nghìn|ngàn|tr|triệu|đ|d|vnd)?/i;

type QueryIntent =
  | "total_spending_income"
  | "cumulative_balance"
  | "category_spending"
  | "budget_remaining"
  | "goal_progress"
  | "recent_transactions"
  | "top_expense"
  | "compare_months"
  | "auto_contribution_status";

// Cụm hỏi mạnh — dùng để phân biệt câu hỏi tài chính với khai báo giao
// dịch (đặc biệt khi câu hỏi có lẫn số, vd "còn bao nhiêu ngân sách 500k
// cho ăn uống" không phải câu thường gặp nhưng vẫn phải ưu tiên hỏi-đáp).
const STRONG_QUERY_KEYWORDS = [
  "tổng chi tiêu",
  "tổng thu nhập",
  "còn bao nhiêu",
  "bao nhiêu tiền",
  "số dư",
  "luỹ kế",
  "lũy kế",
  "so sánh",
  "giao dịch gần đây",
  "chi những gì",
  "khoản chi lớn nhất",
  "tiến độ",
  "mục tiêu tiết kiệm",
  "trích tự động",
  "hạn mức ngân sách",
  // [T-S149, gap phát hiện khi đối chiếu AC với STRONG_QUERY_KEYWORDS cũ]
  // câu mẫu AC "tháng này ăn uống hết bao nhiêu" (category_spending) KHÔNG
  // khớp bất kỳ từ khoá nào ở trên -> isStrongQueryPhrase false -> không
  // bao giờ tới được bước match category. Thêm cụm này để bắt đúng dạng
  // câu hỏi "X hết bao nhiêu" (X = tên category).
  "hết bao nhiêu",
];

function isStrongQueryPhrase(text: string): boolean {
  const lower = text.toLowerCase();
  return STRONG_QUERY_KEYWORDS.some((kw) => lower.includes(kw));
}

// [T-S147/T-S149] Nhận diện thô bằng từ khoá mạnh; T-S149 bắt đầu dùng
// `categoriesList` thật để khớp fuzzy cho `category_spending` (T-S150 mới
// dùng `goalsList` cho `goal_progress`, vẫn giữ `_` cho tham số đó ở task
// này). Độ chính xác từng intent hoàn thiện dần T-S148 -> T-S153
// (CONSTITUTION §4.1, mỗi task 1-3 intent liên quan).
// [T-S157, CHỐT 01/09/2026, hướng (2) — tổng quát hoá thay vì liệt kê cụm]
// `isStrongQueryPhrase` không còn là gate CỨNG chặn toàn bộ hàm này. Bug
// gốc: câu hỏi tự nhiên kiểu "<category> là bao nhiêu" không khớp bất kỳ
// cụm nào trong STRONG_QUERY_KEYWORDS -> return null ngay từ đầu -> không
// bao giờ chạm tới nhánh match category ở cuối hàm (dòng
// findMatchingCategoryName), dù nhánh đó vốn đã đủ sức nhận diện đúng câu
// hỏi này. Quyết định: KHÔNG vá thêm cụm cố định (lớp lỗi đã lặp lại
// T-S147->T-S149), thay bằng luật tổng quát — không khớp cụm mạnh nào +
// KHÔNG có số tiền (`hasAmount=false`, đúng AMOUNT_REGEX đã dùng chung ở
// `handleMessage`) + khớp đúng 1 category THẬT trong categoriesList (fuzzy,
// dùng lại `findMatchingCategoryName`, không viết thuật toán so khớp thứ
// 2) -> coi là category_spending. Có số tiền -> GIỮ NGUYÊN hành vi cũ
// (luôn là khai báo giao dịch, return null), tránh case hiếm "khai báo
// giao dịch không có số tiền" (RỦI RO đã cảnh báo ở CONSTITUTION §5/AC gốc
// T-S157) không áp dụng ở đây vì câu có số vẫn đi thẳng handleExpenseText
// như trước — rủi ro chỉ nằm ở chiều ngược lại: câu KHÔNG có số tiền, có
// tên trùng category thật, nhưng ý người dùng không phải hỏi ngân sách
// (case hiếm, chấp nhận theo đúng phương án đã chọn).
function detectQueryIntent(
  text: string,
  categoriesList: string[],
  _goalsList: string[],
  hasAmount: boolean
): QueryIntent | null {
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
  // [T-S148] "còn bao nhiêu tiền"/"bao nhiêu tiền" KHÔNG kèm ngân sách/hạn
  // mức -> hỏi số dư luỹ kế (khác budget_remaining ở nhánh trên, đã check
  // trước nhánh này nên không xung đột khi câu hỏi có cả 2 cụm).
  if (lower.includes("bao nhiêu tiền")) return "cumulative_balance";
  if (lower.includes("trích tự động")) return "auto_contribution_status";
  if (lower.includes("tiến độ") || lower.includes("mục tiêu tiết kiệm")) return "goal_progress";
  if (lower.includes("khoản chi lớn nhất")) return "top_expense";
  if (lower.includes("giao dịch gần đây") || lower.includes("chi những gì")) return "recent_transactions";
  if (lower.includes("tổng chi tiêu") || lower.includes("tổng thu nhập")) return "total_spending_income";
  // [T-S149] "X hết bao nhiêu" (X = tên category, vd "ăn uống hết bao
  // nhiêu") -> category_spending trực tiếp, KHÔNG phụ thuộc việc có khớp
  // được categoriesList hay không (giữ đúng style các nhánh keyword khác ở
  // trên) — lý do: nếu chỉ trả intent khi khớp category thật, câu hỏi về 1
  // category KHÔNG tồn tại sẽ rơi về null -> lọt sang handleExpenseText,
  // không đúng AC "hỏi category không tồn tại -> bot trả lời rõ không tìm
  // thấy". Việc match category thật (và báo "không tìm thấy" nếu cần) để
  // handleQuery xử lý bằng đúng findMatchingCategoryName dùng chung.
  if (lower.includes("hết bao nhiêu")) return "category_spending";

  // [T-S149] Fallback: khớp cụm mạnh nhưng chưa xác định được đúng 1 trong
  // 8 intent trên (vd câu chỉ nêu tên category + 1 cụm mạnh khác không
  // rơi vào nhánh cụ thể nào, như "hạn mức ngân sách ăn uống của tôi") ->
  // thử khớp tên category thật trong categoriesList (fuzzy, dùng chung
  // findMatchingCategoryName) -> có khớp thì coi là category_spending.
  if (findMatchingCategoryName(lower, categoriesList)) return "category_spending";

  return null;
}

// ---------------------------------------------------------------
// [T-S148, CONSTITUTION §4.1] handleQuery — nối 2 intent đầu tiên:
// total_spending_income + cumulative_balance (đơn giản nhất, dùng để
// validate kiến trúc end-to-end trước khi mở rộng 7 intent còn lại ở
// T-S149->T-S153). Dùng CHUNG getEffectiveScope() (không tự tính scope
// riêng) + luôn filter deleted_at is null (hàng rào DUY NHẤT chống lộ dữ
// liệu người khác vì Edge Function dùng SERVICE_ROLE_KEY, xem §4.1).
// ---------------------------------------------------------------
function formatVnd(n: number): string {
  return `${n.toLocaleString("vi-VN")}đ`;
}

async function handleQuery(
  chatId: string,
  profile: ProfileRow,
  intent: QueryIntent,
  text: string,
  effective: EffectiveScope
): Promise<void> {
  // [T-S156, 01/09/2026] `effective` giờ do `handleMessage` tính sẵn qua
  // `resolveQueryScope()` (có override theo từ khoá trong câu hỏi) rồi
  // truyền vào — KHÔNG tự gọi lại `getEffectiveScope(profile)` ở đây nữa,
  // tránh 2 nơi tính scope lệch nhau (label đúng nhưng dữ liệu sai sổ —
  // đúng lớp lỗi đã có trước khi vá task này).
  const scopeLabel = effective.scope === "household" ? "🏡 Hộ gia đình" : "👤 Cá nhân";

  const scopedQuery = (columns: string) => {
    const q = supabase.from("transactions").select(columns).is("deleted_at", null);
    return effective.scope === "household"
      ? q.eq("household_id", effective.householdId)
      : q.eq("owner_id", effective.ownerId);
  };

  if (intent === "total_spending_income") {
    // Không khớp mẫu thời gian nào trong câu hỏi -> mặc định "tháng này"
    // (đúng quy ước đã CHỐT cho mọi intent cần kỳ, §1.15/T-S112/§4.1) —
    // tái dùng lại `parseVietnameseDateRange` cho default thay vì tự viết
    // công thức mốc tháng thứ 2.
    const range = parseVietnameseDateRange(text) ?? parseVietnameseDateRange("tháng này")!;
    const { data, error } = await scopedQuery("amount, type").gte("date", range.start).lte("date", range.end);
    if (error) {
      console.error("[T-S148] handleQuery total_spending_income error:", error);
      await sendTelegramMessage(chatId, "⚠️ Có lỗi khi truy vấn dữ liệu, vui lòng thử lại sau.");
      return;
    }
    let totalIncome = 0;
    let totalExpense = 0;
    (data || []).forEach((t: { amount: number; type: string }) => {
      if (t.type === "income") totalIncome += Math.abs(t.amount);
      else if (t.type === "expense") totalExpense += t.amount;
    });
    await sendTelegramMessage(
      chatId,
      `📊 *Tổng thu chi ${range.label}* (${scopeLabel})\n\n💚 Thu nhập: ${formatVnd(totalIncome)}\n💸 Chi tiêu: ${formatVnd(totalExpense)}`
    );
    return;
  }

  if (intent === "cumulative_balance") {
    // Toàn bộ lịch sử, KHÔNG lọc theo kỳ — khác hẳn total_spending_income
    // ở trên. Port ĐÚNG công thức `getCumulativeBalance` (src/lib/
    // incomeStats.ts, CONSTITUTION §1.15): balance += |amount| nếu income,
    // balance -= amount nếu expense — KHÔNG tự nghĩ công thức khác.
    const { data, error } = await scopedQuery("amount, type");
    if (error) {
      console.error("[T-S148] handleQuery cumulative_balance error:", error);
      await sendTelegramMessage(chatId, "⚠️ Có lỗi khi truy vấn dữ liệu, vui lòng thử lại sau.");
      return;
    }
    let balance = 0;
    (data || []).forEach((t: { amount: number; type: string }) => {
      if (t.type === "income") balance += Math.abs(t.amount);
      else if (t.type === "expense") balance -= t.amount;
    });
    await sendTelegramMessage(chatId, `💰 *Số dư luỹ kế* (${scopeLabel})\n\n${formatVnd(balance)}`);
    return;
  }

  // ---------------------------------------------------------------
  // [T-S149, CONSTITUTION §4.1 mục 3] category_spending + budget_remaining
  // — cả 2 cần khớp tên category trong câu hỏi trước (fuzzy, dùng CHUNG
  // findMatchingCategoryName, không viết thuật toán so khớp thứ 2). Không
  // khớp được category nào -> trả lời rõ không tìm thấy, KHÔNG bịa số.
  // ---------------------------------------------------------------
  if (intent === "category_spending" || intent === "budget_remaining") {
    const categories = await fetchCategoriesFull(effective);
    const matchedName = findMatchingCategoryName(text, categories.map((c) => c.name));
    const matched = matchedName ? categories.find((c) => c.name === matchedName) : undefined;

    if (!matched) {
      await sendTelegramMessage(
        chatId,
        `❓ Không tìm thấy danh mục nào khớp với câu hỏi của bạn. Vui lòng nêu rõ tên danh mục (vd "ăn uống", "di chuyển"...).`
      );
      return;
    }

    if (intent === "category_spending") {
      // Có nêu kỳ trong câu hỏi -> dùng đúng kỳ đó; không nêu -> mặc định
      // "tháng này" (đúng quy ước chung cho intent cần kỳ, §1.15/§4.1) —
      // khác hẳn budget_remaining bên dưới (LUÔN ép tháng hiện tại).
      const range = parseVietnameseDateRange(text) ?? parseVietnameseDateRange("tháng này")!;
      const { data, error } = await scopedQuery("amount, type, category_id")
        .eq("category_id", matched.id)
        .eq("type", "expense")
        .gte("date", range.start)
        .lte("date", range.end);
      if (error) {
        console.error("[T-S149] handleQuery category_spending error:", error);
        await sendTelegramMessage(chatId, "⚠️ Có lỗi khi truy vấn dữ liệu, vui lòng thử lại sau.");
        return;
      }
      const total = (data || []).reduce((sum: number, t: { amount: number }) => sum + t.amount, 0);
      await sendTelegramMessage(
        chatId,
        `📁 *${matched.name} — ${range.label}* (${scopeLabel})\n\n💸 Đã chi: ${formatVnd(total)}`
      );
      return;
    }

    // intent === "budget_remaining"
    if (matched.type === "income") {
      await sendTelegramMessage(
        chatId,
        `ℹ️ "${matched.name}" là danh mục thu nhập — không có khái niệm hạn mức ngân sách.`
      );
      return;
    }
    if (matched.limit_amount === null || matched.limit_amount === undefined) {
      await sendTelegramMessage(chatId, `ℹ️ Danh mục "${matched.name}" chưa được đặt hạn mức ngân sách.`);
      return;
    }
    // [CONSTITUTION §1.15/T-S112/§4.1] budget_remaining LUÔN tính theo
    // THÁNG HIỆN TẠI, bất kể câu hỏi có nêu kỳ khác hay không — KHÔNG nhận
    // parseVietnameseDateRange(text), luôn ép "tháng này" (khớp đúng ý
    // nghĩa getCurrentMonthCategorySpending/incomeStats.ts, hạn mức ngân
    // sách không có khái niệm "theo kỳ tuỳ chọn").
    const range = parseVietnameseDateRange("tháng này")!;
    const { data, error } = await scopedQuery("amount, type, category_id")
      .eq("category_id", matched.id)
      .eq("type", "expense")
      .gte("date", range.start)
      .lte("date", range.end);
    if (error) {
      console.error("[T-S149] handleQuery budget_remaining error:", error);
      await sendTelegramMessage(chatId, "⚠️ Có lỗi khi truy vấn dữ liệu, vui lòng thử lại sau.");
      return;
    }
    const spent = (data || []).reduce((sum: number, t: { amount: number }) => sum + t.amount, 0);
    const remaining = matched.limit_amount - spent;
    const statusLabel = remaining < 0 ? "⚠️ ĐÃ VƯỢT hạn mức" : "✅ Còn lại";
    await sendTelegramMessage(
      chatId,
      `📁 *${matched.name} — Hạn mức ${range.label}* (${scopeLabel})\n\n🎯 Hạn mức: ${formatVnd(matched.limit_amount)}\n💸 Đã chi: ${formatVnd(spent)}\n${statusLabel}: ${formatVnd(Math.abs(remaining))}`
    );
    return;
  }
}

async function handleLink(chatId: string, token: string, username: string) {
  const { data, error } = await supabase.rpc("link_telegram_account", {
    p_token: token,
    p_chat_id: chatId,
    p_username: username,
  });

  if (error || !data || data.length === 0) {
    await sendTelegramMessage(
      chatId,
      `❌ *Lỗi liên kết:* Mã liên kết \`${token}\` không đúng hoặc đã hết hạn. Vui lòng lấy mã mới trên giao diện web.`
    );
    return;
  }

  const profile = data[0] as { id: string; name: string; household_id: string | null };
  const scopeHint = profile.household_id
    ? "Gõ /ca_nhan hoặc /ho_gia_dinh để đổi sổ mặc định bất kỳ lúc nào."
    : "Bạn chưa tham gia hộ gia đình nào — mọi khoản sẽ ghi vào sổ CÁ NHÂN cho tới khi bạn tham gia 1 hộ trên web.";

  const successMsg = `🎉 *LIÊN KẾT THÀNH CÔNG!* 🏡

Chào mừng *${profile.name}* đến với Smart Spend Tracker.

✍️ *Bắt đầu ghi chép:* Gõ tin nhắn chi tiêu bình thường, ví dụ:
• _"Đi chợ mua cá 45k, rau 15k"_
• _"Thanh toán tiền điện 1tr2"_
• _"Tiết kiệm 200k mua tai nghe"_

${scopeHint}

🖥️ Hệ thống sẽ tự động phân tích và hiển thị tức thì trên web!`;

  await sendTelegramMessage(chatId, successMsg);
}

async function handleScopeCommand(chatId: string, profile: ProfileRow, newScope: "personal" | "household") {
  if (newScope === "household" && !profile.household_id) {
    await sendTelegramMessage(
      chatId,
      "🏡 *Chưa tham gia hộ gia đình!*\n\nTài khoản của bạn chưa tham gia hoặc tạo hộ gia đình nào trên web. Vui lòng tham gia hộ gia đình trước."
    );
    return;
  }

  await supabase.from("profiles").update({ telegram_active_scope: newScope }).eq("id", profile.id);

  await sendTelegramMessage(
    chatId,
    newScope === "personal"
      ? "👤 Đã chuyển sổ mặc định sang *CÁ NHÂN*. Từ giờ tin nhắn chi tiêu sẽ ghi vào sổ cá nhân của bạn."
      : "🏡 Đã chuyển sổ mặc định sang *HỘ GIA ĐÌNH*. Từ giờ tin nhắn chi tiêu sẽ ghi vào sổ chung của hộ."
  );
}

async function handleExpenseText(chatId: string, profile: ProfileRow, text: string) {
  // [T-S156] Vẫn dùng `getEffectiveScope(profile)` trực tiếp — khai báo
  // giao dịch KHÔNG áp dụng override theo từ khoá trong câu, giữ nguyên
  // 100% hành vi cũ (chỉ đổi qua lệnh `/ca_nhan`/`/ho_gia_dinh`).
  const categoriesList = await fetchCategoryNames(getEffectiveScope(profile));

  // aiProvider/userApiKey KHÔNG truyền -> mặc định "groq" (khớp T-S09 patch
  // 16/08/2026), luôn dùng key mặc định server (secrets) — bot không có UI
  // nhập key riêng theo từng người qua chat.
  let result;
  try {
    result = await runParseTransaction({ text, userCategories: categoriesList });
  } catch (err) {
    console.error("runParseTransaction failed:", err);
    await sendTelegramMessage(chatId, "⚠️ Có lỗi khi phân tích chi tiêu, vui lòng thử lại sau.");
    return;
  }

  if (!result.transactions || result.transactions.length === 0) {
    await sendTelegramMessage(
      chatId,
      `❓ *Không nhận diện được khoản chi tiêu.*\n\nVui lòng nhập rõ mô tả và số tiền. Ví dụ: _"Cà phê sáng 35k"_, _"Mua bỉm sữa cho con 350 nghìn"_.`
    );
    return;
  }

  const items = result.transactions.map((t) => ({
    description: t.description,
    amount: t.amount,
    category: t.category,
    is_savings: t.isSavingsContribution,
    savings_goal_name: t.savingsGoalName,
  }));

  const { data: rpcRows, error } = await supabase.rpc("add_transactions_via_bot", {
    p_actor: profile.id,
    p_items: items,
  });

  if (error || !rpcRows || rpcRows.length === 0) {
    console.error("add_transactions_via_bot error:", error);
    await sendTelegramMessage(chatId, "⚠️ Có lỗi khi ghi sổ, vui lòng thử lại sau.");
    return;
  }

  const row = rpcRows[0] as {
    out_batch_id: string;
    out_scope: "personal" | "household";
    out_inserted_count: number;
    out_warning: string | null;
  };

  let confirmation = `✅ *Đã ghi ${row.out_inserted_count} khoản chi tiêu!*\n\n`;
  result.transactions.forEach((tx) => {
    const formattedAmount = Math.abs(tx.amount).toLocaleString("vi-VN") + "đ";
    confirmation += `💸 *${tx.description}* — ${formattedAmount}\n📁 ${tx.category}\n\n`;
  });
  confirmation +=
    row.out_scope === "household" ? "🏡 *Đã ghi vào sổ HỘ GIA ĐÌNH*" : "👤 *Đã ghi vào sổ CÁ NHÂN*";
  if (row.out_warning) confirmation += `\n\n⚠️ ${row.out_warning}`;

  // Inline button đổi scope cho cả batch — CHỈ hiện nếu có household
  // (CONSTITUTION §4 mục 6).
  let replyMarkup: unknown = undefined;
  if (profile.household_id) {
    const targetScope = row.out_scope === "household" ? "personal" : "household";
    const label = targetScope === "household" ? "🔁 Chuyển sang HỘ GIA ĐÌNH" : "🔁 Chuyển sang CÁ NHÂN";
    replyMarkup = {
      inline_keyboard: [[{ text: label, callback_data: `reassign:${row.out_batch_id}:${targetScope}` }]],
    };
  }

  await sendTelegramMessage(chatId, confirmation, replyMarkup);
}

async function handleMessage(message: any) {
  const chatId = String(message.chat?.id || "");
  if (!chatId) return;
  const text = (message.text || "").trim();
  const fromUsername = message.from?.username || "";

  // /start <mã 6 số> (deep link t.me/bot?start=123456) hoặc /link <mã>
  const linkMatch = text.match(/^\/?start\s+(\d{6})/i) || text.match(/^\/?link\s+(\d{6})/i);
  if (linkMatch) {
    await handleLink(chatId, linkMatch[1], fromUsername);
    return;
  }

  if (text === "/start" || text === "/help" || text.toLowerCase() === "help") {
    await sendTelegramMessage(chatId, WELCOME_MESSAGE);
    return;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, name, household_id, telegram_active_scope")
    .eq("telegram_chat_id", chatId)
    .maybeSingle();

  if (!profile) {
    await sendTelegramMessage(chatId, NOT_LINKED_MESSAGE);
    return;
  }

  if (text === "/ca_nhan") {
    await handleScopeCommand(chatId, profile as ProfileRow, "personal");
    return;
  }
  if (text === "/ho_gia_dinh") {
    await handleScopeCommand(chatId, profile as ProfileRow, "household");
    return;
  }

  if (!text) return;

  // [T-S148, CONSTITUTION §4.1] Nối handleQuery THẬT cho 2 intent đầu tiên
  // (total_spending_income, cumulative_balance). 7 intent còn lại
  // (T-S149->T-S153) và handleFreeformQuery (T-S154) CHƯA nối — chỉ route
  // sang handleQuery khi intent nằm trong tập ĐÃ implement, mọi trường hợp
  // khác (intent khác hoặc null) giữ NGUYÊN hành vi cũ 100% (đi
  // handleExpenseText) — đúng nguyên tắc "không đổi hành vi handleExpenseText
  // khi có số tiền" + không mở rộng phạm vi ngoài 2 intent của task này.
  const hasAmount = AMOUNT_REGEX.test(text);
  // [T-S156, 01/09/2026] Scope RIÊNG cho câu hỏi này — có override theo
  // từ khoá "hộ gia đình"/"cá nhân" trong chính câu hỏi (CHỈ áp dụng
  // nhánh hỏi-đáp bên dưới, KHÔNG đổi `handleExpenseText` — hàm đó vẫn tự
  // gọi `getEffectiveScope(profile)` y hệt cũ). Tính SỚM, TRƯỚC bước fetch
  // categoriesList ngay dưới đây, vì category dùng để fuzzy-match
  // (T-S149) phải đúng là category của HỘ hay CÁ NHÂN theo override này —
  // tính sau sẽ làm fuzzy-match sai sổ, y hệt lớp lỗi đang sửa ở task này.
  const queryScope = resolveQueryScope(profile as ProfileRow, text);
  // [T-S149] categoriesList thật giờ cần cho category_spending (fuzzy
  // match) — chỉ fetch khi text đã khớp 1 cụm hỏi mạnh nào đó
  // (isStrongQueryPhrase), tránh tốn 1 query category cho MỌI tin nhắn
  // khai báo giao dịch bình thường (đa số tin nhắn không phải câu hỏi) —
  // giữ đường ghi sổ nhanh như cũ. detectQueryIntent tự re-check
  // isStrongQueryPhrase nội bộ nên không đổi hành vi, chỉ tối ưu khi gọi.
  // [T-S156] Dùng `queryScope` (có override) thay vì `getEffectiveScope
  // (profile)` trực tiếp như trước — đây là điểm fix chính của bug scope.
  // [T-S157] Mở rộng điều kiện fetch: KHÔNG có số tiền (`!hasAmount`) cũng
  // phải fetch categoriesList — nhánh tổng quát mới trong `detectQueryIntent`
  // cần category thật để match cho câu hỏi không khớp cụm mạnh nào. Đây
  // đúng là phần "rủi ro cao hơn" đã CHỐT ở AC T-S157: mọi tin nhắn không
  // số tiền (kể cả không phải câu hỏi) giờ tốn thêm 1 query category.
  const categoriesList =
    isStrongQueryPhrase(text) || !hasAmount ? await fetchCategoryNames(queryScope) : [];
  const intent = detectQueryIntent(text, categoriesList, [], hasAmount);
  if (intent) {
    console.log(
      `[SmartSpend][telegram-webhook][T-S147] detectQueryIntent="${intent}" hasAmount=${hasAmount} text="${text}"`
    );
  }
  // [T-S149] Thêm category_spending + budget_remaining vào tập đã
  // implement (T-S148 chỉ có 2 intent đầu). 5 intent còn lại
  // (goal_progress/recent_transactions/top_expense/compare_months/
  // auto_contribution_status, T-S150->T-S153) vẫn rơi về handleExpenseText
  // y hệt cũ.
  const IMPLEMENTED_QUERY_INTENTS: QueryIntent[] = [
    "total_spending_income",
    "cumulative_balance",
    "category_spending",
    "budget_remaining",
  ];
  if (intent && IMPLEMENTED_QUERY_INTENTS.includes(intent)) {
    // [T-S156] Câu hỏi có nhắc "hộ gia đình" nhưng tài khoản CHƯA tham
    // gia hộ nào -> báo lỗi RÕ, KHÔNG âm thầm rơi về cá nhân (đúng gốc
    // bug đang sửa: trước đây im lặng trả lời cá nhân khiến người dùng
    // tưởng bot đã hiểu household nhưng thực ra bỏ qua hoàn toàn).
    if (queryScope.deniedHousehold) {
      await sendTelegramMessage(
        chatId,
        `🏡 Bạn nhắc đến "hộ gia đình" trong câu hỏi, nhưng tài khoản của bạn *chưa tham gia hộ gia đình nào*.\n\nVui lòng tham gia/tạo hộ gia đình trên web trước, hoặc bỏ chữ "hộ gia đình" để hỏi theo sổ cá nhân.`
      );
      return;
    }
    await handleQuery(chatId, profile as ProfileRow, intent, text, queryScope);
    return;
  }

  await handleExpenseText(chatId, profile as ProfileRow, text);
}

async function handleCallbackQuery(cq: any) {
  const chatId = String(cq.message?.chat?.id || "");
  const data = String(cq.data || "");
  const match = data.match(/^reassign:([0-9a-f-]{36}):(personal|household)$/);

  if (!chatId || !match) {
    await answerCallbackQuery(cq.id, "Yêu cầu không hợp lệ");
    return;
  }

  const [, batchId, newScope] = match;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .eq("telegram_chat_id", chatId)
    .maybeSingle();

  if (!profile) {
    await answerCallbackQuery(cq.id, "Tài khoản chưa liên kết");
    return;
  }

  const { data: rpcRows, error } = await supabase.rpc("reassign_transaction_scope", {
    p_batch_id: batchId,
    p_actor: profile.id,
    p_new_scope: newScope,
  });

  if (error) {
    console.error("reassign_transaction_scope error:", error);
    await answerCallbackQuery(cq.id, "Lỗi: " + (error.message || "không rõ"));
    return;
  }

  const updatedCount = (rpcRows?.[0] as { out_updated_count?: number } | undefined)?.out_updated_count ?? 0;

  await answerCallbackQuery(
    cq.id,
    updatedCount > 0
      ? `✅ Đã chuyển ${updatedCount} khoản sang ${newScope === "household" ? "Hộ gia đình" : "Cá nhân"}`
      : "Không có khoản nào để chuyển"
  );

  // Đổi luôn nút trên tin nhắn gốc sang chiều ngược lại — cho phép bấm qua
  // lại nhiều lần mà không cần tin nhắn mới (idempotent phía RPC).
  if (updatedCount > 0 && cq.message) {
    const nextScope = newScope === "household" ? "personal" : "household";
    const nextLabel = nextScope === "household" ? "🔁 Chuyển sang HỘ GIA ĐÌNH" : "🔁 Chuyển sang CÁ NHÂN";
    try {
      await fetch(`${TELEGRAM_API}/editMessageReplyMarkup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: cq.message.message_id,
          reply_markup: {
            inline_keyboard: [[{ text: nextLabel, callback_data: `reassign:${batchId}:${nextScope}` }]],
          },
        }),
      });
    } catch (err) {
      console.error("editMessageReplyMarkup failed:", err);
    }
  }
}

// [AUDIT 25/08/2026 — mục 2.3, đồng bộ với bản gộp telegram-webhook-merged.ts]
// So `===`/`!==` thường giữa 2 chuỗi bí mật rò rỉ thời gian theo số ký tự
// khớp đầu (timing attack lý thuyết) — so bằng thời gian không đổi, không
// early-return theo từng byte.
function timingSafeEqual(a: string, b: string): boolean {
  const bufA = new TextEncoder().encode(a);
  const bufB = new TextEncoder().encode(b);
  if (bufA.length !== bufB.length) return false;
  let diff = 0;
  for (let i = 0; i < bufA.length; i++) diff |= bufA[i] ^ bufB[i];
  return diff === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("ok", { status: 200 });
  }

  // Chống giả mạo: nếu đã set TELEGRAM_WEBHOOK_SECRET, bắt buộc header
  // khớp (Telegram tự đính kèm header này nếu setWebhook có secret_token).
  if (WEBHOOK_SECRET) {
    const got = req.headers.get("x-telegram-bot-api-secret-token") || "";
    if (!timingSafeEqual(got, WEBHOOK_SECRET)) {
      return new Response("forbidden", { status: 401 });
    }
  }

  let update: any;
  try {
    update = await req.json();
  } catch {
    return new Response("ok", { status: 200 });
  }

  try {
    if (update.callback_query) {
      await handleCallbackQuery(update.callback_query);
    } else if (update.message) {
      await handleMessage(update.message);
    }
  } catch (err) {
    console.error("telegram-webhook unhandled error:", err);
  }

  // Luôn trả 200 cho Telegram dù xử lý lỗi bên trong — tránh Telegram lặp
  // lại gửi update dồn dập khi thấy non-2xx (đúng hành vi cũ server.ts).
  return new Response("ok", { status: 200 });
});
