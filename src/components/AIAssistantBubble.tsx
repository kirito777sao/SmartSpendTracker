import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  Sparkles,
  MessageSquare,
  X,
  Send,
  CornerDownLeft,
  AlertCircle,
  Check,
  Trash2,
  User,
  PiggyBank,
  FileText,
  Bot,
  HelpCircle,
} from "lucide-react";
import { Transaction } from "../types";
import { useScope } from "../context/ScopeContext";
import { useCurrentUserId } from "../hooks/useCurrentUserId";
import {
  useHousehold,
  useCurrentMember,
  formatMemberDisplayName,
} from "../hooks/useHousehold";
import {
  useCreateTransaction,
  useTransactions,
} from "../hooks/useTransactions";
import { useCategories } from "../hooks/useCategories";
import {
  useCreateGoal,
  useGoals,
  useCompleteGoalCascade,
} from "../hooks/useGoals";
import { rowToCategory, rowToGoal } from "../lib/mapRows";
import {
  goalManualAvailable,
  goalFrozenLinkedAvailable,
  GoalSpendLike,
  isGoalFullyFundedForCompletionBanner,
} from "../lib/goalAvailability";
import {
  buildTransactionInsert,
  buildTransactionInserts,
  isNewGoalToken,
  extractNewGoalName,
} from "../lib/toTransactionInsert";
import {
  isSavingsSuggested,
  findMatchingActiveGoalsByName,
} from "../lib/savingsDetect";
import { callParseTransaction } from "../lib/parseTransaction";

// [T-S120, 20/08/2026 — bugfix bảo mật, xem TASKS.md] Parser markdown-mini
// (chỉ hỗ trợ **bold**/_italic_) trả về mảng React node THẬT thay vì chuỗi
// HTML — React tự escape mọi string con khi render, nên không cần tự tay
// escape ký tự `<`/`>`/`&`... và không còn nhu cầu dùng
// `dangerouslySetInnerHTML` (đường hở XSS cũ: msg.text của tin nhắn USER
// được chèn thẳng vào DOM chỉ sau khi thay 2 cú pháp markdown, không escape
// gì khác — gõ 1 tin nhắn chứa thẻ HTML là thực thi được ngay trong trình
// duyệt của chính người gõ). Áp dụng cho MỌI dòng (cả bot lẫn user).
function renderInlineMarkdown(line: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = /\*\*(.+?)\*\*|_(.+?)_/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = regex.exec(line)) !== null) {
    if (match.index > lastIndex) {
      parts.push(line.slice(lastIndex, match.index));
    }
    if (match[1] !== undefined) {
      parts.push(<strong key={key++}>{match[1]}</strong>);
    } else {
      parts.push(<em key={key++}>{match[2]}</em>);
    }
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < line.length) {
    parts.push(line.slice(lastIndex));
  }
  return parts;
}

interface ChatMessage {
  id: string;
  sender: "user" | "bot";
  text: string;
  timestamp: Date;
  isParsingResult?: boolean;
  parsedData?: Omit<Transaction, "id" | "createdAt">[];
  // T-S20 — xem giải thích đầy đủ ở SmartInput.tsx (cùng cơ chế, ở đây gắn
  // theo từng ChatMessage vì parsedData nằm trong message thay vì 1 mảng
  // phẳng). key = index trong parsedData của message này.
  goalCompletionSelections?: Record<number, string>;
}

// T-S06e1 (fix): trước đây nhận categories/goals qua props từ App.tsx —
// nhưng App.tsx truyền state legacy (DEFAULT_CATEGORIES id dạng "cat_1",
// không phải uuid thật) nên insert luôn báo "invalid input syntax for
// type uuid". Theo đúng CONSTITUTION §1.1, component tự gọi
// useCategories/useGoals — giống pattern đã áp cho TransactionHistory.
export default function AIAssistantBubble() {
  const { scopeMode } = useScope();
  const userId = useCurrentUserId();
  const { data: household } = useHousehold();
  const currentMember = useCurrentMember();
  const createTransaction = useCreateTransaction();
  const createGoal = useCreateGoal();
  const completeGoal = useCompleteGoalCascade();
  const { data: categoryRows = [] } = useCategories();
  const { data: goalRows = [] } = useGoals();
  // [T-S67 patch] Cùng lý do như SmartInput.tsx — xem chú thích ở đó.
  const { data: transactionRows = [] } = useTransactions();
  const goalSpendRows: GoalSpendLike[] = useMemo(
    () =>
      transactionRows.map((t) => ({
        goalId: t.goal_id,
        type: t.type,
        amount: t.amount,
      })),
    [transactionRows],
  );
  const categories = useMemo(
    () => categoryRows.map(rowToCategory),
    [categoryRows],
  );
  // [T-S48 amendment 10/08/2026] Loại goal đã liên kết danh mục ngân sách
  // khỏi dropdown "Gắn vào"/khớp tên mô tả — cùng pattern đã đúng ở
  // `TransactionHistory.tsx` (T-S48), xem giải thích đầy đủ ở `SmartInput.tsx`.
  const goals = useMemo(
    () => goalRows.map(rowToGoal).filter((g) => !g.linkedCategoryId),
    [goalRows],
  );
  // [BUGFIX 11/08/2026, CONSTITUTION §1.14 mục 1, xem savingsDetect.ts] Set
  // category id đang bị 1 goal nào đó liên kết (§1.13) — tính từ TOÀN BỘ
  // `goalRows` CHƯA lọc, cùng pattern SmartInput.tsx.
  const linkedCategoryIds = useMemo(
    () =>
      new Set(
        goalRows
          .map(rowToGoal)
          .map((g) => g.linkedCategoryId)
          .filter((id): id is string => !!id),
      ),
    [goalRows],
  );

  const [isOpen, setIsOpen] = useState(false);
  const [showTooltip, setShowTooltip] = useState(true);
  const [inputText, setInputText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [savingMsgId, setSavingMsgId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // [T-S49] Form rút gọn "+ Tạo mục tiêu mới" ngay trong banner gợi ý —
  // xem giải thích đầy đủ ở SmartInput.tsx (cùng cơ chế). Key ở đây là
  // `${msgId}:${index}` vì item nằm lồng trong `msg.parsedData`.
  const [goalDraftOpenKey, setGoalDraftOpenKey] = useState<string | null>(null);
  const [goalDraftName, setGoalDraftName] = useState("");
  const [goalDraftError, setGoalDraftError] = useState<string | null>(null);
  const [isCreatingGoal, setIsCreatingGoal] = useState(false);
  const [createdGoalsCache, setCreatedGoalsCache] = useState<
    { id: string; name: string; currentAmount: number }[]
  >([]);

  const sampleSuggestions = [
    "Cơm trưa 40k, trà đá 5k",
    "Đổ xăng xe máy 50 nghìn",
    "Uống cà phê hết 29k",
    "Tiết kiệm 500k mua điện thoại",
  ];

  // Initialize with a welcome message from the AI Assistant
  useEffect(() => {
    setMessages([
      {
        id: "welcome",
        sender: "bot",
        text: "Xin chào! Mình là **Trợ lý Chi tiêu AI** của bạn. 🤖💖\n\nBạn vừa chi tiêu gì thế? Hãy gõ câu tự nhiên (ví dụ: _'ăn trưa 45k, cà phê 25k'_ hoặc _'tiết kiệm 500k mua điện thoại'_) để mình tự động bóc tách và ghi chép sổ giúp bạn nhé! Không cần thao tác thủ công phức tạp nữa.",
        timestamp: new Date(),
      },
    ]);

    // Check if user previously closed the tooltip
    const isTooltipDismissed = localStorage.getItem("ss_ai_tooltip_dismissed");
    if (isTooltipDismissed === "true") {
      setShowTooltip(false);
    }
  }, []);

  // Auto scroll to the bottom of the chat list
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isLoading, isOpen]);

  const handleToggleChat = () => {
    setIsOpen(!isOpen);
    setShowTooltip(false);
    localStorage.setItem("ss_ai_tooltip_dismissed", "true");
  };

  const handleDismissTooltip = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowTooltip(false);
    localStorage.setItem("ss_ai_tooltip_dismissed", "true");
  };

  const getMappedCategory = (rawCat: string): string => {
    const norm = (rawCat || "").trim().toLowerCase();

    // 1. Exact match
    const exactMatch = categories.find(
      (c) => c.name.trim().toLowerCase() === norm,
    );
    if (exactMatch) return exactMatch.name;

    // 2. Savings check
    if (
      norm.includes("tiết kiệm") ||
      norm.includes("tích lũy") ||
      norm.includes("tích luỹ")
    ) {
      const savingsCat = categories.find(
        (c) =>
          c.name.toLowerCase().includes("tích lũy") ||
          c.name.toLowerCase().includes("tích luỹ") ||
          c.name.toLowerCase().includes("tiết kiệm"),
      );
      if (savingsCat) return savingsCat.name;
    }

    // 3. Partial match
    const partialMatch = categories.find(
      (c) =>
        norm.includes(c.name.toLowerCase()) ||
        c.name.toLowerCase().includes(norm),
    );
    if (partialMatch) return partialMatch.name;

    return "Khác";
  };

  // [BUGFIX 11/08/2026, CONSTITUTION §1.14/§5 — xem giải thích đầy đủ ở
  // SmartInput.tsx] Đã bỏ hẳn `assignSavingGoal` — hàm cũ tự gán `goalId`
  // ngay lúc parse dựa trên cờ `isSavingsContribution`/`savingsGoalName` từ
  // backend (khớp từ khoá), KHÔNG qua bất kỳ cú bấm xác nhận nào của người
  // dùng — vi phạm CONSTITUTION §5 và là gốc rễ bug: đổi category sang 1
  // category đã liên kết goal khác (§1.13) làm banner T-S49 ẩn đi, nhưng
  // `goalId` đã gán sẵn từ trước đó vẫn sót lại, âm thầm tạo goal mới +
  // ghi `type='transfer'` lúc Lưu dù người dùng chưa hề chạm vào banner.

  // T-S20 — xem giải thích đầy đủ ở SmartInput.tsx (cùng logic y hệt).
  // [T-S76, CONSTITUTION §1.22.1 — CHỐT 14/08/2026] Thêm điều kiện goal
  // phải đã gom đủ >= 100% mục tiêu, đảo ngược có chủ đích hành vi cũ
  // (không ngưỡng) — xem giải thích đầy đủ ở SmartInput.tsx.
  const findMatchingActiveGoals = (description: string) => {
    const text = description.trim().toLowerCase();
    if (!text) return [];
    return goals.filter((g) => {
      if (g.completedAt) return false;
      if (!isGoalFullyFundedForCompletionBanner(g)) return false;
      const gName = g.name.trim().toLowerCase();
      if (!gName) return false;
      return text.includes(gName) || gName.includes(text);
    });
  };

  const handleSendText = async (textToSend: string) => {
    const trimmed = textToSend.trim();
    if (!trimmed || isLoading) return;

    // Append User Message
    const userMsgId = `user-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      {
        id: userMsgId,
        sender: "user",
        text: trimmed,
        timestamp: new Date(),
      },
    ]);

    setInputText("");
    setIsLoading(true);

    try {
      const data = await callParseTransaction(
        trimmed,
        categories.map((c) => c.name),
      );

      if (data.transactions && data.transactions.length > 0) {
        const today = new Date().toLocaleDateString("en-CA");
        const formatted = data.transactions.map((t: any) => ({
          description: t.description || "Giao dịch không tên",
          amount: Math.abs(Number(t.amount)) || 0,
          category: getMappedCategory(t.category || "Khác"),
          date: today,
          // [BUGFIX 11/08/2026] Không còn tự gán — xem khối comment thay
          // `assignSavingGoal` phía trên.
          goalId: undefined,
        }));

        // Append Bot message containing the interactive editing block
        setMessages((prev) => [
          ...prev,
          {
            id: `bot-parsed-${Date.now()}`,
            sender: "bot",
            text: `Mình đã phát hiện được **${formatted.length} khoản chi tiêu** từ tin nhắn của bạn! Bạn hãy kiểm tra, chỉnh sửa nếu cần và xác nhận lưu nhé:`,
            timestamp: new Date(),
            isParsingResult: true,
            parsedData: formatted,
          },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            id: `bot-err-${Date.now()}`,
            sender: "bot",
            text: "❓ Mình không bóc tách được chi tiết nào từ câu đó. Hãy thử viết rõ ràng hơn, ví dụ: _'ăn bún bò 45k, mua vé xem phim 120k'_. Thử lại xem nhé!",
            timestamp: new Date(),
          },
        ]);
      }
    } catch (err: any) {
      console.error(err);
      setMessages((prev) => [
        ...prev,
        {
          id: `bot-err-${Date.now()}`,
          sender: "bot",
          text: `⚠️ Đã xảy ra lỗi khi kết nối AI: ${err.message || "Lỗi không xác định"}.`,
          timestamp: new Date(),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdateItem = (
    msgId: string,
    itemIdx: number,
    key: keyof Omit<Transaction, "id" | "createdAt">,
    value: any,
  ) => {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id === msgId && m.parsedData) {
          const updatedData = [...m.parsedData];
          updatedData[itemIdx] = {
            ...updatedData[itemIdx],
            [key]: value,
          };
          // [BUGFIX 11/08/2026, CONSTITUTION §1.13 — xem giải thích đầy đủ ở
          // SmartInput.tsx] Đổi category sang 1 category ĐÃ LIÊN KẾT goal
          // khác → banner ẩn đi, nhưng `goalId` cũ (nếu có) phải dọn theo,
          // không để sót lại lọt qua lúc Xác nhận.
          if (key === "category" && updatedData[itemIdx].goalId) {
            const newCategoryId = categories.find((c) => c.name === value)?.id;
            if (newCategoryId && linkedCategoryIds.has(newCategoryId)) {
              updatedData[itemIdx] = {
                ...updatedData[itemIdx],
                goalId: undefined,
              };
            }
          }
          return { ...m, parsedData: updatedData };
        }
        return m;
      }),
    );
  };

  // [T-S49] Tạo goal mới ngay tại chỗ (tạo NGAY, không dùng token
  // "new_goal_" hoãn tới lúc lưu — cùng cơ chế SmartInput.tsx) rồi tự gắn
  // vào đúng dòng đang nhập trong đúng message.
  const handleCreateGoalInline = async (msgId: string, itemIdx: number) => {
    const name = goalDraftName.trim();
    if (!name) return;
    setIsCreatingGoal(true);
    setGoalDraftError(null);
    try {
      const created = await createGoal.mutateAsync({
        name,
        created_by: userId as string,
        ...(scopeMode === "household"
          ? { household_id: household?.id }
          : { owner_id: userId }),
      });
      setCreatedGoalsCache((prev) => [
        ...prev,
        { id: created.id, name: created.name, currentAmount: 0 },
      ]);
      handleUpdateItem(msgId, itemIdx, "goalId", created.id);
      setGoalDraftOpenKey(null);
      setGoalDraftName("");
    } catch (err: any) {
      setGoalDraftError(err.message || "Không thể tạo mục tiêu mới.");
    } finally {
      setIsCreatingGoal(false);
    }
  };

  const handleDeleteItem = (msgId: string, itemIdx: number) => {
    // [T-S121, 20/08/2026 — bugfix, xem TASKS.md] `goalDraftOpenKey` (state
    // ngoài `messages`, tách riêng để tránh gọi setState lồng bên trong
    // updater của `setMessages` — React 18 StrictMode gọi lại updater 2
    // lần ở dev, side-effect lồng bên trong dễ chạy đúp) gắn theo INDEX
    // trong CÙNG message (`${msgId}:${index}`) — phải reindex/đóng giống
    // hệt `goalCompletionSelections` bên dưới, nếu không xoá 1 dòng phía
    // trước dòng đang mở form sẽ khiến form "nhảy" nhầm sang dòng khác
    // cùng message, kèm tên đang gõ dở còn sót.
    if (goalDraftOpenKey) {
      const sep = goalDraftOpenKey.lastIndexOf(":");
      const draftMsgId = goalDraftOpenKey.slice(0, sep);
      const draftIdx = Number(goalDraftOpenKey.slice(sep + 1));
      if (draftMsgId === msgId) {
        if (draftIdx === itemIdx) {
          setGoalDraftOpenKey(null);
          setGoalDraftName("");
          setGoalDraftError(null);
        } else if (draftIdx > itemIdx) {
          setGoalDraftOpenKey(`${msgId}:${draftIdx - 1}`);
        }
      }
    }

    setMessages((prev) =>
      prev.map((m) => {
        if (m.id === msgId && m.parsedData) {
          const updatedData = m.parsedData.filter((_, idx) => idx !== itemIdx);
          if (updatedData.length === 0) {
            return {
              ...m,
              text: "Giao dịch đã được hủy bỏ.",
              isParsingResult: false,
              parsedData: undefined,
              goalCompletionSelections: undefined,
            };
          }
          // T-S20 — reindex goalCompletionSelections theo đúng index mới,
          // cùng logic reindex đã áp ở SmartInput.tsx.
          const reindexed: Record<number, string> = {};
          Object.entries(m.goalCompletionSelections || {}).forEach(
            ([key, val]) => {
              const i = Number(key);
              if (i === itemIdx) return;
              reindexed[i > itemIdx ? i - 1 : i] = val;
            },
          );
          return {
            ...m,
            parsedData: updatedData,
            goalCompletionSelections: reindexed,
          };
        }
        return m;
      }),
    );
  };

  // T-S20 — cập nhật lựa chọn "đánh dấu hoàn thành mục tiêu" cho 1 dòng
  // trong 1 message cụ thể (banner gợi ý ở review mode).
  const handleSetGoalCompletion = (
    msgId: string,
    itemIdx: number,
    goalId: string | undefined,
  ) => {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== msgId) return m;
        const next = { ...(m.goalCompletionSelections || {}) };
        if (goalId === undefined) {
          delete next[itemIdx];
        } else {
          next[itemIdx] = goalId;
        }
        return { ...m, goalCompletionSelections: next };
      }),
    );
  };

  const handleCancelItems = (msgId: string) => {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id === msgId) {
          return {
            ...m,
            text: "❌ Đã hủy bỏ giao dịch này.",
            isParsingResult: false,
            parsedData: undefined,
            goalCompletionSelections: undefined,
          };
        }
        return m;
      }),
    );
  };

  const handleConfirmItems = async (
    msgId: string,
    parsedData: Omit<Transaction, "id" | "createdAt">[],
    goalCompletionSelections: Record<number, string> = {},
  ) => {
    if (!parsedData || parsedData.length === 0) return;

    // [BUGFIX T-S22 08/08/2026] Chặn lưu khi còn dòng category chưa khớp
    // category thật nào — xem giải thích đầy đủ ở `SmartInput.tsx` (cùng
    // gốc rễ, cùng fix). Trước đây nút "Xác nhận ghi sổ" không bị chặn dù
    // UI đã có cảnh báo màu hổ phách, khiến `resolveTransactionType()` im
    // lặng mặc định `type='expense'` sai vĩnh viễn cho giao dịch thu nhập.
    const hasUnmatched = parsedData.some(
      (item) => !categories.some((c) => c.name === item.category),
    );
    if (hasUnmatched) {
      setMessages((prev) => [
        ...prev,
        {
          id: `bot-err-${Date.now()}`,
          sender: "bot",
          text: "⚠️ Còn dòng chưa chọn danh mục hợp lệ — vui lòng chọn 1 danh mục có sẵn cho tất cả các dòng (xem cảnh báo màu hổ phách ở trên) trước khi xác nhận ghi sổ.",
          timestamp: new Date(),
        },
      ]);
      return;
    }

    // [T-S49] Khối chặn "Còn dòng Tiết kiệm chưa gắn mục tiêu" (T-S45) đã
    // bỏ — gắn goal giờ là gợi ý mềm, không còn điều kiện nào để chặn ở đây.
    setSavingMsgId(msgId);

    // [T-S122, 20/08/2026 — bugfix, xem TASKS.md/CHANGELOG.md, cùng cơ chế
    // y hệt SmartInput.tsx] Batch lưu KHÔNG atomic — theo dõi CHÍNH XÁC
    // index (theo `parsedData` gốc lúc bắt đầu hàm này) nào đã lưu thành
    // công, để nếu lỗi giữa chừng, chỉ giữ lại trong `msg.parsedData` những
    // dòng CHƯA lưu (dòng lỗi + chưa kịp thử) — tránh ghi đúp khi người
    // dùng bấm "Xác nhận ghi sổ" lại.
    const savedIndices = new Set<number>();
    let currentItems = parsedData;

    try {
      const scope = { scopeMode, userId, householdId: household?.id };

      // T-S20 — xem giải thích đầy đủ ở SmartInput.tsx (cùng logic y hệt):
      // tách dòng đã được người dùng TỰ CHỌN đánh dấu hoàn thành goal ra
      // khỏi luồng `buildTransactionInserts` bình thường, validate lại
      // selection còn khớp goal active không trước khi tin.
      const completionEntries: { index: number; goalId: string }[] = [];
      currentItems.forEach((item, index) => {
        const chosen = goalCompletionSelections[index];
        if (!chosen) return;
        const stillMatches = findMatchingActiveGoals(item.description).some(
          (g) => g.id === chosen,
        );
        if (stillMatches) {
          completionEntries.push({ index, goalId: chosen });
        }
      });
      // [T-S74, thay cho chặn cứng T-S67 patch] Giao dịch "hoàn thành mục
      // tiêu" ở đây là 1 khoản CHI TIÊU THẬT đã xảy ra ngoài đời — KHÔNG
      // phải "rút quỹ" từ số dư app đang theo dõi (khác form Rút quỹ ở
      // SavingGoals.tsx, nơi vẫn giữ chặn cứng T-S66). Không được từ chối
      // ghi nhận 1 khoản chi thật chỉ vì "không đủ tiền đã để dành" — badge
      // "Dư/Thiếu" (T-S64b) đã xử lý đúng việc hiển thị lệch này sau khi
      // hoàn thành. Chỉ CẢNH BÁO MỀM (gửi kèm tin nhắn bot), không `return`
      // — vẫn lưu bình thường ở khối bên dưới.
      // [T-S77, 15/08/2026] Cảnh báo so với số dư GỘP CẢ 2 NGUỒN — xem giải
      // thích đầy đủ ở SmartInput.tsx (cùng cơ chế).
      const completionWarnings: string[] = [];
      for (const { index, goalId } of completionEntries) {
        const goal = goals.find((g) => g.id === goalId);
        if (!goal) continue;
        const available =
          goalManualAvailable(goal, goalSpendRows) +
          goalFrozenLinkedAvailable(goal);
        const amount = currentItems[index].amount;
        if (amount > available) {
          completionWarnings.push(
            `"${currentItems[index].description}" (${amount.toLocaleString("vi-VN")}đ) vượt số dư còn lại (liên kết + thủ công) của "${goal.name}" (${available.toLocaleString("vi-VN")}đ)`,
          );
        }
      }
      const completionIndices = new Set(completionEntries.map((e) => e.index));
      const normalItemsWithIndex = currentItems
        .map((item, index) => ({ item, index }))
        .filter(({ index }) => !completionIndices.has(index));

      if (normalItemsWithIndex.length > 0) {
        // [BUGFIX 11/08/2026] Truyền `linkedCategoryIds` — chặn cứng ở tầng
        // dùng chung (`buildTransactionInserts`), phòng `goalId` cũ sót lại
        // lọt qua dù UI đã ẩn banner (xem giải thích ở `handleUpdateItem`).
        const { inserts, newGoalIds } = await buildTransactionInserts(
          normalItemsWithIndex.map((x) => x.item),
          categories,
          scope,
          (input) => createGoal.mutateAsync(input),
          linkedCategoryIds,
        );
        // [T-S122] Ghi ngược uuid goal mới (nếu có) vào `currentItems` +
        // `msg.parsedData` NGAY, trước khi thử insert transaction (có thể
        // lỗi giữa chừng phía dưới) — xem giải thích đầy đủ ở SmartInput.tsx.
        if (newGoalIds.size > 0) {
          currentItems = currentItems.map((it) =>
            isNewGoalToken(it.goalId) &&
            newGoalIds.has(extractNewGoalName(it.goalId).toLowerCase())
              ? {
                  ...it,
                  goalId: newGoalIds.get(
                    extractNewGoalName(it.goalId).toLowerCase(),
                  ),
                }
              : it,
          );
          const patchedSnapshot = currentItems;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === msgId ? { ...m, parsedData: patchedSnapshot } : m,
            ),
          );
        }
        for (let i = 0; i < inserts.length; i++) {
          await createTransaction.mutateAsync(inserts[i]);
          savedIndices.add(normalItemsWithIndex[i].index);
        }
      }

      for (const { index, goalId } of completionEntries) {
        const item = currentItems[index];
        const goal = goals.find((g) => g.id === goalId);
        if (!goal) continue;
        const base = buildTransactionInsert(item, categories, scope, null);
        // [T-S77] Xem giải thích ở SmartInput.tsx — ưu tiên trừ phần liên
        // kết đã đóng băng trước, chỉ phần dư mới thành giao dịch thật.
        await completeGoal.mutateAsync({
          goal,
          transaction: { ...base, goal_id: goalId },
          note: item.description,
          goalSpendRows,
        });
        savedIndices.add(index);
      }

      const totalSaved = currentItems.length;
      const totalAmount = currentItems.reduce(
        (acc, curr) => acc + curr.amount,
        0,
      );
      const formattedAmount = new Intl.NumberFormat("vi-VN").format(
        totalAmount,
      );

      setMessages((prev) =>
        prev.map((m) => {
          if (m.id === msgId) {
            return {
              ...m,
              text: `✅ **Lưu sổ thành công!** Đã ghi nhận **${totalSaved} khoản chi tiêu** với tổng số tiền **${formattedAmount}đ** vào cơ sở dữ liệu. 🥳📊`,
              isParsingResult: false,
              parsedData: undefined,
              goalCompletionSelections: undefined,
            };
          }
          return m;
        }),
      );

      // [T-S74] Cảnh báo mềm gửi SAU khi đã lưu thành công (đúng bản chất
      // "thông tin về kết quả", không phải lỗi chặn trước khi lưu).
      if (completionWarnings.length > 0) {
        setMessages((prev) => [
          ...prev,
          {
            id: `bot-warn-${Date.now()}`,
            sender: "bot",
            text: `⚠️ Lưu ý: ${completionWarnings.join("; ")} — vẫn đã lưu, mục tiêu sẽ hiện "Thiếu" sau khi hoàn thành.`,
            timestamp: new Date(),
          },
        ]);
      }
    } catch (err: any) {
      console.error(err);
      if (savedIndices.size > 0) {
        // [T-S122] Đã có dòng lưu thành công trước khi lỗi — loại các dòng
        // đó khỏi `msg.parsedData`, chỉ giữ lại dòng lỗi + các dòng chưa
        // kịp thử, kèm reindex `goalCompletionSelections`/`goalDraftOpenKey`
        // giống hệt logic ở `handleDeleteItem` (T-S20/T-S121) để không
        // lệch hàng.
        const keptIndices = currentItems
          .map((_, idx) => idx)
          .filter((idx) => !savedIndices.has(idx));
        const oldToNew = new Map(
          keptIndices.map((oldIdx, newIdx) => [oldIdx, newIdx]),
        );
        const remainingItems = keptIndices.map((idx) => currentItems[idx]);

        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== msgId) return m;
            const newSelections: Record<number, string> = {};
            Object.entries(m.goalCompletionSelections || {}).forEach(
              ([key, val]) => {
                const newIdx = oldToNew.get(Number(key));
                if (newIdx !== undefined) newSelections[newIdx] = val;
              },
            );
            return {
              ...m,
              parsedData: remainingItems,
              goalCompletionSelections: newSelections,
            };
          }),
        );
        if (goalDraftOpenKey) {
          const sep = goalDraftOpenKey.lastIndexOf(":");
          if (goalDraftOpenKey.slice(0, sep) === msgId) {
            const oldIdx = Number(goalDraftOpenKey.slice(sep + 1));
            const newIdx = oldToNew.get(oldIdx);
            if (newIdx !== undefined) {
              setGoalDraftOpenKey(`${msgId}:${newIdx}`);
            } else {
              setGoalDraftOpenKey(null);
              setGoalDraftName("");
              setGoalDraftError(null);
            }
          }
        }
        setMessages((prev) => [
          ...prev,
          {
            id: `bot-err-${Date.now()}`,
            sender: "bot",
            text: `⚠️ Đã lưu thành công ${savedIndices.size}/${currentItems.length} khoản trước khi gặp lỗi (${
              err.message || "lỗi không xác định"
            }). Các khoản đã lưu đã được loại khỏi danh sách bên trên — chỉ còn khoản chưa lưu, bấm "Xác nhận ghi sổ" lại để thử tiếp, không bị ghi đúp.`,
            timestamp: new Date(),
          },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            id: `bot-err-${Date.now()}`,
            sender: "bot",
            text: `⚠️ Lưu sổ thất bại: ${err.message || "Lỗi không xác định"}. Bạn thử xác nhận lại nhé.`,
            timestamp: new Date(),
          },
        ]);
      }
    } finally {
      setSavingMsgId(null);
    }
  };

  const handleApplySuggestion = (suggestion: string) => {
    handleSendText(suggestion);
  };

  return (
    <>
      {/* Floating Chat Bubble Button */}
      <div className="fixed bottom-16 md:bottom-6 right-4 md:right-8 z-50 flex flex-col items-end">
        {/* Pulsing Onboarding Tooltip above bubble */}
        {showTooltip && !isOpen && (
          <div
            onClick={handleToggleChat}
            className="mb-3.5 mr-1 bg-gradient-to-r from-indigo-600 to-indigo-700 text-white rounded-2xl px-4 py-2.5 shadow-xl text-xs font-semibold flex items-center gap-2 max-w-[270px] animate-bounce cursor-pointer relative"
          >
            <Sparkles className="w-4 h-4 text-amber-300 animate-pulse shrink-0" />
            <div className="leading-tight">
              Nhập chi tiêu bằng AI siêu tốc tại đây! 👇
            </div>
            <button
              onClick={handleDismissTooltip}
              aria-label="Đóng gợi ý"
              className="p-1 hover:bg-(--sst-surface)/20 rounded text-white/80 hover:text-white transition-all ml-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            >
              <X className="w-3.5 h-3.5" />
            </button>
            {/* Tooltip Arrow */}
            <div className="absolute bottom-[-6px] right-6 w-3 h-3 bg-indigo-700 rotate-45 transform"></div>
          </div>
        )}

        {/* The Action Button */}
        <button
          onClick={handleToggleChat}
          className={`w-14 h-14 rounded-full flex items-center justify-center shadow-xl border cursor-pointer transition-all duration-300 relative focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
            isOpen
              ? "bg-slate-800 border-slate-700 text-white hover:bg-slate-700"
              : "bg-indigo-600 border-indigo-500 text-white hover:bg-indigo-700 hover:scale-105 active:scale-95"
          }`}
          id="ai-floating-assistant-bubble"
          title="Nhập chi tiêu siêu tốc bằng trợ lý AI"
          aria-label="Nhập chi tiêu siêu tốc bằng trợ lý AI"
        >
          {isOpen ? (
            <X className="w-6 h-6 animate-spin-slow" />
          ) : (
            <>
              <Bot className="w-7 h-7" />
              {/* Pulsing indicator light */}
              <span className="absolute top-0 right-0 w-3.5 h-3.5 bg-green-500 border-2 border-white rounded-full animate-pulse"></span>
            </>
          )}
        </button>
      </div>

      {/* Expandable Chatbot Window */}
      {isOpen && (
        <div
          className="fixed bottom-20 md:bottom-[76px] right-4 md:right-8 z-50 w-full max-w-[380px] sm:max-w-[420px] h-[520px] bg-(--sst-surface-2) rounded-3xl border border-(--sst-border) shadow-2xl flex flex-col overflow-hidden animate-scale-up"
          id="ai-chatbot-window"
        >
          {/* Header */}
          <div className="bg-(--sst-surface) border-b border-(--sst-border) px-4 py-3.5 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-600 flex items-center justify-center text-white shadow-md shadow-indigo-100">
                <Sparkles className="w-5.5 h-5.5 text-white" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-(--sst-text) flex items-center gap-1">
                  Trợ Lý Smart Spend AI
                  <span className="inline-block w-2 h-2 rounded-full bg-green-500"></span>
                </h3>
                <p className="text-[10px] text-(--sst-text-muted) font-medium">
                  Bản lĩnh bóc tách ngôn ngữ tự nhiên • Gemini AI
                </p>
              </div>
            </div>
            <button
              onClick={handleToggleChat}
              aria-label="Đóng cửa sổ trợ lý AI"
              title="Đóng cửa sổ trợ lý AI"
              className="p-1.5 hover:bg-(--sst-surface-2) rounded-xl text-(--sst-text-muted) hover:text-(--sst-text) transition-all cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Messages Area */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 no-scrollbar">
            {messages.map((msg) => {
              const isBot = msg.sender === "bot";
              return (
                <div
                  key={msg.id}
                  className={`flex gap-2.5 ${isBot ? "justify-start" : "justify-end"}`}
                >
                  {isBot && (
                    <div className="w-8 h-8 rounded-xl bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-100/60 dark:border-indigo-500/25 flex items-center justify-center shrink-0">
                      <Bot className="w-4.5 h-4.5 text-indigo-500 dark:text-indigo-400" />
                    </div>
                  )}

                  <div className="max-w-[85%] space-y-2">
                    {/* Standard Text Box */}
                    <div
                      className={`p-3 rounded-2xl text-xs leading-relaxed border ${
                        isBot
                          ? "bg-(--sst-surface) text-(--sst-text) border-(--sst-border) shadow-xs rounded-tl-none"
                          : "bg-indigo-600 text-white border-indigo-500 shadow-md shadow-indigo-100/30 rounded-tr-none"
                      }`}
                    >
                      {/* [T-S120] Markdown mini an toàn — xem renderInlineMarkdown
                          phía trên, không còn dangerouslySetInnerHTML. */}
                      <p className="whitespace-pre-wrap">
                        {msg.text.split("\n").map((line, i) => (
                          <span key={i} className="block">
                            {renderInlineMarkdown(line)}
                          </span>
                        ))}
                      </p>
                    </div>

                    {/* If this message contains interactive parsing result */}
                    {msg.isParsingResult && msg.parsedData && (
                      <div className="space-y-2.5">
                        {msg.parsedData.map((item, index) => {
                          // [T-S49 10/08/2026 — thay thế T-S47] `isSavingsSuggested`
                          // giờ nhận thêm `goals`, chỉ còn khớp TÊN goal active
                          // (không còn khớp tên category/từ khoá tự do). Không
                          // còn khái niệm "khoá nút" đi kèm — thuần gợi ý mềm.
                          // [BUGFIX 11/08/2026] Truyền thêm `categoryId` +
                          // `linkedCategoryIds` — category đang liên kết goal
                          // (§1.13) luôn trả về false.
                          const itemCategoryId =
                            categories.find((c) => c.name === item.category)
                              ?.id ?? null;
                          const isSavingsCategory = isSavingsSuggested(
                            {
                              category: item.category,
                              categoryId: itemCategoryId,
                              description: item.description,
                              note: item.note,
                              goalId: item.goalId,
                            },
                            goals,
                            linkedCategoryIds,
                          );
                          const matchedContributionGoals =
                            findMatchingActiveGoalsByName(
                              {
                                description: item.description,
                                note: item.note,
                              },
                              goals,
                            );
                          const availableGoalsForRow = [
                            ...goals.filter((g) => !g.completedAt),
                            ...createdGoalsCache.filter(
                              (cg) => !goals.some((g) => g.id === cg.id),
                            ),
                          ];
                          const draftKey = `${msg.id}:${index}`;

                          // T-S06e1c (CONSTITUTION §1.4): category AI trả về (vd
                          // fallback "Khác") có thể không khớp category thật nào
                          // của user — không để <select> tự fallback im lặng.
                          const categoryMatched = categories.some(
                            (c) => c.name === item.category,
                          );

                          return (
                            <div
                              key={index}
                              className="bg-(--sst-surface) rounded-2xl p-3 border border-indigo-100 dark:border-indigo-500/25 shadow-md space-y-2.5 relative hover:border-indigo-300 dark:hover:border-indigo-500/40 transition-all animate-scale-up"
                            >
                              {/* Inputs fields - Compact layout */}
                              <div className="grid grid-cols-12 gap-1.5">
                                <div className="col-span-7">
                                  <label className="block text-[8px] font-bold text-(--sst-text-muted) uppercase tracking-wide">
                                    Mặt hàng / Chi tiết
                                  </label>
                                  <input
                                    type="text"
                                    className="w-full text-xs font-semibold text-(--sst-text) bg-(--sst-surface-2) focus:bg-(--sst-surface) border border-(--sst-border-strong) focus:border-indigo-400 rounded-lg px-2 py-1 outline-none transition-all"
                                    value={item.description}
                                    onChange={(e) =>
                                      handleUpdateItem(
                                        msg.id,
                                        index,
                                        "description",
                                        e.target.value,
                                      )
                                    }
                                  />
                                </div>
                                <div className="col-span-5">
                                  <label className="block text-[8px] font-bold text-(--sst-text-muted) uppercase tracking-wide">
                                    Số tiền (VNĐ)
                                  </label>
                                  <input
                                    type="number"
                                    className="w-full text-xs font-bold text-indigo-600 dark:text-indigo-400 bg-(--sst-surface-2) focus:bg-(--sst-surface) border border-(--sst-border-strong) focus:border-indigo-400 rounded-lg px-2 py-1 outline-none transition-all"
                                    value={item.amount}
                                    onChange={(e) =>
                                      handleUpdateItem(
                                        msg.id,
                                        index,
                                        "amount",
                                        Number(e.target.value),
                                      )
                                    }
                                  />
                                </div>
                              </div>

                              <div className="grid grid-cols-12 gap-1.5">
                                <div className="col-span-7">
                                  <label className="block text-[8px] font-bold text-(--sst-text-muted) uppercase tracking-wide">
                                    Phân loại danh mục
                                  </label>
                                  {/* T-S06e1b: "Thu nhập" không còn là 1 lựa chọn ảo hard-code —
                                      categories.type (DB thật) quyết định 1 category là thu hay
                                      chi (xem resolveTransactionType, toTransactionInsert.ts).
                                      Cùng pattern optgroup đã áp ở SmartInput.tsx. */}
                                  <select
                                    className={`w-full text-[11px] font-medium bg-(--sst-surface-2) focus:bg-(--sst-surface) border rounded-lg px-2 py-1 outline-none cursor-pointer ${
                                      categoryMatched
                                        ? "text-(--sst-text) border-(--sst-border-strong) focus:border-indigo-400"
                                        : "text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-500/40 focus:border-amber-500"
                                    }`}
                                    value={item.category}
                                    onChange={(e) =>
                                      handleUpdateItem(
                                        msg.id,
                                        index,
                                        "category",
                                        e.target.value,
                                      )
                                    }
                                  >
                                    {/* T-S06e1c (CONSTITUTION §1.4): xem SmartInput.tsx —
                                        cảnh báo tường minh thay vì fallback im lặng. */}
                                    {!categoryMatched && (
                                      <option value={item.category}>
                                        ⚠️ "{item.category}" — chưa có danh mục
                                        này
                                      </option>
                                    )}
                                    <optgroup label="💵 Thu nhập">
                                      {categories
                                        .filter((c) => c.type === "income")
                                        .map((c) => (
                                          <option key={c.id} value={c.name}>
                                            {c.icon} {c.name}
                                          </option>
                                        ))}
                                    </optgroup>
                                    <optgroup label="🧾 Chi tiêu">
                                      {categories
                                        .filter((c) => c.type !== "income")
                                        .map((c) => (
                                          <option key={c.id} value={c.name}>
                                            {c.icon} {c.name}
                                          </option>
                                        ))}
                                    </optgroup>
                                  </select>
                                  {!categoryMatched && (
                                    <p className="text-[9px] text-amber-600 dark:text-amber-400 font-medium mt-0.5">
                                      Vui lòng chọn danh mục có sẵn.
                                    </p>
                                  )}
                                </div>
                                <div className="col-span-5">
                                  <label className="block text-[8px] font-bold text-(--sst-text-muted) uppercase tracking-wide">
                                    Thành viên
                                  </label>
                                  {/* T-S06e1 / CONSTITUTION §1.2: khoá = người đang đăng nhập ở hộ
                                      gia đình (tên thật, không phải email); ẩn hẳn ở cá nhân. */}
                                  {scopeMode === "household" ? (
                                    <div className="w-full text-[11px] text-(--sst-text-secondary) bg-(--sst-surface-2) border border-(--sst-border-strong) rounded-lg px-1.5 py-1 truncate">
                                      👤{" "}
                                      {currentMember
                                        ? formatMemberDisplayName(currentMember)
                                        : "Bạn"}
                                    </div>
                                  ) : (
                                    <div className="w-full text-[11px] text-(--sst-text-muted) bg-(--sst-surface-2) border border-(--sst-border) rounded-lg px-1.5 py-1">
                                      -- Cá nhân --
                                    </div>
                                  )}
                                </div>
                              </div>

                              {/* [T-S49] Banner MỀM "Gắn vào mục tiêu" — không
                                  còn khoá gì, không còn khớp theo tên category.
                                  Kèm nút "+ Tạo mục tiêu mới" (cùng pattern
                                  SmartInput.tsx). */}
                              {isSavingsCategory && (
                                <div className="border p-2 rounded-lg text-[10px] space-y-1.5 bg-amber-50/70 dark:bg-amber-500/10 border-amber-100 dark:border-amber-500/25">
                                  <span className="font-semibold flex items-center gap-1 text-amber-800 dark:text-amber-300">
                                    <PiggyBank className="w-3 h-3 text-amber-500 dark:text-amber-400" />
                                    {!item.goalId &&
                                    matchedContributionGoals.length > 0
                                      ? `Có vẻ khớp mục tiêu "${matchedContributionGoals[0].name}" — gắn vào?`
                                      : !item.goalId
                                        ? "Có vẻ liên quan tiết kiệm/góp quỹ — gắn vào có sẵn hoặc tạo mới?"
                                        : "Gắn vào mục tiêu tiết kiệm (không bắt buộc):"}
                                  </span>
                                  <select
                                    className="w-full bg-(--sst-surface) border border-amber-200 dark:border-amber-500/30 rounded text-amber-900 dark:text-amber-200 px-1 py-0.5 outline-none text-[10px] cursor-pointer"
                                    value={item.goalId || ""}
                                    onChange={(e) =>
                                      handleUpdateItem(
                                        msg.id,
                                        index,
                                        "goalId",
                                        e.target.value || undefined,
                                      )
                                    }
                                  >
                                    <option value="">
                                      -- Không liên kết tích lũy --
                                    </option>
                                    {item.goalId &&
                                      item.goalId.startsWith("new_goal_") && (
                                        <option value={item.goalId}>
                                          ✨ Tạo mới: "
                                          {item.goalId.replace("new_goal_", "")}
                                          "
                                        </option>
                                      )}
                                    {availableGoalsForRow.map((g) => (
                                      <option key={g.id} value={g.id}>
                                        🎯 {g.name}
                                      </option>
                                    ))}
                                  </select>
                                  {goalDraftOpenKey === draftKey ? (
                                    <div className="flex items-center gap-1 pt-1 border-t border-amber-100 dark:border-amber-500/25">
                                      <input
                                        type="text"
                                        className="flex-1 bg-(--sst-surface) border border-amber-200 dark:border-amber-500/30 rounded px-1.5 py-0.5 text-[10px] outline-none"
                                        placeholder="Tên mục tiêu mới..."
                                        value={goalDraftName}
                                        onChange={(e) =>
                                          setGoalDraftName(e.target.value)
                                        }
                                        disabled={isCreatingGoal}
                                        autoFocus
                                      />
                                      <button
                                        type="button"
                                        className="px-2 py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded text-[10px] font-semibold cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                                        disabled={
                                          isCreatingGoal ||
                                          !goalDraftName.trim()
                                        }
                                        onClick={() =>
                                          handleCreateGoalInline(msg.id, index)
                                        }
                                      >
                                        {isCreatingGoal ? "..." : "Tạo"}
                                      </button>
                                      <button
                                        type="button"
                                        className="px-2 py-2.5 bg-(--sst-surface) hover:bg-amber-100 dark:hover:bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-500/30 rounded text-[10px] cursor-pointer"
                                        onClick={() => {
                                          setGoalDraftOpenKey(null);
                                          setGoalDraftName("");
                                          setGoalDraftError(null);
                                        }}
                                      >
                                        Huỷ
                                      </button>
                                    </div>
                                  ) : (
                                    <button
                                      type="button"
                                      className="text-amber-700 dark:text-amber-300 hover:text-amber-900 dark:hover:text-amber-200 underline font-medium cursor-pointer"
                                      onClick={() => {
                                        setGoalDraftOpenKey(draftKey);
                                        setGoalDraftName("");
                                        setGoalDraftError(null);
                                      }}
                                    >
                                      + Tạo mục tiêu mới
                                    </button>
                                  )}
                                  {goalDraftOpenKey === draftKey &&
                                    goalDraftError && (
                                      <p className="text-rose-600 dark:text-rose-400 font-medium">
                                        {goalDraftError}
                                      </p>
                                    )}
                                </div>
                              )}

                              {/* T-S20 — Goal completion detection banner, xem giải
                                  thích đầy đủ ở SmartInput.tsx (cùng logic, T-S59). */}
                              {(() => {
                                if (item.goalId) return null;
                                const matchedCategoryObj = categories.find(
                                  (c) => c.name === item.category,
                                );
                                if (matchedCategoryObj?.type === "income")
                                  return null;
                                const matchedActiveGoals =
                                  findMatchingActiveGoals(item.description);
                                if (matchedActiveGoals.length === 0)
                                  return null;

                                const choice = (msg.goalCompletionSelections ||
                                  {})[index];
                                const isDismissed = choice === "";
                                const confirmedGoal = choice
                                  ? matchedActiveGoals.find(
                                      (g) => g.id === choice,
                                    )
                                  : undefined;

                                if (isDismissed) {
                                  return (
                                    <button
                                      type="button"
                                      className="text-[9px] text-(--sst-text-muted) hover:text-teal-600 dark:hover:text-teal-400 underline cursor-pointer"
                                      onClick={() =>
                                        handleSetGoalCompletion(
                                          msg.id,
                                          index,
                                          undefined,
                                        )
                                      }
                                    >
                                      Đã bỏ qua gợi ý hoàn thành mục tiêu — hoàn
                                      tác?
                                    </button>
                                  );
                                }

                                return (
                                  <div className="bg-teal-50/70 dark:bg-teal-500/10 border border-teal-100 dark:border-teal-500/25 p-2 rounded-lg text-[10px] space-y-1">
                                    <span className="text-teal-800 dark:text-teal-300 font-semibold flex items-start gap-1">
                                      <PiggyBank className="w-3 h-3 text-teal-500 dark:text-teal-400 mt-0.5 shrink-0" />
                                      {confirmedGoal ? (
                                        <span>
                                          ✅ Sẽ đánh dấu hoàn thành "
                                          {confirmedGoal.name}" khi lưu.
                                        </span>
                                      ) : matchedActiveGoals.length === 1 ? (
                                        <span>
                                          Có vẻ là mua sắm cho mục tiêu "
                                          {matchedActiveGoals[0].name}" — đánh
                                          dấu hoàn thành?
                                        </span>
                                      ) : (
                                        <span>
                                          Khớp nhiều mục tiêu tiết kiệm — chọn 1
                                          để đánh dấu hoàn thành:
                                        </span>
                                      )}
                                    </span>
                                    {confirmedGoal ? (
                                      <button
                                        type="button"
                                        className="px-2 py-2.5 bg-(--sst-surface) hover:bg-teal-100 dark:hover:bg-teal-500/15 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-500/30 rounded text-[10px] font-medium cursor-pointer"
                                        onClick={() =>
                                          handleSetGoalCompletion(
                                            msg.id,
                                            index,
                                            undefined,
                                          )
                                        }
                                      >
                                        Đổi ý
                                      </button>
                                    ) : matchedActiveGoals.length === 1 ? (
                                      <div className="flex gap-1.5">
                                        <button
                                          type="button"
                                          className="px-2 py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded text-[10px] font-semibold cursor-pointer"
                                          onClick={() =>
                                            handleSetGoalCompletion(
                                              msg.id,
                                              index,
                                              matchedActiveGoals[0].id,
                                            )
                                          }
                                        >
                                          Đánh dấu hoàn thành
                                        </button>
                                        <button
                                          type="button"
                                          className="px-2 py-2.5 bg-(--sst-surface) hover:bg-teal-100 dark:hover:bg-teal-500/15 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-500/30 rounded text-[10px] font-medium cursor-pointer"
                                          onClick={() =>
                                            handleSetGoalCompletion(
                                              msg.id,
                                              index,
                                              "",
                                            )
                                          }
                                        >
                                          Bỏ qua
                                        </button>
                                      </div>
                                    ) : (
                                      <select
                                        className="w-full bg-(--sst-surface) border border-teal-200 dark:border-teal-500/30 rounded text-teal-900 dark:text-teal-200 px-1 py-0.5 outline-none text-[10px] cursor-pointer"
                                        value={choice || ""}
                                        onChange={(e) =>
                                          handleSetGoalCompletion(
                                            msg.id,
                                            index,
                                            e.target.value || "",
                                          )
                                        }
                                      >
                                        <option value="">-- Bỏ qua --</option>
                                        {matchedActiveGoals.map((g) => (
                                          <option key={g.id} value={g.id}>
                                            🎯 {g.name}
                                          </option>
                                        ))}
                                      </select>
                                    )}
                                  </div>
                                );
                              })()}

                              {/* Note/Date expandable block */}
                              <div className="grid grid-cols-12 gap-1.5 pt-1.5 border-t border-(--sst-border)">
                                <div className="col-span-5">
                                  <input
                                    type="date"
                                    className="w-full text-[10px] text-(--sst-text-secondary) bg-(--sst-surface-2) focus:bg-(--sst-surface) border border-(--sst-border) focus:border-indigo-400 rounded-md px-1.5 py-0.5 outline-none"
                                    value={item.date}
                                    onChange={(e) =>
                                      handleUpdateItem(
                                        msg.id,
                                        index,
                                        "date",
                                        e.target.value,
                                      )
                                    }
                                  />
                                </div>
                                <div className="col-span-7">
                                  <input
                                    type="text"
                                    className="w-full text-[10px] text-(--sst-text-secondary) bg-(--sst-surface-2) focus:bg-(--sst-surface) border border-(--sst-border) focus:border-indigo-400 rounded-md px-1.5 py-0.5 outline-none"
                                    value={item.note || ""}
                                    onChange={(e) =>
                                      handleUpdateItem(
                                        msg.id,
                                        index,
                                        "note",
                                        e.target.value,
                                      )
                                    }
                                    placeholder="Ghi chú thêm..."
                                  />
                                </div>
                              </div>

                              {/* Mini remove button */}
                              <button
                                onClick={() => handleDeleteItem(msg.id, index)}
                                className="absolute top-2 right-2 p-1 text-(--sst-text-faint) hover:text-red-500 dark:hover:text-red-400 hover:bg-(--sst-surface-2) rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
                                title="Xóa dòng này"
                                aria-label="Xóa dòng này"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          );
                        })}

                        {/* [BUGFIX T-S22] Chặn nút xác nhận ở tầng UI, cùng lúc với chặn
                            ở handleConfirmItems (phòng gọi hàm từ nơi khác sau này). */}
                        {(() => {
                          const hasUnmatchedInMsg = msg.parsedData!.some(
                            (item) =>
                              !categories.some((c) => c.name === item.category),
                          );
                          return (
                            <div className="flex gap-2 justify-end items-center pt-1 flex-wrap">
                              {hasUnmatchedInMsg && (
                                <span className="text-[10px] text-amber-600 dark:text-amber-400 font-medium mr-auto">
                                  ⚠️ Còn dòng chưa chọn danh mục hợp lệ
                                </span>
                              )}
                              <button
                                onClick={() => handleCancelItems(msg.id)}
                                className="px-3 py-1.5 bg-(--sst-surface-2) hover:bg-(--sst-surface-hover) text-(--sst-text-secondary) rounded-xl text-[10px] font-bold transition-all cursor-pointer"
                              >
                                Hủy bỏ
                              </button>
                              <button
                                onClick={() =>
                                  handleConfirmItems(
                                    msg.id,
                                    msg.parsedData!,
                                    msg.goalCompletionSelections || {},
                                  )
                                }
                                disabled={
                                  savingMsgId === msg.id || hasUnmatchedInMsg
                                }
                                title={
                                  hasUnmatchedInMsg
                                    ? "Còn dòng chưa chọn danh mục hợp lệ"
                                    : undefined
                                }
                                className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-[10px] shadow-sm transition-all flex items-center gap-1 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                              >
                                <Check className="w-3 h-3" />
                                {savingMsgId === msg.id
                                  ? "Đang lưu..."
                                  : "Xác nhận ghi sổ"}
                              </button>
                            </div>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Typing indicator bot */}
            {isLoading && (
              <div className="flex gap-2.5 justify-start">
                <div className="w-8 h-8 rounded-xl bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-100/60 dark:border-indigo-500/25 flex items-center justify-center shrink-0">
                  <Bot className="w-4.5 h-4.5 text-indigo-500 dark:text-indigo-400" />
                </div>
                <div className="bg-(--sst-surface) border border-(--sst-border) p-3 rounded-2xl rounded-tl-none shadow-xs text-xs flex items-center gap-1.5 text-(--sst-text-muted)">
                  <div className="flex space-x-1">
                    <span
                      className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce"
                      style={{ animationDelay: "0ms" }}
                    ></span>
                    <span
                      className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce"
                      style={{ animationDelay: "150ms" }}
                    ></span>
                    <span
                      className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce"
                      style={{ animationDelay: "300ms" }}
                    ></span>
                  </div>
                  <span>AI đang bóc tách ngôn ngữ...</span>
                </div>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          {/* Prompt suggestions (if no parsing is currently active) */}
          {!isLoading && (
            <div className="bg-(--sst-surface) border-t border-(--sst-border) px-4 py-2 shrink-0">
              <span className="text-[9px] font-bold text-(--sst-text-muted) uppercase tracking-wider block mb-1">
                💡 Gợi ý nhập nhanh:
              </span>
              <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1">
                {sampleSuggestions.map((s, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleApplySuggestion(s)}
                    className="text-[10px] px-2.5 py-1 bg-(--sst-surface-2) hover:bg-indigo-50 dark:hover:bg-indigo-500/10 text-(--sst-text-secondary) hover:text-indigo-600 dark:hover:text-indigo-300 font-medium rounded-lg border border-(--sst-border-strong)/60 transition-all cursor-pointer whitespace-nowrap shrink-0"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Chat Input form */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSendText(inputText);
            }}
            className="bg-(--sst-surface) border-t border-(--sst-border) p-3 flex gap-2 items-center shrink-0"
          >
            <input
              type="text"
              placeholder="Nhập chi tiêu tự do... (Ví dụ: 'ăn sáng 35k')"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              disabled={isLoading}
              className="flex-1 bg-(--sst-surface-2) hover:bg-(--sst-surface-hover) focus:bg-(--sst-surface) border border-(--sst-border-strong) focus:border-indigo-400 rounded-xl px-3.5 py-2 text-xs outline-none transition-all placeholder:text-(--sst-text-muted)"
              autoFocus
            />
            <button
              type="submit"
              disabled={isLoading || !inputText.trim()}
              aria-label="Gửi tin nhắn"
              title="Gửi tin nhắn"
              className="p-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-(--sst-surface-2) text-white disabled:text-(--sst-text-faint) rounded-xl transition-all cursor-pointer flex items-center justify-center shrink-0 shadow-sm disabled:shadow-none focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      )}
    </>
  );
}
