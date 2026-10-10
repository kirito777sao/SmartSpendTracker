// T-S09 (16/08/2026): Edge Function thay `/api/parse-transaction` (server.ts
// dòng 935-1109, 1214-1389).
// T-S10 (16/08/2026): logic rule-first + 4 provider AI đã CHUYỂN sang
// `supabase/functions/_shared/parseTransactionLogic.ts` để dùng chung với
// `telegram-webhook` — file này giờ chỉ còn HTTP handler (CORS, đọc body,
// gọi hàm dùng chung, trả JSON), không đổi hành vi so với bản gốc T-S09.
//
// Deploy: supabase functions deploy parse-transaction
// Secret bắt buộc (server mặc định, KHÔNG phải userApiKey người dùng tự
// nhập): supabase secrets set GEMINI_API_KEY=xxx / GROQ_API_KEY=xxx
// (OpenAI/DeepSeek KHÔNG có key mặc định server — .env.example gốc cũng
// chỉ có GEMINI_API_KEY — các provider không set secret CHỈ hoạt động khi
// người dùng tự nhập key riêng ở tab Hộ Gia Đình, đúng hành vi cũ.)
//
// Input/output giữ NGUYÊN shape với endpoint Express cũ để FE
// (src/lib/parseTransaction.ts) không cần đổi logic xử lý response.

import { runParseTransaction } from "../_shared/parseTransactionLogic.ts";

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
