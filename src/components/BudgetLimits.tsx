import { useEffect, useMemo, useState, FormEvent } from "react";
// T-S06e2: BudgetLimits tự đọc VÀ tự ghi qua hook thật (T-S06b/c), không
// còn nhận onUpdateCategory/onToggleRecurring/onAddCategory/onDeleteCategory
// qua props (state legacy tương ứng ở App.tsx: handleUpdateCategory/
// handleToggleRecurring/handleAddCategory/handleDeleteCategory — trở thành
// dead code, xoá hẳn thuộc phạm vi T-S06f, không mở rộng ở đây).
import { Plus, Edit2, Check, X, ShieldAlert, Award, Calendar, ToggleLeft, ToggleRight, Eye, EyeOff, Trash2 } from "lucide-react";
import { useTransactions } from "../hooks/useTransactions";
import {
  useCategories,
  useCreateCategory,
  useUpdateCategory,
  useSoftDeleteCategory,
} from "../hooks/useCategories";
import { useHousehold, useHouseholdMembers } from "../hooks/useHousehold";
import { useDataScope } from "../hooks/useDataScope";
import { useCurrentUserId } from "../hooks/useCurrentUserId";
import { useCreateAutoContributionConfig } from "../hooks/useAutoContribution";
import { rowsToTransactions, rowToCategory } from "../lib/mapRows";
import { getCurrentMonthCategorySpending } from "../lib/incomeStats";
import { Category } from "../types";
import { EXPENSE_ICONS, INCOME_ICONS } from "../lib/categoryIcons";
import IconPicker from "./IconPicker";
import Pagination from "./Pagination";
import { useConfirm } from "../context/ConfirmContext";
import AutoContributionCategoryConfig, {
  AutoContributionCategoryConfigPending,
  PendingCategoryAutoContribution,
} from "./AutoContributionCategoryConfig";

interface BudgetLimitsProps {
  isOwner?: boolean;
}

// CONSTITUTION §1.5(a): form tạo/sửa category dùng segmented control 2 nút
// to ở đầu form — user THẬT SỰ chọn type cho category mới/sửa (khác form
// nhập giao dịch, nơi type được suy ra từ category đã chọn sẵn, không đổi).
function CategoryTypeSegmented({
  value,
  onChange,
}: {
  value: "income" | "expense";
  onChange: (next: "income" | "expense") => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2" role="group" aria-label="Loại danh mục">
      <button
        type="button"
        onClick={() => onChange("income")}
        className={`px-3 py-2.5 rounded-lg text-sm font-semibold border-2 transition-all cursor-pointer ${
          value === "income"
            ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
            : "border-(--sst-border-strong) bg-(--sst-surface) text-(--sst-text-secondary) hover:border-(--sst-border-strong)"
        }`}
      >
        💵 Khoản Thu
      </button>
      <button
        type="button"
        onClick={() => onChange("expense")}
        className={`px-3 py-2.5 rounded-lg text-sm font-semibold border-2 transition-all cursor-pointer ${
          value === "expense"
            ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300"
            : "border-(--sst-border-strong) bg-(--sst-surface) text-(--sst-text-secondary) hover:border-(--sst-border-strong)"
        }`}
      >
        🧾 Khoản Chi
      </button>
    </div>
  );
}

// T-S52 — điều khiển phân trang dùng chung cho khối chi tiêu & khối nguồn
// thu (2 instance độc lập, mỗi bên tự giữ `page`/`totalPages`/`onChange` riêng).
// T-S133 — CategoryPagination cũ đã xoá, thay bằng component dùng chung
// `Pagination.tsx` (T-S132) ở cả 2 nơi gọi bên dưới (chi tiêu + nguồn thu).

export default function BudgetLimits({ isOwner = true }: BudgetLimitsProps) {
  const confirm = useConfirm();
  const { data: transactionRows = [] } = useTransactions();
  const { data: categoryRows = [], isLoading: isLoadingCategories } = useCategories();
  const { data: household } = useHousehold();
  const { data: memberRows = [] } = useHouseholdMembers(household?.id);
  const { scopeMode, householdId } = useDataScope();
  const userId = useCurrentUserId();
  const currentMember = memberRows.find((m) => m.id === userId);

  // [BUGFIX 08/08/2026] Cùng lỗi gốc như TransactionHistory: prop `isOwner`
  // từ App.tsx dựa trên state legacy, không đáng tin. Tính lại từ
  // `household_role` thật (profiles row qua RLS) — RBAC không đổi (chỉ chủ
  // hộ được cài/sửa/xoá ngân sách, CONSTITUTION §3 policy `categories`).
  const isHouseholdOwner =
    scopeMode !== "household" || currentMember?.household_role === "owner";

  const [writeError, setWriteError] = useState<string | null>(null);

  const createCategoryMutation = useCreateCategory();
  const updateCategoryMutation = useUpdateCategory();
  const softDeleteCategoryMutation = useSoftDeleteCategory();
  // [T-S143] Trích tự động hàng tháng cho category MỚI — category chưa có
  // id lúc mở form nên chỉ giữ cấu hình ở đây, tạo config THẬT sau khi
  // `createCategoryMutation` trả về id (xem `handleSaveAdd`).
  const createAutoContributionConfigMutation = useCreateAutoContributionConfig();
  const [newCatAutoContrib, setNewCatAutoContrib] = useState<PendingCategoryAutoContribution | null>(null);

  const categories = useMemo(() => categoryRows.map(rowToCategory), [categoryRows]);
  const transactions = useMemo(
    () => rowsToTransactions(transactionRows, categoryRows, memberRows),
    [transactionRows, categoryRows, memberRows]
  );

  const expenseCategories = useMemo(() => categories.filter((c) => c.type === "expense"), [categories]);
  const incomeCategories = useMemo(() => categories.filter((c) => c.type === "income"), [categories]);

  // T-S36 — search + filter + multi-select dọn dẹp hàng loạt, cùng pattern
  // "Sổ Giao Dịch" (TransactionHistory.tsx) đã có cho giao dịch, áp dụng
  // tương tự cho danh mục ngân sách (hữu ích nhất là dọn category dư thừa
  // do phân bổ thông minh tạo nhầm khi đổi tên — T-S35).
  const [catSearch, setCatSearch] = useState("");
  const [catRecurringFilter, setCatRecurringFilter] = useState<"all" | "recurring" | "once">("all");
  const [selectedCatIds, setSelectedCatIds] = useState<string[]>([]);

  const filteredExpenseCategories = useMemo(() => {
    const q = catSearch.trim().toLowerCase();
    return expenseCategories.filter((c) => {
      const matchSearch = !q || c.name.toLowerCase().includes(q);
      const matchRecurring =
        catRecurringFilter === "all" ||
        (catRecurringFilter === "recurring" ? !!c.isRecurring : !c.isRecurring);
      return matchSearch && matchRecurring;
    });
  }, [expenseCategories, catSearch, catRecurringFilter]);

  const filteredIncomeCategories = useMemo(() => {
    const q = catSearch.trim().toLowerCase();
    if (!q) return incomeCategories;
    return incomeCategories.filter((c) => c.name.toLowerCase().includes(q));
  }, [incomeCategories, catSearch]);

  // T-S52 — phân trang 10 mục/trang cho danh sách category hiển thị, áp dụng
  // SAU khi đã lọc theo tìm kiếm (`catSearch`) + lọc định kỳ (`catRecurringFilter`)
  // + toggle "Hiện nguồn thu" (`showIncome`) — không đổi thứ tự lọc hiện có
  // (T-S36), chỉ thêm 1 lớp cắt trang ở cuối pipeline. 2 bộ phân trang độc
  // lập cho khối chi tiêu và khối nguồn thu (đúng như khối này vốn đã tách
  // hiển thị riêng qua toggle §1.5).
  const CATEGORY_PAGE_SIZE = 10;
  const [expensePage, setExpensePage] = useState(1);
  const [incomePage, setIncomePage] = useState(1);

  // Đổi từ khoá tìm kiếm hoặc lọc định kỳ → nhảy về trang 1 ở CẢ 2 khối
  // (tránh trang hiện tại rỗng vì danh sách sau lọc ngắn hơn).
  useEffect(() => {
    setExpensePage(1);
    setIncomePage(1);
  }, [catSearch, catRecurringFilter]);

  const expenseTotalPages = Math.max(1, Math.ceil(filteredExpenseCategories.length / CATEGORY_PAGE_SIZE));
  const incomeTotalPages = Math.max(1, Math.ceil(filteredIncomeCategories.length / CATEGORY_PAGE_SIZE));

  // Nếu trang hiện tại vượt quá tổng số trang sau khi danh sách co lại (vd
  // vừa xoá hàng loạt category ở đúng trang cuối) → kéo lại về trang cuối
  // hợp lệ, không để trang rỗng treo.
  useEffect(() => {
    setExpensePage((p) => Math.min(p, expenseTotalPages));
  }, [expenseTotalPages]);
  useEffect(() => {
    setIncomePage((p) => Math.min(p, incomeTotalPages));
  }, [incomeTotalPages]);

  const pagedExpenseCategories = useMemo(
    () => filteredExpenseCategories.slice((expensePage - 1) * CATEGORY_PAGE_SIZE, expensePage * CATEGORY_PAGE_SIZE),
    [filteredExpenseCategories, expensePage]
  );
  const pagedIncomeCategories = useMemo(
    () => filteredIncomeCategories.slice((incomePage - 1) * CATEGORY_PAGE_SIZE, incomePage * CATEGORY_PAGE_SIZE),
    [filteredIncomeCategories, incomePage]
  );

  const handleToggleSelectCat = (id: string) => {
    setSelectedCatIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleToggleSelectAllVisible = () => {
    // T-S52: "đang hiện" giờ nghĩa là đang hiện TRÊN TRANG hiện tại (sau phân
    // trang), không phải toàn bộ danh sách đã lọc — khớp đúng nhãn nút.
    const visibleIds = [...pagedExpenseCategories, ...(showIncome ? pagedIncomeCategories : [])].map((c) => c.id);
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedCatIds.includes(id));
    if (allSelected) {
      setSelectedCatIds((prev) => prev.filter((id) => !visibleIds.includes(id)));
    } else {
      setSelectedCatIds((prev) => Array.from(new Set([...prev, ...visibleIds])));
    }
  };

  const handleBulkDeleteCategories = async () => {
    if (selectedCatIds.length === 0) return;
    if (
      !(await confirm({
        title: "Xoá hàng loạt danh mục",
        message: `Bạn có chắc chắn muốn xoá hàng loạt ${selectedCatIds.length} danh mục được chọn không? Giao dịch cũ thuộc các danh mục này vẫn giữ nguyên, chỉ không còn gán danh mục.`,
        confirmLabel: "Xoá",
        variant: "danger",
      }))
    ) {
      return;
    }
    setWriteError(null);
    const ids = [...selectedCatIds];
    try {
      // Tuần tự — cùng quy ước với handleBulkDelete ở TransactionHistory.tsx.
      for (const id of ids) {
        await softDeleteCategoryMutation.mutateAsync(id);
      }
      setSelectedCatIds([]);
    } catch (err: any) {
      setWriteError(err.message || "Không thể xoá hết các danh mục đã chọn. Chỉ chủ hộ mới được xoá ngân sách.");
    }
  };

  const [showIncome, setShowIncome] = useState(false);

  // T-S52 — bật/tắt "Hiện nguồn thu" chỉ ảnh hưởng khối nguồn thu → nhảy
  // riêng trang khối đó về 1, không đụng trang khối chi tiêu đang xem.
  useEffect(() => {
    setIncomePage(1);
  }, [showIncome]);

  const [isAdding, setIsAdding] = useState(false);
  const [newCatType, setNewCatType] = useState<"income" | "expense">("expense");
  const [newCatName, setNewCatName] = useState("");
  const [newCatIcon, setNewCatIcon] = useState("🍔");
  const [newCatLimit, setNewCatLimit] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTypeVal, setEditTypeVal] = useState<"income" | "expense">("expense");
  const [editNameVal, setEditNameVal] = useState("");
  const [editIconVal, setEditIconVal] = useState("");
  const [editLimitVal, setEditLimitVal] = useState("");
  const [confirmDeleteCatId, setConfirmDeleteCatId] = useState<string | null>(null);

  const buildScope = () =>
    scopeMode === "household" ? { household_id: householdId } : { owner_id: userId };

  const handleNewTypeChange = (next: "income" | "expense") => {
    setNewCatType(next);
    // §1.5(a): chọn xong đổi real-time icon gợi ý.
    setNewCatIcon(next === "income" ? INCOME_ICONS[0] : EXPENSE_ICONS[0]);
    if (next === "income") {
      setNewCatLimit("");
      setNewCatAutoContrib(null); // [T-S143] category income không có target trích tự động
    }
  };

  const handleEditTypeChange = (next: "income" | "expense") => {
    setEditTypeVal(next);
    setEditIconVal(next === "income" ? INCOME_ICONS[0] : EXPENSE_ICONS[0]);
    if (next === "income") setEditLimitVal("");
  };

  // Calculate current month's spending per category
  // [T-S112, 19/08/2026] Công thức chuyển hẳn sang `incomeStats.ts`
  // (`getCurrentMonthCategorySpending`, dùng chung với `FinancialDashboard.tsx`
  // — trước đây 2 file tự viết 2 công thức riêng cho cùng 1 khái niệm, lệch
  // nhau khi Dashboard đổi `timeFilter`, xem CONSTITUTION §5 "1 công thức, 1
  // nơi"). Giữ tên hàm cục bộ để không phải sửa mọi nơi gọi nó bên dưới.
  // [T-S114, 19/08/2026 — phương án B] Đổi tham số sang `categoryId` (trước
  // là `categoryName`) — match theo id, không còn double-count khi 2
  // category trùng tên.
  const getCurrentMonthSpending = (categoryId: string) =>
    getCurrentMonthCategorySpending(categoryId, transactions);

  // [T-S114, 19/08/2026 — phương án A] Sau migration 0034, tạo/sửa category
  // trùng tên (cùng phạm vi + cùng loại, category kia chưa xoá) bị Postgres
  // chặn bằng unique index, trả lỗi mã `23505` — dịch sang thông báo người
  // dùng hiểu được thay vì để lỗi kỹ thuật thô văng ra UI.
  const friendlyWriteError = (err: any, fallback: string): string => {
    if (err?.code === "23505") {
      return "Tên danh mục này đã được dùng cho 1 danh mục khác cùng loại (thu/chi). Hãy chọn tên khác, hoặc kiểm tra lại danh sách — có thể danh mục đó đã tồn tại.";
    }
    return err?.message || fallback;
  };

  const handleSaveAdd = async (e: FormEvent) => {
    e.preventDefault();
    if (!newCatName.trim() || !userId) return;
    const limitNum =
      newCatType === "expense" && newCatLimit ? Number(newCatLimit) : undefined;
    setWriteError(null);
    // [T-S143] Giữ lại cấu hình trích tự động TRƯỚC khi reset form phía
    // dưới (state bị xoá ngay sau khi gọi mutate, không đợi callback).
    const pendingAutoContrib = newCatType === "expense" ? newCatAutoContrib : null;
    try {
      const created = await createCategoryMutation.mutateAsync({
        ...buildScope(),
        name: newCatName.trim(),
        icon: newCatIcon,
        type: newCatType,
        limit_amount: limitNum ?? null,
        created_by: userId,
      });
      if (pendingAutoContrib && created?.id) {
        try {
          await createAutoContributionConfigMutation.mutateAsync({
            categoryId: created.id,
            triggerType: "monthly_schedule",
            amountType: pendingAutoContrib.amountType,
            amountValue: pendingAutoContrib.amountValue,
            dayOfMonth: pendingAutoContrib.dayOfMonth,
          });
        } catch (autoErr: any) {
          // Danh mục đã tạo thành công — chỉ báo riêng lỗi phần trích tự
          // động, không rollback category (đúng thông báo rõ trước/sau đã
          // yêu cầu ở T-S143: người dùng cần biết chính xác phần nào lỗi).
          setWriteError(
            `Đã tạo danh mục "${newCatName.trim()}" thành công, nhưng KHÔNG bật được trích tự động: ${
              autoErr?.message || "lỗi không xác định"
            }. Bạn có thể bật lại thủ công ngay trong danh mục vừa tạo.`
          );
        }
      }
    } catch (err: any) {
      setWriteError(friendlyWriteError(err, "Không thể tạo danh mục ngân sách. Chỉ chủ hộ mới được cài đặt ngân sách."));
    }
    setNewCatName("");
    setNewCatLimit("");
    setNewCatType("expense");
    setNewCatIcon(EXPENSE_ICONS[0]);
    setNewCatAutoContrib(null);
    setIsAdding(false);
  };

  const handleStartEdit = (category: Category) => {
    setEditingId(category.id);
    setEditTypeVal(category.type);
    setEditNameVal(category.name);
    setEditIconVal(category.icon);
    setEditLimitVal(category.limitAmount ? String(category.limitAmount) : "");
  };

  const handleSaveEdit = (categoryId: string) => {
    if (!editNameVal.trim()) return;
    const limitNum =
      editTypeVal === "expense" && editLimitVal ? Number(editLimitVal) : undefined;
    setWriteError(null);
    updateCategoryMutation.mutate(
      {
        id: categoryId,
        patch: {
          name: editNameVal.trim(),
          icon: editIconVal,
          type: editTypeVal,
          limit_amount: limitNum ?? null,
        },
      },
      {
        onError: (err: any) =>
          setWriteError(friendlyWriteError(err, "Không thể lưu thay đổi ngân sách. Chỉ chủ hộ mới được sửa ngân sách.")),
      }
    );
    setEditingId(null);
  };

  const handleToggleRecurring = (category: Category) => {
    setWriteError(null);
    updateCategoryMutation.mutate(
      { id: category.id, patch: { is_recurring: !category.isRecurring } },
      {
        onError: (err: any) =>
          setWriteError(err.message || "Không thể đổi trạng thái định kỳ. Chỉ chủ hộ mới được sửa ngân sách."),
      }
    );
  };

  const handleDeleteCategory = (categoryId: string) => {
    setWriteError(null);
    softDeleteCategoryMutation.mutate(categoryId, {
      onError: (err: any) =>
        setWriteError(err.message || "Không thể xoá danh mục ngân sách. Chỉ chủ hộ mới được xoá ngân sách."),
    });
    setConfirmDeleteCatId(null);
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(amount);
  };

  const renderExpenseRow = (cat: Category) => {
    const spent = getCurrentMonthSpending(cat.id); // [T-S114] theo id, không theo tên
    const limit = cat.limitAmount;
    const isOver = limit !== undefined && spent > limit;
    const pct = limit ? (spent / limit) * 100 : 0;

    let progressColor = "bg-emerald-500";
    let bgColor = "bg-emerald-50/50 dark:bg-emerald-500/10";
    let borderColor = "border-emerald-100/40 dark:border-emerald-500/25";

    if (limit) {
      if (pct >= 100) {
        progressColor = "bg-rose-500";
        bgColor = "bg-rose-50/50 dark:bg-rose-500/10";
        borderColor = "border-rose-100/50 dark:border-rose-500/25";
      } else if (pct >= 80) {
        progressColor = "bg-amber-500";
        bgColor = "bg-amber-50/50 dark:bg-amber-500/10";
        borderColor = "border-amber-100/50 dark:border-amber-500/25";
      }
    }

    return (
      <div
        key={cat.id}
        className={`p-4 rounded-xl border transition-all ${bgColor} ${borderColor} flex flex-col md:flex-row md:items-center justify-between gap-4 ${selectedCatIds.includes(cat.id) ? "ring-2 ring-indigo-200" : ""}`}
      >
        {isHouseholdOwner && editingId !== cat.id && (
          <input
            type="checkbox"
            className="mt-1 md:mt-0 w-4 h-4 rounded border-(--sst-border-strong) text-indigo-600 dark:text-indigo-300 cursor-pointer shrink-0 p-2 -m-2"
            checked={selectedCatIds.includes(cat.id)}
            onChange={() => handleToggleSelectCat(cat.id)}
            title="Chọn để dọn dẹp hàng loạt"
          />
        )}
        <div className="flex-1 space-y-1.5 w-full">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div className="flex items-center gap-2.5 w-full">
              {editingId === cat.id ? (
                <div className="flex flex-col gap-2 w-full">
                  <CategoryTypeSegmented value={editTypeVal} onChange={handleEditTypeChange} />
                  <div className="flex flex-wrap items-center gap-2 w-full">
                    <IconPicker
                      value={editIconVal}
                      icons={editTypeVal === "income" ? INCOME_ICONS : EXPENSE_ICONS}
                      onChange={setEditIconVal}
                    />
                    <input
                      type="text"
                      className="flex-1 text-sm font-semibold bg-(--sst-surface) border border-(--sst-border-strong) focus:border-indigo-500 rounded px-2.5 py-1 outline-none transition-all"
                      value={editNameVal}
                      onChange={(e) => setEditNameVal(e.target.value)}
                      placeholder="Tên danh mục..."
                      title="Tên danh mục"
                    />
                    {editTypeVal === "expense" && (
                      <div className="flex items-center gap-1.5 min-w-[130px]">
                        <span className="text-xs text-(--sst-text-muted) font-medium">Hạn mức:</span>
                        <input
                          type="number"
                          placeholder="Không hạn mức"
                          className="w-24 text-xs bg-(--sst-surface) border border-(--sst-border-strong) focus:border-indigo-500 rounded px-2 py-1 outline-none transition-all font-mono"
                          value={editLimitVal}
                          onChange={(e) => setEditLimitVal(e.target.value)}
                        />
                      </div>
                    )}
                    <div className="flex items-center gap-1.5 ml-auto">
                      <button
                        className="p-1 text-emerald-600 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 rounded cursor-pointer border border-emerald-100 dark:border-emerald-500/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                        onClick={() => handleSaveEdit(cat.id)}
                        title="Lưu thay đổi"
                        aria-label="Lưu thay đổi"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                      <button
                        className="p-1 text-(--sst-text-muted) hover:bg-(--sst-surface-hover) rounded cursor-pointer border border-(--sst-border-strong) focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                        onClick={() => setEditingId(null)}
                        title="Hủy bỏ"
                        aria-label="Hủy bỏ"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <span className="text-2xl shrink-0 p-1 bg-(--sst-surface) rounded-lg shadow-sm border border-(--sst-border)">
                    {cat.icon}
                  </span>
                  <div>
                    <div className="font-semibold text-(--sst-text) text-sm flex items-center gap-1.5">
                      {cat.name}
                      {cat.isRecurring && (
                        <span
                          className="text-[10px] font-medium bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-300 px-1.5 py-0.5 rounded border border-indigo-100 dark:border-indigo-500/25 flex items-center gap-0.5"
                          title="Tự động lặp lại định kỳ hàng tháng"
                        >
                          <Calendar className="w-2.5 h-2.5" />
                          Định kỳ
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-(--sst-text-secondary) flex items-center gap-2">
                      <span>Đã chi: <strong>{formatCurrency(spent)}</strong></span>
                      {limit !== undefined && <span className="text-(--sst-text-faint)">|</span>}
                      {limit !== undefined && (
                        <span>Ngân sách: <strong>{formatCurrency(limit)}</strong></span>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {editingId !== cat.id && limit !== undefined && (
            <div className="space-y-1">
              <div className="w-full bg-(--sst-border-strong) rounded-full h-2 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${progressColor}`}
                  style={{ width: `${Math.min(pct, 100)}%` }}
                ></div>
              </div>
            </div>
          )}

          {/* [T-S143, 27/08/2026 — BỎ gating từ khoá theo phản hồi người
              dùng: hiện cho MỌI category chi tiêu, không chỉ category tên
              khớp "tiết kiệm/đầu tư/..." — RPC/backend không hề giới hạn
              theo tên, gating theo tên chỉ là lựa chọn UI ban đầu, gây
              cứng nhắc cho các category người dùng thật sự muốn tự động
              trích tới (vd "Xe máy", "Học phí con", "Sửa nhà"...). */}
          {editingId !== cat.id && (
            <AutoContributionCategoryConfig categoryId={cat.id} transactions={transactions} formatCurrency={formatCurrency} />
          )}

          {editingId !== cat.id && (
            <div className="text-right shrink-0 md:hidden">
              {limit === undefined ? (
                <span className="text-xs text-(--sst-text-muted) italic">Không đặt ngân sách</span>
              ) : isOver ? (
                <span className="text-xs font-semibold text-rose-600 dark:text-rose-300 bg-rose-100/60 dark:bg-rose-500/10 px-2.5 py-1 rounded-full border border-rose-100 dark:border-rose-500/25">
                  Vượt {formatCurrency(spent - limit)} ({Math.round(pct)}%)
                </span>
              ) : (
                <span className="text-xs font-medium text-(--sst-text-secondary)">
                  Còn lại {formatCurrency(limit - spent)} ({Math.round(100 - pct)}%)
                </span>
              )}
            </div>
          )}
        </div>

        {editingId !== cat.id && (
          <div className="text-right shrink-0 hidden md:block">
            {limit === undefined ? (
              <span className="text-xs text-(--sst-text-muted) italic">Không đặt ngân sách</span>
            ) : isOver ? (
              <span className="text-xs font-semibold text-rose-600 dark:text-rose-300 bg-rose-100/60 dark:bg-rose-500/10 px-2.5 py-1 rounded-full border border-rose-100 dark:border-rose-500/25">
                Vượt {formatCurrency(spent - limit)} ({Math.round(pct)}%)
              </span>
            ) : (
              <span className="text-xs font-medium text-(--sst-text-secondary)">
                Còn lại {formatCurrency(limit - spent)} ({Math.round(100 - pct)}%)
              </span>
            )}
          </div>
        )}

        {isHouseholdOwner && (
          <div className="flex items-center gap-3 self-end md:self-auto border-t md:border-t-0 border-(--sst-border-strong)/50 pt-2 md:pt-0 shrink-0">
            {editingId !== cat.id && (
              <button
                className="p-1.5 text-(--sst-text-muted) hover:text-indigo-600 dark:hover:text-indigo-300 hover:bg-(--sst-surface-hover) rounded-lg transition-all text-xs font-medium flex items-center gap-1 cursor-pointer border border-(--sst-border)"
                onClick={() => handleStartEdit(cat)}
              >
                <Edit2 className="w-3.5 h-3.5" />
                Sửa
              </button>
            )}

            <button
              onClick={() => handleToggleRecurring(cat)}
              className="flex items-center gap-1 text-xs text-(--sst-text-secondary) hover:text-(--sst-text) cursor-pointer"
              title="Toggle tự động lặp lại hàng tháng"
            >
              {cat.isRecurring ? (
                <span className="flex items-center gap-1 text-indigo-600 dark:text-indigo-300">
                  <ToggleRight className="w-5 h-5" />
                  Lặp
                </span>
              ) : (
                <span className="flex items-center gap-1 text-(--sst-text-muted)">
                  <ToggleLeft className="w-5 h-5" />
                  Lặp
                </span>
              )}
            </button>

            {confirmDeleteCatId === cat.id ? (
              <div className="flex items-center gap-1 bg-rose-50 dark:bg-rose-500/10 border border-rose-100 dark:border-rose-500/25 p-1 rounded-lg">
                <span className="text-[9px] font-bold text-rose-700 dark:text-rose-300 px-1">Xóa?</span>
                <button
                  onClick={() => handleDeleteCategory(cat.id)}
                  className="px-1.5 py-0.5 bg-rose-600 hover:bg-rose-700 text-white font-bold text-[9px] rounded cursor-pointer"
                >
                  Xóa
                </button>
                <button
                  onClick={() => setConfirmDeleteCatId(null)}
                  className="px-1.5 py-0.5 bg-(--sst-surface-2) hover:bg-(--sst-surface-hover) text-(--sst-text) font-semibold text-[9px] rounded cursor-pointer"
                >
                  Hủy
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDeleteCatId(cat.id)}
                className="text-[10px] text-rose-500 dark:text-rose-300 hover:text-rose-700 dark:hover:text-rose-300 bg-rose-50 dark:bg-rose-500/10 hover:bg-rose-100 dark:hover:bg-rose-500/10 px-2 py-1 rounded border border-rose-100 dark:border-rose-500/25 cursor-pointer"
              >
                Xóa
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderIncomeRow = (cat: Category) => (
    <div
      key={cat.id}
      className={`p-4 rounded-xl border transition-all bg-emerald-50/50 dark:bg-emerald-500/10 border-emerald-100/50 dark:border-emerald-500/25 flex flex-col md:flex-row md:items-center justify-between gap-4 ${selectedCatIds.includes(cat.id) ? "ring-2 ring-indigo-200" : ""}`}
    >
      {isHouseholdOwner && editingId !== cat.id && (
        <input
          type="checkbox"
          className="mt-1 md:mt-0 w-4 h-4 rounded border-(--sst-border-strong) text-indigo-600 dark:text-indigo-300 cursor-pointer shrink-0 p-2 -m-2"
          checked={selectedCatIds.includes(cat.id)}
          onChange={() => handleToggleSelectCat(cat.id)}
          title="Chọn để dọn dẹp hàng loạt"
        />
      )}
      <div className="flex-1 w-full">
        {editingId === cat.id ? (
          <div className="flex flex-col gap-2 w-full">
            <CategoryTypeSegmented value={editTypeVal} onChange={handleEditTypeChange} />
            <div className="flex flex-wrap items-center gap-2 w-full">
              <IconPicker
                value={editIconVal}
                icons={editTypeVal === "income" ? INCOME_ICONS : EXPENSE_ICONS}
                onChange={setEditIconVal}
              />
              <input
                type="text"
                className="flex-1 text-sm font-semibold bg-(--sst-surface) border border-(--sst-border-strong) focus:border-emerald-500 rounded px-2.5 py-1 outline-none transition-all"
                value={editNameVal}
                onChange={(e) => setEditNameVal(e.target.value)}
                placeholder="Tên nguồn thu..."
                title="Tên danh mục"
              />
              <div className="flex items-center gap-1.5 ml-auto">
                <button
                  className="p-1 text-emerald-600 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 rounded cursor-pointer border border-emerald-100 dark:border-emerald-500/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                  onClick={() => handleSaveEdit(cat.id)}
                  title="Lưu thay đổi"
                  aria-label="Lưu thay đổi"
                >
                  <Check className="w-4 h-4" />
                </button>
                <button
                  className="p-1 text-(--sst-text-muted) hover:bg-(--sst-surface-hover) rounded cursor-pointer border border-(--sst-border-strong) focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                  onClick={() => setEditingId(null)}
                  title="Hủy bỏ"
                  aria-label="Hủy bỏ"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2.5">
            <span className="text-2xl shrink-0 p-1 bg-(--sst-surface) rounded-lg shadow-sm border border-emerald-100 dark:border-emerald-500/25">
              {cat.icon}
            </span>
            <div className="font-semibold text-(--sst-text) text-sm">{cat.name}</div>
            <span className="text-[10px] font-medium bg-emerald-100 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 px-1.5 py-0.5 rounded border border-emerald-200 dark:border-emerald-500/25">
              Nguồn thu — không giới hạn ngân sách
            </span>
          </div>
        )}
      </div>

      {isHouseholdOwner && editingId !== cat.id && (
        <div className="flex items-center gap-3 self-end md:self-auto shrink-0">
          <button
            className="p-1.5 text-(--sst-text-muted) hover:text-indigo-600 dark:hover:text-indigo-300 hover:bg-(--sst-surface-hover) rounded-lg transition-all text-xs font-medium flex items-center gap-1 cursor-pointer border border-(--sst-border)"
            onClick={() => handleStartEdit(cat)}
          >
            <Edit2 className="w-3.5 h-3.5" />
            Sửa
          </button>

          {confirmDeleteCatId === cat.id ? (
            <div className="flex items-center gap-1 bg-rose-50 dark:bg-rose-500/10 border border-rose-100 dark:border-rose-500/25 p-1 rounded-lg">
              <span className="text-[9px] font-bold text-rose-700 dark:text-rose-300 px-1">Xóa?</span>
              <button
                onClick={() => handleDeleteCategory(cat.id)}
                className="px-1.5 py-0.5 bg-rose-600 hover:bg-rose-700 text-white font-bold text-[9px] rounded cursor-pointer"
              >
                Xóa
              </button>
              <button
                onClick={() => setConfirmDeleteCatId(null)}
                className="px-1.5 py-0.5 bg-(--sst-surface-2) hover:bg-(--sst-surface-hover) text-(--sst-text) font-semibold text-[9px] rounded cursor-pointer"
              >
                Hủy
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDeleteCatId(cat.id)}
              className="text-[10px] text-rose-500 dark:text-rose-300 hover:text-rose-700 dark:hover:text-rose-300 bg-rose-50 dark:bg-rose-500/10 hover:bg-rose-100 dark:hover:bg-rose-500/10 px-2 py-1 rounded border border-rose-100 dark:border-rose-500/25 cursor-pointer"
            >
              Xóa
            </button>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className="bg-(--sst-surface) rounded-2xl shadow-sm border border-(--sst-border) p-4 sm:p-6 space-y-4 sm:space-y-6" id="budget-limits-section">
      {/* [BUGFIX 08/08/2026] Trước đây mutate() không có onError -> lỗi bị RLS
          chặn (thành viên cố sửa ngân sách) biến mất im lặng, không ai biết. */}
      {writeError && (
        <div className="flex items-start gap-2 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/25 text-rose-700 dark:text-rose-300 text-xs sm:text-sm font-semibold px-3.5 py-2.5 rounded-xl">
          <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="flex-1">{writeError}</span>
          <button
            onClick={() => setWriteError(null)}
            className="text-rose-400 dark:text-rose-300 hover:text-rose-600 dark:hover:text-rose-300 cursor-pointer shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 rounded"
            title="Đóng thông báo"
            aria-label="Đóng thông báo"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      {!isHouseholdOwner && (
        <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/25 rounded-xl p-3.5 text-amber-800 dark:text-amber-300 text-xs font-semibold flex items-center gap-2.5 animate-fadeIn">
          <ShieldAlert className="w-4.5 h-4.5 text-amber-600 dark:text-amber-300 shrink-0" />
          <span>Quy định an toàn: Chỉ có <strong>Chủ hộ</strong> mới có quyền điều chỉnh ngân sách, thay đổi hạn mức, thêm hoặc xóa các danh mục chi tiêu chung trong gia đình.</span>
        </div>
      )}

      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-semibold text-(--sst-text) flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-indigo-500 dark:text-indigo-300" />
            Hạn Mức Ngân Sách Tháng
          </h2>
          <p className="text-xs text-(--sst-text-secondary) mt-1">
            Đặt giới hạn tối đa cho từng danh mục chi tiêu để kiểm soát tài chính tối ưu.
          </p>
        </div>
        {isHouseholdOwner && (
          <button
            onClick={() => setIsAdding(!isAdding)}
            className="p-2 text-indigo-600 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 rounded-xl transition-all border border-indigo-100 dark:border-indigo-500/25 flex items-center gap-1 text-xs font-semibold cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Tạo Danh Mục</span>
          </button>
        )}
      </div>

      {isAdding && (
        <form onSubmit={handleSaveAdd} className="bg-(--sst-surface-2) border border-(--sst-border) rounded-xl p-4 space-y-3.5">
          <CategoryTypeSegmented value={newCatType} onChange={handleNewTypeChange} />
          <div className={`grid grid-cols-1 ${newCatType === "expense" ? "sm:grid-cols-3" : "sm:grid-cols-2"} gap-3`}>
            <div>
              <label className="block text-xs font-semibold text-(--sst-text-secondary) mb-1">
                {newCatType === "income" ? "Tên nguồn thu" : "Tên danh mục"}
              </label>
              <input
                type="text"
                placeholder={newCatType === "income" ? "Ví dụ: Lương, Thưởng, Bán đồ cũ..." : "Ví dụ: Ăn vặt, Nuôi thú cưng..."}
                className="w-full text-sm bg-(--sst-surface) border border-(--sst-border-strong) focus:border-indigo-500 rounded-lg px-3 py-2 outline-none transition-all"
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                required
              />
            </div>
            {newCatType === "expense" && (
              <div>
                <label className="block text-xs font-semibold text-(--sst-text-secondary) mb-1">Giới hạn chi tiêu (VNĐ)</label>
                <input
                  type="number"
                  placeholder="Để trống nếu không giới hạn"
                  className="w-full text-sm bg-(--sst-surface) border border-(--sst-border-strong) focus:border-indigo-500 rounded-lg px-3 py-2 outline-none transition-all"
                  value={newCatLimit}
                  onChange={(e) => setNewCatLimit(e.target.value)}
                />
              </div>
            )}
            <IconPicker
              label="Chọn Biểu tượng (Emoji)"
              value={newCatIcon}
              icons={newCatType === "income" ? INCOME_ICONS : EXPENSE_ICONS}
              onChange={setNewCatIcon}
            />
          </div>
          {/* [T-S143, 27/08/2026 — BỎ gating từ khoá] Hiện cho MỌI category
              CHI mới tạo, không chỉ tên khớp từ khoá tiết kiệm. */}
          {newCatType === "expense" && (
            <AutoContributionCategoryConfigPending
              value={newCatAutoContrib}
              onChange={setNewCatAutoContrib}
              transactions={transactions}
              formatCurrency={formatCurrency}
            />
          )}
          <div className="flex justify-end gap-2 text-xs">
            <button
              type="button"
              className="px-3.5 py-2 bg-(--sst-surface-2) hover:bg-(--sst-surface-hover) rounded-lg font-medium text-(--sst-text) transition-all cursor-pointer"
              onClick={() => setIsAdding(false)}
            >
              Hủy
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg shadow-sm transition-all cursor-pointer"
            >
              Lưu
            </button>
          </div>
        </form>
      )}

      {/* [T-S43 09/08/2026] Tìm kiếm/lọc mở cho MỌI thành viên (chỉ đọc, không
          ghi gì) — trước đây gộp nhầm chung điều kiện `isHouseholdOwner` với
          checkbox/toolbar dọn dẹp hàng loạt (thao tác GHI, đúng RBAC chỉ chủ
          hộ). Tách riêng theo đúng yêu cầu: xem/tìm/lọc không phải quyền ghi. */}
      <div className="flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-center">
        <div className="relative flex-1">
          <input
            type="text"
            placeholder="Tìm kiếm danh mục..."
            className="w-full text-xs bg-(--sst-surface) border border-(--sst-border-strong) focus:border-indigo-500 rounded-lg pl-3 pr-3 py-2 outline-none transition-all"
            value={catSearch}
            onChange={(e) => setCatSearch(e.target.value)}
          />
        </div>
        <select
          className="text-xs bg-(--sst-surface) border border-(--sst-border-strong) focus:border-indigo-500 rounded-lg px-2.5 py-2 outline-none cursor-pointer"
          value={catRecurringFilter}
          onChange={(e) => setCatRecurringFilter(e.target.value as "all" | "recurring" | "once")}
          title="Lọc theo định kỳ (chỉ áp dụng cho danh mục chi tiêu)"
        >
          <option value="all">Tất cả (định kỳ &amp; không)</option>
          <option value="recurring">Chỉ định kỳ</option>
          <option value="once">Chỉ không định kỳ</option>
        </select>
      </div>

      {/* T-S36 — toolbar dọn dẹp hàng loạt, cùng pattern TransactionHistory.tsx —
          VẪN chỉ chủ hộ (thao tác ghi/xoá, đúng RBAC §3), checkbox từng dòng
          cũng đã lọc riêng theo `isHouseholdOwner` ở nơi render dòng. */}
      {selectedCatIds.length > 0 && (
        <div className="flex items-center justify-between gap-2 bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-100 dark:border-indigo-500/25 rounded-xl px-3.5 py-2.5 text-xs">
          <span className="text-indigo-700 dark:text-indigo-300 font-medium">
            Đang chọn <strong className="font-black">{selectedCatIds.length}</strong> danh mục
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleToggleSelectAllVisible}
              className="px-2.5 py-1.5 bg-(--sst-surface) hover:bg-indigo-100 dark:hover:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-500/25 rounded-lg font-semibold cursor-pointer"
            >
              Chọn/Bỏ chọn tất cả đang hiện
            </button>
            <button
              type="button"
              onClick={() => setSelectedCatIds([])}
              className="px-2.5 py-1.5 bg-(--sst-surface) hover:bg-(--sst-surface-hover) text-(--sst-text-secondary) border border-(--sst-border-strong) rounded-lg font-semibold cursor-pointer"
            >
              Bỏ chọn hết
            </button>
            <button
              type="button"
              onClick={handleBulkDeleteCategories}
              className="px-2.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-semibold cursor-pointer flex items-center gap-1"
            >
              <Trash2 className="w-3.5 h-3.5" /> Xoá đã chọn ({selectedCatIds.length})
            </button>
          </div>
        </div>
      )}

      <div className="space-y-4">
        {isLoadingCategories ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={`skeleton-exp-${i}`} className="animate-pulse bg-(--sst-surface-2) rounded-2xl h-24 w-full" />
            ))}
          </div>
        ) : (
          <>
            {pagedExpenseCategories.map(renderExpenseRow)}
            {filteredExpenseCategories.length === 0 && expenseCategories.length > 0 && (
              <p className="text-xs text-(--sst-text-muted) text-center py-4">Không có danh mục chi tiêu nào khớp bộ lọc.</p>
            )}
            <Pagination page={expensePage} totalPages={expenseTotalPages} onChange={setExpensePage} />
          </>
        )}
      </div>

      {/* §1.5: mặc định ẨN nhóm category income, toggle tường minh để bật xem
          — không trộn chung 1 danh sách với category chi tiêu. */}
      {!isLoadingCategories && incomeCategories.length > 0 && (
        <div className="pt-2 border-t border-(--sst-border) space-y-3">
          <button
            type="button"
            onClick={() => setShowIncome((v) => !v)}
            className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300 hover:text-emerald-800 dark:hover:text-emerald-300 cursor-pointer"
          >
            {showIncome ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            {showIncome ? "Ẩn nguồn thu" : "Hiện nguồn thu"} ({incomeCategories.length})
          </button>
          {showIncome && (
            <div className="space-y-3">
              <p className="text-xs text-(--sst-text-muted) flex items-center gap-1.5">
                <Award className="w-3.5 h-3.5" />
                Nguồn thu không áp dụng hạn mức ngân sách.
              </p>
              {pagedIncomeCategories.map(renderIncomeRow)}
              {filteredIncomeCategories.length === 0 && incomeCategories.length > 0 && (
                <p className="text-xs text-(--sst-text-muted) text-center py-4">Không có nguồn thu nào khớp tìm kiếm.</p>
              )}
              <Pagination page={incomePage} totalPages={incomeTotalPages} onChange={setIncomePage} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}