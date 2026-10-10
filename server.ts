import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config();

// Initialize the Google Gen AI client with server-side API key
const apiKey = process.env.GEMINI_API_KEY;
const ai = new GoogleGenAI({
  apiKey: apiKey || "MOCK_KEY_FOR_BUILD",
  httpOptions: {
    headers: {
      "User-Agent": "aistudio-build",
    },
  },
});

interface User {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  role: string;
  displayName: string;
  linkToken: string;
  telegramChatId?: string;
  telegramUsername?: string;
  householdInviteCode?: string;
}

interface StoreData {
  users: {
    [email: string]: User;
  };
  telegramLinks: {
    [chatId: string]: string; // chatId -> email mapping
  };
  households: {
    [inviteCode: string]: {
      household: {
        id: string;
        name: string;
        inviteCode: string;
        createdAt: string;
        members: Array<{
          id: string;
          name: string;
          role: string;
          displayName: string;
          joinedAt: string;
        }>;
      };
      transactions: any[];
      categories: any[];
      goals: any[];
      notifications?: any[];
    };
  };
}

const DATA_FILE = path.join(process.cwd(), "data_store.json");

function readStore(): StoreData {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const content = fs.readFileSync(DATA_FILE, "utf-8");
      const store = JSON.parse(content);
      if (!store.users) store.users = {};
      if (!store.telegramLinks) store.telegramLinks = {};
      return store;
    }
  } catch (e) {
    console.error("Error reading data store file:", e);
  }

  const defaultInvite = "7F3K-9QXZ";
  const defaultH = {
    id: "hh_default",
    name: "Gia đình nhỏ ấm áp 🏡",
    inviteCode: defaultInvite,
    createdAt: new Date().toISOString(),
    members: [
      { id: "mem_default_1", name: "Minh", role: "Chồng" as const, displayName: "Chồng (Minh)", joinedAt: new Date().toISOString(), isOwner: true },
      { id: "mem_default_2", name: "Lan", role: "Vợ" as const, displayName: "Vợ (Lan)", joinedAt: new Date().toISOString() },
      { id: "mem_default_3", name: "Đức", role: "Con" as const, displayName: "Con (Đức)", joinedAt: new Date().toISOString() }
    ]
  };

  const today = new Date();
  const formatOffsetDate = (daysAgo: number) => {
    const d = new Date();
    d.setDate(today.getDate() - daysAgo);
    return d.toLocaleDateString("en-CA");
  };

  const initialTxs = [
    {
      id: "t_demo_1",
      description: "Lương tháng này nhận được",
      amount: -18000000,
      category: "Thu nhập",
      date: formatOffsetDate(18),
      note: "Lương chính thức công ty",
      createdAt: new Date().toISOString(),
    },
    {
      id: "t_demo_2",
      description: "Thanh toán tiền phòng trọ",
      amount: 3500000,
      category: "Nhà ở",
      date: formatOffsetDate(15),
      note: "Bao gồm cả điện nước và xe cộ",
      createdAt: new Date().toISOString(),
    },
    {
      id: "t_demo_3",
      description: "Đổ xăng xe máy đầy bình",
      amount: 60000,
      category: "Di chuyển",
      date: formatOffsetDate(12),
      createdAt: new Date().toISOString(),
    },
    {
      id: "t_demo_4",
      description: "Mua thực phẩm siêu thị cuối tuần",
      amount: 750000,
      category: "Ăn uống",
      date: formatOffsetDate(8),
      note: "Thịt, rau củ và sữa cho cả tuần",
      createdAt: new Date().toISOString(),
    },
    {
      id: "t_demo_5",
      description: "Khóa học ngoại ngữ tiếng Anh giao tiếp",
      amount: 1200000,
      category: "Học tập",
      date: formatOffsetDate(6),
      note: "Đăng ký khóa học 3 tháng online",
      createdAt: new Date().toISOString(),
    },
    {
      id: "t_demo_6",
      description: "Thưởng dự án freelancer ngoài giờ",
      amount: -3500000,
      category: "Thu nhập",
      date: formatOffsetDate(5),
      note: "Thiết kế logo thương hiệu",
      createdAt: new Date().toISOString(),
    },
    {
      id: "t_demo_7",
      description: "Mua thuốc tây trị cảm cúm",
      amount: 150000,
      category: "Sức khỏe",
      date: formatOffsetDate(4),
      createdAt: new Date().toISOString(),
    },
    {
      id: "t_demo_8",
      description: "Vé xem phim CGV và bỏng ngô",
      amount: 220000,
      category: "Giải trí",
      date: formatOffsetDate(3),
      note: "Đi xem phim bom tấn cùng bạn bè",
      createdAt: new Date().toISOString(),
    },
    {
      id: "t_demo_9",
      description: "Ăn trưa cơm văn phòng",
      amount: 45000,
      category: "Ăn uống",
      date: formatOffsetDate(2),
      createdAt: new Date().toISOString(),
    },
    {
      id: "t_demo_10",
      description: "Mua áo khoác gió thời trang",
      amount: 450000,
      category: "Mua sắm",
      date: formatOffsetDate(1),
      createdAt: new Date().toISOString(),
    },
    {
      id: "t_demo_11",
      description: "Cà phê sáng cùng đồng nghiệp",
      amount: 35000,
      category: "Ăn uống",
      date: formatOffsetDate(0),
      createdAt: new Date().toISOString(),
    },
  ];

  const initialCats = [
    { id: "cat_1", name: "Ăn uống", icon: "🍔", limitAmount: 5000000, isRecurring: true },
    { id: "cat_2", name: "Di chuyển", icon: "🚗", limitAmount: 1200000, isRecurring: true },
    { id: "cat_3", name: "Nhà ở", icon: "🏠", limitAmount: 4000000, isRecurring: true },
    { id: "cat_4", name: "Giải trí", icon: "🎉", limitAmount: 2000000, isRecurring: true },
    { id: "cat_5", name: "Sức khỏe", icon: "💊", limitAmount: 600000, isRecurring: false },
    { id: "cat_6", name: "Học tập", icon: "📚", limitAmount: 1500000, isRecurring: true },
    { id: "cat_7", name: "Mua sắm", icon: "🛒", limitAmount: 3000000, isRecurring: true },
    { id: "cat_9", name: "Tiết kiệm & Tích lũy", icon: "🐖", limitAmount: 2000000, isRecurring: true },
    { id: "cat_8", name: "Khác", icon: "📦", limitAmount: 1000000, isRecurring: false },
  ];

  const initialGoals = [
    {
      id: "g_1",
      name: "Tích lũy mua Laptop mới",
      targetAmount: 30000000,
      currentAmount: 12000000,
      targetDate: "2026-12-31",
      createdAt: new Date().toISOString(),
    },
    {
      id: "g_2",
      name: "Quỹ khẩn cấp phòng ngừa rủi ro",
      targetAmount: 15000000,
      currentAmount: 7000000,
      createdAt: new Date().toISOString(),
    },
  ];

  const initialStore: StoreData = {
    users: {
      "demo@smartspend.vn": {
        id: "u_demo",
        email: "demo@smartspend.vn",
        passwordHash: "123",
        name: "Minh",
        role: "Chồng",
        displayName: "Chồng (Minh)",
        linkToken: "123456",
        householdInviteCode: "7F3K-9QXZ"
      },
      "vo_lan@smartspend.vn": {
        id: "u_lan",
        email: "vo_lan@smartspend.vn",
        passwordHash: "123",
        name: "Lan",
        role: "Vợ",
        displayName: "Vợ (Lan)",
        linkToken: "654321",
        householdInviteCode: "7F3K-9QXZ"
      }
    },
    telegramLinks: {},
    households: {
      [defaultInvite]: {
        household: defaultH,
        transactions: initialTxs,
        categories: initialCats,
        goals: initialGoals
      }
    }
  };

  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(initialStore, null, 2), "utf-8");
  } catch (e) {
    console.error("Error writing initial store:", e);
  }

  return initialStore;
}

function writeStore(store: StoreData) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), "utf-8");
  } catch (e) {
    console.error("Error writing store to file:", e);
  }
}

function generateInviteCode(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let part1 = "";
  let part2 = "";
  for (let i = 0; i < 4; i++) {
    part1 += chars.charAt(Math.floor(Math.random() * chars.length));
    part2 += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `${part1}-${part2}`;
}

async function sendTelegramMessage(botToken: string, chatId: number | string, text: string) {
  if (!botToken) {
    console.warn("Skipping Telegram send: No Bot Token provided. ChatId:", chatId, "Text:", text);
    return;
  }
  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: "Markdown"
      })
    });
    if (!response.ok) {
      const errText = await response.text();
      console.error(`Telegram API error (${response.status}): ${errText}`);
    }
  } catch (err) {
    console.error("Error sending message to Telegram:", err);
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // --- AUTHENTICATION ENDPOINTS ---
  // /api/auth/register và /api/auth/login đã bị xoá (T-S04) — thay bằng
  // Supabase Auth (supabase.auth.signUp / signInWithPassword) ở client.
  // 3 route dưới đây GIỮ NGUYÊN, chưa có thay thế (thuộc T-S05/T-S10).

  // 3. Update User Profile & Household Link
  app.post("/api/auth/update-profile", (req, res) => {
    try {
      const { email, name, role, inviteCode } = req.body;
      if (!email || !name || !role) {
        return res.status(400).json({ error: "Thông tin không đầy đủ." });
      }

      const cleanEmail = email.trim().toLowerCase();
      const store = readStore();
      const user = store.users[cleanEmail];

      if (!user) {
        return res.status(404).json({ error: "Không tìm thấy tài khoản." });
      }

      const oldDisplayName = user.displayName;
      user.name = name.trim();
      user.role = role.trim();
      user.displayName = `${role.trim()} (${name.trim()})`;
      
      const oldInvite = user.householdInviteCode;
      const newInvite = inviteCode ? inviteCode.trim().toUpperCase() : undefined;
      user.householdInviteCode = newInvite;

      // Handle updating household member details
      if (newInvite && store.households[newInvite]) {
        const hh = store.households[newInvite];
        // Remove from old household if changed
        if (oldInvite && oldInvite !== newInvite && store.households[oldInvite]) {
          const oldHh = store.households[oldInvite];
          oldHh.household.members = oldHh.household.members.filter((m: any) => m.name.toLowerCase() !== name.trim().toLowerCase());
        }

        // Add or update in new household
        const memberIdx = hh.household.members.findIndex((m: any) => m.name.toLowerCase() === name.trim().toLowerCase());
        if (memberIdx !== -1) {
          hh.household.members[memberIdx].role = role.trim();
          hh.household.members[memberIdx].displayName = `${role.trim()} (${name.trim()})`;
        } else {
          hh.household.members.push({
            id: `mem_u_${Date.now()}`,
            name: name.trim(),
            role: role.trim(),
            displayName: `${role.trim()} (${name.trim()})`,
            joinedAt: new Date().toISOString()
          });
        }
      }

      writeStore(store);
      return res.json({ user });
    } catch (e: any) {
      console.error("Error in /api/auth/update-profile:", e);
      return res.status(500).json({ error: "Lỗi cập nhật hồ sơ." });
    }
  });

  // 4. Refresh Link Token
  app.post("/api/auth/refresh-link-token", (req, res) => {
    try {
      const { email } = req.body;
      if (!email) return res.status(400).json({ error: "Thiếu email." });

      const cleanEmail = email.trim().toLowerCase();
      const store = readStore();
      const user = store.users[cleanEmail];

      if (!user) {
        return res.status(404).json({ error: "Không tìm thấy tài khoản." });
      }

      user.linkToken = Math.floor(100000 + Math.random() * 900000).toString();
      writeStore(store);
      return res.json({ linkToken: user.linkToken });
    } catch (e: any) {
      console.error("Error in /api/auth/refresh-link-token:", e);
      return res.status(500).json({ error: "Lỗi máy chủ." });
    }
  });

  // 5. Unlink Telegram
  app.post("/api/auth/unlink-telegram", (req, res) => {
    try {
      const { email } = req.body;
      if (!email) return res.status(400).json({ error: "Thiếu email." });

      const cleanEmail = email.trim().toLowerCase();
      const store = readStore();
      const user = store.users[cleanEmail];

      if (!user) {
        return res.status(404).json({ error: "Không tìm thấy tài khoản." });
      }

      const chatId = user.telegramChatId;
      if (chatId) {
        delete store.telegramLinks[chatId];
      }
      
      user.telegramChatId = undefined;
      user.telegramUsername = undefined;
      
      writeStore(store);
      return res.json({ success: true, user });
    } catch (e: any) {
      console.error("Error in /api/auth/unlink-telegram:", e);
      return res.status(500).json({ error: "Lỗi hủy liên kết Telegram." });
    }
  });

  // --- TELEGRAM WEBHOOK ENDPOINTS & STATUS ---

  // 1. GET status and manual setup for Telegram Webhook (Support both query parameter and path parameters)
  app.get("/api/telegram/webhook/:token?", async (req, res) => {
    try {
      const { setup, url } = req.query;
      const botToken = req.params.token || req.query.token as string || "";
      
      if (setup === "true" && botToken) {
        const webhookUrl = url as string || `${req.protocol}://${req.get("host")}/api/telegram/webhook/${botToken}`;
        
        console.log(`Setting up Telegram Webhook dynamically. BotToken: ${botToken.substring(0, 8)}... WebhookUrl: ${webhookUrl}`);
        
        const telegramApiUrl = `https://api.telegram.org/bot${botToken}/setWebhook?url=${encodeURIComponent(webhookUrl)}`;
        const tgRes = await fetch(telegramApiUrl);
        const tgData = await tgRes.json();
        
        return res.json({
          success: tgData.ok,
          telegram_response: tgData
        });
      }

      return res.json({
        status: "ok",
        message: "Telegram Webhook endpoint is active. Use POST to receive updates."
      });
    } catch (err: any) {
      console.error("Error in GET /api/telegram/webhook:", err);
      return res.status(500).json({ error: err.message || "Lỗi máy chủ." });
    }
  });

  // 2. POST setup webhook for seamless button-click registration from UI
  app.post("/api/telegram/setup-webhook", async (req, res) => {
    try {
      const { token, webhookUrl } = req.body;
      if (!token || !webhookUrl) {
        return res.status(400).json({ error: "Vui lòng cung cấp đầy đủ Bot Token và Webhook URL." });
      }

      console.log(`Setting up Telegram Webhook via POST. Token: ${token.substring(0, 8)}... WebhookUrl: ${webhookUrl}`);
      const telegramApiUrl = `https://api.telegram.org/bot${token}/setWebhook?url=${encodeURIComponent(webhookUrl)}`;
      
      const tgRes = await fetch(telegramApiUrl);
      const tgData = await tgRes.json();

      if (!tgRes.ok || !tgData.ok) {
        return res.status(400).json({
          error: tgData.description || "Không thể đăng ký Webhook với Telegram. Vui lòng kiểm tra lại Bot Token."
        });
      }

      return res.json({
        success: true,
        message: "Đăng ký Webhook với Telegram thành công!",
        result: tgData.result
      });
    } catch (err: any) {
      console.error("Error in /api/telegram/setup-webhook:", err);
      return res.status(500).json({ error: err.message || "Lỗi cấu hình Webhook." });
    }
  });

  // 3. POST Webhook endpoint for receiving Telegram updates (Support optional token in path)
  app.post("/api/telegram/webhook/:token?", async (req, res) => {
    try {
      const update = req.body;
      console.log("Incoming Telegram update:", JSON.stringify(update));
      
      if (!update || !update.message) {
        return res.sendStatus(200);
      }

      const message = update.message;
      const chatId = String(message.chat.id);
      const text = (message.text || "").trim();
      const botToken = req.params.token || req.query.token as string || process.env.TELEGRAM_BOT_TOKEN || "";

      const store = readStore();

      // Command 1: Join / Link account using link code (/start <token> or /link <token>)
      const startMatch = text.match(/^\/?start\s+(\d{6})/i) || text.match(/^\/?link\s+(\d{6})/i);
      if (startMatch) {
        const token = startMatch[1];
        let targetEmail = "";
        
        Object.keys(store.users).forEach((em) => {
          if (String(store.users[em].linkToken) === String(token)) {
            targetEmail = em;
          }
        });

        if (targetEmail) {
          const user = store.users[targetEmail];
          user.telegramChatId = chatId;
          user.telegramUsername = message.from?.username || "";
          store.telegramLinks[chatId] = targetEmail;
          writeStore(store);

          const successMsg = `🎉 *LIÊN KẾT THÀNH CÔNG!* 🏡\n\nChào mừng *${user.displayName}* đến với Smart Spend Tracker.\nTài khoản của bạn *(${user.email})* đã được đồng bộ hóa với chat bot.\n\n✍️ *Bắt đầu ghi chép:* Gõ tin nhắn chi tiêu bình thường, ví dụ:\n• _"Đi chợ mua cá 45k, rau 15k"_\n• _"Thanh toán tiền điện 1tr2"_\n• _"Tiết kiệm 200k mua tai nghe"_\n\nHệ thống sẽ tự động phân tích và hiển thị tức thì trên màn hình web gia đình!`;
          await sendTelegramMessage(botToken, chatId, successMsg);
        } else {
          await sendTelegramMessage(botToken, chatId, `❌ *Lỗi liên kết:* Mã liên kết \`${token}\` không đúng hoặc đã hết hạn. Vui lòng lấy mã mới trên giao diện web.`);
        }
        return res.sendStatus(200);
      }

      // Command 2: Help or General Start
      if (text === "/start" || text === "/help" || text.toLowerCase() === "help") {
        const welcome = `👋 *Chào mừng đến với Smart Spend AI Bot!* 🏡\n\nĐây là hệ thống bot ghi chép tài chính gia đình thông minh, liên kết trực tiếp với bảng điều khiển web của gia đình bạn.\n\n⚙️ *Cách liên kết:* \n1. Đăng nhập tài khoản trên website.\n2. Vào phần *Cá Nhân / Hộ Gia Đình* lấy *Mã liên kết Telegram* (6 chữ số).\n3. Gửi tin nhắn vào đây theo cú pháp: \`/link <mã_của_bạn>\` (Ví dụ: \`/link 123456\`).\n\n🎯 *Sau khi kết nối:* Bạn chỉ cần nhập chi tiêu tự do bằng tiếng Việt, bot sẽ tự động nhận dạng và phân bổ chính xác theo tên thành viên!`;
        await sendTelegramMessage(botToken, chatId, welcome);
        return res.sendStatus(200);
      }

      // regular spending text processing
      const userEmail = store.telegramLinks[chatId];
      if (!userEmail || !store.users[userEmail]) {
        const warn = `⚠️ *Tài khoản Telegram chưa được liên kết!* \n\nVui lòng đăng nhập vào website, lấy mã liên kết của bạn và gửi tin nhắn vào đây theo cú pháp:\n\n\`/link <mã_liên_kết>\``;
        await sendTelegramMessage(botToken, chatId, warn);
        return res.sendStatus(200);
      }

      const user = store.users[userEmail];
      const inviteCode = user.householdInviteCode;
      if (!inviteCode || !store.households[inviteCode]) {
        const warnNoH = `🏡 *Chưa tham gia hộ gia đình!*\n\nTài khoản của bạn (*${user.email}*) chưa tham gia hoặc tạo hộ gia đình nào trên website. Vui lòng tham gia hộ gia đình trước để bắt đầu đồng bộ chi tiêu.`;
        await sendTelegramMessage(botToken, chatId, warnNoH);
        return res.sendStatus(200);
      }

      const hhData = store.households[inviteCode];
      const categoriesList = hhData.categories.map((c: any) => c.name);

      // Parse using advanced AI helper (with hybrid rules fallback)
      const parsed = await parseTransactionWithAI(text, categoriesList);

      if (parsed.length === 0) {
        await sendTelegramMessage(botToken, chatId, `❓ *Không nhận diện được khoản chi tiêu.*\n\nVui lòng nhập rõ mô tả và số tiền. Ví dụ: _"Cà phê sáng 35k"_, _"Mua bỉm sữa cho con 350 nghìn"_.`);
        return res.sendStatus(200);
      }

      const added: any[] = [];
      for (const item of parsed) {
        const txObj = {
          id: `t_tg_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
          description: item.description,
          amount: item.amount,
          category: item.category,
          date: new Date().toLocaleDateString("en-CA"),
          note: "Nhập tự động qua Telegram Bot",
          member: user.displayName,
          createdAt: new Date().toISOString()
        };

        // Handle savings contributions
        if (item.isSavingsContribution && item.savingsGoalName) {
          const matchedGoal = hhData.goals.find((g: any) => 
            g.name.toLowerCase().includes(item.savingsGoalName.toLowerCase()) || 
            item.savingsGoalName.toLowerCase().includes(g.name.toLowerCase())
          );
          if (matchedGoal) {
            matchedGoal.currentAmount = (matchedGoal.currentAmount || 0) + item.amount;
            txObj.description = `Tích lũy: ${matchedGoal.name}`;
          }
        }

        hhData.transactions.unshift(txObj);
        added.push(txObj);
      }

      // Sort
      hhData.transactions.sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
      writeStore(store);

      let confirmation = `✅ *Đã cập nhật chi tiêu gia đình thành công!* 🏡\n\n`;
      added.forEach((tx) => {
        const isIncome = tx.amount < 0;
        const formattedAmount = Math.abs(tx.amount).toLocaleString("vi-VN") + "đ";
        confirmation += `👤 *Người chi:* ${user.displayName}\n`;
        confirmation += `${isIncome ? "💵" : "💸"} *Khoản chi:* ${tx.description}\n`;
        confirmation += `💰 *Số tiền:* ${isIncome ? "+" : "-"}${formattedAmount}\n`;
        confirmation += `📁 *Danh mục:* ${tx.category}\n\n`;
      });
      confirmation += `🖥️ _Dữ liệu đã được đồng bộ trực tiếp lên Web Dashboard!_`;

      await sendTelegramMessage(botToken, chatId, confirmation);

    } catch (e: any) {
      console.error("Error in Telegram Webhook:", e);
    }
    return res.sendStatus(200);
  });

  // 1. Get Household State
  app.get("/api/household/get", (req, res) => {
    try {
      const inviteCode = (req.query.inviteCode as string || "").trim().toUpperCase();
      if (!inviteCode) {
        return res.status(400).json({ error: "Thiếu mã mời (inviteCode)" });
      }
      const store = readStore();
      const data = store.households[inviteCode];
      if (!data) {
        return res.status(404).json({ error: `Mã mời ${inviteCode} không tồn tại.` });
      }
      return res.json(data);
    } catch (e: any) {
      console.error("Error in /api/household/get:", e);
      return res.status(500).json({ error: e.message || "Lỗi xử lý hệ thống" });
    }
  });

  // 2. Create Household
  app.post("/api/household/create", (req, res) => {
    try {
      const { name, displayName, role, email } = req.body;
      if (!name || !displayName || !role) {
        return res.status(400).json({ error: "Thiếu thông tin bắt buộc (name, displayName, role)" });
      }

      const store = readStore();
      let inviteCode = generateInviteCode();
      // Ensure unique code
      while (store.households[inviteCode]) {
        inviteCode = generateInviteCode();
      }

      const newHousehold = {
        id: `hh_${Date.now()}`,
        name: name.trim(),
        inviteCode,
        createdAt: new Date().toISOString(),
        members: [
          {
            id: `mem_${Date.now()}_1`,
            name: displayName.trim(),
            role: role,
            displayName: `${role} (${displayName.trim()})`,
            joinedAt: new Date().toISOString()
          }
        ]
      };

      const defaultCats = [
        { id: "cat_1", name: "Ăn uống", icon: "🍔", limitAmount: 5000000, isRecurring: true },
        { id: "cat_2", name: "Di chuyển", icon: "🚗", limitAmount: 1200000, isRecurring: true },
        { id: "cat_3", name: "Nhà ở", icon: "🏠", limitAmount: 4000000, isRecurring: true },
        { id: "cat_4", name: "Giải trí", icon: "🎉", limitAmount: 2000000, isRecurring: true },
        { id: "cat_5", name: "Sức khỏe", icon: "💊", limitAmount: 600000, isRecurring: false },
        { id: "cat_6", name: "Học tập", icon: "📚", limitAmount: 1500000, isRecurring: true },
        { id: "cat_7", name: "Mua sắm", icon: "🛒", limitAmount: 3000000, isRecurring: true },
        { id: "cat_9", name: "Tiết kiệm & Tích lũy", icon: "🐖", limitAmount: 2000000, isRecurring: true },
        { id: "cat_8", name: "Khác", icon: "📦", limitAmount: 1000000, isRecurring: false },
      ];

      const defaultGoals = [
        {
          id: "g_1",
          name: "Tích lũy mua Laptop mới",
          targetAmount: 30000000,
          currentAmount: 12000000,
          targetDate: "2026-12-31",
          createdAt: new Date().toISOString(),
        },
        {
          id: "g_2",
          name: "Quỹ khẩn cấp phòng ngừa rủi ro",
          targetAmount: 15000000,
          currentAmount: 7000000,
          createdAt: new Date().toISOString(),
        },
      ];

      store.households[inviteCode] = {
        household: newHousehold,
        transactions: [],
        categories: defaultCats,
        goals: defaultGoals
      };

      let updatedUser = null;
      if (email) {
        const cleanEmail = email.trim().toLowerCase();
        if (store.users[cleanEmail]) {
          store.users[cleanEmail].householdInviteCode = inviteCode;
          updatedUser = store.users[cleanEmail];
        }
      }

      writeStore(store);

      return res.json({
        household: newHousehold,
        transactions: [],
        categories: defaultCats,
        goals: defaultGoals,
        user: updatedUser
      });
    } catch (e: any) {
      console.error("Error in /api/household/create:", e);
      return res.status(500).json({ error: e.message || "Lỗi xử lý hệ thống" });
    }
  });

  // 3. Join Household
  app.post("/api/household/join", (req, res) => {
    try {
      const { inviteCode, displayName, role, email } = req.body;
      if (!inviteCode || !displayName || !role) {
        return res.status(400).json({ error: "Thiếu thông tin bắt buộc (inviteCode, displayName, role)" });
      }

      const cleanCode = inviteCode.trim().toUpperCase();
      const store = readStore();
      const data = store.households[cleanCode];
      if (!data) {
        return res.status(404).json({ error: `Mã mời ${cleanCode} không tồn tại hoặc đã hết hạn.` });
      }

      // Check if user already exists
      const existing = data.household.members.find(
        (m: any) => m.name.toLowerCase() === displayName.trim().toLowerCase()
      );

      if (existing) {
        return res.status(400).json({ error: "Bạn đã gia nhập hoặc trùng tên trong hộ gia đình này rồi." });
      }

      const newMember = {
        id: `mem_user_${Date.now()}`,
        name: displayName.trim(),
        role: role,
        displayName: `${role} (${displayName.trim()})`,
        joinedAt: new Date().toISOString()
      };

      data.household.members.push(newMember);

      let updatedUser = null;
      if (email) {
        const cleanEmail = email.trim().toLowerCase();
        if (store.users[cleanEmail]) {
          store.users[cleanEmail].householdInviteCode = cleanCode;
          updatedUser = store.users[cleanEmail];
        }
      }

      writeStore(store);

      return res.json({
        household: data.household,
        transactions: data.transactions,
        categories: data.categories,
        goals: data.goals,
        user: updatedUser
      });
    } catch (e: any) {
      console.error("Error in /api/household/join:", e);
      return res.status(500).json({ error: e.message || "Lỗi xử lý hệ thống" });
    }
  });

  // 3.5. Leave Household
  app.post("/api/household/leave", (req, res) => {
    try {
      const { email } = req.body;
      if (!email) {
        return res.status(400).json({ error: "Thiếu email." });
      }

      const cleanEmail = email.trim().toLowerCase();
      const store = readStore();
      const user = store.users[cleanEmail];

      if (!user) {
        return res.status(404).json({ error: "Không tìm thấy tài khoản." });
      }

      const inviteCode = user.householdInviteCode;
      if (inviteCode && store.households[inviteCode]) {
        const hh = store.households[inviteCode];
        hh.household.members = hh.household.members.filter(
          (m: any) => m.name.toLowerCase() !== user.name.toLowerCase()
        );
      }

      user.householdInviteCode = undefined;
      writeStore(store);

      return res.json({ user });
    } catch (e: any) {
      console.error("Error in /api/household/leave:", e);
      return res.status(500).json({ error: "Lỗi rời nhóm." });
    }
  });

  // 4. Synchronize Household State (Merge Logic)
  app.post("/api/household/sync", (req, res) => {
    try {
      const { inviteCode, household, transactions, categories, goals, actionDescription, operatorEmail } = req.body;
      if (!inviteCode || !household) {
        return res.status(400).json({ error: "Thiếu dữ liệu đồng bộ" });
      }

      const cleanCode = inviteCode.trim().toUpperCase();
      const store = readStore();
      const serverData = store.households[cleanCode];

      if (!serverData) {
        // If household doesn't exist on server, we register/save it
        store.households[cleanCode] = {
          household,
          transactions: transactions || [],
          categories: categories || [],
          goals: goals || [],
          notifications: []
        };
      } else {
        // MERGE LOGIC (Server-Authoritative Union of entries)

        // Merge members
        const memberMap = new Map();
        serverData.household.members.forEach((m: any) => memberMap.set(m.id || m.name, m));
        if (household.members && Array.isArray(household.members)) {
          household.members.forEach((m: any) => memberMap.set(m.id || m.name, m));
        }
        serverData.household.members = Array.from(memberMap.values());
        serverData.household.name = household.name || serverData.household.name;

        // Merge transactions
        const txMap = new Map();
        serverData.transactions.forEach((t: any) => txMap.set(t.id, t));
        if (transactions && Array.isArray(transactions)) {
          transactions.forEach((t: any) => txMap.set(t.id, t));
        }
        serverData.transactions = Array.from(txMap.values()).sort((a: any, b: any) => {
          return new Date(b.date).getTime() - new Date(a.date).getTime();
        });

        // Merge categories
        const catMap = new Map();
        serverData.categories.forEach((c: any) => catMap.set(c.id, c));
        if (categories && Array.isArray(categories)) {
          categories.forEach((c: any) => catMap.set(c.id, c));
        }
        serverData.categories = Array.from(catMap.values());

        // Merge goals
        const goalMap = new Map();
        serverData.goals.forEach((g: any) => goalMap.set(g.id, g));
        if (goals && Array.isArray(goals)) {
          goals.forEach((g: any) => goalMap.set(g.id, g));
        }
        serverData.goals = Array.from(goalMap.values());
      }

      const currentServerData = store.households[cleanCode];

      // Process and save notification if provided
      if (actionDescription) {
        const notif = {
          id: `notif_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
          message: actionDescription,
          createdAt: new Date().toISOString()
        };
        if (!currentServerData.notifications) {
          currentServerData.notifications = [];
        }
        currentServerData.notifications.push(notif);
        if (currentServerData.notifications.length > 50) {
          currentServerData.notifications.shift();
        }

        // Send telegram notification to all other members
        const botToken = process.env.TELEGRAM_BOT_TOKEN || "";
        if (botToken) {
          const opEmailLower = operatorEmail ? operatorEmail.trim().toLowerCase() : "";
          Object.values(store.users).forEach((u: any) => {
            if (
              u.householdInviteCode === cleanCode &&
              u.telegramChatId &&
              u.email.toLowerCase() !== opEmailLower
            ) {
              const tgMsg = `🔔 *Thông báo hoạt động từ gia đình:*\n\n${actionDescription}\n\n🏡 _Hệ thống Smart Spend Tracker_`;
              sendTelegramMessage(botToken, u.telegramChatId, tgMsg);
            }
          });
        }
      }

      writeStore(store);
      return res.json(store.households[cleanCode]);
    } catch (e: any) {
      console.error("Error in /api/household/sync:", e);
      return res.status(500).json({ error: e.message || "Lỗi xử lý hệ thống" });
    }
  });

  // API Endpoint: Smart Spending NLP Parser (Hybrid rule-first + AI fallback)
  app.post("/api/parse-transaction", async (req, res) => {
    try {
      const { text, userCategories, aiProvider, userApiKey } = req.body;

      if (!text || typeof text !== "string" || text.trim() === "") {
        return res.status(400).json({ error: "Nội dung nhập liệu không hợp lệ" });
      }

      const cleanText = text.trim();
      const categoriesList = Array.isArray(userCategories) && userCategories.length > 0
        ? userCategories
        : ["Ăn uống", "Di chuyển", "Nhà ở", "Giải trí", "Sức khỏe", "Học tập", "Mua sắm", "Khác"];

      const provider = aiProvider || "gemini";

      const systemPrompt = `Bạn là trợ lý AI chuyên nghiệp phân tích chi tiêu cá nhân bằng tiếng Việt.
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

      if (provider === "gemini") {
        // Initialize the active Google Gen AI client based on user key or server key
        let activeAi = ai;
        if (userApiKey && typeof userApiKey === "string" && userApiKey.trim() !== "") {
          activeAi = new GoogleGenAI({
            apiKey: userApiKey.trim(),
            httpOptions: {
              headers: {
                "User-Agent": "aistudio-build",
              },
            },
          });
        } else if (!process.env.GEMINI_API_KEY) {
          console.warn("GEMINI_API_KEY is missing, falling back to rule-based parser");
          const fallbackResult = parseWithRules(cleanText, categoriesList);
          return res.json({ transactions: fallbackResult, method: "rule-based" });
        }

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
        return res.json({
          transactions: applySavingsKeywordOverride(parsedData.transactions || [], cleanText),
          method: "gemini-ai",
        });
      } else {
        // OpenAI-compatible providers: openai, groq, deepseek
        let apiUrl = "";
        let modelName = "";
        let activeKey = (userApiKey && typeof userApiKey === "string" && userApiKey.trim() !== "")
          ? userApiKey.trim()
          : "";

        if (provider === "openai") {
          apiUrl = "https://api.openai.com/v1/chat/completions";
          modelName = "gpt-4o-mini";
          if (!activeKey) activeKey = process.env.OPENAI_API_KEY || "";
        } else if (provider === "groq") {
          apiUrl = "https://api.groq.com/openai/v1/chat/completions";
          // [BUGFIX T-S95 17/08/2026] Groq khai tử `llama-3.3-70b-versatile`
          // (deprecated 17/06/2026). Model thay thế theo khuyến nghị chính
          // thức của Groq — giữ đồng bộ với 3 bản còn lại (_shared +
          // 2 merged Edge Function) để tránh trôi cấu hình giữa các bản.
          modelName = "openai/gpt-oss-120b";
          if (!activeKey) activeKey = process.env.GROQ_API_KEY || "";
        } else if (provider === "deepseek") {
          apiUrl = "https://api.deepseek.com/chat/completions";
          modelName = "deepseek-chat";
          if (!activeKey) activeKey = process.env.DEEPSEEK_API_KEY || "";
        }

        if (!activeKey) {
          throw new Error(`API Key cho nhà cung cấp ${provider.toUpperCase()} chưa được thiết lập. Vui lòng cấu hình trong tab Hộ Gia Đình.`);
        }

        const apiResponse = await fetch(apiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${activeKey}`
          },
          body: JSON.stringify({
            model: modelName,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: `Hãy phân tích câu nhập liệu chi tiêu này: "${cleanText}"` }
            ],
            temperature: 0.1,
            response_format: { type: "json_object" }
          })
        });

        if (!apiResponse.ok) {
          const errText = await apiResponse.text();
          throw new Error(`Lỗi kết nối API ${provider.toUpperCase()} (${apiResponse.status}): ${errText}`);
        }

        const resultJson = await apiResponse.json();
        const content = resultJson?.choices?.[0]?.message?.content;
        if (!content) {
          throw new Error(`Mô hình ${provider.toUpperCase()} không trả về nội dung hợp lệ`);
        }

        const parsedData = JSON.parse(content.trim());
        return res.json({
          transactions: applySavingsKeywordOverride(parsedData.transactions || [], cleanText),
          method: `${provider}-ai`,
        });
      }

    } catch (error: any) {
      console.error("Lỗi khi phân tích bằng AI:", error);
      // Fallback to rule-based parser in case of API failure
      try {
        const text = req.body.text || "";
        const userCategories = req.body.userCategories || [];
        const fallbackResult = parseWithRules(text, userCategories);
        return res.json({
          transactions: fallbackResult,
          method: "rule-based-fallback",
          warning: error?.message || "Không thể gọi AI, hệ thống tự động chuyển sang phân tích cục bộ",
        });
      } catch (err) {
        return res.status(500).json({ error: "Lỗi xử lý phân tích chi tiêu" });
      }
    }
  });

  // Serve static assets in production, otherwise use Vite middleware
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Smart Spend Tracker server running on http://localhost:${PORT}`);
  });
}

// Advanced rule-first + Gemini AI parser for smart transactions in chatbot and web
async function parseTransactionWithAI(text: string, categoriesList: string[]): Promise<any[]> {
  const cleanText = (text || "").trim();
  if (!cleanText) return [];

  // If server-side GEMINI_API_KEY is available, use it!
  if (process.env.GEMINI_API_KEY) {
    const systemPrompt = `Bạn là trợ lý AI chuyên nghiệp phân tích chi tiêu cá nhân bằng tiếng Việt.
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

    try {
      const response = await ai.models.generateContent({
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
      if (textOutput) {
        const parsedData = JSON.parse(textOutput.trim());
        if (parsedData && Array.isArray(parsedData.transactions)) {
          return applySavingsKeywordOverride(parsedData.transactions, cleanText);
        }
      }
    } catch (err) {
      console.error("Error generating Content with Gemini in parseTransactionWithAI:", err);
    }
  }

  // Fallback to local regex-based parsing if Gemini fails or is not available
  return parseWithRules(cleanText, categoriesList);
}

// T-S06e1d fix-2: lời dặn trong systemPrompt không đảm bảo Gemini/OpenAI-compatible
// tuân theo 100% (LLM không tất định) — thêm lớp kiểm tra từ khóa CỨNG sau khi
// nhận kết quả AI, độc lập với việc AI có "nghe lời" prompt hay không. Dùng
// chung logic tách savingsGoalName với parseWithRules (giữ nguyên regex/danh
// sách để hành vi nhất quán giữa 2 đường).
function applySavingsKeywordOverride(transactions: any[], rawText: string): any[] {
  const savingsKeywords = ["tiết kiệm", "để dành", "tích lũy", "tích luỹ", "góp quỹ", "heo đất", "tiết kiệm tiền", "để dành tiền", "góp vốn", "góp tiền", "gửi tiết kiệm"];
  const amountRegex = /(\d+(?:\.\d+)?)\s*(k|nghìn|ngàn|tr|triệu|đ|d|vnd)?/i;
  const lowerRaw = rawText.toLowerCase();
  const rawHasKeyword = savingsKeywords.some((kw) => includesWholeWord(lowerRaw, kw));

  return transactions.map((item) => {
    if (!item || item.isSavingsContribution) return item; // AI đã đúng, không đụng vào

    const desc = String(item.description || "").toLowerCase();
    const descHasKeyword = savingsKeywords.some((kw) => includesWholeWord(desc, kw));
    // Chỉ áp dụng cờ raw-text khi input chỉ tách ra đúng 1 giao dịch, tránh
    // gán nhầm sang các khoản khác khi người dùng nhập nhiều khoản 1 lúc.
    if (!descHasKeyword && !(transactions.length === 1 && rawHasKeyword)) return item;

    let cleanGoal = transactions.length === 1 ? lowerRaw : desc;
    savingsKeywords.forEach((kw) => {
      cleanGoal = cleanGoal.replace(kw, "");
    });
    cleanGoal = cleanGoal.replace(amountRegex, "").replace(/với|cho|để|vào|quỹ/g, "").replace(/\s+/g, " ").trim();

    const existingGoalName = String(item.savingsGoalName || "").trim();
    const savingsGoalName = existingGoalName || (cleanGoal ? cleanGoal.charAt(0).toUpperCase() + cleanGoal.slice(1) : "Tiết kiệm chung");

    return { ...item, isSavingsContribution: true, savingsGoalName };
  });
}

// [BUGFIX T-S31 08/08/2026] So chuỗi con (`String.includes`) làm khớp NHẦM khi
// từ khóa ngắn tình cờ là chuỗi con của 1 từ tiếng Việt khác không liên quan
// — ví dụ từ khóa "ăn" (danh mục Ăn uống) khớp nhầm vào "xăng" (x-ă-n-g chứa
// "ăn"), khiến "Đổ xăng xe máy" bị xếp vào Ăn uống thay vì Di chuyển dù từ
// khóa "xăng" thật sự tồn tại đúng ở danh mục Di chuyển (chỉ là bị kiểm tra
// SAU, vòng lặp `break` ở lần khớp nhầm đầu tiên nên không bao giờ tới lượt).
// Lỗi này không giới hạn ở "xăng" — bất kỳ từ nào chứa "ăn"/"cá"/"rau" làm
// chuỗi con (vd "cá nhân", "các", "cách", "khăn", "văn") đều có nguy cơ y hệt.
// Sửa: so theo TỪ TRỌN VẸN (ranh giới là đầu/cuối chuỗi hoặc ký tự không
// phải chữ cái) thay vì so chuỗi con thô.
function includesWholeWord(haystack: string, keyword: string): boolean {
  if (!keyword) return false;
  // Từ khóa nhiều từ (có dấu cách, vd "cà phê", "tiền nhà") vẫn giữ nguyên
  // hành vi so chuỗi con như cũ — rủi ro khớp nhầm gần như không có vì cụm
  // từ càng dài càng đặc thù, ranh giới từ đơn không áp dụng tốt cho cụm từ.
  if (keyword.includes(" ")) return haystack.includes(keyword);
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // \p{L} = bất kỳ ký tự chữ cái Unicode nào (bao gồm có dấu tiếng Việt) —
  // ranh giới từ đúng là vị trí KHÔNG có chữ cái liền kề ở cả 2 phía.
  const re = new RegExp(`(?<![\\p{L}])${escaped}(?![\\p{L}])`, "iu");
  return re.test(haystack);
}

// Simple rule-based parser for quick fallbacks
function parseWithRules(text: string, categoriesList: string[]): any[] {
  if (!text) return [];

  // Split text by commas or newlines to find multiple entries
  const parts = text.split(/[,;\n]+/).map(p => p.trim()).filter(p => p.length > 0);
  const transactions: any[] = [];

  for (const part of parts) {
    // Look for a number pattern (amount) and text around it
    // Example patterns: "ca 35k", "35k ca", "mua sua 50 nghin", "nap card dt 100k"
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

      // Remove the money part from the text to get the description
      let description = part.replace(amountRegex, "").replace(/\s+/g, " ").trim();
      if (!description) {
        description = "Chi tiêu không tên";
      } else {
        // Capitalize first letter
        description = description.charAt(0).toUpperCase() + description.slice(1);
      }

      // Match simple categories based on keyword dictionary
      let category = "Khác";
      const descLower = description.toLowerCase();

      let isSavingsContribution = false;
      let savingsGoalName = "";
      const savingsKeywords = ["tiết kiệm", "để dành", "tích lũy", "tích luỹ", "góp quỹ", "heo đất", "tiết kiệm tiền", "để dành tiền", "góp vốn", "góp tiền", "gửi tiết kiệm"];
      if (savingsKeywords.some(kw => includesWholeWord(part.toLowerCase(), kw))) {
        isSavingsContribution = true;
        let cleanGoal = part.toLowerCase();
        savingsKeywords.forEach(kw => {
          cleanGoal = cleanGoal.replace(kw, "");
        });
        cleanGoal = cleanGoal.replace(amountRegex, "");
        cleanGoal = cleanGoal.replace(/với|cho|để|vào|quỹ/g, "");
        cleanGoal = cleanGoal.replace(/\s+/g, " ").trim();
        if (cleanGoal) {
          savingsGoalName = cleanGoal.charAt(0).toUpperCase() + cleanGoal.slice(1);
        } else {
          savingsGoalName = "Tiết kiệm chung";
        }
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

      // Find matching category
      let foundCategory = false;
      if (isSavingsContribution) {
        const matchingSavingsCat = categoriesList.find(c => c.toLowerCase().includes("tiết kiệm") || c.toLowerCase().includes("tích lũy") || c.toLowerCase().includes("tích luỹ"));
        if (matchingSavingsCat) {
          category = matchingSavingsCat;
          foundCategory = true;
        }
      }

      if (!foundCategory) {
        for (const [catName, keywords] of Object.entries(keywordDict)) {
          if (keywords.some(kw => includesWholeWord(descLower, kw))) {
            // Verify if catName is in user's categories list
            const matchingCatInList = categoriesList.find(c => c.toLowerCase() === catName.toLowerCase());
            if (matchingCatInList) {
              category = matchingCatInList;
              foundCategory = true;
              break;
            }
          }
        }
      }

      if (!foundCategory) {
        // If not matched, try to match directly in categoriesList with simple string contains
        const directMatch = categoriesList.find(c => descLower.includes(c.toLowerCase()) || c.toLowerCase().includes(descLower));
        if (directMatch) {
          category = directMatch;
        } else {
          // [BUGFIX 08/08/2026 - T-S23] KHÔNG được fallback về
          // `categoriesList[categoriesList.length - 1]` (category CUỐI CÙNG
          // trong danh sách category thật của user). Nếu user không có category
          // tên đúng "Khác"/"Chi tiêu khác" (vd category cuối cùng của họ tình
          // cờ là "Tiết kiệm"), MỌI giao dịch không khớp từ khóa nào sẽ bị gán
          // cứng vào category đó — đây chính là bug đã report: "nhập bất kỳ
          // giao dịch nào cũng bị nhận diện là tiết kiệm". Luôn trả về chuỗi
          // "Khác" y hệt quy ước của systemPrompt AI (server.ts) và
          // `getMappedCategory` phía client (SmartInput.tsx/AIAssistantBubble.tsx)
          // — nếu "Khác" không khớp category thật nào, UI đã có sẵn cơ chế cảnh
          // báo + chặn lưu cho tới khi user tự chọn category hợp lệ.
          const fallbackCat = categoriesList.find(c => c === "Khác" || c === "Chi tiêu khác") || "Khác";
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

startServer();