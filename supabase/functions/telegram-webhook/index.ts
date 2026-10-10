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

async function fetchCategoryNames(profile: ProfileRow): Promise<string[]> {
  const query = supabase.from("categories").select("name").is("deleted_at", null);
  const { data } = profile.household_id
    ? await query.eq("household_id", profile.household_id)
    : await query.eq("owner_id", profile.id);
  return (data || []).map((c: { name: string }) => c.name);
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
  const categoriesList = await fetchCategoryNames(profile);

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

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("ok", { status: 200 });
  }

  // Chống giả mạo: nếu đã set TELEGRAM_WEBHOOK_SECRET, bắt buộc header
  // khớp (Telegram tự đính kèm header này nếu setWebhook có secret_token).
  if (WEBHOOK_SECRET) {
    const got = req.headers.get("x-telegram-bot-api-secret-token");
    if (got !== WEBHOOK_SECRET) {
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
