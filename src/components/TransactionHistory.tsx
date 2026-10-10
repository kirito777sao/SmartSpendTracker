import { useState, useMemo, FormEvent, useEffect } from "react";
import {
  Search,
  Filter,
  Plus,
  Trash2,
  FileSpreadsheet,
  Download,
  Calendar,
  DollarSign,
  AlertCircle,
  Tag,
  BookOpen,
  X,
  Check,
  Edit2,
  User,
  ArrowUpDown,
  Database,
  PiggyBank,
} from "lucide-react";
import { Transaction } from "../types";
import Pagination from "./Pagination";
// T-S06e1: nhánh GHI (add/edit/delete) đã chuyển sang mutation hook thật
// (useCreateTransaction/useUpdateTransaction/useSoftDeleteTransaction, T-S06c).
// `members` (HouseholdMember[] cũ) đã bỏ hẳn — "Thành viên thực hiện" giờ
// khoá = người đang đăng nhập (CONSTITUTION §1.2), không còn là danh sách
// chọn tuỳ ý qua props.
import { useTransactions, useCreateTransaction, useUpdateTransaction, useSoftDeleteTransaction, useRestoreTransaction } from "../hooks/useTransactions";
import { useCategories } from "../hooks/useCategories";
import { useGoals, useCreateGoal, useCompleteGoalCascade } from "../hooks/useGoals";
import { rowToGoal } from "../lib/mapRows";
import { goalManualAvailable, goalFrozenLinkedAvailable, GoalSpendLike, isGoalFullyFundedForCompletionBanner } from "../lib/goalAvailability";
import { useHousehold, useHouseholdMembers, formatMemberDisplayName } from "../hooks/useHousehold";
import { useCurrentUserId } from "../hooks/useCurrentUserId";
import { useScope } from "../context/ScopeContext";
import { rowsToTransactions, rowToCategory } from "../lib/mapRows";
import { buildTransactionInsert, buildTransactionUpdate, resolveCategoryId } from "../lib/toTransactionInsert";
import { isSavingsSuggested, findMatchingActiveGoalsByName } from "../lib/savingsDetect";
// [T-S113, 19/08/2026 — bugfix phát hiện qua audit logic dòng tiền] Nguồn
// sự thật DUY NHẤT để phân loại thu/chi (CONSTITUTION §5, bug gốc T-S21) —
// thay cho điều kiện OR tự viết so tên category, đã bị bỏ sót ở file này.
import { isIncomeTx } from "../lib/txClassify";
import { useToast } from "../context/ToastContext";
import { useConfirm } from "../context/ConfirmContext";

interface TransactionHistoryProps {
  isOwner?: boolean;
}

export default function TransactionHistory({ isOwner = true }: TransactionHistoryProps) {
  const { scopeMode } = useScope();
  const userId = useCurrentUserId();
  const { data: transactionRows = [], isLoading: isLoadingTransactions } = useTransactions();
  const { data: categoryRows = [] } = useCategories();
  const { data: household } = useHousehold();
  const { data: memberRows = [] } = useHouseholdMembers(household?.id);
  // T-S33 — cần danh sách goal ACTIVE để cho phép gắn `goal_id` ngay ở form
  // thủ công, cùng nguồn dữ liệu `useGoals()` mà SmartInput/AIAssistantBubble
  // đã dùng (T-S14).
  const { data: goalRows = [] } = useGoals();
  const createGoal = useCreateGoal();
  // [T-S76, CONSTITUTION §1.22.1 — CHỐT 14/08/2026] Bổ sung banner tự động
  // "Đánh dấu hoàn thành mục tiêu" (đã có sẵn ở SmartInput/AIAssistantBubble
  // từ T-S20/T-S59/T-S74, thiếu ở đây — xác nhận là gap thật). Dùng chung
  // action `useCompleteGoal` (T-S67, ghi giao dịch mua thật + set
  // `completed_at`). `goalSpendRows` cần cho `goalManualAvailable` (cảnh báo
  // mềm T-S74 khi vượt số dư thủ công còn lại) — tái dùng thẳng
  // `transactionRows` thô đã fetch sẵn ở trên, không query thêm.
  const completeGoal = useCompleteGoalCascade();
  const goalSpendRows: GoalSpendLike[] = useMemo(
    () => transactionRows.map((t) => ({ goalId: t.goal_id, type: t.type, amount: t.amount })),
    [transactionRows]
  );
  const goals = useMemo(
    // T-S48 (CONSTITUTION §1.13.3) — goal liên kết category không nhận góp
    // quỹ thủ công qua transfer, loại khỏi dropdown "Gắn vào mục tiêu".
    () => goalRows.map(rowToGoal).filter((g) => !g.completedAt && !g.linkedCategoryId),
    [goalRows]
  );
  // [BUGFIX 11/08/2026, CONSTITUTION §1.14 mục 1, xem savingsDetect.ts] Set
  // các category id đang bị 1 goal nào đó liên kết (§1.13) — tính từ TOÀN
  // BỘ `goalRows` CHƯA lọc (khác `goals` ở trên đã lọc bỏ goal liên kết,
  // không còn giữ thông tin category nào đang liên kết nữa). Dùng để loại
  // trừ banner T-S49 khi category đang chọn ở form thêm mới là 1 category
  // liên kết — đúng nguyên văn CHỐT §1.13/§1.14.
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
  const currentMember = memberRows.find((m) => m.id === userId);

  const createTransaction = useCreateTransaction();
  const updateTransaction = useUpdateTransaction();
  const softDeleteTransaction = useSoftDeleteTransaction();
  const restoreTransaction = useRestoreTransaction();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const [writeError, setWriteError] = useState<string | null>(null);

  // [BUGFIX 08/08/2026] Prop `isOwner` truyền từ App.tsx được tính từ state
  // legacy (localStorage, khớp tên không phân biệt hoa thường) — KHÔNG phải
  // `household_role` thật từ Supabase, và có nhiều fallback mặc định `true`
  // (guest/thiếu dữ liệu) → có thể sai, khiến 1 thành viên thường bị coi là
  // chủ hộ. Component này đã tự có `currentMember` (profiles row thật, đọc
  // qua RLS) nên tính lại tại chỗ, KHÔNG dùng prop `isOwner` cho quyết định
  // sửa/xoá nữa (giữ prop lại chỉ để không phá interface, không dùng).
  // RBAC vẫn đúng y hệt đã CHỐT ở CONSTITUTION §3: chủ hộ override mọi giao
  // dịch hộ; ở sổ cá nhân, mọi giao dịch luôn là của chính mình.
  const isHouseholdOwner =
    scopeMode !== "household" || currentMember?.household_role === "owner";

  // Quyền sửa/xoá THEO TỪNG GIAO DỊCH: chủ hộ luôn được; ở sổ cá nhân luôn
  // được (owner_id chắc chắn = mình, do query đã lọc theo ownerId); ở sổ hộ
  // gia đình, thành viên thường CHỈ được với giao dịch member_id = chính họ.
  // Đây chỉ là lớp UI (ẩn/hiện nút) — chốt chặn thật vẫn ở RLS/RPC
  // (soft_delete_transaction đã kiểm tra lại y hệt điều kiện này, xem
  // 0006_fix_soft_delete_restore_transaction_security_definer.sql).
  const canModifyTx = (t: Transaction) =>
    isHouseholdOwner || scopeMode !== "household" || t.memberId === userId;

  const categories = useMemo(() => categoryRows.map(rowToCategory), [categoryRows]);
  const transactions = useMemo(
    () => rowsToTransactions(transactionRows, categoryRows, memberRows),
    [transactionRows, categoryRows, memberRows]
  );
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedMember, setSelectedMember] = useState("all");
  const [isAdding, setIsAdding] = useState(false);

  // Pagination, multiple selection, sorting
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedTxIds, setSelectedTxIds] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<"date_desc" | "date_asc" | "amount_desc" | "amount_asc" | "category_asc" | "category_desc" | "member_asc" | "member_desc">("date_desc");

  // Reset pagination & selected items on filter / search / sort change
  useEffect(() => {
    setCurrentPage(1);
    setSelectedTxIds([]);
  }, [search, selectedCategory, selectedMember, sortBy]);

  // Editing state for inline transaction editing
  const [editingTxId, setEditingTxId] = useState<string | null>(null);
  const [confirmDeleteTxId, setConfirmDeleteTxId] = useState<string | null>(null);
  const [editDesc, setEditDesc] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [editCat, setEditCat] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editNote, setEditNote] = useState("");
  // [T-S23, CONSTITUTION §1.10] Loại thu/chi ĐANG CHỌN trong form sửa —
  // khác `t.type` gốc khi người dùng vừa bấm toggle đổi loại, chưa lưu.
  const [editType, setEditType] = useState<"income" | "expense">("expense");

  // Chỉ cho đổi type khi KHÔNG phải giao dịch `transfer` (gắn chặt
  // apply_goal_contribution) và KHÔNG đang gắn `goal_id` (CONSTITUTION
  // §1.10 mục 1-2) — muốn đổi loại 1 giao dịch có goal phải gỡ goal trước,
  // thao tác tách riêng, không nằm trong phạm vi T-S23 này.
  const canChangeType = (t: Transaction) => t.type !== "transfer" && !t.goalId;

  const handleStartEdit = (t: Transaction) => {
    setEditingTxId(t.id);
    setEditDesc(t.description);
    setEditAmount(Math.abs(t.amount).toString());
    setEditCat(t.category);
    setEditDate(t.date);
    setEditNote(t.note || "");
    setEditType(t.type === "income" ? "income" : "expense");
  };

  // Đổi toggle Thu/Chi giữa chừng: category cũ gần như chắc chắn khác nhóm
  // mới -> XOÁ hẳn lựa chọn category, bắt người dùng TỰ chọn lại (đúng
  // nguyên tắc "không tự đoán hộ" đã CHỐT ở §1.4 — auto-giữ category cũ
  // khác nhóm hoặc auto-chọn category đầu tiên đều là 1 dạng đoán ngầm).
  const handleToggleEditType = (next: "income" | "expense") => {
    if (next === editType) return;
    setEditType(next);
    setEditCat("");
  };

  // [T-S23, CONSTITUTION §1.10] Cùng pattern `catMatched` đã dùng cho form
  // thêm mới (§1.4, T-S22/T-S22b) — chặn cứng ở tầng logic, không chỉ tin
  // nút Lưu đã bị `disabled` khoá ở UI. Giao dịch `transfer` không ép nhóm
  // (giữ đúng hành vi "chỉ hiển thị lịch sử" đã có từ T-S24).
  const editCatMatched = useMemo(() => {
    if (!editCat) return false;
    const category = categories.find((c) => c.name === editCat);
    if (!category) return false;
    const editingTx = transactions.find((t) => t.id === editingTxId);
    if (editingTx?.type === "transfer") return true;
    return category.type === editType;
  }, [editCat, editType, categories, transactions, editingTxId]);

  const handleSaveEdit = async () => {
    if (!editDesc.trim() || !editAmount) return;
    const editingTx = transactions.find((t) => t.id === editingTxId);
    if (!editCatMatched) {
      setWriteError("Vui lòng chọn danh mục hợp lệ (đúng nhóm Thu/Chi) trước khi lưu.");
      return;
    }
    setWriteError(null);
    try {
      await updateTransaction.mutateAsync({
        id: editingTxId as string,
        patch: buildTransactionUpdate(
          {
            description: editDesc.trim(),
            amount: Number(editAmount),
            category: editCat,
            date: editDate,
            note: editNote.trim(),
            type: editingTx && canChangeType(editingTx) ? editType : undefined,
          },
          categories
        ),
      });
      setEditingTxId(null);
    } catch (err: any) {
      console.error(err);
      setWriteError(err.message || "Không thể lưu thay đổi giao dịch.");
    }
  };

  // Time filters for transactions
  const [timeFilter, setTimeFilter] = useState<"all" | "today" | "week" | "month" | "year" | "custom" >("all");
  const [customStartDate, setCustomStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toLocaleDateString("en-CA");
  });
  const [customEndDate, setCustomEndDate] = useState(() => new Date().toLocaleDateString("en-CA"));

  // Form states for manual adding
  const [desc, setDesc] = useState("");
  const [amount, setAmount] = useState("");
  // [BUGFIX T-S22b 09/08/2026, phát hiện qua test tay] Bản sửa trước (T-S22b
  // gốc) default rỗng nhưng có useEffect TỰ ĐIỀN category chi tiêu đầu tiên
  // tìm thấy trong danh sách khi `cat` không khớp — hoá ra đây vẫn là 1 dạng
  // "tự đoán âm thầm thay người dùng" (đúng lớp bug T-S22/CONSTITUTION §1.4),
  // chỉ khác là đoán ra 1 category CÓ THẬT thay vì mặc định cứng 'expense'.
  // Test tay 09/08/2026 xác nhận: xoá category "Ăn uống", mở form nhập
  // "bánh mì" mà không đụng dropdown → bị tự gán "đi lại" (category chi tiêu
  // đầu tiên trong mảng) hoàn toàn im lặng, không cảnh báo gì. Bỏ hẳn
  // auto-fill — `cat` giữ rỗng cho tới khi người dùng TỰ chọn, không có
  // ngoại lệ nào tự chọn hộ.
  const [cat, setCat] = useState("");
  const [date, setDate] = useState(() => new Date().toLocaleDateString("en-CA")); // local YYYY-MM-DD
  const [note, setNote] = useState("");
  // T-S33 — goal đang chọn để gắn cho giao dịch góp quỹ ("" = không tích luỹ,
  // giữ hành vi cũ). Reset khi đổi category ra khỏi nhóm tiết kiệm để tránh
  // gắn nhầm goal cho 1 giao dịch chi tiêu thường sau khi đổi ý category.
  const [goalId, setGoalId] = useState("");

  // [T-S76 — CONSTITUTION §1.22.1] Gợi ý "Đánh dấu hoàn thành mục tiêu"
  // (khác hẳn `goalId`/banner "Gắn vào" ở trên — 1 giao dịch không thể vừa
  // góp quỹ vừa mua thật, cùng ràng buộc loại trừ lẫn nhau đã áp ở
  // SmartInput.tsx/T-S59). "" = đã bỏ qua gợi ý (tường minh), id thật = đã
  // chọn "Đánh dấu hoàn thành", undefined = chưa quyết định.
  const [goalCompletionChoice, setGoalCompletionChoice] = useState<string | undefined>(undefined);
  // [T-S74, thay cho chặn cứng cũ] Cảnh báo MỀM khi giao dịch hoàn thành
  // vượt số dư thủ công còn lại của goal — không chặn lưu, cùng pattern
  // SmartInput.tsx/AIAssistantBubble.tsx.
  const [completionWarning, setCompletionWarning] = useState<string | null>(null);

  // [T-S49 10/08/2026 — CONSTITUTION §1.14] Form rút gọn "+ Tạo mục tiêu
  // mới" ngay trong banner gợi ý, cùng pattern SmartInput.tsx/
  // AIAssistantBubble.tsx — chỉ 1 form add-mới ở đây (không phải mảng nhiều
  // dòng) nên không cần index, chỉ 1 bộ state cờ mở/đóng.
  const [goalDraftOpen, setGoalDraftOpen] = useState(false);
  const [goalDraftName, setGoalDraftName] = useState("");
  const [goalDraftError, setGoalDraftError] = useState<string | null>(null);
  const [isCreatingGoal, setIsCreatingGoal] = useState(false);
  const [createdGoalsCache, setCreatedGoalsCache] = useState<
    { id: string; name: string; currentAmount: number }[]
  >([]);

  // Category không còn khớp danh sách thật (bị xoá sau khi đã chọn, hoặc
  // chưa từng chọn) — dùng để tô viền cảnh báo + khoá nút Ghi Sổ, cùng pattern
  // `categoryMatched` đã áp cho SmartInput/AIAssistantBubble (CONSTITUTION §1.4).
  const catMatched = !!cat && categories.some((c) => c.name === cat);

  // [T-S49 10/08/2026 — thay thế T-S47, CONSTITUTION §1.14] `isSavingsSuggested`
  // dùng chung (src/lib/savingsDetect.ts) để 3 nơi (SmartInput/
  // AIAssistantBubble/TransactionHistory) hiện banner "Gắn vào" giống hệt
  // nhau — chỉ còn khớp TÊN goal active hoặc goalId đã chọn sẵn, không còn
  // khớp từ khoá/tên category, không còn khái niệm khoá nút Ghi Sổ.
  // [BUGFIX 11/08/2026] Truyền thêm `categoryId` (resolve từ `cat`) +
  // `linkedCategoryIds` — category đang liên kết goal (§1.13) sẽ luôn trả
  // về false, không đoán gì cả, đúng nguyên văn CHỐT §1.14 mục 1.
  const isSavingsCat = isSavingsSuggested(
    { category: cat, categoryId: resolveCategoryId(cat, categories), description: desc, note, goalId: goalId || undefined },
    goals,
    linkedCategoryIds
  );

  // [T-S49 10/08/2026 — thay thế T-S47, CONSTITUTION §1.14] Chỉ còn khớp
  // TÊN goal thủ công đang active — dùng để đổi câu chữ banner (gợi ý đúng
  // tên goal khớp thay vì câu chung chung), không còn khái niệm chặn/khoá.
  const matchedContributionGoals = findMatchingActiveGoalsByName({ description: desc, note }, goals);

  // [T-S76 — CONSTITUTION §1.22.1, CHỐT 14/08/2026] Banner "Đánh dấu hoàn
  // thành" — cùng logic y hệt `findMatchingActiveGoals` ở SmartInput.tsx/
  // AIAssistantBubble.tsx (T-S20/T-S59), thêm mới ở đây (gap thật, chưa
  // từng có). Chỉ khớp goal đã gom đủ >= 100% mục tiêu
  // (`isGoalFullyFundedForCompletionBanner`).
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
  const matchedCompletionGoals = findMatchingActiveGoals(desc);

  const availableGoalsForForm = [
    ...goals,
    ...createdGoalsCache.filter((cg) => !goals.some((g) => g.id === cg.id)),
  ];

  useEffect(() => {
    if (!isSavingsCat && goalId) setGoalId("");
  }, [isSavingsCat, goalId]);

  // [T-S49 10/08/2026 — CONSTITUTION §1.14] Tạo goal mới ngay tại chỗ (bấm
  // rõ ràng của người dùng, không token "new_goal_" hoãn tạo) rồi tự gắn
  // vào form đang nhập — cùng pattern `handleCreateGoalInline` ở
  // SmartInput.tsx.
  const handleCreateGoalInline = async () => {
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
      setGoalId(created.id);
      setGoalDraftOpen(false);
      setGoalDraftName("");
    } catch (err: any) {
      setGoalDraftError(err.message || "Không thể tạo mục tiêu mới.");
    } finally {
      setIsCreatingGoal(false);
    }
  };

  const handleManualAdd = async (e: FormEvent) => {
    e.preventDefault();
    if (!desc.trim() || !amount) return;
    // [BUGFIX T-S22/T-S22b] Chặn cứng ở tầng logic, không chỉ tin nút Ghi Sổ
    // đã bị `disabled={!catMatched}` khoá ở UI (phòng trường hợp submit bằng
    // Enter hoặc form bị submit qua đường khác bỏ qua thuộc tính disabled) —
    // cùng tinh thần chặn ở SmartInput/AIAssistantBubble: không để
    // resolveTransactionType() suy ra 'expense' âm thầm khi category không
    // khớp category thật nào.
    if (!catMatched) {
      setWriteError("Vui lòng chọn danh mục hợp lệ trước khi ghi sổ.");
      return;
    }
    // [T-S49 10/08/2026 — CONSTITUTION §1.14] Khối chặn cứng "chưa gắn mục
    // tiêu" (T-S45/T-S47) đã bỏ — gắn goal giờ chỉ là gợi ý mềm, không còn
    // điều kiện nào để chặn ở đây nữa.
    setWriteError(null);
    setCompletionWarning(null);
    try {
      const scope = { scopeMode, userId, householdId: household?.id };
      const baseItem = {
        description: desc.trim(),
        amount: Math.abs(Number(amount)),
        category: cat,
        date,
        note: note.trim() || undefined,
      };

      // [T-S76 — CONSTITUTION §1.22.1] Validate lại lựa chọn "Đánh dấu hoàn
      // thành" ngay tại đây (không tin state UI cũ) — nếu mô tả đã bị sửa
      // và không còn khớp goal đã chọn, bỏ qua an toàn thay vì lỡ hoàn
      // thành nhầm mục tiêu không còn liên quan (CONSTITUTION §5), cùng
      // pattern SmartInput.tsx.
      const stillMatchesCompletion =
        !!goalCompletionChoice && findMatchingActiveGoals(desc).some((g) => g.id === goalCompletionChoice);

      if (stillMatchesCompletion && goalCompletionChoice) {
        // [T-S77, thay T-S74] Cảnh báo mềm giờ so với số dư GỘP CẢ 2 NGUỒN
        // (liên kết đã đóng băng + thủ công) — xem giải thích ở SmartInput.tsx.
        const goal = goals.find((g) => g.id === goalCompletionChoice);
        if (goal) {
          const available = goalManualAvailable(goal, goalSpendRows) + goalFrozenLinkedAvailable(goal);
          if (baseItem.amount > available) {
            setCompletionWarning(
              `"${baseItem.description}" (${baseItem.amount.toLocaleString("vi-VN")}đ) vượt số dư còn lại (liên kết + thủ công) của "${goal.name}" (${available.toLocaleString("vi-VN")}đ) — vẫn lưu, mục tiêu sẽ hiện "Thiếu" sau khi hoàn thành.`
            );
          }
        }
        // [CONSTITUTION §1.9 mục 5] Dựng base bằng `goal_id=null` tạm thời
        // (type suy đúng ra 'expense' từ category thật đã chọn) rồi tự gắn
        // lại `goal_id` sau — bám đúng cách SmartInput.tsx/SavingGoals.tsx
        // đã làm cho `useCompleteGoal` (T-S67).
        if (goal) {
          const base = buildTransactionInsert(baseItem, categories, scope, null);
          // [T-S77] Ưu tiên trừ phần liên kết đã đóng băng trước, chỉ phần
          // dư mới thành giao dịch thật — xem SmartInput.tsx.
          await completeGoal.mutateAsync({
            goal,
            transaction: { ...base, goal_id: goalCompletionChoice },
            note: baseItem.description,
            goalSpendRows,
          });
        }
      } else {
        await createTransaction.mutateAsync(
          buildTransactionInsert(
            baseItem,
            categories,
            scope,
            // T-S33 — truyền tường minh goal_id đã chọn (hoặc null nếu để
            // "-- Không tích lũy --"); ép `type='transfer'` + không tính vào
            // thu/chi khi có goal, y hệt hành vi `SmartInput`/`AIAssistantBubble`
            // (T-S14, xem `toTransactionInsert.ts`).
            goalId || null
          )
        );
      }

      // Reset Form
      setDesc("");
      setAmount("");
      setNote("");
      setGoalId("");
      setGoalCompletionChoice(undefined);
      setGoalDraftOpen(false);
      setGoalDraftName("");
      setGoalDraftError(null);
      setIsAdding(false);
    } catch (err: any) {
      console.error(err);
      setWriteError(err.message || "Không thể thêm giao dịch.");
    }
  };

  // Filtered transactions for the view list, fully respecting search, category, and date filter
  const filteredList = useMemo(() => {
    const today = new Date();
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    return transactions.filter((t) => {
      // 1. Search filter
      const matchSearch =
        t.description.toLowerCase().includes(search.toLowerCase()) ||
        (t.note && t.note.toLowerCase().includes(search.toLowerCase()));
      
      // 2. Category filter
      const matchCategory = selectedCategory === "all" || t.category === selectedCategory;

      // 3. Member filter
      const matchMember =
        selectedMember === "all" ||
        t.member === selectedMember ||
        (selectedMember === "none" && !t.member);

      // 4. Time filter
      let matchTime = true;
      const tDate = new Date(t.date);

      if (timeFilter === "today") {
        matchTime = tDate >= startOfToday;
      } else if (timeFilter === "week") {
        const oneWeekAgo = new Date();
        oneWeekAgo.setDate(today.getDate() - 7);
        matchTime = tDate >= oneWeekAgo;
      } else if (timeFilter === "month") {
        const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        matchTime = tDate >= startOfMonth;
      } else if (timeFilter === "year") {
        const startOfYear = new Date(today.getFullYear(), 0, 1);
        matchTime = tDate >= startOfYear;
      } else if (timeFilter === "custom") {
        const start = new Date(customStartDate);
        const end = new Date(customEndDate);
        end.setHours(23, 59, 59, 999);
        matchTime = tDate >= start && tDate <= end;
      }

      return matchSearch && matchCategory && matchTime && matchMember;
    });
  }, [transactions, search, selectedCategory, selectedMember, timeFilter, customStartDate, customEndDate]);

  // Sorted list fully respecting sort options: amount, date, category, member
  //
  // [BUGFIX 08/08/2026 — bug thật người dùng báo qua ảnh chụp UI, thứ tự
  // "Mới nhất" nhảy loạn] `Transaction.date` (`YYYY-MM-DD`, xem types.ts) chỉ
  // có độ chính xác tới NGÀY — đây là "ngày giao dịch" người dùng tự chọn,
  // KHÔNG phải thời điểm tạo dòng. Khi nhiều giao dịch cùng 1 ngày (rất phổ
  // biến — nhập nhiều dòng cùng lúc qua AI, hoặc nhập tay trong ngày),
  // `new Date(b.date) - new Date(a.date)` luôn ra 0 cho mọi cặp cùng ngày →
  // Array.sort (dù ổn định từ ES2019) giữ nguyên thứ tự MẢNG GỐC (thứ tự trả
  // về từ query, không đảm bảo phản ánh "vừa thêm") thay vì thứ tự người
  // dùng mong đợi. Sửa: dùng `createdAt` (ISO timestamp thật, `row.created_at`
  // — xem mapRows.ts) làm tiêu chí PHỤ (tie-breaker) khi `date` bằng nhau.
  const sortedList = useMemo(() => {
    return [...filteredList].sort((a, b) => {
      if (sortBy === "date_desc") {
        const byDate = new Date(b.date).getTime() - new Date(a.date).getTime();
        if (byDate !== 0) return byDate;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }
      if (sortBy === "date_asc") {
        const byDate = new Date(a.date).getTime() - new Date(b.date).getTime();
        if (byDate !== 0) return byDate;
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      }
      if (sortBy === "amount_desc") {
        return Math.abs(b.amount) - Math.abs(a.amount);
      }
      if (sortBy === "amount_asc") {
        return Math.abs(a.amount) - Math.abs(b.amount);
      }
      if (sortBy === "category_asc") {
        return a.category.localeCompare(b.category, "vi");
      }
      if (sortBy === "category_desc") {
        return b.category.localeCompare(a.category, "vi");
      }
      if (sortBy === "member_asc") {
        const memA = a.member || "";
        const memB = b.member || "";
        return memA.localeCompare(memB, "vi");
      }
      if (sortBy === "member_desc") {
        const memA = a.member || "";
        const memB = b.member || "";
        return memB.localeCompare(memA, "vi");
      }
      return 0;
    });
  }, [filteredList, sortBy]);

  // Pagination calculations: 20 rows per page
  const totalPages = useMemo(() => {
    return Math.max(1, Math.ceil(sortedList.length / 20));
  }, [sortedList]);

  // Adjust current page if it exceeds total pages
  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [totalPages, currentPage]);

  const paginatedList = useMemo(() => {
    const startIndex = (currentPage - 1) * 20;
    return sortedList.slice(startIndex, startIndex + 20);
  }, [sortedList, currentPage]);

  // Checkbox selection handlers
  const handleToggleSelectAll = () => {
    const visibleIds = paginatedList.map(t => t.id);
    const allSelectedOnPage = visibleIds.length > 0 && visibleIds.every(id => selectedTxIds.includes(id));
    
    if (allSelectedOnPage) {
      // Remove all visible on page from selection
      setSelectedTxIds(prev => prev.filter(id => !visibleIds.includes(id)));
    } else {
      // Add all visible on page to selection (avoid duplicates)
      setSelectedTxIds(prev => {
        const set = new Set([...prev, ...visibleIds]);
        return Array.from(set);
      });
    }
  };

  const handleToggleSelectRow = (id: string) => {
    setSelectedTxIds(prev => 
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const handleDeleteOne = async (id: string) => {
    setWriteError(null);
    // Lấy trước description để hiện trong toast — sau khi optimistic
    // onMutate ẩn dòng khỏi cache, tra lại từ `transactions` (đã map) có
    // thể không còn thấy nó nữa.
    const target = transactions.find((t) => t.id === id);
    try {
      await softDeleteTransaction.mutateAsync(id);
      showToast({
        message: `Đã xoá giao dịch${target ? ` "${target.description}"` : ""}.`,
        actionLabel: "Hoàn tác",
        onAction: () => {
          restoreTransaction.mutate(id, {
            onError: (err: any) =>
              setWriteError(err.message || "Không thể hoàn tác. Giao dịch có thể đã bị xoá vĩnh viễn."),
          });
        },
      });
    } catch (err: any) {
      console.error(err);
      setWriteError(err.message || "Không thể xóa giao dịch.");
    }
  };

  const handleBulkDelete = async () => {
    if (selectedTxIds.length === 0) return;
    if (
      !(await confirm({
        title: "Xoá hàng loạt giao dịch",
        message: `Bạn có chắc chắn muốn xóa hàng loạt ${selectedTxIds.length} giao dịch được chọn không?`,
        confirmLabel: "Xoá",
        variant: "danger",
      }))
    ) {
      return;
    }

    setWriteError(null);
    const ids = [...selectedTxIds];
    try {
      // Tuần tự (không Promise.all) — cùng quy ước với buildTransactionInserts:
      // giữ đúng thứ tự lỗi nếu 1 dòng xoá thất bại giữa chừng, dễ báo cho
      // người dùng biết đã xoá tới đâu.
      for (const id of ids) {
        await softDeleteTransaction.mutateAsync(id);
      }
      setSelectedTxIds([]);
      // T-S07: 1 toast gộp "Hoàn tác tất cả" thay vì alert() cũ — nhất quán
      // với UX xoá đơn lẻ, và cho phép hoàn tác đúng như xoá 1 dòng.
      showToast({
        message: `Đã xoá ${ids.length} giao dịch.`,
        actionLabel: "Hoàn tác tất cả",
        onAction: () => {
          ids.forEach((id) =>
            restoreTransaction.mutate(id, {
              onError: (err: any) =>
                setWriteError(err.message || "Không thể hoàn tác hết. Một số giao dịch có thể đã bị xoá vĩnh viễn."),
            })
          );
        },
      });
    } catch (err: any) {
      console.error(err);
      setWriteError(err.message || "Không thể xóa hết các giao dịch đã chọn.");
    }
  };

  // Generate 45 beautiful mock data items spanning different dates, amounts, and members
  const handleSeedMockData = async () => {
    if (
      !(await confirm({
        title: "[DEV ONLY] Tạo dữ liệu mẫu",
        message: "Bạn có muốn tự động tạo 45 giao dịch mẫu đa dạng để kiểm tra giao diện phân trang, lọc sắp xếp và xóa hàng loạt không?",
      }))
    ) {
      return;
    }

    // T-S06e1b: findBestCategory phải ưu tiên đúng PHE (income/expense),
    // không chỉ so tên — trước đây chỉ so substring trên TÊN category, nên
    // template "Lương"/"Thu nhập" có thể khớp nhầm hoặc rơi vào fallback
    // systemCategoryNames[0] (category ĐẦU TIÊN bất kỳ, có thể là chi tiêu)
    // khi chưa có category income nào tên khớp — biến 1 khoản thu 25 triệu
    // thành 1 dòng chi tiêu sai lệch hoàn toàn, âm thầm phá tổng thu/chi.
    // Giờ luôn ưu tiên tìm trong đúng category.type trước, chỉ fallback
    // sang phe khác nếu hệ thống chưa có category nào thuộc phe đó.
    const findBestCategory = (pref: string, wantType: "income" | "expense" = "expense") => {
      const sameType = categories.filter((c) => c.type === wantType);
      const pool = sameType.length > 0 ? sameType : categories;
      const match = pool.find((c) => c.name.toLowerCase().includes(pref.toLowerCase()));
      return match?.name || pool[0]?.name || categories[0]?.name || "Khác";
    };

    const now = new Date();
    // T-S06e1 / CONSTITUTION §1.2: bỏ hẳn field "mem" trên từng dòng mẫu —
    // member_id giờ LUÔN = người đang đăng nhập, không còn cách nào (kể cả
    // dữ liệu mẫu) gán cho 1 thành viên khác qua client.
    const result: Omit<Transaction, "id" | "createdAt">[] = [];

    const templates: { desc: string; cat: string; amt: number; offset: number; note: string; type?: "income" | "expense" }[] = [
      { desc: "Lương tháng 6 (Chồng)", cat: "Lương", amt: -25000000, offset: 15, note: "Chuyển khoản Vietcombank", type: "income" },
      { desc: "Lương tháng 6 (Vợ)", cat: "Thu nhập", amt: -18000000, offset: 15, note: "Lương Techcombank", type: "income" },
      { desc: "Tiền bán tủ gỗ cũ", cat: "Thu nhập", amt: -1500000, offset: 12, note: "Giao dịch Chợ Tốt", type: "income" },
      { desc: "Hóa đơn tiền điện tháng 6", cat: "Nhà cửa", amt: 1450000, offset: 1, note: "Thanh toán qua ví MoMo" },
      { desc: "Hóa đơn tiền nước", cat: "Nhà cửa", amt: 210000, offset: 2, note: "Thanh toán tự động" },
      { desc: "Hóa đơn Internet Viettel", cat: "Nhà cửa", amt: 275000, offset: 5, note: "Gói NetPlus" },
      { desc: "Đi siêu thị BigC cuối tuần", cat: "Ăn uống", amt: 1240000, offset: 3, note: "Thực phẩm cho cả tuần" },
      { desc: "Mua tã giấy cho em bé", cat: "Mua sắm", amt: 420000, offset: 4, note: "Bỉm Bobby size L" },
      { desc: "Học phí học kỳ 2 của con", cat: "Giáo dục", amt: 3500000, offset: 10, note: "Chuyển khoản cho trường" },
      { desc: "Đổ xăng xe máy Wave", cat: "Di chuyển", amt: 70000, offset: 0, note: "Xăng RON 95" },
      { desc: "Đổ xăng ô tô gia đình", cat: "Di chuyển", amt: 950000, offset: 3, note: "Xăng ô tô" },
      { desc: "Ăn tối lẩu Kichi-Kichi", cat: "Ăn uống", amt: 1100000, offset: 5, note: "Kỷ niệm ngày cưới" },
      { desc: "Thuốc bổ khớp cho bà", cat: "Sức khỏe", amt: 650000, offset: 8, note: "Glucosamine" },
      { desc: "Khám răng định kỳ cho con", cat: "Sức khỏe", amt: 300000, offset: 7, note: "Nha khoa quốc tế" },
      { desc: "Mua sách giáo khoa mới", cat: "Giáo dục", amt: 280000, offset: 11, note: "Sách lớp 8" },
      { desc: "Đăng ký khóa học tiếng Anh", cat: "Giáo dục", amt: 4800000, offset: 14, note: "Khóa giao tiếp" },
      { desc: "Mua váy công sở mới", cat: "Mua sắm", amt: 550000, offset: 2, note: "Váy Zara thanh lịch" },
      { desc: "Cắt tóc nam", cat: "Mua sắm", amt: 100000, offset: 1, note: "Cắt và gội" },
      { desc: "Sửa vòi nước bồn rửa bát", cat: "Nhà cửa", amt: 150000, offset: 4, note: "Thay vòi inox mới" },
      { desc: "Ăn trưa bún chả", cat: "Ăn uống", amt: 45000, offset: 0, note: "Bún chả Sinh Từ" },
      { desc: "Cafe họp nhóm", cat: "Giải trí", amt: 120000, offset: 1, note: "The Coffee House" },
      { desc: "Mua vé xem phim CGV", cat: "Giải trí", amt: 240000, offset: 6, note: "Phim bom tấn cuối tuần" },
      { desc: "Đóng tiền gửi xe tháng", cat: "Di chuyển", amt: 150000, offset: 13, note: "Vé gửi xe chung cư" },
      { desc: "Mua sắm đồ gia dụng Lock&Lock", cat: "Mua sắm", amt: 850000, offset: 9, note: "Hộp bảo quản thực phẩm" },
      { desc: "Thu phí hội đồng chung cư", cat: "Nhà cửa", amt: 320000, offset: 15, note: "Phí quản lý tháng" },
      { desc: "Bánh ngọt cho bữa xế", cat: "Ăn uống", amt: 65000, offset: 0, note: "Bánh bông lan trứng muối" },
      { desc: "Trái cây nhập khẩu siêu thị", cat: "Ăn uống", amt: 340000, offset: 2, note: "Táo Envy và nho ngón tay" },
      { desc: "Mua tai nghe bluetooth mới", cat: "Mua sắm", amt: 1200000, offset: 7, note: "Tai nghe chống ồn" },
      { desc: "Nước rửa chén, bột giặt", cat: "Nhà cửa", amt: 215000, offset: 4, note: "Omo Matic và Sunlight" },
      { desc: "Thưởng dự án xuất sắc", cat: "Thu nhập", amt: -5000000, offset: 6, note: "Công ty thưởng nóng", type: "income" },
      { desc: "Ăn sáng bánh mì pate", cat: "Ăn uống", amt: 25000, offset: 0, note: "Bánh mì Hội An" },
      { desc: "Lịch tập Gym tháng mới", cat: "Sức khỏe", amt: 450000, offset: 12, note: "Thẻ tập Fit24" },
      { desc: "Nạp tiền điện thoại", cat: "Di chuyển", amt: 100000, offset: 1, note: "Thẻ cào Viettel" },
      { desc: "Mua giày thể thao chạy bộ", cat: "Mua sắm", amt: 1850000, offset: 8, note: "Giày Adidas Ultraboost" },
      { desc: "Mua quà sinh nhật cho bạn", cat: "Giải trí", amt: 500000, offset: 5, note: "Quà tặng lưu niệm" },
      { desc: "Trà sữa cùng bạn học", cat: "Ăn uống", amt: 90000, offset: 3, note: "Trà sữa Gongcha" },
      { desc: "Thuốc ho và vitamin C", cat: "Sức khỏe", amt: 110000, offset: 2, note: "Nhà thuốc Pharmacity" },
      { desc: "Đăng ký Netflix gói Premium", cat: "Giải trí", amt: 260000, offset: 14, note: "Chia sẻ 4 thiết bị" },
      { desc: "Thay dầu nhớt xe máy", cat: "Di chuyển", amt: 130000, offset: 10, note: "Dầu Castrol Power1" },
      { desc: "Mua hoa quả thắp hương mùng 1", cat: "Nhà cửa", amt: 180000, offset: 12, note: "Hoa tươi và quả ngũ quả" },
      { desc: "Mua bàn chải điện", cat: "Sức khỏe", amt: 650000, offset: 9, note: "Bàn chải Oral-B" },
      { desc: "Cơm văn phòng buổi trưa", cat: "Ăn uống", amt: 50000, offset: 0, note: "Cơm sườn nướng" },
      { desc: "Mua mũ bảo hiểm mới", cat: "Di chuyển", amt: 250000, offset: 6, note: "Mũ bảo hiểm Andes" },
      { desc: "Dọn dẹp vệ sinh máy lạnh", cat: "Nhà cửa", amt: 350000, offset: 5, note: "Vệ sinh 2 máy lạnh treo tường" },
      { desc: "Tiền mừng đám cưới đồng nghiệp", cat: "Giải trí", amt: 500000, offset: 4, note: "Đám cưới em Nam phòng IT" }
    ];

    templates.forEach((t) => {
      const itemDate = new Date();
      itemDate.setDate(now.getDate() - t.offset);

      result.push({
        description: t.desc,
        amount: t.amt,
        category: findBestCategory(t.cat, t.type ?? "expense"),
        date: itemDate.toLocaleDateString("en-CA"),
        note: t.note,
      });
    });

    setWriteError(null);
    try {
      // Tuần tự qua đúng 1 cửa buildTransactionInsert/createTransaction thật
      // (không còn nhánh onAddTransaction(s) cũ) — member_id tự gán theo
      // scope hiện tại, đúng CONSTITUTION §1.2.
      for (const item of result) {
        await createTransaction.mutateAsync(
          buildTransactionInsert(item, categories, { scopeMode, userId, householdId: household?.id })
        );
      }
      showToast({ message: "Đã thêm thành công 45 giao dịch mẫu ngẫu nhiên rất đa dạng!" });
      setCurrentPage(1);
      setSelectedTxIds([]);
    } catch (err: any) {
      console.error(err);
      setWriteError(err.message || "Không thể tạo hết dữ liệu mẫu.");
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(amount);
  };

  // POLISHED EXPORT TO EXCEL/CSV (With UTF-8 BOM representation)
  const handleExportCSV = () => {
    if (sortedList.length === 0) {
      showToast({ message: "Không có dữ liệu giao dịch nào để xuất!" });
      return;
    }

    const BOM = "\uFEFF";
    const rows: string[] = [];

    // Header metadata
    rows.push("SỔ CHI TIẾT GIAO DỊCH TÀI CHÍNH SMART SPEND");
    
    let timeLabel = "";
    if (timeFilter === "all") timeLabel = "Tất cả";
    else if (timeFilter === "today") timeLabel = "Hôm nay";
    else if (timeFilter === "week") timeLabel = "Tuần này";
    else if (timeFilter === "month") timeLabel = "Tháng này";
    else if (timeFilter === "year") timeLabel = "Năm nay";
    else if (timeFilter === "custom") timeLabel = `Tự chọn (${customStartDate} đến ${customEndDate})`;
    
    rows.push(`Chu kỳ lọc thời gian,${timeLabel}`);
    rows.push(`Danh mục được chọn,${selectedCategory === "all" ? "Tất cả danh mục" : selectedCategory}`);
    rows.push(`Thành viên được lọc,${selectedMember === "all" ? "Tất cả thành viên" : selectedMember === "none" ? "Cá nhân" : selectedMember}`);
    if (search.trim()) {
      rows.push(`Từ khóa tìm kiếm,"${search.replace(/"/g, '""')}"`);
    }
    rows.push(`Sắp xếp theo,${
      sortBy === "date_desc" ? "Mới nhất" :
      sortBy === "date_asc" ? "Cũ nhất" :
      sortBy === "amount_desc" ? "Số tiền giảm dần" :
      sortBy === "amount_asc" ? "Số tiền tăng dần" :
      sortBy === "category_asc" ? "Danh mục A-Z" :
      sortBy === "category_desc" ? "Danh mục Z-A" :
      sortBy === "member_asc" ? "Thành viên A-Z" : "Thành viên Z-A"
    }`);
    rows.push(`Ngày xuất sổ,${new Date().toLocaleString("vi-VN")}`);
    rows.push("");

    // Calculate total sums for selected period
    let totalIncome = 0;
    let totalExpense = 0;
    let totalTransfer = 0;
    sortedList.forEach((t) => {
      // T-S14 (0013, CONSTITUTION §1.9) — 'transfer' (góp quỹ tiết kiệm) là
      // chuyển khoản nội bộ, tách riêng khỏi thu/chi thật.
      if (t.type === "transfer") {
        totalTransfer += t.amount;
        return;
      }
      const isIncome = isIncomeTx(t); // [T-S113] nguồn sự thật txClassify.ts, thay OR tự viết
      if (isIncome) {
        totalIncome += Math.abs(t.amount);
      } else {
        totalExpense += t.amount;
      }
    });
    rows.push(`TỔNG KẾT GIAO DỊCH LỌC`);
    rows.push(`Tổng thu nhập lọc,${totalIncome} VNĐ`);
    rows.push(`Tổng chi tiêu lọc,${totalExpense} VNĐ`);
    rows.push(`Tổng chuyển khoản (góp quỹ tiết kiệm, không tính thu/chi),${totalTransfer} VNĐ`);
    rows.push(`Số dư ròng,${totalIncome - totalExpense} VNĐ`);
    rows.push("");

    // Transaction Details Header row
    rows.push("Mã giao dịch,Mô tả,Loại giao dịch,Số tiền (VNĐ),Số tiền thực tế (VNĐ),Danh mục,Ngày chi tiêu,Thành viên,Ghi chú");

    // Format content
    sortedList.forEach((t) => {
      const isIncome = isIncomeTx(t); // [T-S113] nguồn sự thật txClassify.ts, thay OR tự viết
      const typeLabel = t.type === "transfer" ? "Chuyển khoản" : isIncome ? "Thu nhập" : "Chi tiêu";
      const signedAmount = t.type === "transfer" ? Math.abs(t.amount) : isIncome ? Math.abs(t.amount) : -t.amount;
      
      rows.push([
        t.id,
        `"${t.description.replace(/"/g, '""')}"`,
        typeLabel,
        Math.abs(t.amount),
        signedAmount,
        `"${t.category}"`,
        t.date,
        t.member ? `"${t.member}"` : '""',
        t.note ? `"${t.note.replace(/"/g, '""')}"` : '""',
      ].join(","));
    });

    const csvContent = BOM + rows.join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);

    let filterSuffix = "";
    if (timeFilter === "all") filterSuffix = "Tat_Ca";
    else if (timeFilter === "today") filterSuffix = "Hom_Nay";
    else if (timeFilter === "week") filterSuffix = "Tuan_Nay";
    else if (timeFilter === "month") filterSuffix = "Thang_Nay";
    else if (timeFilter === "year") filterSuffix = "Nam_Nay";
    else if (timeFilter === "custom") filterSuffix = `${customStartDate}_den_${customEndDate}`;

    link.setAttribute("download", `So_Giao_Dich_SmartSpend_${filterSuffix}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="bg-(--sst-surface) rounded-2xl shadow-sm border border-(--sst-border) p-4 sm:p-6 space-y-4 sm:space-y-5" id="transaction-history-section">
      {/* [BUGFIX 08/08/2026] `writeError` được set ở handleManualAdd/handleSaveEdit/
          handleDeleteOne/handleBulkDelete nhưng trước đây KHÔNG render ở đâu cả —
          mọi lỗi bị chặn quyền (RLS/RPC raise, vd "Bạn không có quyền xoá giao
          dịch này.") biến mất im lặng, người dùng không biết vì sao thao tác
          không có tác dụng. Banner này đảm bảo MỌI lỗi ghi (thêm/sửa/xoá) đều
          hiển thị rõ, có nút đóng. */}
      {writeError && (
        <div className="flex items-start gap-2 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/25 text-rose-700 dark:text-rose-300 text-xs sm:text-sm font-semibold px-3.5 py-2.5 rounded-xl">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="flex-1">{writeError}</span>
          <button
            onClick={() => setWriteError(null)}
            className="text-rose-400 hover:text-rose-600 dark:hover:text-rose-300 cursor-pointer shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 rounded"
            title="Đóng thông báo"
            aria-label="Đóng thông báo"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Header Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 pb-2 sm:pb-0">
        <div>
          <h2 className="text-base sm:text-lg font-bold text-(--sst-text) flex items-center gap-2">
            <BookOpen className="w-4.5 h-4.5 sm:w-5 sm:h-5 text-indigo-500 dark:text-indigo-300 shrink-0" />
            Sổ Ghi Chép Giao Dịch
          </h2>
          <p className="text-[11px] sm:text-xs text-(--sst-text-muted) mt-1 font-medium leading-tight">
            Danh sách các khoản thu chi thủ công và tự động.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto mt-1 sm:mt-0">
          {/* [T-S126, 22/08/2026] Chỉ hiện khi chạy `npm run dev` (local) —
              production build (`npm run build`, đây là bản Vercel deploy
              thật người dùng đang dùng) sẽ KHÔNG có nút này, tránh người
              dùng thật vô tình bấm làm bẩn dữ liệu thật của họ. */}
          {import.meta.env.DEV && (
            <button
              onClick={handleSeedMockData}
              className="px-3 py-2 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 rounded-xl border border-indigo-100 dark:border-indigo-500/25 transition-all text-xs font-bold flex items-center justify-center gap-1 cursor-pointer"
              title="[DEV ONLY] Tự động tạo 45 giao dịch mẫu để test phân trang và xóa"
            >
              <Database className="w-4 h-4 text-indigo-600 dark:text-indigo-300 shrink-0" />
              <span className="truncate">Tạo 45 hàng mẫu</span>
            </button>
          )}

          <button
            onClick={handleExportCSV}
            className="px-3 py-2 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 rounded-xl border border-emerald-100 dark:border-emerald-500/25 transition-all text-xs font-bold flex items-center justify-center gap-1 cursor-pointer"
            title="Xuất báo cáo sang Excel/CSV tiếng Việt"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-600 dark:text-emerald-300 shrink-0" />
            <span className="truncate">Xuất Excel</span>
          </button>

          <button
            onClick={() => setIsAdding(!isAdding)}
            className="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl transition-all text-xs font-bold flex items-center justify-center gap-1 cursor-pointer shadow-sm active:scale-98"
          >
            <Plus className="w-4 h-4 shrink-0" />
            <span className="truncate">Ghi chi tiêu</span>
          </button>
        </div>
      </div>

      {/* Manual Entry Form */}
      {isAdding && (
        <form
          onSubmit={handleManualAdd}
          className="bg-(--sst-surface-2) border border-(--sst-border) rounded-xl p-4 space-y-4 relative"
        >
          <button
            type="button"
            className="absolute top-3 right-3 text-(--sst-text-muted) hover:text-(--sst-text) p-1 rounded-full hover:bg-(--sst-surface-hover)/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            onClick={() => setIsAdding(false)}
            title="Đóng"
            aria-label="Đóng form thêm giao dịch"
          >
            <X className="w-4 h-4" />
          </button>

          <h3 className="text-xs font-bold text-(--sst-text-secondary) uppercase tracking-wider mb-2">Thêm giao dịch thủ công</h3>

          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3.5">
            <div className="col-span-2 lg:col-span-1">
              <label className="block text-xs font-semibold text-(--sst-text-secondary) mb-1">Mô tả giao dịch *</label>
              <input
                type="text"
                placeholder="Ví dụ: Ăn trưa, đổ xăng..."
                className="w-full text-xs bg-(--sst-surface) border border-(--sst-border-strong) focus:border-indigo-500 rounded-lg px-3 py-2 outline-none transition-all"
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                required
              />
            </div>

            <div className="col-span-1 lg:col-span-1">
              <label className="block text-xs font-semibold text-(--sst-text-secondary) mb-1">Số tiền (VNĐ) *</label>
              <input
                type="number"
                placeholder="Ví dụ: 45000"
                className="w-full text-xs bg-(--sst-surface) border border-(--sst-border-strong) focus:border-indigo-500 rounded-lg px-3 py-2 outline-none transition-all"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
              />
            </div>

            <div className="col-span-1 lg:col-span-1">
              <label className="block text-xs font-semibold text-(--sst-text-secondary) mb-1">Danh mục *</label>
              {/* T-S06e1b (fix): dropdown này trước đó liệt kê phẳng mọi
                  category (thu lẫn chi trộn lẫn, không phân biệt) — khác
                  với 2 optgroup 💵 Thu nhập / 🧾 Chi tiêu đã áp ở
                  SmartInput.tsx/AIAssistantBubble.tsx cho cùng use case
                  "tạo giao dịch mới". buildTransactionInsert vẫn suy đúng
                  `type` từ category.type dù có optgroup hay không (không
                  phải lỗi dữ liệu) — đây là sửa cho ĐỒNG NHẤT UI, để người
                  dùng thấy rõ đang chọn danh mục thu hay chi trước khi ghi
                  sổ, tránh nhầm giữa nhiều category income mới. */}
              <select
                className={`w-full text-xs bg-(--sst-surface) border rounded-lg px-2 py-2 outline-none transition-all cursor-pointer ${
                  catMatched
                    ? "text-(--sst-text) border-(--sst-border-strong) focus:border-indigo-500"
                    : "text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-500/25 focus:border-amber-500"
                }`}
                value={cat}
                onChange={(e) => setCat(e.target.value)}
              >
                {!catMatched && (
                  <option value="" disabled>
                    -- Chọn danh mục --
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
              {/* [T-S22b 09/08/2026] Cảnh báo inline ngay dưới field, cùng vị
                  trí/kiểu chữ amber như SmartInput.tsx — trước đây chỉ có
                  banner đỏ chung ở đầu trang lúc submit fail, không rõ ràng
                  bằng, người test không nhận ra là bị chặn. */}
              {!catMatched && (
                <p className="text-[10px] text-amber-600 dark:text-amber-300 font-medium mt-1">
                  Vui lòng chọn 1 danh mục có sẵn trước khi ghi sổ.
                </p>
              )}
            </div>

            <div className="col-span-1 lg:col-span-1">
              <label className="block text-xs font-semibold text-(--sst-text-secondary) mb-1">Ngày chi tiêu</label>
              <input
                type="date"
                className="w-full text-xs bg-(--sst-surface) border border-(--sst-border-strong) focus:border-indigo-500 rounded-lg px-2.5 py-2 outline-none transition-all text-(--sst-text-secondary)"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </div>

            {/* T-S06e1 / CONSTITUTION §1.2: member_id không còn chọn được — hộ
                gia đình luôn = người đang đăng nhập (khoá, hiển thị tên thật,
                không phải email); cá nhân thì ẩn hẳn (không có khái niệm này). */}
            {scopeMode === "household" && (
              <div className="col-span-1 lg:col-span-1">
                <label className="block text-xs font-semibold text-(--sst-text-secondary) mb-1">Thành viên chi tiêu</label>
                <div className="w-full text-xs text-(--sst-text-secondary) bg-(--sst-surface-2) border border-(--sst-border-strong) rounded-lg px-2.5 py-2">
                  👤 {currentMember ? formatMemberDisplayName(currentMember) : "Bạn"}
                </div>
              </div>
            )}
          </div>

          {/* [T-S49 10/08/2026 — thay thế T-S33/T-S45, CONSTITUTION §1.14]
              Banner MỀM "Gắn vào mục tiêu" — không còn khoá nút Ghi Sổ,
              không còn khớp theo tên category. Hiện khi mô tả/ghi chú khớp
              tên ≥1 goal active hoặc đã có goalId gắn sẵn. Kèm nút
              "+ Tạo mục tiêu mới" (cùng pattern SmartInput.tsx). */}
          {isSavingsCat && (
            <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/25 p-2.5 rounded-lg text-xs space-y-2">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <span className="text-amber-800 dark:text-amber-300 font-medium flex items-center gap-1">
                  <PiggyBank className="w-3.5 h-3.5 text-amber-500 dark:text-amber-300 shrink-0" />
                  {!goalId && matchedContributionGoals.length > 0
                    ? `Mô tả có vẻ khớp mục tiêu "${matchedContributionGoals[0].name}"${
                        matchedContributionGoals.length > 1 ? " (và mục khác)" : ""
                      } — gắn vào?`
                    : !goalId
                    ? "Giao dịch này có vẻ liên quan tiết kiệm/góp quỹ — gắn vào 1 mục tiêu có sẵn hoặc tạo mới?"
                    : "Gắn giao dịch này vào 1 mục tiêu tiết kiệm (không bắt buộc):"}
                </span>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-amber-600 dark:text-amber-300 font-bold">Gắn vào:</span>
                  <select
                    className="bg-(--sst-surface) border border-amber-200 dark:border-amber-500/25 rounded text-amber-900 dark:text-amber-300 px-2 py-1 outline-none text-xs cursor-pointer font-semibold"
                    value={goalId}
                    onChange={(e) => setGoalId(e.target.value)}
                  >
                    <option value="">-- Không tích lũy --</option>
                    {availableGoalsForForm.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name} (Đã có: {new Intl.NumberFormat("vi-VN").format(g.currentAmount)}đ)
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {goalDraftOpen ? (
                <div className="flex items-center gap-1.5 pt-2 border-t border-amber-100 dark:border-amber-500/25">
                  <input
                    type="text"
                    className="flex-1 bg-(--sst-surface) border border-amber-200 dark:border-amber-500/25 rounded px-2 py-1 text-xs outline-none"
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
                    onClick={handleCreateGoalInline}
                  >
                    {isCreatingGoal ? "Đang tạo..." : "Tạo"}
                  </button>
                  <button
                    type="button"
                    className="px-2.5 py-2 bg-(--sst-surface) hover:bg-amber-100 dark:hover:bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-500/25 rounded text-[11px] font-medium cursor-pointer"
                    onClick={() => {
                      setGoalDraftOpen(false);
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
                  className="-m-2 p-2 text-[11px] text-amber-700 hover:text-amber-900 dark:hover:text-amber-300 underline font-medium cursor-pointer"
                  onClick={() => {
                    setGoalDraftOpen(true);
                    setGoalDraftName("");
                    setGoalDraftError(null);
                  }}
                >
                  + Tạo mục tiêu mới
                </button>
              )}
              {goalDraftOpen && goalDraftError && (
                <p className="text-[10px] text-rose-600 dark:text-rose-300 font-medium">{goalDraftError}</p>
              )}
            </div>
          )}

          {/* [T-S76 — CONSTITUTION §1.22.1, CHỐT 14/08/2026] Banner "Đánh dấu
              hoàn thành mục tiêu" — bổ sung mới ở Sổ Giao Dịch (gap thật so
              với SmartInput.tsx/AIAssistantBubble.tsx, xem T-S20/T-S59).
              Loại trừ lẫn nhau với banner "Gắn vào mục tiêu" (amber, góp
              quỹ) qua `goalId` — 1 giao dịch không thể vừa transfer-góp quỹ
              vừa expense-hoàn thành, cùng ràng buộc đã áp ở SmartInput.tsx. */}
          {!goalId && matchedCompletionGoals.length > 0 && (() => {
            const isDismissed = goalCompletionChoice === "";
            const confirmedGoal = goalCompletionChoice
              ? matchedCompletionGoals.find((g) => g.id === goalCompletionChoice)
              : undefined;

            if (isDismissed) {
              return (
                <button
                  type="button"
                  className="-m-2 p-2 text-[10px] text-(--sst-text-muted) hover:text-teal-600 dark:hover:text-teal-300 underline cursor-pointer"
                  onClick={() => setGoalCompletionChoice(undefined)}
                >
                  Đã bỏ qua gợi ý hoàn thành mục tiêu tiết kiệm — hoàn tác?
                </button>
              );
            }

            return (
              <div className="bg-teal-50 dark:bg-teal-500/10 border border-teal-100 dark:border-teal-500/25 p-2.5 rounded-lg text-xs space-y-2">
                <div className="flex items-start gap-1.5 text-teal-800 dark:text-teal-300 font-medium">
                  <PiggyBank className="w-3.5 h-3.5 text-teal-500 dark:text-teal-300 mt-0.5 shrink-0" />
                  {confirmedGoal ? (
                    <span>✅ Sẽ đánh dấu hoàn thành mục tiêu "{confirmedGoal.name}" khi ghi sổ giao dịch này.</span>
                  ) : matchedCompletionGoals.length === 1 ? (
                    <span>
                      Giao dịch này có vẻ là mua sắm cho mục tiêu tiết kiệm đã gom đủ "{matchedCompletionGoals[0].name}"
                      — đánh dấu hoàn thành mục tiêu này?
                    </span>
                  ) : (
                    <span>
                      Giao dịch này có vẻ khớp với nhiều mục tiêu tiết kiệm đã gom đủ — chọn 1 để đánh dấu hoàn thành
                      (hoặc bỏ qua):
                    </span>
                  )}
                </div>

                {confirmedGoal ? (
                  <button
                    type="button"
                    className="px-2.5 py-2 bg-(--sst-surface) hover:bg-teal-100 dark:hover:bg-teal-500/10 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-500/25 rounded-md text-[11px] font-medium cursor-pointer"
                    onClick={() => setGoalCompletionChoice(undefined)}
                  >
                    Đổi ý
                  </button>
                ) : matchedCompletionGoals.length === 1 ? (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="px-2.5 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-md text-[11px] font-semibold cursor-pointer"
                      onClick={() => setGoalCompletionChoice(matchedCompletionGoals[0].id)}
                    >
                      Đánh dấu hoàn thành
                    </button>
                    <button
                      type="button"
                      className="px-2.5 py-2 bg-(--sst-surface) hover:bg-teal-100 dark:hover:bg-teal-500/10 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-500/25 rounded-md text-[11px] font-medium cursor-pointer"
                      onClick={() => setGoalCompletionChoice("")}
                    >
                      Bỏ qua
                    </button>
                  </div>
                ) : (
                  <select
                    className="bg-(--sst-surface) border border-teal-200 dark:border-teal-500/25 rounded text-teal-900 dark:text-teal-300 px-2 py-1 outline-none text-xs cursor-pointer font-semibold w-full"
                    value={goalCompletionChoice || ""}
                    onChange={(e) => setGoalCompletionChoice(e.target.value)}
                  >
                    <option value="">-- Bỏ qua --</option>
                    {matchedCompletionGoals.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name} (Đã tích lũy: {new Intl.NumberFormat("vi-VN").format(g.currentAmount)}đ)
                      </option>
                    ))}
                  </select>
                )}
              </div>
            );
          })()}

          {completionWarning && (
            <p className="text-[11px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/25 rounded-lg px-2.5 py-2">
              ⚠️ {completionWarning}
            </p>
          )}

          <div>
            <label className="block text-xs font-semibold text-(--sst-text-secondary) mb-1">Ghi chú (Tùy chọn)</label>
            <input
              type="text"
              placeholder="Thêm thông tin bổ sung..."
              className="w-full text-sm bg-(--sst-surface) border border-(--sst-border-strong) focus:border-indigo-500 rounded-lg px-3 py-2 outline-none transition-all"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          <div className="flex justify-end gap-2 text-xs">
            <button
              type="button"
              className="px-4 py-2 bg-(--sst-surface-2) hover:bg-(--sst-surface-hover) rounded-lg font-medium text-(--sst-text) transition-all cursor-pointer"
              onClick={() => setIsAdding(false)}
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={!catMatched}
              title={!catMatched ? "Vui lòng chọn 1 danh mục có sẵn trước khi ghi sổ." : undefined}
              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg shadow-sm transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-indigo-600"
            >
              Ghi Sổ
            </button>
          </div>
        </form>
      )}

      {/* Filter and Search Bar */}
      <div className="bg-(--sst-surface-2)/50 border border-(--sst-border) rounded-2xl p-3 sm:p-4 space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5">
          {/* Search */}
          <div className="relative col-span-2 md:col-span-2">
            <span className="absolute left-3 top-3 text-(--sst-text-muted)">
              <Search className="w-3.5 h-3.5" />
            </span>
            <input
              type="text"
              placeholder="Tìm kiếm giao dịch, ghi chú..."
              className="w-full pl-8.5 pr-3 py-2 text-xs bg-(--sst-surface) border border-(--sst-border-strong) focus:border-indigo-500 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500/10 transition-all"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {/* Category selector filter */}
          <div className="relative col-span-1">
            <span className="absolute left-2.5 top-3 text-(--sst-text-muted)">
              <Filter className="w-3.5 h-3.5" />
            </span>
            <select
              className="w-full pl-7.5 pr-2 py-2 text-[11px] sm:text-xs bg-(--sst-surface) border border-(--sst-border-strong) focus:border-indigo-500 rounded-xl outline-none text-(--sst-text) transition-all cursor-pointer appearance-none truncate"
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
            >
              <option value="all">Tất cả danh mục</option>
              {categories.map((c) => (
                <option key={c.id} value={c.name}>
                  {c.icon} {c.name}
                </option>
              ))}
            </select>
          </div>

          {/* Member selector filter */}
          <div className="relative col-span-1">
            <span className="absolute left-2.5 top-3 text-(--sst-text-muted)">
              <User className="w-3.5 h-3.5" />
            </span>
            <select
              className="w-full pl-7.5 pr-2 py-2 text-[11px] sm:text-xs bg-(--sst-surface) border border-(--sst-border-strong) focus:border-indigo-500 rounded-xl outline-none text-(--sst-text) transition-all cursor-pointer appearance-none truncate"
              value={selectedMember}
              onChange={(e) => setSelectedMember(e.target.value)}
            >
              <option value="all">Tất cả thành viên</option>
              <option value="none">Chỉ cá nhân</option>
              {memberRows.map((m) => (
                <option key={m.id} value={m.name}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>

          {/* Sort selector filter */}
          <div className="relative col-span-2 md:col-span-1">
            <span className="absolute left-2.5 top-3 text-(--sst-text-muted)">
              <ArrowUpDown className="w-3.5 h-3.5" />
            </span>
            <select
              className="w-full pl-7.5 pr-2 py-2 text-[11px] sm:text-xs bg-(--sst-surface) border border-(--sst-border-strong) focus:border-indigo-500 rounded-xl outline-none text-(--sst-text) transition-all cursor-pointer appearance-none truncate font-semibold"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
            >
              <option value="date_desc">📅 Mới nhất</option>
              <option value="date_asc">📅 Cũ nhất</option>
              <option value="amount_desc">💰 Số tiền giảm dần</option>
              <option value="amount_asc">💰 Số tiền tăng dần</option>
              <option value="category_asc">🗂️ Danh mục A-Z</option>
              <option value="category_desc">🗂️ Danh mục Z-A</option>
              <option value="member_asc">👤 Thành viên A-Z</option>
              <option value="member_desc">👤 Thành viên Z-A</option>
            </select>
          </div>
        </div>

        {/* Time filter controls */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pt-1 border-t border-(--sst-border)/60">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-bold text-(--sst-text-muted) uppercase tracking-wider mr-1">Thời gian:</span>
            {([
              { id: "all", label: "Tất cả" },
              { id: "today", label: "Hôm nay" },
              { id: "week", label: "Tuần này" },
              { id: "month", label: "Tháng này" },
              { id: "year", label: "Năm nay" },
              { id: "custom", label: "Tự chọn" },
            ] as { id: "all" | "today" | "week" | "month" | "year" | "custom"; label: string }[]).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setTimeFilter(tab.id)}
                className={`text-[11px] px-2.5 py-1 rounded-lg font-medium transition-all cursor-pointer ${
                  timeFilter === tab.id
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "bg-(--sst-surface) hover:bg-(--sst-surface-hover) text-(--sst-text-secondary) border border-(--sst-border-strong)/60"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {timeFilter === "custom" && (
            <div className="flex items-center gap-2 text-xs self-start md:self-auto">
              <input
                type="date"
                className="bg-(--sst-surface) border border-(--sst-border-strong) rounded-lg px-2.5 py-1 outline-none text-(--sst-text) text-[11px]"
                value={customStartDate}
                onChange={(e) => setCustomStartDate(e.target.value)}
              />
              <span className="text-(--sst-text-muted)">đến</span>
              <input
                type="date"
                className="bg-(--sst-surface) border border-(--sst-border-strong) rounded-lg px-2.5 py-1 outline-none text-(--sst-text) text-[11px]"
                value={customEndDate}
                onChange={(e) => setCustomEndDate(e.target.value)}
              />
            </div>
          )}
        </div>
      </div>

      {/* Bulk actions banner */}
      {selectedTxIds.length > 0 && (
        <div className="bg-rose-50 dark:bg-rose-500/10 border border-rose-100 dark:border-rose-500/25 rounded-xl p-3.5 px-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-fadeIn">
          <div className="flex items-center gap-2">
            <span className="w-2 rounded-full bg-rose-500 animate-pulse shrink-0 h-2" />
            <span className="text-xs font-bold text-rose-800 dark:text-rose-300">
              Đang chọn <strong className="text-sm font-black">{selectedTxIds.length}</strong> giao dịch để xử lý
            </span>
          </div>
          <div className="flex items-center gap-2 self-end sm:self-auto">
            <button
              onClick={() => setSelectedTxIds([])}
              className="px-3 py-1 bg-(--sst-surface) hover:bg-(--sst-surface-hover) text-(--sst-text-secondary) rounded-lg text-xs font-semibold border border-(--sst-border-strong) cursor-pointer shadow-xs transition-all"
            >
              Hủy chọn
            </button>
            <button
              onClick={handleBulkDelete}
              className="px-3.5 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-xs transition-all"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Xóa hàng loạt ({selectedTxIds.length})
            </button>
          </div>
        </div>
      )}

      {/* Transaction List Table - Desktop & Tablet */}
      <div className="hidden md:block border border-(--sst-border) rounded-2xl overflow-hidden shadow-sm bg-(--sst-surface)">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs sm:text-sm">
            <thead>
              <tr className="bg-(--sst-surface-2)/60 border-b border-(--sst-border) text-(--sst-text-secondary) font-bold text-xs uppercase tracking-wider">
                {isHouseholdOwner && (
                  <th className="py-3.5 px-4 w-10 text-center">
                    <input
                      type="checkbox"
                      className="rounded border-(--sst-border-strong) text-indigo-600 dark:text-indigo-300 focus:ring-indigo-500 cursor-pointer h-4 w-4 p-2 -m-2"
                      checked={paginatedList.length > 0 && paginatedList.every(t => selectedTxIds.includes(t.id))}
                      onChange={handleToggleSelectAll}
                    />
                  </th>
                )}
                <th className="py-3.5 px-4">Giao dịch</th>
                <th className="py-3.5 px-4">Danh mục</th>
                <th className="py-3.5 px-4">Ngày</th>
                <th className="py-3.5 px-4">Ghi chú</th>
                <th className="py-3.5 px-4 text-right">Số tiền</th>
                <th className="py-3.5 px-4 text-center">Hành động</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-(--sst-border) text-xs sm:text-sm">
              {isLoadingTransactions ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={`skeleton-${i}`}>
                    <td colSpan={7} className="py-2.5 px-4">
                      <div className="animate-pulse bg-(--sst-surface-2) rounded-lg h-9 w-full" />
                    </td>
                  </tr>
                ))
              ) : paginatedList.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-(--sst-text-muted) text-xs italic">
                    Không tìm thấy giao dịch nào phù hợp.
                  </td>
                </tr>
              ) : (
                paginatedList.map((t) => {
                  const catObj = categories.find((c) => c.name === t.category);
                  const isIncome = isIncomeTx(t); // [T-S113] nguồn sự thật txClassify.ts, thay OR tự viết

                  if (editingTxId === t.id) {
                    return (
                      <tr key={t.id} className="bg-indigo-50/40 dark:bg-indigo-500/10 border-y border-indigo-100/60 dark:border-indigo-500/25">
                        <td className="py-2.5 px-4 text-center">
                          <input
                            type="checkbox"
                            disabled
                            className="rounded border-(--sst-border-strong) text-indigo-600 dark:text-indigo-300 opacity-50 cursor-not-allowed h-4 w-4"
                          />
                        </td>
                        {/* Edit Description & Member */}
                        <td className="py-2.5 px-4 min-w-[200px]">
                          <input
                            type="text"
                            className="w-full text-xs font-semibold bg-(--sst-surface) border border-(--sst-border-strong) focus:border-indigo-500 rounded px-2.5 py-1.5 outline-none mb-1.5 shadow-sm"
                            value={editDesc}
                            onChange={(e) => setEditDesc(e.target.value)}
                            placeholder="Tên giao dịch..."
                            required
                          />
                          {/* T-S06e1 / CONSTITUTION §1.2: người thực hiện cố định từ lúc
                              tạo, không sửa được — chỉ hiển thị lại, bỏ hẳn dropdown chọn. */}
                          {t.member && (
                            <div className="w-full text-[11px] text-(--sst-text-secondary) px-1">👤 {t.member}</div>
                          )}
                        </td>

                        {/* Edit Category (+ toggle Thu/Chi, T-S23 CONSTITUTION §1.10) */}
                        <td className="py-2.5 px-4">
                          {/* [T-S23] Toggle đổi loại — chỉ hiện khi được phép (không phải
                              transfer, không gắn goal_id). Giao dịch transfer/có goal hiện
                              badge tĩnh giải thích vì sao khoá, không có toggle. */}
                          {canChangeType(t) ? (
                            <div className="inline-flex rounded-lg border border-(--sst-border-strong) overflow-hidden shadow-sm text-[10px] font-bold mb-1.5">
                              <button
                                type="button"
                                onClick={() => handleToggleEditType("expense")}
                                className={`px-2 py-1 cursor-pointer transition-all ${
                                  editType === "expense" ? "bg-slate-700 text-white" : "bg-(--sst-surface) text-(--sst-text-secondary) hover:bg-(--sst-surface-hover)"
                                }`}
                              >
                                🧾 Chi
                              </button>
                              <button
                                type="button"
                                onClick={() => handleToggleEditType("income")}
                                className={`px-2 py-1 cursor-pointer transition-all border-l border-(--sst-border-strong) ${
                                  editType === "income" ? "bg-emerald-600 text-white" : "bg-(--sst-surface) text-(--sst-text-secondary) hover:bg-(--sst-surface-hover)"
                                }`}
                              >
                                💵 Thu
                              </button>
                            </div>
                          ) : (
                            <div
                              className="text-[9px] text-(--sst-text-muted) font-medium mb-1"
                              title={
                                t.type === "transfer"
                                  ? "Giao dịch chuyển khoản (góp quỹ) không đổi được loại."
                                  : "Giao dịch đã gắn mục tiêu tiết kiệm — gỡ mục tiêu trước để đổi loại."
                              }
                            >
                              {t.type === "transfer" ? "🔒 Chuyển khoản" : "🔒 Đã gắn mục tiêu"}
                            </div>
                          )}
                          {/* T-S06e1b (thay fix 06/08/2026): categories.type (DB thật) giờ
                              cho nhiều category THU NHẬP thật (Lương, Thưởng...) — không
                              còn khoá cứng thành nhãn tĩnh "Thu nhập" nữa.
                              [T-S23, CONSTITUTION §1.10] `type` giờ đổi được (income <->
                              expense) qua toggle bên trên — dropdown lọc theo `editType`
                              (phe ĐANG CHỌN trong form, có thể khác `t.type` gốc nếu vừa
                              bấm toggle), KHÔNG còn lọc theo `t.type` cố định như trước
                              T-S23.
                              [BUGFIX T-S24 08/08/2026] Giao dịch `type='transfer'` (góp quỹ
                              tiết kiệm) KHÔNG thuộc phe income/expense nào, không cho đổi
                              type (xem `canChangeType`) — `category_id` của nó chỉ giữ lại
                              để hiện badge LỊCH SỬ (CONSTITUTION §1.9/T-S14). Hiện TOÀN BỘ
                              category (không lọc theo type) — đúng tinh thần "chỉ hiển thị
                              lịch sử, không ép nhóm". */}
                          <select
                            className="w-full text-xs bg-(--sst-surface) border border-(--sst-border-strong) focus:border-indigo-500 rounded px-2 py-1.5 outline-none text-(--sst-text) shadow-sm cursor-pointer"
                            value={editCat}
                            onChange={(e) => setEditCat(e.target.value)}
                          >
                            <option value="" disabled>
                              — Chọn danh mục —
                            </option>
                            {categories
                              .filter((c) => (t.type === "transfer" ? true : editType === "income" ? c.type === "income" : c.type !== "income"))
                              .map((c) => (
                                <option key={c.id} value={c.name}>
                                  {c.icon} {c.name}
                                </option>
                              ))}
                          </select>
                        </td>

                        {/* Edit Date */}
                        <td className="py-2.5 px-4">
                          <input
                            type="date"
                            className="w-full text-xs bg-(--sst-surface) border border-(--sst-border-strong) focus:border-indigo-500 rounded px-2 py-1 outline-none shadow-sm text-(--sst-text-secondary)"
                            value={editDate}
                            onChange={(e) => setEditDate(e.target.value)}
                          />
                        </td>

                        {/* Edit Note */}
                        <td className="py-2.5 px-4 min-w-[150px]">
                          <input
                            type="text"
                            className="w-full text-xs bg-(--sst-surface) border border-(--sst-border-strong) focus:border-indigo-500 rounded px-2 py-1.5 outline-none shadow-sm"
                            value={editNote}
                            onChange={(e) => setEditNote(e.target.value)}
                            placeholder="Ghi chú cụ thể..."
                          />
                        </td>

                        {/* Edit Amount */}
                        <td className="py-2.5 px-4 text-right">
                          <input
                            type="number"
                            className="w-28 text-right text-xs font-bold text-indigo-600 dark:text-indigo-300 bg-(--sst-surface) border border-(--sst-border-strong) focus:border-indigo-500 rounded px-2.5 py-1.5 outline-none shadow-sm"
                            value={editAmount}
                            onChange={(e) => setEditAmount(e.target.value)}
                            placeholder="Số tiền..."
                            required
                          />
                        </td>

                        {/* Edit Action buttons */}
                        <td className="py-2.5 px-4 text-center whitespace-nowrap">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              onClick={handleSaveEdit}
                              disabled={!editCatMatched}
                              className="p-1.5 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 hover:bg-emerald-100 rounded border border-emerald-200 dark:border-emerald-500/25 cursor-pointer shadow-sm disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-emerald-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                              title={editCatMatched ? "Lưu thay đổi" : "Chọn danh mục hợp lệ trước khi lưu"}
                              aria-label={editCatMatched ? "Lưu thay đổi" : "Chọn danh mục hợp lệ trước khi lưu"}
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => setEditingTxId(null)}
                              className="p-1.5 bg-(--sst-surface-2) text-(--sst-text-secondary) hover:bg-(--sst-surface-hover) rounded border border-(--sst-border-strong) cursor-pointer shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                              title="Hủy"
                              aria-label="Hủy sửa giao dịch"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  }

                  return (
                    <tr key={t.id} className={`hover:bg-(--sst-surface-hover)/40 transition-colors ${selectedTxIds.includes(t.id) ? "bg-indigo-50/20 dark:bg-indigo-500/10" : ""}`}>
                      {/* Checkbox */}
                      {isHouseholdOwner && (
                        <td className="py-3.5 px-4 text-center">
                          <input
                            type="checkbox"
                            className="rounded border-(--sst-border-strong) text-indigo-600 dark:text-indigo-300 focus:ring-indigo-500 cursor-pointer h-4 w-4 p-2 -m-2"
                            checked={selectedTxIds.includes(t.id)}
                            onChange={() => handleToggleSelectRow(t.id)}
                          />
                        </td>
                      )}

                      {/* Name / Description */}
                      <td className="py-3.5 px-4">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-semibold text-(--sst-text)">{t.description}</span>
                          {t.member && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-100/60 dark:border-amber-500/25 shadow-xs">
                              👤 {t.member}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Category */}
                      <td className="py-3.5 px-4 shrink-0">
                        <span className="inline-flex items-center gap-1 bg-(--sst-surface-2) text-(--sst-text-secondary) px-2 py-1 rounded-lg border border-(--sst-border-strong)/50 text-xs font-medium">
                          <span>{catObj ? catObj.icon : "📦"}</span>
                          <span>{t.category}</span>
                        </span>
                      </td>

                      {/* Date */}
                      <td className="py-3.5 px-4 text-xs text-(--sst-text-secondary) whitespace-nowrap font-medium">
                        {new Date(t.date).toLocaleDateString("vi-VN")}
                      </td>

                      {/* Note */}
                      <td className="py-3.5 px-4 text-xs text-(--sst-text-muted) max-w-[200px] truncate" title={t.note}>
                        {t.note || "-"}
                      </td>

                      {/* Amount */}
                      <td className="py-3.5 px-4 text-right">
                        {t.type === "transfer" && (
                          <span className="block text-[9px] font-bold text-indigo-500 dark:text-indigo-300 uppercase tracking-wide mb-0.5">
                            Chuyển khoản
                          </span>
                        )}
                        <span
                          className={`font-bold ${
                            t.type === "transfer" ? "text-indigo-600 dark:text-indigo-300" : isIncome ? "text-emerald-600 dark:text-emerald-300" : "text-(--sst-text)"
                          }`}
                        >
                          {t.type === "transfer" ? "" : isIncome ? "+" : "-"}
                          {formatCurrency(Math.abs(t.amount))}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-center whitespace-nowrap">
                        {confirmDeleteTxId === t.id ? (
                          <div className="flex items-center justify-center gap-1 bg-rose-50 dark:bg-rose-500/10 border border-rose-100 dark:border-rose-500/25 p-1 rounded-lg">
                            <span className="text-[10px] font-bold text-rose-700 dark:text-rose-300 px-1">Xóa?</span>
                            <button
                              onClick={() => {
                                handleDeleteOne(t.id);
                                setConfirmDeleteTxId(null);
                              }}
                              className="px-2 py-0.5 bg-rose-600 hover:bg-rose-700 text-white font-bold text-[10px] rounded cursor-pointer"
                            >
                              Xóa
                            </button>
                            <button
                              onClick={() => setConfirmDeleteTxId(null)}
                              className="px-2 py-0.5 bg-(--sst-surface-2) hover:bg-(--sst-surface-hover) text-(--sst-text) font-semibold text-[10px] rounded cursor-pointer"
                            >
                              Hủy
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-center gap-1">
                            {canModifyTx(t) ? (
                              <button
                                onClick={() => handleStartEdit(t)}
                                className="p-1.5 text-(--sst-text-muted) hover:text-indigo-600 dark:hover:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 rounded-lg transition-all cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                                title="Sửa giao dịch"
                                aria-label="Sửa giao dịch"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                            ) : (
                              <button
                                onClick={() =>
                                  setWriteError(
                                    "Bạn chỉ có thể sửa giao dịch của chính mình. Giao dịch này thuộc về thành viên khác trong hộ."
                                  )
                                }
                                className="p-1.5 text-(--sst-text-faint) cursor-not-allowed rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                                title="Không có quyền sửa giao dịch của thành viên khác"
                                aria-label="Không có quyền sửa giao dịch của thành viên khác"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                            )}
                            {canModifyTx(t) && (
                              <button
                                onClick={() => setConfirmDeleteTxId(t.id)}
                                className="p-1.5 text-(--sst-text-muted) hover:text-rose-600 dark:hover:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition-all cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
                                title="Xóa giao dịch"
                                aria-label="Xóa giao dịch"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Transaction List Mobile View */}
      <div className="block md:hidden space-y-3" id="transaction-list-mobile">
        {isLoadingTransactions ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div key={`skeleton-m-${i}`} className="animate-pulse bg-(--sst-surface-2) rounded-2xl h-20 w-full" />
          ))
        ) : paginatedList.length === 0 ? (
          <div className="py-12 text-center text-(--sst-text-muted) text-xs italic bg-(--sst-surface) border border-(--sst-border) rounded-2xl">
            Không tìm thấy giao dịch nào phù hợp.
          </div>
        ) : (
          paginatedList.map((t) => {
            const catObj = categories.find((c) => c.name === t.category);
            const isIncome = isIncomeTx(t); // [T-S113] nguồn sự thật txClassify.ts, thay OR tự viết
            const isEditing = editingTxId === t.id;

            if (isEditing) {
              return (
                <div key={t.id} className="bg-indigo-50/40 dark:bg-indigo-500/10 border border-indigo-100/60 dark:border-indigo-500/25 rounded-xl p-4 space-y-3.5 shadow-xs">
                  <div className="space-y-2">
                    <div>
                      <label className="block text-[10px] font-bold text-(--sst-text-muted) uppercase tracking-wider mb-1">Tên giao dịch</label>
                      <input
                        type="text"
                        className="w-full text-xs font-semibold bg-(--sst-surface) border border-(--sst-border-strong) focus:border-indigo-500 rounded-lg px-2.5 py-1.5 outline-none"
                        value={editDesc}
                        onChange={(e) => setEditDesc(e.target.value)}
                        placeholder="Tên giao dịch..."
                        required
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] font-bold text-(--sst-text-muted) uppercase tracking-wider mb-1">Thành viên</label>
                        {/* T-S06e1 / CONSTITUTION §1.2: người thực hiện cố định từ lúc
                            tạo, không sửa được — chỉ hiển thị lại, bỏ hẳn dropdown chọn. */}
                        <div className="w-full text-xs text-(--sst-text-secondary) bg-(--sst-surface-2) border border-(--sst-border-strong) rounded-lg px-2 py-1.5">
                          {t.member ? `👤 ${t.member}` : "— Cá nhân —"}
                        </div>
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-(--sst-text-muted) uppercase tracking-wider mb-1">Loại</label>
                        {/* [T-S23, CONSTITUTION §1.10] — xem giải thích đầy đủ ở khối
                            desktop cùng file. */}
                        {canChangeType(t) ? (
                          <div className="inline-flex w-full rounded-lg border border-(--sst-border-strong) overflow-hidden shadow-xs text-[10px] font-bold">
                            <button
                              type="button"
                              onClick={() => handleToggleEditType("expense")}
                              className={`flex-1 py-1.5 cursor-pointer transition-all ${
                                editType === "expense" ? "bg-slate-700 text-white" : "bg-(--sst-surface) text-(--sst-text-secondary) hover:bg-(--sst-surface-hover)"
                              }`}
                            >
                              🧾 Chi
                            </button>
                            <button
                              type="button"
                              onClick={() => handleToggleEditType("income")}
                              className={`flex-1 py-1.5 cursor-pointer transition-all border-l border-(--sst-border-strong) ${
                                editType === "income" ? "bg-emerald-600 text-white" : "bg-(--sst-surface) text-(--sst-text-secondary) hover:bg-(--sst-surface-hover)"
                              }`}
                            >
                              💵 Thu
                            </button>
                          </div>
                        ) : (
                          <div className="w-full text-[10px] text-(--sst-text-muted) font-medium bg-(--sst-surface-2) border border-(--sst-border-strong) rounded-lg px-2 py-1.5">
                            {t.type === "transfer" ? "🔒 Chuyển khoản" : "🔒 Đã gắn mục tiêu"}
                          </div>
                        )}
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-(--sst-text-muted) uppercase tracking-wider mb-1">Danh mục</label>
                      {/* T-S06e1b — xem giải thích ở khối desktop cùng file: lọc theo
                          categories.type, không còn khoá thành nhãn tĩnh nữa.
                          [T-S23] Lọc theo `editType` (phe ĐANG CHỌN), không còn lọc theo
                          `t.type` cố định như trước.
                          [BUGFIX T-S24 08/08/2026] — xem giải thích đầy đủ ở khối desktop:
                          `type='transfer'` không lọc theo income/expense, hiện toàn bộ
                          category (chỉ mang ý nghĩa hiển thị lịch sử). */}
                      <select
                        className="w-full text-xs bg-(--sst-surface) border border-(--sst-border-strong) focus:border-indigo-500 rounded-lg px-2 py-1.5 outline-none text-(--sst-text) cursor-pointer"
                        value={editCat}
                        onChange={(e) => setEditCat(e.target.value)}
                      >
                        <option value="" disabled>
                          — Chọn danh mục —
                        </option>
                        {categories
                          .filter((c) => (t.type === "transfer" ? true : editType === "income" ? c.type === "income" : c.type !== "income"))
                          .map((c) => (
                            <option key={c.id} value={c.name}>
                              {c.icon} {c.name}
                            </option>
                          ))}
                      </select>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] font-bold text-(--sst-text-muted) uppercase tracking-wider mb-1">Ngày chi</label>
                        <input
                          type="date"
                          className="w-full text-xs bg-(--sst-surface) border border-(--sst-border-strong) focus:border-indigo-500 rounded-lg px-2 py-1.5 outline-none text-(--sst-text-secondary)"
                          value={editDate}
                          onChange={(e) => setEditDate(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-(--sst-text-muted) uppercase tracking-wider mb-1">Số tiền</label>
                        <input
                          type="number"
                          className="w-full text-xs font-bold text-indigo-600 dark:text-indigo-300 bg-(--sst-surface) border border-(--sst-border-strong) focus:border-indigo-500 rounded-lg px-2.5 py-1.5 outline-none"
                          value={editAmount}
                          onChange={(e) => setEditAmount(e.target.value)}
                          placeholder="Số tiền..."
                          required
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-(--sst-text-muted) uppercase tracking-wider mb-1">Ghi chú</label>
                      <input
                        type="text"
                        className="w-full text-xs bg-(--sst-surface) border border-(--sst-border-strong) focus:border-indigo-500 rounded-lg px-2.5 py-1.5 outline-none"
                        value={editNote}
                        onChange={(e) => setEditNote(e.target.value)}
                        placeholder="Ghi chú cụ thể..."
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-1.5 pt-2 border-t border-indigo-100/55 dark:border-indigo-500/25">
                    <button
                      type="button"
                      onClick={() => setEditingTxId(null)}
                      className="px-3.5 py-1.5 bg-(--sst-surface-2) hover:bg-(--sst-surface-hover) text-(--sst-text-secondary) font-semibold text-xs rounded-lg transition-all cursor-pointer"
                    >
                      Hủy
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveEdit}
                      disabled={!editCatMatched}
                      className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-lg shadow-sm transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-indigo-600"
                    >
                      Lưu
                    </button>
                  </div>
                </div>
              );
            }

            return (
              <div key={t.id} className={`bg-(--sst-surface) border rounded-xl p-3.5 space-y-2.5 shadow-xs hover:border-indigo-100/75 dark:hover:border-indigo-500/25 transition-all ${selectedTxIds.includes(t.id) ? "bg-indigo-50/25 dark:bg-indigo-500/10 border-indigo-200" : "border-(--sst-border)"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    {isHouseholdOwner && (
                      <input
                        type="checkbox"
                        className="rounded border-(--sst-border-strong) text-indigo-600 dark:text-indigo-300 focus:ring-indigo-500 cursor-pointer h-4 w-4 shrink-0 mr-1 p-2 -m-2"
                        checked={selectedTxIds.includes(t.id)}
                        onChange={() => handleToggleSelectRow(t.id)}
                      />
                    )}
                    <div className="w-9 h-9 rounded-xl bg-(--sst-surface-2) flex items-center justify-center text-base border border-(--sst-border) shrink-0">
                      {catObj ? catObj.icon : "📦"}
                    </div>
                    <div className="min-w-0">
                      <div className="font-semibold text-(--sst-text) text-xs truncate leading-tight">{t.description}</div>
                      <div className="flex flex-wrap items-center gap-1.5 mt-1">
                        <span className="text-[10px] text-(--sst-text-muted) font-medium">
                          {new Date(t.date).toLocaleDateString("vi-VN")}
                        </span>
                        {t.member && (
                          <span className="text-[9px] font-bold text-amber-700 dark:text-amber-300 bg-amber-50/80 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/25 px-1 rounded">
                            👤 {t.member}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  
                  <div className="text-right shrink-0">
                    {t.type === "transfer" && (
                      <div className="text-[9px] font-bold text-indigo-500 dark:text-indigo-300 uppercase tracking-wide mb-0.5">Chuyển khoản</div>
                    )}
                    <div
                      className={`font-bold text-xs sm:text-sm ${
                        t.type === "transfer" ? "text-indigo-600 dark:text-indigo-300" : isIncome ? "text-emerald-600 dark:text-emerald-300" : "text-(--sst-text)"
                      }`}
                    >
                      {t.type === "transfer" ? "" : isIncome ? "+" : "-"}
                      {formatCurrency(Math.abs(t.amount))}
                    </div>
                    <div className="text-[9px] text-(--sst-text-muted) mt-0.5 font-medium">{t.category}</div>
                  </div>
                </div>

                {t.note && (
                  <div className="text-[10px] text-(--sst-text-secondary) bg-(--sst-surface-2)/70 px-2.5 py-1.5 rounded-lg border border-(--sst-border)/50 italic">
                    {t.note}
                  </div>
                )}

                <div className="flex justify-end border-t border-(--sst-border) pt-2">
                  {confirmDeleteTxId === t.id ? (
                    <div className="flex items-center gap-1.5 bg-rose-50 dark:bg-rose-500/10 border border-rose-100 dark:border-rose-500/25 px-2 py-1 rounded-lg">
                      <span className="text-[10px] font-bold text-rose-700 dark:text-rose-300">Xóa?</span>
                      <button
                        onClick={() => {
                          handleDeleteOne(t.id);
                          setConfirmDeleteTxId(null);
                        }}
                        className="px-2 py-0.5 bg-rose-600 hover:bg-rose-700 text-white font-bold text-[9px] rounded cursor-pointer"
                      >
                        Xóa
                      </button>
                      <button
                        onClick={() => setConfirmDeleteTxId(null)}
                        className="px-2 py-0.5 bg-(--sst-surface-2) hover:bg-(--sst-surface-hover) text-(--sst-text) font-semibold text-[9px] rounded cursor-pointer"
                      >
                        Hủy
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      {canModifyTx(t) ? (
                        <button
                          onClick={() => handleStartEdit(t)}
                          className="px-2.5 py-1 text-[11px] text-indigo-600 dark:text-indigo-300 bg-indigo-50/50 dark:bg-indigo-500/10 hover:bg-indigo-50 rounded-md border border-indigo-100/50 dark:border-indigo-500/25 font-semibold transition-all cursor-pointer flex items-center gap-1"
                        >
                          <Edit2 className="w-3 h-3" /> Sửa
                        </button>
                      ) : (
                        <button
                          onClick={() =>
                            setWriteError(
                              "Bạn chỉ có thể sửa giao dịch của chính mình. Giao dịch này thuộc về thành viên khác trong hộ."
                            )
                          }
                          className="px-2.5 py-1 text-[11px] text-(--sst-text-muted) bg-(--sst-surface-2) rounded-md border border-(--sst-border) font-semibold cursor-not-allowed flex items-center gap-1"
                        >
                          <Edit2 className="w-3 h-3" /> Sửa
                        </button>
                      )}
                      {canModifyTx(t) && (
                        <button
                          onClick={() => setConfirmDeleteTxId(t.id)}
                          className="px-2.5 py-1 text-[11px] text-rose-600 dark:text-rose-300 bg-rose-50/50 dark:bg-rose-500/10 hover:bg-rose-50 rounded-md border border-rose-100/50 dark:border-rose-500/25 font-semibold transition-all cursor-pointer flex items-center gap-1"
                        >
                          <Trash2 className="w-3 h-3" /> Xóa
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Pagination Controls */}
      {sortedList.length > 20 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-4 border-t border-(--sst-border)">
          <span className="text-xs text-(--sst-text-secondary) font-medium">
            Hiển thị <strong className="text-(--sst-text)">{(currentPage - 1) * 20 + 1} - {Math.min(currentPage * 20, sortedList.length)}</strong> trong tổng số <strong className="text-(--sst-text)">{sortedList.length}</strong> dòng
          </span>
          
          <Pagination page={currentPage} totalPages={totalPages} onChange={setCurrentPage} />
        </div>
      )}
    </div>
  );
}