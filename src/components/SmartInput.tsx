import { useState, useMemo } from "react";
import { Sparkles, CornerDownLeft, AlertCircle, AlertTriangle, Edit2, Check, Trash2, HelpCircle, User, PiggyBank, FileText, Send } from "lucide-react";
import { Transaction } from "../types";
import { useScope } from "../context/ScopeContext";
import { useCurrentUserId } from "../hooks/useCurrentUserId";
import { useHousehold, useCurrentMember, formatMemberDisplayName } from "../hooks/useHousehold";
import { useCreateTransaction, useTransactions } from "../hooks/useTransactions";
import { useCategories } from "../hooks/useCategories";
import { useCreateGoal, useGoals, useCompleteGoalCascade } from "../hooks/useGoals";
import { rowToCategory, rowToGoal } from "../lib/mapRows";
import { goalManualAvailable, goalFrozenLinkedAvailable, GoalSpendLike, isGoalFullyFundedForCompletionBanner } from "../lib/goalAvailability";
import { buildTransactionInsert, buildTransactionInserts, isNewGoalToken, extractNewGoalName } from "../lib/toTransactionInsert";
import { isSavingsSuggested, findMatchingActiveGoalsByName } from "../lib/savingsDetect";
import { callParseTransaction } from "../lib/parseTransaction";

// T-S06e1 (fix): trước đây nhận categories/goals qua props từ App.tsx —
// nhưng App.tsx truyền state legacy (DEFAULT_CATEGORIES id dạng "cat_1",
// không phải uuid thật) nên insert luôn báo "invalid input syntax for
// type uuid". Theo đúng CONSTITUTION §1.1 ("gọi hook tại nơi dùng, không
// prop-drill"), component tự gọi useCategories/useGoals — giống pattern
// đã áp cho TransactionHistory/SavingGoals.
export default function SmartInput() {
  const { scopeMode } = useScope();
  const userId = useCurrentUserId();
  const { data: household } = useHousehold();
  const currentMember = useCurrentMember();
  const createTransaction = useCreateTransaction();
  const createGoal = useCreateGoal();
  const completeGoal = useCompleteGoalCascade();
  const { data: categoryRows = [] } = useCategories();
  // [T-S67 patch] Cần transactions thô để tính số dư "thủ công" còn rút
  // được của goal trước khi banner tự động đóng goal — xem `goalAvailability.ts`.
  // Chỉ lấy field goal_id/type/amount, KHÔNG cần map tên category/member
  // nên không gọi `useHouseholdMembers`/`rowsToTransactions` (tránh query
  // thừa, đúng phạm vi hẹp đã ghi ở CHANGELOG T-S67).
  const { data: transactionRows = [] } = useTransactions();
  const goalSpendRows: GoalSpendLike[] = useMemo(
    () => transactionRows.map((t) => ({ goalId: t.goal_id, type: t.type, amount: t.amount })),
    [transactionRows]
  );
  // [T-S48 amendment 10/08/2026] Loại goal đã liên kết danh mục ngân sách
  // (`linkedCategoryId`) khỏi mọi nơi dùng `goals` trong file này (dropdown
  // "Gắn vào", khớp tên mô tả) — cùng pattern đã đúng ở `TransactionHistory.tsx`
  // từ T-S48. Goal liên kết KHÔNG nhận góp quỹ thủ công qua `type='transfer'`,
  // `current_amount` của nó luôn tự tính từ giao dịch category, chọn thủ công
  // ở đây trước đây gây cộng dồn sai lệch song song với số tự tính.
  const { data: goalRows = [] } = useGoals();
  const categories = useMemo(() => categoryRows.map(rowToCategory), [categoryRows]);
  const goals = useMemo(
    () => goalRows.map(rowToGoal).filter((g) => !g.linkedCategoryId),
    [goalRows]
  );
  // [BUGFIX 11/08/2026, CONSTITUTION §1.14 mục 1, xem savingsDetect.ts] Set
  // category id đang bị 1 goal nào đó liên kết (§1.13) — tính từ TOÀN BỘ
  // `goalRows` CHƯA lọc (khác `goals` ở trên). Truyền vào `isSavingsSuggested`
  // để loại trừ banner T-S49 khi category của dòng đang chọn là category
  // liên kết, đúng nguyên văn CHỐT §1.13/§1.14.
  const linkedCategoryIds = useMemo(
    () =>
      new Set(
        goalRows
          .map(rowToGoal)
          .map((g) => g.linkedCategoryId)
          .filter((id): id is string => !!id)
      ),
    [goalRows]
  );

  const [inputText, setInputText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // [T-S74] Cảnh báo MỀM (không chặn lưu) khi giao dịch "hoàn thành mục
  // tiêu" vượt số dư thủ công còn lại — khác `error` (đỏ, chặn cứng dùng
  // cho `hasUnmatchedCategory`). Xem CHANGELOG "T-S74" để biết lý do tách
  // khỏi validate T-S66/T-S67b cũ (đã bỏ chặn cứng ở đây).
  const [completionWarning, setCompletionWarning] = useState<string | null>(null);
  const [parsedItems, setParsedItems] = useState<Omit<Transaction, "id" | "createdAt">[]>([]);
  const [isReviewMode, setIsReviewMode] = useState(false);
  // T-S20 (CONSTITUTION §1.9 mục 5-7) — nhận diện tự động "mua sắm cho mục
  // tiêu tiết kiệm" ở giao dịch chi tiêu BÌNH THƯỜNG (không phải góp quỹ).
  // key = index trong parsedItems, value: "" = đã bỏ qua gợi ý (tường minh),
  // goalId thật = người dùng đã bấm "Đánh dấu hoàn thành"/chọn trong dropdown,
  // absent = chưa quyết định (banner vẫn hiện nếu còn goal khớp). KHÔNG bao
  // giờ tự áp dụng khi lưu nếu người dùng chưa tự chọn (§5 — luôn phải qua
  // xác nhận rõ ràng, không suy luận rồi âm thầm đổi trạng thái tài chính).
  const [goalCompletionSelections, setGoalCompletionSelections] = useState<Record<number, string>>({});

  // [BUGFIX T-S22 08/08/2026, CONSTITUTION §1.4 mở rộng] Trước đây "Lưu Vào
  // Sổ Chi Tiêu" không bị chặn dù có dòng category chưa khớp category thật
  // nào (fallback AI "Khác" khi user chưa tạo category tên "Khác") — cảnh
  // báo màu hổ phách chỉ mang tính hiển thị, không ngăn insert. Hậu quả gốc
  // rễ: `resolveTransactionType()` (`toTransactionInsert.ts`) không tìm
  // thấy category → im lặng mặc định `type='expense'`, ghi cứng SAI vĩnh
  // viễn cho giao dịch thu nhập (Update không có field `type`, CONSTITUTION
  // §1.2). Chặn ngay tại đây — trước khi gọi `buildTransactionInserts` — để
  // người dùng BẮT BUỘC chọn 1 category thật (thu hoặc chi đúng ý) trước
  // khi lưu, không để hệ thống tự đoán âm thầm.
  const hasUnmatchedCategory = useMemo(
    () => parsedItems.some((item) => !categories.some((c) => c.name === item.category)),
    [parsedItems, categories]
  );

  // [T-S49 10/08/2026 — thay thế khối hasMissingSavingsGoal cũ (T-S45)]
  // Không còn chặn cứng nữa — banner "Gắn vào mục tiêu" giờ chỉ là gợi ý
  // mềm (xem `isSavingsSuggested` mới, savingsDetect.ts). Thêm state cho
  // form rút gọn "+ Tạo mục tiêu mới" ngay trong banner: `goalDraftOpenIdx`
  // = index dòng đang mở form (chỉ 1 dòng mở tại 1 thời điểm, đơn giản hoá
  // UI), `goalDraftName` = tên đang gõ. `createdGoalsCache` giữ goal vừa
  // tạo xong (id thật) để hiện ngay trong dropdown trước khi `useGoals()`
  // refetch xong (tránh <select> hiện giá trị rỗng trong lúc chờ mạng).
  const [goalDraftOpenIdx, setGoalDraftOpenIdx] = useState<number | null>(null);
  const [goalDraftName, setGoalDraftName] = useState("");
  const [goalDraftError, setGoalDraftError] = useState<string | null>(null);
  const [isCreatingGoal, setIsCreatingGoal] = useState(false);
  const [createdGoalsCache, setCreatedGoalsCache] = useState<
    { id: string; name: string; currentAmount: number }[]
  >([]);

  const sampleSuggestions = [
    "cá 35k, rau 25k, thịt lợn 45k",
    "uống cà phê hết 29k",
    "đổ xăng xe máy 50 nghìn",
    "mua váy mới 350k, giày búp bê 220k",
    "tiền điện nước tháng này 1.2tr",
    "mua sách tiếng Anh 150 ngàn",
  ];

  const getMappedCategory = (rawCat: string): string => {
    const norm = (rawCat || "").trim().toLowerCase();
    
    // 1. If raw category is already an exact match, use it
    const exactMatch = categories.find((c) => c.name.trim().toLowerCase() === norm);
    if (exactMatch) return exactMatch.name;

    // 2. If it's related to savings/saving/accumulation (tiết kiệm, tích luỹ)
    if (norm.includes("tiết kiệm") || norm.includes("tích lũy") || norm.includes("tích luỹ")) {
      const savingsCat = categories.find((c) => 
        c.name.toLowerCase().includes("tích lũy") || 
        c.name.toLowerCase().includes("tích luỹ") || 
        c.name.toLowerCase().includes("tiết kiệm")
      );
      if (savingsCat) return savingsCat.name;
      const fallbackSavings = categories.find((c) => c.name.toLowerCase().includes("tích") || c.name.toLowerCase().includes("tiết"));
      if (fallbackSavings) return fallbackSavings.name;
    }

    // 3. General partial match
    const partialMatch = categories.find((c) => norm.includes(c.name.toLowerCase()) || c.name.toLowerCase().includes(norm));
    if (partialMatch) return partialMatch.name;

    return "Khác";
  };

  // [BUGFIX 11/08/2026, CONSTITUTION §1.14/§5 — bug thật người dùng phát
  // hiện qua test tay] Hàm `assignSavingGoal` CŨ (thời T-S14/T-S20, trước
  // khi T-S49 chốt lại thiết kế) tự động gán `item.goalId` (goal có sẵn
  // hoặc token "new_goal_<tên>" chờ tạo) NGAY LÚC PARSE, dựa vào cờ
  // `isSavingsContribution`/`savingsGoalName` do backend (`server.ts`) tự
  // suy luận qua khớp từ khoá trong câu nhập — tức là chọn/tạo goal hộ
  // người dùng mà KHÔNG qua bất kỳ cú bấm xác nhận nào, vi phạm thẳng
  // CONSTITUTION §5 ("Tự động chọn hộ 1 goal cụ thể... người dùng luôn
  // phải tự chọn"). Đây chính là gốc rễ bug: người dùng đổi category sang
  // 1 category ĐÃ LIÊN KẾT goal khác (§1.13) — banner T-S49 ẩn đúng (vì
  // `isSavingsSuggested` đã loại trừ category liên kết), nhưng `goalId` đã
  // bị gán sẵn từ bước parse vẫn còn nguyên trong state, không có UI nào
  // để thấy/gỡ nó (banner ẩn mất) — tới lúc Lưu, `goalId` cũ đó vẫn được
  // dùng để tạo goal mới (token "new_goal_") + ghi `type='transfer'`, dù
  // người dùng chưa từng chạm vào banner/dropdown "Gắn vào".
  //
  // Sửa: bỏ hẳn việc tự gán `goalId` lúc parse — mọi giao dịch parse xong
  // luôn có `goalId: undefined`, đúng tinh thần T-S49 (chỉ gợi ý qua banner
  // `isSavingsSuggested`/`findMatchingActiveGoalsByName`, người dùng phải tự
  // bấm chọn trong dropdown mới có `goalId`). Cờ `isSavingsContribution`/
  // `savingsGoalName` từ backend không còn được đọc ở đây nữa.

  // T-S20 — khớp tên mô tả giao dịch với mục tiêu tiết kiệm ĐANG ACTIVE
  // (`completedAt` chưa set), theo đúng kiểu match 2 chiều `includes()` đã
  // dùng ở `assignSavingGoal` (CONSTITUTION §1.9 mục 5). Chỉ gợi ý — không
  // tự động gán, xem `goalCompletionSelections`.
  // [T-S76, CONSTITUTION §1.22.1 — CHỐT 14/08/2026] Đảo ngược có chủ đích
  // hành vi cũ: thêm điều kiện goal phải đã gom đủ >= 100% mục tiêu mới
  // được gợi ý "Đánh dấu hoàn thành" (trước đây không có ngưỡng, khớp tên
  // là hiện bất kể % đã gom).
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

  const handleParse = async (textToParse: string) => {
    if (!textToParse.trim()) return;
    setIsLoading(true);
    setError(null);
    setCompletionWarning(null); // [T-S74] reset cảnh báo mềm của lượt lưu trước
    setParsedItems([]);
    setGoalCompletionSelections({}); // T-S20 — reset gợi ý hoàn thành mục tiêu cho lần parse mới
    // [T-S121, 20/08/2026 — bugfix] `goalDraftOpenIdx`/`goalDraftName` gắn
    // theo INDEX của batch CŨ — nếu không reset, batch mới (không liên
    // quan) có thể tự mở nhầm form "+ Tạo mục tiêu mới" ở đúng index đó,
    // kèm tên đang gõ dở còn sót từ batch trước. Xem TASKS.md T-S121.
    setGoalDraftOpenIdx(null);
    setGoalDraftName("");
    setGoalDraftError(null);

    try {
      const data = await callParseTransaction(
        textToParse,
        categories.map((c) => c.name)
      );

      if (data.transactions && data.transactions.length > 0) {
        // Assign default date of today (YYYY-MM-DD)
        const today = new Date().toLocaleDateString("en-CA"); // local YYYY-MM-DD
        const formatted = data.transactions.map((t: any) => ({
          description: t.description || "Giao dịch không tên",
          amount: Math.abs(Number(t.amount)) || 0,
          category: getMappedCategory(t.category || "Khác"),
          date: today,
          // [BUGFIX 11/08/2026] Không còn tự gán — xem giải thích ở khối
          // comment thay `assignSavingGoal` phía trên.
          goalId: undefined,
        }));
        setParsedItems(formatted);
        setIsReviewMode(true);
      } else {
        setError("Không nhận diện được giao dịch nào. Bạn vui lòng viết rõ hơn (ví dụ: 'cơm trưa 40k').");
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Đã xảy ra lỗi khi phân tích cú pháp chi tiêu.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleApplySuggestion = (suggestion: string) => {
    setInputText(suggestion);
    handleParse(suggestion);
  };

  const handleUpdateItem = (index: number, key: keyof Omit<Transaction, "id" | "createdAt">, value: any) => {
    const updated = [...parsedItems];
    updated[index] = {
      ...updated[index],
      [key]: value,
    };
    // [BUGFIX 11/08/2026, CONSTITUTION §1.13] Đổi category sang 1 category
    // ĐÃ LIÊN KẾT goal khác (§1.13) → banner "Gắn vào mục tiêu" (T-S49) ẩn
    // đi ngay (đúng thiết kế), nhưng nếu dòng này đang giữ sẵn `goalId` từ
    // trước (đã tự chọn ở category cũ, hoặc còn sót từ lần parse trước) thì
    // phải dọn theo — nếu không, `goalId` cũ sẽ âm thầm lọt qua lúc Lưu dù
    // không còn UI nào hiện ra để người dùng biết/gỡ nó.
    if (key === "category" && updated[index].goalId) {
      const newCategoryId = categories.find((c) => c.name === value)?.id;
      if (newCategoryId && linkedCategoryIds.has(newCategoryId)) {
        updated[index] = { ...updated[index], goalId: undefined };
      }
    }
    setParsedItems(updated);
  };

  // [T-S49] Tạo goal mới ngay tại chỗ (không dùng token "new_goal_" hoãn
  // tạo tới lúc lưu — đây là hành động BẤM RÕ RÀNG của người dùng, tạo
  // ngay lập tức) rồi tự gắn vào dòng đang nhập.
  const handleCreateGoalInline = async (index: number) => {
    const name = goalDraftName.trim();
    if (!name) return;
    setIsCreatingGoal(true);
    setGoalDraftError(null);
    try {
      const created = await createGoal.mutateAsync({
        name,
        created_by: userId as string,
        ...(scopeMode === "household" ? { household_id: household?.id } : { owner_id: userId }),
      });
      setCreatedGoalsCache((prev) => [...prev, { id: created.id, name: created.name, currentAmount: 0 }]);
      handleUpdateItem(index, "goalId", created.id);
      setGoalDraftOpenIdx(null);
      setGoalDraftName("");
    } catch (err: any) {
      setGoalDraftError(err.message || "Không thể tạo mục tiêu mới.");
    } finally {
      setIsCreatingGoal(false);
    }
  };

  const handleDeleteItem = (index: number) => {
    const updated = parsedItems.filter((_, i) => i !== index);
    setParsedItems(updated);
    // T-S20 — reindex goalCompletionSelections theo đúng index mới (xoá dòng
    // giữa mảng làm lệch index của mọi dòng phía sau).
    setGoalCompletionSelections((prev) => {
      const next: Record<number, string> = {};
      Object.entries(prev).forEach(([key, val]) => {
        const i = Number(key);
        if (i === index) return;
        next[i > index ? i - 1 : i] = val;
      });
      return next;
    });
    // [T-S121, 20/08/2026 — bugfix] `goalDraftOpenIdx` cũng phải reindex
    // giống hệt `goalCompletionSelections` ở trên — nếu không, xoá 1 dòng
    // phía TRƯỚC dòng đang mở form "+ Tạo mục tiêu mới" sẽ khiến form tự
    // "nhảy" sang dòng khác (dòng giữ đúng index cũ sau khi mảng dịch lên),
    // kèm `goalDraftName` đang gõ dở còn sót — bấm "Tạo" có thể gắn goal
    // mới vào SAI dòng giao dịch. Xem TASKS.md T-S121.
    if (goalDraftOpenIdx !== null) {
      if (goalDraftOpenIdx === index) {
        // Dòng đang mở form chính là dòng bị xoá — đóng form, dọn sạch input dở.
        setGoalDraftOpenIdx(null);
        setGoalDraftName("");
        setGoalDraftError(null);
      } else if (goalDraftOpenIdx > index) {
        setGoalDraftOpenIdx(goalDraftOpenIdx - 1);
      }
    }
    if (updated.length === 0) {
      setIsReviewMode(false);
    }
  };

  const handleConfirmAll = async () => {
    if (parsedItems.length === 0) return;
    // [BUGFIX T-S22] Chặn cứng ở tầng logic, không chỉ dựa vào `disabled`
    // trên button (phòng trường hợp gọi hàm này từ nơi khác sau này).
    if (hasUnmatchedCategory) {
      setError("Còn dòng chưa chọn danh mục hợp lệ — vui lòng chọn danh mục có sẵn cho tất cả các dòng trước khi lưu.");
      return;
    }
    // [T-S49] Khối chặn "Còn dòng Tiết kiệm chưa gắn mục tiêu" (T-S45) đã bỏ
    // — gắn goal giờ là gợi ý mềm, không còn điều kiện nào để chặn ở đây.
    setIsSaving(true);
    setError(null);
    setCompletionWarning(null);

    // [T-S122, 20/08/2026 — bugfix, xem TASKS.md/CHANGELOG.md] Batch lưu
    // KHÔNG atomic — nếu 1 dòng ở giữa lỗi, các dòng TRƯỚC nó đã ghi thành
    // công thật vào Supabase. `savedIndices` theo dõi CHÍNH XÁC index (theo
    // `parsedItems` gốc lúc bắt đầu hàm này) nào đã lưu xong, để nếu có
    // lỗi, khối `catch` chỉ giữ lại trong state những dòng CHƯA lưu (dòng
    // lỗi + các dòng chưa kịp thử) — bấm lưu lại sẽ không ghi đúp các dòng
    // đã lưu thành công ở lượt trước (phương án "dừng ngay tại dòng lỗi",
    // người dùng đã chọn).
    const savedIndices = new Set<number>();
    // Bản snapshot `parsedItems` có thể được PATCH ngay khi 1 goal mới
    // (token `new_goal_...`) tạo thành công — xem đoạn sau — để nếu lỗi
    // xảy ra SAU đó, phần còn lại giữ trong state đã trỏ tới uuid thật,
    // không tạo trùng goal khi bấm lưu lại.
    let currentItems = parsedItems;

    try {
      const scope = { scopeMode, userId, householdId: household?.id };

      // T-S20 — tách 2 nhóm: (a) dòng người dùng đã TỰ CHỌN đánh dấu hoàn
      // thành 1 mục tiêu tiết kiệm (banner/dropdown gợi ý), (b) mọi dòng
      // còn lại (giao dịch bình thường + góp quỹ, giữ nguyên luồng cũ).
      // Validate lại selection ngay tại đây (không tin state UI cũ) — nếu
      // mô tả đã bị sửa và không còn khớp goal đã chọn, bỏ qua an toàn thay
      // vì lỡ hoàn thành nhầm mục tiêu không còn liên quan (CONSTITUTION §5:
      // không bao giờ tự động đổi trạng thái tài chính khi không chắc chắn).
      const completionEntries: { index: number; goalId: string }[] = [];
      currentItems.forEach((item, index) => {
        const chosen = goalCompletionSelections[index];
        if (!chosen) return;
        const stillMatches = findMatchingActiveGoals(item.description).some((g) => g.id === chosen);
        if (stillMatches) {
          completionEntries.push({ index, goalId: chosen });
        }
      });
      // [T-S74, thay cho chặn cứng T-S67 patch] Giao dịch "hoàn thành mục
      // tiêu" ở đây là 1 khoản CHI TIÊU THẬT đã xảy ra ngoài đời — KHÔNG
      // phải "rút quỹ" từ số dư app đang theo dõi (khác hẳn form Rút quỹ ở
      // SavingGoals.tsx, nơi vẫn giữ nguyên chặn cứng T-S66 vì đúng ngữ
      // cảnh rút từ 1 số dư có thật trong app). Ứng dụng không được từ
      // chối ghi nhận 1 khoản chi thật chỉ vì "không đủ tiền đã để dành" —
      // đó chính là ý nghĩa của badge "Dư/Thiếu" (T-S64b) hiển thị SAU khi
      // hoàn thành. Ở đây chỉ CẢNH BÁO MỀM (không chặn `return`), vẫn lưu
      // giao dịch + đóng goal như bình thường ở khối bên dưới.
      // [T-S77, 15/08/2026] Cảnh báo mềm giờ so với số dư GỘP CẢ 2 NGUỒN
      // (liên kết đã đóng băng + thủ công) — trước T-S77 chỉ so với
      // `goalManualAvailable` (thủ công), gây cảnh báo SAI cho goal có
      // phần liên kết đã đóng băng đủ trang trải (banner cảnh báo "Thiếu"
      // dù thực ra đủ tiền, chỉ lấy từ nguồn khác). Số tiền GHI GIAO DỊCH
      // vẫn có thể khác (chỉ phần dư sau khi trừ liên kết, xem
      // `computeGoalCompletionCascade`) — cảnh báo chỉ nói về TỔNG số dư,
      // không nói về số tiền sẽ ghi vào Sổ Giao Dịch.
      const completionWarnings: string[] = [];
      for (const { index, goalId } of completionEntries) {
        const goal = goals.find((g) => g.id === goalId);
        if (!goal) continue;
        const available = goalManualAvailable(goal, goalSpendRows) + goalFrozenLinkedAvailable(goal);
        const amount = currentItems[index].amount;
        if (amount > available) {
          completionWarnings.push(
            `"${currentItems[index].description}" (${amount.toLocaleString("vi-VN")}đ) vượt số dư còn lại (liên kết + thủ công) của "${goal.name}" (${available.toLocaleString("vi-VN")}đ) — vẫn lưu, mục tiêu sẽ hiện "Thiếu" sau khi hoàn thành.`
          );
        }
      }
      if (completionWarnings.length > 0) {
        setCompletionWarning(completionWarnings.join(" "));
      }
      const completionIndices = new Set(completionEntries.map((e) => e.index));
      // Giữ nguyên index GỐC (trong `currentItems`) cho từng dòng thường,
      // để `savedIndices` luôn khớp đúng index gốc dù `normalItems` là
      // mảng đã lọc bớt.
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
          linkedCategoryIds
        );
        // [T-S122] Goal mới (nếu có) đã tạo THẬT trong DB ngay trong lệnh
        // gọi trên — ghi ngược uuid thật vào `currentItems` NGAY, trước khi
        // thử insert transaction (có thể lỗi giữa chừng phía dưới). Nếu
        // không patch trước, lỡ insert lỗi + bấm lưu lại sẽ tạo thêm 1 goal
        // trùng tên (token "new_goal_" vẫn còn nguyên trong state).
        if (newGoalIds.size > 0) {
          currentItems = currentItems.map((it) =>
            isNewGoalToken(it.goalId) && newGoalIds.has(extractNewGoalName(it.goalId).toLowerCase())
              ? { ...it, goalId: newGoalIds.get(extractNewGoalName(it.goalId).toLowerCase()) }
              : it
          );
          setParsedItems(currentItems);
        }
        for (let i = 0; i < inserts.length; i++) {
          await createTransaction.mutateAsync(inserts[i]);
          savedIndices.add(normalItemsWithIndex[i].index);
        }
      }

      // [CONSTITUTION §1.9 mục 5, cùng bẫy đã ghi chú ở toTransactionInsert.ts]
      // KHÔNG dùng buildTransactionInserts cho nhóm này — hàm đó ép
      // `type='transfer'` bất cứ khi nào `goal_id` khác null (đúng cho luồng
      // góp quỹ cũ, SAI cho giao dịch MUA THẬT ở đây). Dựng base bằng
      // `buildTransactionInsert(..., null)` để `goal_id=null` tạm thời (type
      // suy đúng ra 'expense' từ category thật đã chọn), rồi tự gắn lại
      // `goal_id` sau — bám đúng cách `SavingGoals.tsx handleSaveComplete`
      // đã làm cho nút "Hoàn thành" thủ công (T-S19), dùng chung 1 action
      // `useCompleteGoal` (ghi giao dịch + set `completed_at`, KHÔNG đổi
      // `current_amount`).
      for (const { index, goalId } of completionEntries) {
        const item = currentItems[index];
        const goal = goals.find((g) => g.id === goalId);
        if (!goal) continue;
        const base = buildTransactionInsert(item, categories, scope, null);
        // [T-S77] `base.amount` = số tiền THẬT gốc người dùng nhập, CHƯA
        // chia — `useCompleteGoalCascade` tự ưu tiên trừ phần liên kết đã
        // đóng băng trước (chỉ ghi log), CHỈ phần còn thiếu mới thành giao
        // dịch thật (tránh trừ đúp, xem `computeGoalCompletionCascade`).
        await completeGoal.mutateAsync({ goal, transaction: { ...base, goal_id: goalId }, note: item.description, goalSpendRows });
        savedIndices.add(index);
      }

      setParsedItems([]);
      setGoalCompletionSelections({});
      setInputText("");
      setIsReviewMode(false);
    } catch (err: any) {
      console.error(err);
      if (savedIndices.size > 0) {
        // [T-S122] Đã có dòng lưu thành công trước khi lỗi — loại các dòng
        // đó khỏi state, chỉ giữ lại dòng lỗi + các dòng chưa kịp thử, kèm
        // reindex `goalCompletionSelections`/`goalDraftOpenIdx` giống hệt
        // logic ở `handleDeleteItem` (T-S20/T-S121) để không lệch hàng.
        const keptIndices = currentItems.map((_, idx) => idx).filter((idx) => !savedIndices.has(idx));
        const oldToNew = new Map(keptIndices.map((oldIdx, newIdx) => [oldIdx, newIdx]));
        const remainingItems = keptIndices.map((idx) => currentItems[idx]);

        const newSelections: Record<number, string> = {};
        Object.entries(goalCompletionSelections).forEach(([key, val]) => {
          const newIdx = oldToNew.get(Number(key));
          if (newIdx !== undefined) newSelections[newIdx] = val;
        });

        setParsedItems(remainingItems);
        setGoalCompletionSelections(newSelections);
        if (goalDraftOpenIdx !== null) {
          const newDraftIdx = oldToNew.get(goalDraftOpenIdx);
          setGoalDraftOpenIdx(newDraftIdx !== undefined ? newDraftIdx : null);
          if (newDraftIdx === undefined) {
            setGoalDraftName("");
            setGoalDraftError(null);
          }
        }
        setError(
          `Đã lưu thành công ${savedIndices.size}/${currentItems.length} dòng trước khi gặp lỗi (${
            err.message || "lỗi không rõ"
          }). Các dòng đã lưu đã được loại khỏi danh sách bên dưới — chỉ còn dòng chưa lưu, bấm "Lưu Vào Sổ Chi Tiêu" lại để thử tiếp, không bị ghi đúp.`
        );
      } else {
        setError(err.message || "Đã xảy ra lỗi khi lưu giao dịch vào sổ chi tiêu.");
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="bg-(--sst-surface) rounded-2xl shadow-sm border border-(--sst-border) p-4 sm:p-6 transition-all duration-300" id="smart-input-section">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-(--sst-text) flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-indigo-500 fill-indigo-100" />
            Nhập Chi Tiêu Nhanh bằng AI
          </h2>
          <p className="text-xs text-(--sst-text-secondary) mt-1">
            Gõ câu tự nhiên để AI tự động bóc tách số tiền, tên mặt hàng và phân loại danh mục.
          </p>
        </div>
        <div className="hidden sm:flex items-center gap-1.5 text-xs bg-(--sst-surface-2) text-(--sst-text-secondary) px-2.5 py-1 rounded-full border border-(--sst-border)">
          <HelpCircle className="w-3.5 h-3.5 text-(--sst-text-muted)" />
          Nhập tự do nhiều khoản cùng lúc
        </div>
      </div>

      {!isReviewMode ? (
        <div className="space-y-4">
          <div className="relative">
            <textarea
              className="w-full min-h-[90px] p-4 pr-12 text-(--sst-text) placeholder-(--sst-text-muted) bg-(--sst-surface-2) hover:bg-(--sst-surface-hover) focus:bg-(--sst-surface) border border-(--sst-border-strong) focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 rounded-xl resize-none text-sm outline-none transition-all duration-200"
              placeholder="Ví dụ: sáng ăn bát phở bò 45k, mua thêm cốc nước mía 15k..."
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleParse(inputText);
                }
              }}
              disabled={isLoading}
            />
            <button
              className={`absolute bottom-3 right-3 p-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white transition-all shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
                isLoading || !inputText.trim() ? "opacity-50 cursor-not-allowed" : "hover:scale-105 active:scale-95"
              }`}
              onClick={() => handleParse(inputText)}
              disabled={isLoading || !inputText.trim()}
              title="Phân tích bằng AI"
              aria-label="Phân tích bằng AI"
              id="btn-parse-ai"
            >
              <CornerDownLeft className="w-4 h-4" />
            </button>
          </div>

          {error && (
            <div className="flex items-start gap-2 p-3.5 bg-rose-50 dark:bg-rose-500/10 border border-rose-100 dark:border-rose-500/25 text-rose-700 dark:text-rose-300 rounded-xl text-sm">
              <AlertCircle className="w-4 h-4 text-rose-500 dark:text-rose-400 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <div className="text-xs font-semibold text-(--sst-text-secondary) uppercase tracking-wider mb-2.5">
              Gợi ý câu nhập nhanh:
            </div>
            <div className="flex flex-wrap gap-2">
              {sampleSuggestions.map((suggestion, idx) => (
                <button
                  key={idx}
                  onClick={() => handleApplySuggestion(suggestion)}
                  disabled={isLoading}
                  className="text-xs px-3 py-1.5 bg-(--sst-surface-2) hover:bg-indigo-50 dark:hover:bg-indigo-500/10 text-(--sst-text-secondary) hover:text-indigo-600 dark:hover:text-indigo-300 rounded-lg border border-(--sst-border-strong) hover:border-indigo-100 dark:hover:border-indigo-500/25 transition-all cursor-pointer text-left"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>

        </div>
      ) : (
        <div className="space-y-4">
          <div className="bg-indigo-50/50 dark:bg-indigo-500/10 rounded-xl p-4 border border-indigo-100/60 dark:border-indigo-500/25">
            <div className="flex justify-between items-center mb-3">
              <div className="text-sm font-semibold text-indigo-900 dark:text-indigo-300 flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-indigo-500 fill-indigo-100" />
                Kết quả AI Nhận Diện ({parsedItems.length})
              </div>
              <button
                className="text-xs text-(--sst-text-secondary) hover:text-(--sst-text) font-medium underline"
                onClick={() => setIsReviewMode(false)}
              >
                Nhập câu khác
              </button>
            </div>

            <div className="space-y-4 max-h-[380px] overflow-y-auto pr-1">
              {parsedItems.map((item, index) => {
                // [T-S49 10/08/2026 — thay thế T-S47] `isSavingsSuggested`
                // giờ nhận thêm `goals` — chỉ còn khớp TÊN goal active (không
                // còn khớp từ khoá/tên category). Đây là gợi ý MỀM thuần
                // tuý, không còn khái niệm "khoá nút Lưu" đi kèm nữa.
                // [BUGFIX 11/08/2026] Truyền thêm `categoryId` + `linkedCategoryIds`
                // — category đang liên kết goal (§1.13) luôn trả về false.
                const itemCategoryId = categories.find((c) => c.name === item.category)?.id ?? null;
                const isSavingsCategory = isSavingsSuggested(
                  {
                    category: item.category,
                    categoryId: itemCategoryId,
                    description: item.description,
                    note: item.note,
                    goalId: item.goalId,
                  },
                  goals,
                  linkedCategoryIds
                );
                const matchedContributionGoals = findMatchingActiveGoalsByName(
                  { description: item.description, note: item.note },
                  goals
                );
                const availableGoalsForRow = [
                  ...goals.filter((g) => !g.completedAt),
                  ...createdGoalsCache.filter((cg) => !goals.some((g) => g.id === cg.id)),
                ];

                // T-S06e1c (CONSTITUTION §1.4): category AI trả về (vd fallback
                // "Khác") có thể không khớp bất kỳ category thật nào của user —
                // không được để <select> tự fallback im lặng sang option đầu.
                const categoryMatched = categories.some((c) => c.name === item.category);

                return (
                  <div
                    key={index}
                    className="bg-(--sst-surface) rounded-xl p-4 border border-(--sst-border-strong) shadow-sm space-y-3 relative hover:border-indigo-200 dark:hover:border-indigo-500/40 transition-all"
                  >
                    {/* Top Row: Basic fields */}
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                      <div className="md:col-span-5">
                        <label className="block text-[10px] font-bold text-(--sst-text-muted) mb-1">TÊN GIAO DỊCH</label>
                        <input
                          type="text"
                          className="w-full text-sm font-semibold text-(--sst-text) bg-(--sst-surface-2) focus:bg-(--sst-surface) border border-(--sst-border-strong) focus:border-indigo-500 rounded-lg px-3 py-2 outline-none transition-all"
                          value={item.description}
                          onChange={(e) => handleUpdateItem(index, "description", e.target.value)}
                          placeholder="Mô tả..."
                        />
                      </div>

                      <div className="md:col-span-3">
                        <label className="block text-[10px] font-bold text-(--sst-text-muted) mb-1">SỐ TIỀN (VNĐ)</label>
                        <input
                          type="number"
                          className="w-full text-sm font-bold text-indigo-600 dark:text-indigo-400 bg-(--sst-surface-2) focus:bg-(--sst-surface) border border-(--sst-border-strong) focus:border-indigo-500 rounded-lg px-3 py-2 outline-none transition-all"
                          value={item.amount}
                          onChange={(e) => handleUpdateItem(index, "amount", Number(e.target.value))}
                          placeholder="Số tiền..."
                        />
                      </div>

                      <div className="md:col-span-4">
                        <label className="block text-[10px] font-bold text-(--sst-text-muted) mb-1">DANH MỤC</label>
                        {/* T-S06e1b: "Thu nhập" không còn là 1 lựa chọn ảo hard-code —
                            categories.type (DB thật) quyết định 1 category là thu hay
                            chi (xem resolveTransactionType, toTransactionInsert.ts).
                            Gộp 2 optgroup để vẫn chọn nhanh trong 1 dropdown như cũ,
                            nhưng giờ có thể có NHIỀU danh mục thu nhập (Lương, Thưởng...). */}
                        <select
                          className={`w-full text-sm font-semibold bg-(--sst-surface-2) focus:bg-(--sst-surface) border rounded-lg px-3 py-2 outline-none transition-all cursor-pointer ${
                            categoryMatched
                              ? "text-(--sst-text) border-(--sst-border-strong) focus:border-indigo-500"
                              : "text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-500/40 focus:border-amber-500"
                          }`}
                          value={item.category}
                          onChange={(e) => handleUpdateItem(index, "category", e.target.value)}
                        >
                          {/* T-S06e1c (CONSTITUTION §1.4): nếu category AI đề xuất
                              không khớp category thật nào, thêm hẳn 1 option cảnh
                              báo tường minh thay vì để <select> tự fallback im lặng
                              sang option đầu (từng khiến "Thu nhập chung" hiện sai
                              cho giao dịch thật ra không phải thu nhập). */}
                          {!categoryMatched && (
                            <option value={item.category}>
                              ⚠️ "{item.category}" — chưa có danh mục này, vui lòng chọn
                            </option>
                          )}
                          <optgroup label="💵 Thu nhập">
                            {categories.filter((c) => c.type === "income").map((c) => (
                              <option key={c.id} value={c.name}>
                                {c.icon} {c.name}
                              </option>
                            ))}
                          </optgroup>
                          <optgroup label="🧾 Chi tiêu">
                            {categories.filter((c) => c.type !== "income").map((c) => (
                              <option key={c.id} value={c.name}>
                                {c.icon} {c.name}
                              </option>
                            ))}
                          </optgroup>
                        </select>
                        {!categoryMatched && (
                          <p className="text-[10px] text-amber-600 dark:text-amber-400 font-medium mt-1">
                            Chưa có danh mục "{item.category}" — vui lòng chọn 1 danh mục có sẵn ở trên trước khi lưu.
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Bottom Row: Additional Info */}
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-3 pt-2 border-t border-(--sst-border)">
                      {/* T-S06e1 / CONSTITUTION §1.2: member_id không còn chọn được — hộ
                          gia đình luôn = người đang đăng nhập (khoá, hiển thị tên thật,
                          không phải email); cá nhân thì ẩn hẳn (không có khái niệm này). */}
                      {scopeMode === "household" && (
                        <div className="md:col-span-3">
                          <label className="block text-[10px] font-bold text-(--sst-text-muted) mb-1 flex items-center gap-1">
                            <User className="w-3 h-3 text-(--sst-text-muted)" /> THÀNH VIÊN
                          </label>
                          <div className="w-full text-xs text-(--sst-text-secondary) bg-(--sst-surface-2) border border-(--sst-border-strong) rounded-lg px-2.5 py-1.5">
                            👤 {currentMember ? formatMemberDisplayName(currentMember) : "Bạn"}
                          </div>
                        </div>
                      )}

                      <div className="md:col-span-3">
                        <label className="block text-[10px] font-bold text-(--sst-text-muted) mb-1 flex items-center gap-1">
                          NGÀY GIAO DỊCH
                        </label>
                        <input
                          type="date"
                          className="w-full text-xs text-(--sst-text) bg-(--sst-surface-2) focus:bg-(--sst-surface) border border-(--sst-border-strong) focus:border-indigo-500 rounded-lg px-2.5 py-1.5 outline-none"
                          value={item.date}
                          onChange={(e) => handleUpdateItem(index, "date", e.target.value)}
                        />
                      </div>

                      <div className={`flex flex-col justify-end ${scopeMode === "household" ? "md:col-span-6" : "md:col-span-9"}`}>
                        <label className="block text-[10px] font-bold text-(--sst-text-muted) mb-1 flex items-center gap-1">
                          <FileText className="w-3 h-3 text-(--sst-text-muted)" /> GHI CHÚ / CHI TIẾT
                        </label>
                        <input
                          type="text"
                          className="w-full text-xs text-(--sst-text-secondary) bg-(--sst-surface-2) focus:bg-(--sst-surface) border border-(--sst-border-strong) focus:border-indigo-500 rounded-lg px-3 py-1.5 outline-none"
                          value={item.note || ""}
                          onChange={(e) => handleUpdateItem(index, "note", e.target.value)}
                          placeholder="Thêm ghi chú cụ thể tại đây..."
                        />
                      </div>
                    </div>

                    {/* [T-S49] Banner MỀM "Gắn vào mục tiêu" — không còn khoá
                        nút Lưu, không còn khớp theo tên category. Hiện khi
                        mô tả/ghi chú khớp tên ≥1 goal active, hoặc [11/08/2026]
                        category/mô tả/ghi chú chứa từ khoá ý định tiết kiệm
                        rõ ràng (chưa khớp tên goal cụ thể nào), hoặc đã có
                        goalId gắn sẵn. Kèm nút "+ Tạo mục tiêu mới". */}
                    {isSavingsCategory && (
                      <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/25 p-2.5 rounded-lg text-xs mt-1 space-y-2">
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                          <span className="text-amber-800 dark:text-amber-300 font-medium flex items-center gap-1">
                            <PiggyBank className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400 shrink-0" />
                            {!item.goalId && matchedContributionGoals.length > 0
                              ? `Mô tả có vẻ khớp mục tiêu "${matchedContributionGoals[0].name}"${
                                  matchedContributionGoals.length > 1 ? " (và mục khác)" : ""
                                } — gắn vào?`
                              : !item.goalId
                              ? "Giao dịch này có vẻ liên quan tiết kiệm/góp quỹ — gắn vào 1 mục tiêu có sẵn hoặc tạo mới?"
                              : "Gắn giao dịch này vào 1 mục tiêu tiết kiệm (không bắt buộc):"}
                          </span>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] text-amber-600 dark:text-amber-400 font-bold">Gắn vào:</span>
                            <select
                              className="bg-(--sst-surface) border border-amber-200 dark:border-amber-500/30 rounded text-amber-900 dark:text-amber-200 px-2 py-1 outline-none text-xs cursor-pointer font-semibold"
                              value={item.goalId || ""}
                              onChange={(e) => handleUpdateItem(index, "goalId", e.target.value || undefined)}
                            >
                              <option value="">-- Không tích lũy --</option>
                              {item.goalId && item.goalId.startsWith("new_goal_") && (
                                <option value={item.goalId}>
                                  ✨ Tạo mục tiêu mới: "{item.goalId.replace("new_goal_", "")}"
                                </option>
                              )}
                              {availableGoalsForRow.map((g) => (
                                <option key={g.id} value={g.id}>
                                  {g.name} (Đã có: {new Intl.NumberFormat("vi-VN").format(g.currentAmount)}đ)
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>

                        {goalDraftOpenIdx === index ? (
                          <div className="flex items-center gap-1.5 pt-2 border-t border-amber-100 dark:border-amber-500/25">
                            <input
                              type="text"
                              className="flex-1 bg-(--sst-surface) border border-amber-200 dark:border-amber-500/30 rounded px-2 py-1 text-xs outline-none"
                              placeholder="Tên mục tiêu mới..."
                              value={goalDraftName}
                              onChange={(e) => setGoalDraftName(e.target.value)}
                              disabled={isCreatingGoal}
                              autoFocus
                            />
                            <button
                              type="button"
                              className="px-2.5 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded text-[11px] font-semibold cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                              disabled={isCreatingGoal || !goalDraftName.trim()}
                              onClick={() => handleCreateGoalInline(index)}
                            >
                              {isCreatingGoal ? "Đang tạo..." : "Tạo"}
                            </button>
                            <button
                              type="button"
                              className="px-2.5 py-2 bg-(--sst-surface) hover:bg-amber-100 dark:hover:bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-500/30 rounded text-[11px] font-medium cursor-pointer"
                              onClick={() => {
                                setGoalDraftOpenIdx(null);
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
                            className="-m-2 p-2 text-[11px] text-amber-700 dark:text-amber-300 hover:text-amber-900 dark:hover:text-amber-200 underline font-medium cursor-pointer"
                            onClick={() => {
                              setGoalDraftOpenIdx(index);
                              setGoalDraftName("");
                              setGoalDraftError(null);
                            }}
                          >
                            + Tạo mục tiêu mới
                          </button>
                        )}
                        {goalDraftOpenIdx === index && goalDraftError && (
                          <p className="text-[10px] text-rose-600 dark:text-rose-400 font-medium">{goalDraftError}</p>
                        )}
                      </div>
                    )}

                    {/* T-S20 — Goal completion detection banner (giao dịch chi tiêu
                        bình thường khớp tên 1 mục tiêu tiết kiệm đang active).
                        [T-S59 SỬA 11/08/2026 — xem CONSTITUTION §1.19] Loại trừ
                        lẫn nhau với banner "Gắn vào mục tiêu" (góp quỹ, amber)
                        theo ĐÚNG ràng buộc thật (1 giao dịch không thể vừa
                        transfer-góp quỹ vừa expense-hoàn thành) — dùng
                        `item.goalId` (đã CHỌN góp quỹ ở dropdown amber hay
                        chưa, tín hiệu ĐỘNG theo lựa chọn thật), KHÔNG dùng
                        `isSavingsCategory` (chỉ là "amber CÓ render hay
                        không", tĩnh theo khớp tên/từ khoá — sai vì amber mặc
                        định KHÔNG chọn goal nào, category liên kết hay không
                        cũng không liên quan gì đến việc này, xem CHANGELOG). */}
                    {(() => {
                      if (item.goalId) return null;
                      const matchedCategoryObj = categories.find((c) => c.name === item.category);
                      if (matchedCategoryObj?.type === "income") return null;
                      const matchedActiveGoals = findMatchingActiveGoals(item.description);
                      if (matchedActiveGoals.length === 0) return null;

                      const choice = goalCompletionSelections[index];
                      const isDismissed = choice === "";
                      const confirmedGoal = choice ? matchedActiveGoals.find((g) => g.id === choice) : undefined;

                      if (isDismissed) {
                        return (
                          <button
                            type="button"
                            className="-m-2 p-2 text-[10px] text-(--sst-text-muted) hover:text-teal-600 dark:hover:text-teal-400 underline cursor-pointer"
                            onClick={() =>
                              setGoalCompletionSelections((prev) => {
                                const next = { ...prev };
                                delete next[index];
                                return next;
                              })
                            }
                          >
                            Đã bỏ qua gợi ý hoàn thành mục tiêu tiết kiệm — hoàn tác?
                          </button>
                        );
                      }

                      return (
                        <div className="bg-teal-50 dark:bg-teal-500/10 border border-teal-100 dark:border-teal-500/25 p-2.5 rounded-lg text-xs space-y-2">
                          <div className="flex items-start gap-1.5 text-teal-800 dark:text-teal-300 font-medium">
                            <PiggyBank className="w-3.5 h-3.5 text-teal-500 dark:text-teal-400 mt-0.5 shrink-0" />
                            {confirmedGoal ? (
                              <span>
                                ✅ Sẽ đánh dấu hoàn thành mục tiêu "{confirmedGoal.name}" khi lưu giao dịch này.
                              </span>
                            ) : matchedActiveGoals.length === 1 ? (
                              <span>
                                Giao dịch này có vẻ là mua sắm cho mục tiêu tiết kiệm "{matchedActiveGoals[0].name}" —
                                đánh dấu hoàn thành mục tiêu này?
                              </span>
                            ) : (
                              <span>
                                Giao dịch này có vẻ khớp với nhiều mục tiêu tiết kiệm — chọn 1 để đánh dấu hoàn
                                thành (hoặc bỏ qua):
                              </span>
                            )}
                          </div>

                          {confirmedGoal ? (
                            <button
                              type="button"
                              className="px-2.5 py-2 bg-(--sst-surface) hover:bg-teal-100 dark:hover:bg-teal-500/15 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-500/30 rounded-md text-[11px] font-medium cursor-pointer"
                              onClick={() =>
                                setGoalCompletionSelections((prev) => {
                                  const next = { ...prev };
                                  delete next[index];
                                  return next;
                                })
                              }
                            >
                              Đổi ý
                            </button>
                          ) : matchedActiveGoals.length === 1 ? (
                            <div className="flex gap-2">
                              <button
                                type="button"
                                className="px-2.5 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-md text-[11px] font-semibold cursor-pointer"
                                onClick={() =>
                                  setGoalCompletionSelections((prev) => ({ ...prev, [index]: matchedActiveGoals[0].id }))
                                }
                              >
                                Đánh dấu hoàn thành
                              </button>
                              <button
                                type="button"
                                className="px-2.5 py-2 bg-(--sst-surface) hover:bg-teal-100 dark:hover:bg-teal-500/15 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-500/30 rounded-md text-[11px] font-medium cursor-pointer"
                                onClick={() => setGoalCompletionSelections((prev) => ({ ...prev, [index]: "" }))}
                              >
                                Bỏ qua
                              </button>
                            </div>
                          ) : (
                            <select
                              className="bg-(--sst-surface) border border-teal-200 dark:border-teal-500/30 rounded text-teal-900 dark:text-teal-200 px-2 py-1 outline-none text-xs cursor-pointer font-semibold w-full"
                              value={choice || ""}
                              onChange={(e) =>
                                setGoalCompletionSelections((prev) => ({ ...prev, [index]: e.target.value }))
                              }
                            >
                              <option value="">-- Bỏ qua --</option>
                              {matchedActiveGoals.map((g) => (
                                <option key={g.id} value={g.id}>
                                  {g.name} (Đã tích lũy: {new Intl.NumberFormat("vi-VN").format(g.currentAmount)}đ)
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                      );
                    })()}

                    {/* Trash delete button */}
                    <button
                      className="absolute top-2 right-2 p-1.5 text-(--sst-text-muted) hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition-all cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
                      onClick={() => handleDeleteItem(index)}
                      title="Xóa dòng này"
                      aria-label="Xóa dòng này"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex gap-3 justify-end items-center">
            {hasUnmatchedCategory && (
              <span className="text-[11px] text-amber-600 dark:text-amber-400 font-medium mr-auto">
                ⚠️ Còn dòng chưa chọn danh mục hợp lệ
              </span>
            )}
            <button
              className="px-4 py-2 bg-(--sst-surface-2) hover:bg-(--sst-surface-hover) text-(--sst-text) rounded-xl text-sm font-medium transition-all cursor-pointer"
              onClick={() => {
                setParsedItems([]);
                setIsReviewMode(false);
              }}
            >
              Hủy bỏ
            </button>
            <button
              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-semibold shadow-md shadow-indigo-100 transition-all cursor-pointer hover:scale-102 active:scale-98 flex items-center gap-1.5 disabled:opacity-60 disabled:cursor-not-allowed"
              onClick={handleConfirmAll}
              disabled={isSaving || hasUnmatchedCategory}
              title={hasUnmatchedCategory ? "Còn dòng chưa chọn danh mục hợp lệ" : undefined}
              id="btn-confirm-parse"
            >
              <Check className="w-4 h-4" />
              {isSaving ? "Đang lưu..." : "Lưu Vào Sổ Chi Tiêu"}
            </button>
          </div>
        </div>
      )}

      {error && isReviewMode && (
        <div className="flex items-start gap-2 p-3.5 bg-rose-50 dark:bg-rose-500/10 border border-rose-100 dark:border-rose-500/25 text-rose-700 dark:text-rose-300 rounded-xl text-sm mt-3">
          <AlertCircle className="w-4 h-4 text-rose-500 dark:text-rose-400 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* [T-S74] Cảnh báo MỀM — không chặn, hiện cả sau khi đã lưu xong
          (không gate theo isReviewMode như banner lỗi ở trên) vì đây là
          thông tin về kết quả vừa lưu (goal sẽ "Thiếu"), không phải lỗi
          cần sửa trước khi lưu. */}
      {completionWarning && (
        <div className="flex items-start gap-2 p-3.5 bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/25 text-amber-700 dark:text-amber-300 rounded-xl text-sm mt-3">
          <AlertTriangle className="w-4 h-4 text-amber-500 dark:text-amber-400 mt-0.5 shrink-0" />
          <span>{completionWarning}</span>
        </div>
      )}

      {isLoading && (
        <div className="absolute inset-0 bg-(--sst-surface)/80 rounded-2xl flex flex-col items-center justify-center z-10 p-6">
          <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mb-3"></div>
          <p className="text-sm font-medium text-(--sst-text)">Đang bóc tách chi tiêu bằng NLP AI...</p>
          <p className="text-xs text-(--sst-text-muted) mt-1">Đang phân tích cú pháp, chuẩn hóa VNĐ và gợi ý danh mục</p>
        </div>
      )}
    </div>
  );
}