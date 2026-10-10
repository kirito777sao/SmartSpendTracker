// T-S09/T-S10 (16/08/2026) — BAN GOP 1 FILE cho Supabase Dashboard "Via Editor"
// (Dashboard KHONG ho tro import cheo sang folder _shared/ khi deploy qua
// trinh soan thao web, chi CLI moi doc duoc nhieu file). Noi dung logic
// giong het ban tach file (_shared/parseTransactionLogic.ts +
// parse-transaction/index.ts) - chi inline lai thanh 1 file duy nhat.
// Neu sau nay deploy bang CLI (supabase functions deploy), nen dung lai
// ban tach file goc (co _shared/) de khong bi trung lap code giua 2
// function.

import { GoogleGenAI, Type } from "npm:@google/genai@^2.4.0";

export interface ParsedTransactionItem {
  description: string;
  amount: number;
  category: string;
  isSavingsContribution: boolean;
  savingsGoalName: string;
}

export interface ParseResult {
  transactions: ParsedTransactionItem[];
  method: string;
  warning?: string;
}

// [BUGFIX T-S31 08/08/2026] So chuỗi con (`String.includes`) làm khớp NHẦM
// khi từ khóa ngắn tình cờ là chuỗi con của 1 từ tiếng Việt khác không liên
// quan — so theo TỪ TRỌN VẸN thay vì so chuỗi con thô.
export function includesWholeWord(haystack: string, keyword: string): boolean {
  if (!keyword) return false;
  if (keyword.includes(" ")) return haystack.includes(keyword);
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?<![\\p{L}])${escaped}(?![\\p{L}])`, "iu");
  return re.test(haystack);
}

export function applySavingsKeywordOverride(
  transactions: any[],
  rawText: string
): any[] {
  const savingsKeywords = [
    "tiết kiệm",
    "để dành",
    "tích lũy",
    "tích luỹ",
    "góp quỹ",
    "heo đất",
    "tiết kiệm tiền",
    "để dành tiền",
    "góp vốn",
    "góp tiền",
    "gửi tiết kiệm",
  ];
  const amountRegex = /(\d+(?:\.\d+)?)\s*(k|nghìn|ngàn|tr|triệu|đ|d|vnd)?/i;
  const lowerRaw = rawText.toLowerCase();
  const rawHasKeyword = savingsKeywords.some((kw) =>
    includesWholeWord(lowerRaw, kw)
  );

  return transactions.map((item) => {
    if (!item || item.isSavingsContribution) return item;

    const desc = String(item.description || "").toLowerCase();
    const descHasKeyword = savingsKeywords.some((kw) =>
      includesWholeWord(desc, kw)
    );
    if (
      !descHasKeyword &&
      !(transactions.length === 1 && rawHasKeyword)
    )
      return item;

    let cleanGoal = transactions.length === 1 ? lowerRaw : desc;
    savingsKeywords.forEach((kw) => {
      cleanGoal = cleanGoal.replace(kw, "");
    });
    cleanGoal = cleanGoal
      .replace(amountRegex, "")
      .replace(/với|cho|để|vào|quỹ/g, "")
      .replace(/\s+/g, " ")
      .trim();

    const existingGoalName = String(item.savingsGoalName || "").trim();
    const savingsGoalName =
      existingGoalName ||
      (cleanGoal
        ? cleanGoal.charAt(0).toUpperCase() + cleanGoal.slice(1)
        : "Tiết kiệm chung");

    return { ...item, isSavingsContribution: true, savingsGoalName };
  });
}

export function parseWithRules(text: string, categoriesList: string[]): ParsedTransactionItem[] {
  if (!text) return [];

  const parts = text
    .split(/[,;\n]+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const transactions: any[] = [];

  for (const part of parts) {
    const amountRegex = /(\d+(?:\.\d+)?)\s*(k|nghìn|ngàn|tr|triệu|đ|d|vnd)?/i;
    const match = part.match(amountRegex);

    if (match) {
      const rawNum = parseFloat(match[1]);
      const suffix = (match[2] || "").toLowerCase();
      let amount = rawNum;

      if (suffix === "k" || suffix === "nghìn" || suffix === "ngàn") {
        amount = rawNum * 1000;
      } else if (suffix === "tr" || suffix === "triệu") {
        amount = rawNum * 1000000;
      }

      let description = part.replace(amountRegex, "").replace(/\s+/g, " ").trim();
      if (!description) {
        description = "Chi tiêu không tên";
      } else {
        description = description.charAt(0).toUpperCase() + description.slice(1);
      }

      let category = "Khác";
      const descLower = description.toLowerCase();

      let isSavingsContribution = false;
      let savingsGoalName = "";
      const savingsKeywords = [
        "tiết kiệm",
        "để dành",
        "tích lũy",
        "tích luỹ",
        "góp quỹ",
        "heo đất",
        "tiết kiệm tiền",
        "để dành tiền",
        "góp vốn",
        "góp tiền",
        "gửi tiết kiệm",
      ];
      if (savingsKeywords.some((kw) => includesWholeWord(part.toLowerCase(), kw))) {
        isSavingsContribution = true;
        let cleanGoal = part.toLowerCase();
        savingsKeywords.forEach((kw) => {
          cleanGoal = cleanGoal.replace(kw, "");
        });
        cleanGoal = cleanGoal.replace(amountRegex, "");
        cleanGoal = cleanGoal.replace(/với|cho|để|vào|quỹ/g, "");
        cleanGoal = cleanGoal.replace(/\s+/g, " ").trim();
        savingsGoalName = cleanGoal
          ? cleanGoal.charAt(0).toUpperCase() + cleanGoal.slice(1)
          : "Tiết kiệm chung";
      }

      const keywordDict: { [key: string]: string[] } = {
        "Ăn uống": ["cá", "rau", "thịt", "ăn", "uống", "cà phê", "cafe", "bún", "phở", "cơm", "sữa", "bánh", "kem", "nhà hàng", "trà sữa", "tiệc"],
        "Di chuyển": ["xăng", "xe", "bus", "taxi", "grab", "xe ôm", "gửi xe", "sửa xe", "bảo dưỡng", "vé tàu", "vé máy bay"],
        "Nhà ở": ["tiền nhà", "phòng trọ", "điện", "nước", "internet", "wifi", "rác", "chung cư", "gas"],
        "Giải trí": ["phim", "nhạc", "netflix", "youtube", "game", "du lịch", "dã ngoại", "karaoke", "spa"],
        "Sức khỏe": ["thuốc", "bệnh viện", "bác sĩ", "khám", "vitamin", "phòng khám", "nha khoa"],
        "Học tập": ["sách", "học phí", "khóa học", "bút", "vở", "dụng cụ học tập", "tài liệu", "thi"],
        "Mua sắm": ["áo", "quần", "váy", "giày", "dép", "mỹ phẩm", "điện thoại", "tai nghe", "shopee", "lazada", "tiki", "siêu thị"],
      };

      let foundCategory = false;
      if (isSavingsContribution) {
        const matchingSavingsCat = categoriesList.find(
          (c) =>
            c.toLowerCase().includes("tiết kiệm") ||
            c.toLowerCase().includes("tích lũy") ||
            c.toLowerCase().includes("tích luỹ")
        );
        if (matchingSavingsCat) {
          category = matchingSavingsCat;
          foundCategory = true;
        }
      }

      if (!foundCategory) {
        for (const [catName, keywords] of Object.entries(keywordDict)) {
          if (keywords.some((kw) => includesWholeWord(descLower, kw))) {
            const matchingCatInList = categoriesList.find(
              (c) => c.toLowerCase() === catName.toLowerCase()
            );
            if (matchingCatInList) {
              category = matchingCatInList;
              foundCategory = true;
              break;
            }
          }
        }
      }

      if (!foundCategory) {
        const directMatch = categoriesList.find(
          (c) =>
            descLower.includes(c.toLowerCase()) ||
            c.toLowerCase().includes(descLower)
        );
        if (directMatch) {
          category = directMatch;
        } else {
          // [BUGFIX 08/08/2026 - T-S23] KHÔNG fallback về category CUỐI CÙNG
          // trong danh sách — luôn trả "Khác" y hệt quy ước systemPrompt AI.
          const fallbackCat =
            categoriesList.find((c) => c === "Khác" || c === "Chi tiêu khác") ||
            "Khác";
          category = fallbackCat;
        }
      }

      transactions.push({
        description,
        amount: Math.round(amount),
        category,
        isSavingsContribution,
        savingsGoalName,
      });
    }
  }

  return transactions;
}

function buildSystemPrompt(categoriesList: string[]): string {
  return `Bạn là trợ lý AI chuyên nghiệp phân tích chi tiêu cá nhân bằng tiếng Việt.
Nhiệm vụ của bạn là phân tích câu mô tả chi tiêu tự nhiên của người dùng thành danh sách các giao dịch (giao dịch có thể gồm một hoặc nhiều khoản chi tiêu riêng lẻ được ngăn cách bởi dấu phẩy, dấu xuống dòng hoặc từ nối).

Yêu cầu phân tích:
1. Tách câu nhập liệu thành các giao dịch cụ thể.
2. Với mỗi giao dịch, phân tích:
   - description: Mô tả ngắn gọn, súc tích (ví dụ: "Mua cá", "Đổ xăng", "Cà phê sáng"). Viết hoa chữ cái đầu.
   - amount: Số tiền dạng số nguyên VNĐ. Hãy xử lý các cách viết tắt số tiền của người Việt:
     + "k", "nghìn", "ngàn" -> nhân với 1,000 (ví dụ: "35k" -> 35000, "120 nghìn" -> 120000, "20 ngàn" -> 20000)
     + "tr", "triệu" -> nhân với 1,000,000 (ví dụ: "1.5tr" hoặc "1tr5" -> 1500000, "2 triệu" -> 2000000)
     + "đ", "d", "vnd" -> giữ nguyên số tiền (ví dụ: "50000đ" -> 50000)
   - category: Phân loại vào danh mục phù hợp nhất từ danh sách sau: [${categoriesList.join(", ")}].
     Nếu không thể xếp vào danh mục nào một cách thuyết phục, hãy gán danh mục phù hợp nhất hoặc "Khác".
     LƯU Ý: Nếu đây là giao dịch tích lũy/tiết kiệm (có từ khóa như "tiết kiệm", "để dành", "tích lũy", "góp vốn", "góp tiền", "gửi tiết kiệm"), hãy gán danh mục là "Tiết kiệm & Tích lũy" hoặc danh mục tương đương về tích lũy có sẵn.
   - isSavingsContribution: Gán là true nếu giao dịch này là một khoản tiết kiệm, để dành, tích lũy, góp vốn/góp tiền vào quỹ tiết kiệm, hoặc bỏ quỹ heo đất (ví dụ: "tiết kiệm 500k mua laptop", "để dành 1tr mua xe máy", "bỏ ống heo 200k", "góp vốn 600k mua laptop"). Giao dịch thông thường gán là false.
   - savingsGoalName: Nếu isSavingsContribution là true, trích xuất tên mục tiêu tiết kiệm cụ thể đó (ví dụ: "Mua laptop", "Mua xe máy", "Du lịch"). Viết hoa chữ cái đầu. Nếu không có mục tiêu cụ thể hoặc giao dịch thông thường, gán là "".

Ví dụ nhập liệu và kết quả mong muốn:
- "cá 35k, rau 25k" -> [{ "description": "Mua cá", "amount": 35000, "category": "Ăn uống", "isSavingsContribution": false, "savingsGoalName": "" }, { "description": "Mua rau", "amount": 25000, "category": "Ăn uống", "isSavingsContribution": false, "savingsGoalName": "" }]
- "tiết kiệm 500k mua laptop" -> [{ "description": "Tiết kiệm mua laptop", "amount": 500000, "category": "Khác", "isSavingsContribution": true, "savingsGoalName": "Mua laptop" }]
- "để dành 2 triệu mua xe" -> [{ "description": "Để dành mua xe", "amount": 2000000, "category": "Khác", "isSavingsContribution": true, "savingsGoalName": "Mua xe" }]

Trả về DUY NHẤT một đối tượng JSON có thuộc tính "transactions" chứa danh sách mảng kết quả.`;
}

export interface RunParseOptions {
  text: string;
  userCategories?: string[];
  /** Mặc định "groq" nếu không truyền — khớp mặc định T-S09 patch 16/08. */
  aiProvider?: string;
  /** Key người dùng tự nhập (web). Bot Telegram KHÔNG có khái niệm này —
   * luôn truyền undefined/"", chỉ dùng key mặc định server (secrets). */
  userApiKey?: string;
}

/**
 * Hàm dùng chung DUY NHẤT cho cả 2 Edge Function — chứa toàn bộ logic
 * rule-first + 4 provider AI + fallback, y hệt Deno.serve() gốc của
 * `parse-transaction` (T-S09), chỉ tách khỏi HTTP handler để tái sử dụng.
 */
export async function runParseTransaction(opts: RunParseOptions): Promise<ParseResult> {
  const cleanText = (opts.text || "").trim();
  const categoriesList: string[] =
    Array.isArray(opts.userCategories) && opts.userCategories.length > 0
      ? opts.userCategories
      : ["Ăn uống", "Di chuyển", "Nhà ở", "Giải trí", "Sức khỏe", "Học tập", "Mua sắm", "Khác"];

  const provider = opts.aiProvider || "groq";
  const userApiKey = opts.userApiKey;
  const systemPrompt = buildSystemPrompt(categoriesList);

  try {
    if (provider === "gemini") {
      const activeKey =
        userApiKey && typeof userApiKey === "string" && userApiKey.trim() !== ""
          ? userApiKey.trim()
          : Deno.env.get("GEMINI_API_KEY") || "";

      if (!activeKey) {
        console.warn("GEMINI_API_KEY is missing, falling back to rule-based parser");
        return { transactions: parseWithRules(cleanText, categoriesList), method: "rule-based" };
      }

      const activeAi = new GoogleGenAI({
        apiKey: activeKey,
        httpOptions: { headers: { "User-Agent": "aistudio-build" } },
      });

      const response = await activeAi.models.generateContent({
        model: "gemini-3.5-flash",
        contents: `Hãy phân tích câu nhập liệu chi tiêu này: "${cleanText}"`,
        config: {
          systemInstruction: systemPrompt,
          temperature: 0.1,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              transactions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    description: { type: Type.STRING },
                    amount: { type: Type.INTEGER },
                    category: { type: Type.STRING },
                    isSavingsContribution: { type: Type.BOOLEAN },
                    savingsGoalName: { type: Type.STRING },
                  },
                  required: ["description", "amount", "category", "isSavingsContribution", "savingsGoalName"],
                },
              },
            },
            required: ["transactions"],
          },
        },
      });

      const textOutput = response.text;
      if (!textOutput) {
        throw new Error("Không nhận được phản hồi từ mô hình AI");
      }

      const parsedData = JSON.parse(textOutput.trim());
      return {
        transactions: applySavingsKeywordOverride(parsedData.transactions || [], cleanText),
        method: "gemini-ai",
      };
    } else {
      let apiUrl = "";
      let modelName = "";
      let activeKey =
        userApiKey && typeof userApiKey === "string" && userApiKey.trim() !== ""
          ? userApiKey.trim()
          : "";

      if (provider === "openai") {
        apiUrl = "https://api.openai.com/v1/chat/completions";
        modelName = "gpt-4o-mini";
        if (!activeKey) activeKey = Deno.env.get("OPENAI_API_KEY") || "";
      } else if (provider === "groq") {
        apiUrl = "https://api.groq.com/openai/v1/chat/completions";
        // [BUGFIX T-S95 17/08/2026] Groq khai tử `llama-3.3-70b-versatile`
        // (deprecated 17/06/2026) — mọi request đều 404 "model_not_found".
        // Model thay thế theo khuyến nghị chính thức của Groq.
        modelName = "openai/gpt-oss-120b";
        if (!activeKey) activeKey = Deno.env.get("GROQ_API_KEY") || "";
      } else if (provider === "deepseek") {
        apiUrl = "https://api.deepseek.com/chat/completions";
        modelName = "deepseek-chat";
        if (!activeKey) activeKey = Deno.env.get("DEEPSEEK_API_KEY") || "";
      }

      if (!activeKey) {
        throw new Error(
          `API Key cho nhà cung cấp ${String(provider).toUpperCase()} chưa được thiết lập. Vui lòng cấu hình trong tab Hộ Gia Đình.`
        );
      }

      const apiResponse = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${activeKey}`,
        },
        body: JSON.stringify({
          model: modelName,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `Hãy phân tích câu nhập liệu chi tiêu này: "${cleanText}"` },
          ],
          temperature: 0.1,
          response_format: { type: "json_object" },
        }),
      });

      if (!apiResponse.ok) {
        const errText = await apiResponse.text();
        throw new Error(
          `Lỗi kết nối API ${String(provider).toUpperCase()} (${apiResponse.status}): ${errText}`
        );
      }

      const resultJson = await apiResponse.json();
      const content = resultJson?.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error(`Mô hình ${String(provider).toUpperCase()} không trả về nội dung hợp lệ`);
      }

      const parsedData = JSON.parse(content.trim());
      return {
        transactions: applySavingsKeywordOverride(parsedData.transactions || [], cleanText),
        method: `${provider}-ai`,
      };
    }
  } catch (error: any) {
    console.error("Lỗi khi phân tích bằng AI:", error);
    try {
      const fallbackResult = parseWithRules(cleanText, categoriesList);
      return {
        transactions: fallbackResult,
        method: "rule-based-fallback",
        warning: error?.message || "Không thể gọi AI, hệ thống tự động chuyển sang phân tích cục bộ",
      };
    } catch (err) {
      throw new Error("Lỗi xử lý phân tích chi tiêu");
    }
  }
}

// ==================== HTTP HANDLER ====================


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Nội dung nhập liệu không hợp lệ" }, 400);
  }

  const { text, userCategories, aiProvider, userApiKey } = body || {};

  if (!text || typeof text !== "string" || text.trim() === "") {
    return jsonResponse({ error: "Nội dung nhập liệu không hợp lệ" }, 400);
  }

  try {
    const result = await runParseTransaction({ text, userCategories, aiProvider, userApiKey });
    return jsonResponse(result);
  } catch (error: any) {
    return jsonResponse({ error: error?.message || "Lỗi xử lý phân tích chi tiêu" }, 500);
  }
});
