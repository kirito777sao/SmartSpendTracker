// T-S09 (16/08/2026): thay `fetch("/api/parse-transaction")` (Express cũ)
// bằng `supabase.functions.invoke("parse-transaction")` (Edge Function).
// Trước đây SmartInput.tsx/AIAssistantBubble.tsx đều tự lặp lại y hệt logic
// resolve `aiProvider`/`userApiKey` từ localStorage + gọi fetch — gộp về 1
// hàm dùng chung ở đây (bắt buộc phải sửa cả 2 nơi trong task này, gộp luôn
// cho gọn, không phải mở rộng phạm vi riêng).
import { supabase } from "./supabaseClient";

export interface ParsedTransactionItem {
  description: string;
  amount: number;
  category: string;
  isSavingsContribution: boolean;
  savingsGoalName: string;
}

export interface ParseTransactionResult {
  transactions: ParsedTransactionItem[];
  method: string;
  warning?: string;
}

function resolveActiveProviderAndKey(): { aiProvider: string; userApiKey: string } {
  // [T-S09 patch 16/08/2026] Mặc định GROQ (không phải Gemini) khi người
  // dùng chưa từng tự chọn provider — theo yêu cầu, Groq free tier rộng rãi
  // hơn, tiết kiệm chi phí hơn khi dùng key mặc định server.
  const aiProvider = localStorage.getItem("user_active_ai_provider") || "groq";
  let userApiKey = "";
  if (aiProvider === "gemini") {
    userApiKey = localStorage.getItem("user_gemini_api_key") || "";
  } else if (aiProvider === "openai") {
    userApiKey = localStorage.getItem("user_openai_api_key") || "";
  } else if (aiProvider === "groq") {
    userApiKey = localStorage.getItem("user_groq_api_key") || "";
  } else if (aiProvider === "deepseek") {
    userApiKey = localStorage.getItem("user_deepseek_api_key") || "";
  }
  return { aiProvider, userApiKey };
}

export async function callParseTransaction(
  text: string,
  userCategories: string[]
): Promise<ParseTransactionResult> {
  const { aiProvider, userApiKey } = resolveActiveProviderAndKey();

  const { data, error } = await supabase.functions.invoke("parse-transaction", {
    body: { text, userCategories, aiProvider, userApiKey },
  });

  if (error) {
    // FunctionsHttpError: cố đọc body JSON thật do Edge Function trả về
    // (field `error` tiếng Việt dễ hiểu) thay vì lộ message kỹ thuật chung
    // chung của supabase-js ("Edge Function returned a non-2xx status code").
    let message = error.message || "Lỗi mạng khi kết nối máy chủ";
    const context = (error as any)?.context;
    if (context && typeof context.json === "function") {
      try {
        const body = await context.json();
        if (body?.error) message = body.error;
      } catch {
        // Không parse được body — giữ nguyên message mặc định.
      }
    }
    throw new Error(message);
  }

  if (!data || (data as any).error) {
    throw new Error((data as any)?.error || "Lỗi xử lý phân tích chi tiêu");
  }

  // [T-S31 08/08/2026, giữ nguyên] Log chẩn đoán: `method` cho biết kết quả
  // đến từ AI thật hay rơi vào rule-based (từ điển từ khóa cứng, độ chính
  // xác thấp hơn). Xem DevTools Console (F12) nếu thấy nhận diện kém.
  console.log(
    "[SmartSpend][parse-transaction] method =",
    (data as any).method,
    (data as any).warning ? `| warning: ${(data as any).warning}` : ""
  );

  return data as ParseTransactionResult;
}