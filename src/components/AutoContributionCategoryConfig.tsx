import { useState } from "react";
import { Repeat, Info } from "lucide-react";
import {
  useAutoContributionConfigs,
  useCreateAutoContributionConfig,
  useUpdateAutoContributionConfig,
  useDeleteAutoContributionConfig,
  useToggleAutoContributionConfig,
} from "../hooks/useAutoContribution";
import { getPreviousMonthIncomeTotal, getCumulativeBalance } from "../lib/incomeStats";
import type { Transaction } from "../types";

type AmountType = "fixed" | "percent";

/** [T-S143] Cấu hình đang chờ (category CHƯA được tạo — dùng ở form "Thêm
 * danh mục mới" của BudgetLimits.tsx / dòng gợi ý của SmartAllocator.tsx).
 * Cha (BudgetLimits.tsx/SmartAllocator.tsx) tự giữ state này, tự gọi
 * `createAutoContributionConfig` với `categoryId` thật SAU KHI category đã
 * tạo xong (RPC bắt buộc `category_id` tồn tại trước, không tạo đồng thời
 * được — khác goal, vốn luôn có sẵn id trước khi mở form này). */
export interface PendingCategoryAutoContribution {
  dayOfMonth: number;
  amountType: AmountType;
  amountValue: number;
}

interface CommonProps {
  transactions: Transaction[];
  formatCurrency: (amount: number) => string;
}

/** Form nhập ngày/kiểu tính/giá trị + xem trước — dùng chung cho cả 2 chế
 * độ (pending và đã có categoryId), tránh viết 2 lần cùng 1 bộ input. */
function AmountScheduleFields({
  dayOfMonth,
  setDayOfMonth,
  amountType,
  setAmountType,
  amountValue,
  setAmountValue,
  transactions,
  formatCurrency,
}: {
  dayOfMonth: string;
  setDayOfMonth: (v: string) => void;
  amountType: AmountType;
  setAmountType: (v: AmountType) => void;
  amountValue: string;
  setAmountValue: (v: string) => void;
} & CommonProps) {
  // [CONSTITUTION §1.28.2] Category target CHỈ có monthly_schedule — mốc %
  // luôn là tổng thu nhập THÁNG VỪA HOÀN TẤT (không phải tháng này), đúng
  // công thức thật run_monthly_auto_contributions() (0038) dùng khi trích.
  const previewBase = getPreviousMonthIncomeTotal(transactions);
  const cumulativeBalance = getCumulativeBalance(transactions);
  const numAmount = parseFloat(amountValue) || 0;
  const previewAmount = amountType === "fixed" ? numAmount : Math.round((previewBase * numAmount) / 100);
  const isInsufficientNow = numAmount > 0 && previewAmount > cumulativeBalance;

  return (
    <>
      <div className="space-y-1">
        <label className="block text-[10px] font-bold text-(--sst-text-secondary)">Ngày trong tháng (1-31)</label>
        <input
          type="number"
          min={1}
          max={31}
          className="w-full text-xs bg-(--sst-surface) border border-(--sst-border-strong) focus:border-indigo-500 rounded px-2 py-1.5 outline-none"
          value={dayOfMonth}
          onChange={(e) => setDayOfMonth(e.target.value)}
        />
        <p className="text-[10px] text-(--sst-text-muted)">
          Nếu tháng đó không đủ ngày (VD chọn 31 nhưng tháng chỉ có 30 ngày), hệ thống tự trích vào ngày cuối cùng của tháng.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="block text-[10px] font-bold text-(--sst-text-secondary)">Kiểu tính</label>
          <select
            className="w-full text-xs bg-(--sst-surface) border border-(--sst-border-strong) focus:border-indigo-500 rounded px-2 py-1.5 outline-none cursor-pointer"
            value={amountType}
            onChange={(e) => setAmountType(e.target.value as AmountType)}
          >
            <option value="fixed">Số tiền cố định</option>
            <option value="percent">% thu nhập tháng trước</option>
          </select>
        </div>
        <div className="space-y-1">
          <label className="block text-[10px] font-bold text-(--sst-text-secondary)">
            {amountType === "fixed" ? "Số tiền (VNĐ)" : "Tỉ lệ (%)"}
          </label>
          <input
            type="number"
            min={0}
            className="w-full text-xs bg-(--sst-surface) border border-(--sst-border-strong) focus:border-indigo-500 rounded px-2 py-1.5 outline-none"
            value={amountValue}
            onChange={(e) => setAmountValue(e.target.value)}
            placeholder={amountType === "fixed" ? "1000000" : "10"}
          />
        </div>
      </div>

      {numAmount > 0 && (
        <p
          className={`text-[10px] rounded px-2 py-1.5 flex items-start gap-1 border ${
            isInsufficientNow
              ? "text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 border-amber-100 dark:border-amber-500/25"
              : "text-teal-700 dark:text-teal-300 bg-teal-50 dark:bg-teal-500/10 border-teal-100 dark:border-teal-500/25"
          }`}
        >
          <Info className="w-3 h-3 mt-0.5 shrink-0" />
          <span>
            Ước tính lần trích tiếp theo: <strong>{formatCurrency(previewAmount)}</strong>
            {amountType === "percent" && <> (dựa trên thu nhập tháng trước: {formatCurrency(previewBase)})</>}
            {" "}— Số dư luỹ kế hiện tại: <strong>{formatCurrency(cumulativeBalance)}</strong>.
            {isInsufficientNow && " Không đủ số dư luỹ kế tại thời điểm hiện tại (có thể đổi khi tới ngày trích thật)."}
          </span>
        </p>
      )}

      <p className="text-[10px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/25 rounded px-2 py-1.5">
        ⚠️ Trích tự động sẽ tự tạo 1 khoản CHI hàng tháng vào đúng danh mục này. Tắt = chỉ dừng các lần trích SAU, KHÔNG hoàn lại các lần đã trích trước đó.
      </p>
    </>
  );
}

/** [T-S143] Chế độ PENDING — dùng khi category CHƯA tồn tại (form "Thêm
 * danh mục mới"). Không gọi API gì cả — chỉ thu thập cấu hình, báo lại cho
 * component cha qua `onChange`; cha tự tạo config thật sau khi category đã
 * có id (xem `BudgetLimits.tsx` `handleSaveAdd`). */
export function AutoContributionCategoryConfigPending({
  value,
  onChange,
  transactions,
  formatCurrency,
}: {
  value: PendingCategoryAutoContribution | null;
  onChange: (next: PendingCategoryAutoContribution | null) => void;
} & CommonProps) {
  const enabled = value !== null;
  const dayOfMonth = value ? String(value.dayOfMonth) : "5";
  const amountType = value?.amountType ?? "fixed";
  const amountValue = value ? String(value.amountValue) : "";

  const setField = (patch: Partial<PendingCategoryAutoContribution>) => {
    onChange({
      dayOfMonth: value?.dayOfMonth ?? 5,
      amountType: value?.amountType ?? "fixed",
      amountValue: value?.amountValue ?? 0,
      ...patch,
    });
  };

  return (
    <div className="p-2.5 bg-indigo-50/60 dark:bg-indigo-500/10 border border-indigo-100 dark:border-indigo-500/25 rounded-lg space-y-2">
      <label className="flex items-center gap-2 text-xs font-bold text-indigo-700 dark:text-indigo-300 uppercase tracking-wider cursor-pointer">
        <input
          type="checkbox"
          className="w-4 h-4 rounded cursor-pointer"
          checked={enabled}
          onChange={(e) => onChange(e.target.checked ? { dayOfMonth: 5, amountType: "fixed", amountValue: 0 } : null)}
        />
        <Repeat className="w-3.5 h-3.5" /> Trích ngân sách tự động hàng tháng
      </label>
      {enabled && (
        <AmountScheduleFields
          dayOfMonth={dayOfMonth}
          setDayOfMonth={(v) => setField({ dayOfMonth: parseInt(v, 10) || 1 })}
          amountType={amountType}
          setAmountType={(v) => setField({ amountType: v })}
          amountValue={amountValue}
          setAmountValue={(v) => setField({ amountValue: parseFloat(v) || 0 })}
          transactions={transactions}
          formatCurrency={formatCurrency}
        />
      )}
    </div>
  );
}

/** [T-S143] Chế độ THẬT — category đã tồn tại (đang hiện trong danh sách ở
 * `BudgetLimits.tsx`). Đọc/ghi trực tiếp qua `auto_contribution_configs`,
 * cùng pattern `AutoContributionConfig.tsx` (T-S139, target goal) nhưng
 * CHỈ monthly_schedule, không có lựa chọn on_income (đúng CONSTITUTION
 * §1.28.2 — category không nhận trigger theo giao dịch thu nhập). */
export default function AutoContributionCategoryConfig({ categoryId, transactions, formatCurrency }: { categoryId: string } & CommonProps) {
  const { data: configs = [] } = useAutoContributionConfigs();
  const config = configs.find((c) => c.category_id === categoryId);

  const createMutation = useCreateAutoContributionConfig();
  const updateMutation = useUpdateAutoContributionConfig();
  const deleteMutation = useDeleteAutoContributionConfig();
  const toggleMutation = useToggleAutoContributionConfig();

  const [isEditing, setIsEditing] = useState(false);
  const [dayOfMonth, setDayOfMonth] = useState("5");
  const [amountType, setAmountType] = useState<AmountType>("fixed");
  const [amountValue, setAmountValue] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const isBusy = createMutation.isPending || updateMutation.isPending || deleteMutation.isPending || toggleMutation.isPending;

  const startEdit = () => {
    setFormError(null);
    if (config) {
      setAmountType(config.amount_type);
      setAmountValue(String(config.amount_value));
      setDayOfMonth(config.day_of_month ? String(config.day_of_month) : "5");
    } else {
      setAmountType("fixed");
      setAmountValue("");
      setDayOfMonth("5");
    }
    setIsEditing(true);
  };

  const cancelEdit = () => {
    setIsEditing(false);
    setFormError(null);
  };

  const handleSave = () => {
    setFormError(null);
    const numAmount = parseFloat(amountValue);
    if (!numAmount || numAmount <= 0) {
      setFormError("Nhập số tiền/tỉ lệ hợp lệ (lớn hơn 0).");
      return;
    }
    if (amountType === "percent" && numAmount > 100) {
      setFormError("Tỉ lệ % không được vượt quá 100.");
      return;
    }
    const numDay = parseInt(dayOfMonth, 10);
    if (!numDay || numDay < 1 || numDay > 31) {
      setFormError("Chọn ngày trong tháng từ 1 đến 31.");
      return;
    }

    if (config) {
      updateMutation.mutate(
        { configId: config.id, triggerType: "monthly_schedule", amountType, amountValue: numAmount, dayOfMonth: numDay },
        {
          onSuccess: () => setIsEditing(false),
          onError: (err: any) => setFormError(err.message || "Không thể lưu cấu hình."),
        }
      );
    } else {
      createMutation.mutate(
        { categoryId, triggerType: "monthly_schedule", amountType, amountValue: numAmount, dayOfMonth: numDay },
        {
          onSuccess: () => setIsEditing(false),
          onError: (err: any) => setFormError(err.message || "Không thể tạo cấu hình."),
        }
      );
    }
  };

  const handleToggle = (nextEnabled: boolean) => {
    if (!config) return;
    setFormError(null);
    toggleMutation.mutate(
      { configId: config.id, enabled: nextEnabled },
      { onError: (err: any) => setFormError(err.message || "Không thể bật/tắt cấu hình.") }
    );
  };

  const handleDelete = () => {
    if (!config) return;
    setFormError(null);
    deleteMutation.mutate(config.id, {
      onSuccess: () => setIsEditing(false),
      onError: (err: any) => setFormError(err.message || "Không thể xoá cấu hình."),
    });
  };

  if (!isEditing) {
    if (!config) {
      return (
        <button
          type="button"
          onClick={startEdit}
          className="mt-1 flex items-center gap-1 text-xs font-semibold text-indigo-600 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-500/10 hover:bg-indigo-100 dark:hover:bg-indigo-500/20 px-2.5 py-1.5 rounded-lg border border-indigo-100 dark:border-indigo-500/25 transition-all cursor-pointer"
        >
          <Repeat className="w-3.5 h-3.5" />
          Bật trích ngân sách tự động
        </button>
      );
    }
    return (
      <div className="mt-1 flex items-center justify-between gap-2 text-[10px]">
        <div className="flex items-center gap-1.5">
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={config.enabled}
              disabled={isBusy}
              onChange={(e) => handleToggle(e.target.checked)}
            />
            <div className="w-7 h-4 bg-(--sst-border-strong) peer-checked:bg-indigo-600 rounded-full transition-colors peer-disabled:opacity-50"></div>
            <div className="absolute left-0.5 top-0.5 w-3 h-3 bg-white rounded-full transition-transform peer-checked:translate-x-3"></div>
          </label>
          <span className="text-(--sst-text-secondary)">
            {config.enabled ? (
              <span className="text-indigo-600 dark:text-indigo-300 font-semibold">
                Đang trích {config.amount_type === "fixed" ? formatCurrency(config.amount_value) : `${config.amount_value}%`}{" "}
                vào ngày {config.day_of_month} hàng tháng
              </span>
            ) : (
              "Trích tự động đang tắt"
            )}
          </span>
        </div>
        <button
          type="button"
          onClick={startEdit}
          className="text-indigo-600 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-500/10 hover:bg-indigo-100 dark:hover:bg-indigo-500/20 border border-indigo-100 dark:border-indigo-500/25 cursor-pointer font-semibold shrink-0 px-2 py-1 rounded-md transition-all"
        >
          Sửa
        </button>
      </div>
    );
  }

  return (
    <div className="mt-2 p-2.5 bg-indigo-50/60 dark:bg-indigo-500/10 border border-indigo-100 dark:border-indigo-500/25 rounded-lg space-y-2">
      <h4 className="text-[10px] font-bold text-indigo-700 dark:text-indigo-300 uppercase tracking-wider flex items-center gap-1">
        <Repeat className="w-3 h-3" /> Trích ngân sách tự động hàng tháng
      </h4>

      <AmountScheduleFields
        dayOfMonth={dayOfMonth}
        setDayOfMonth={setDayOfMonth}
        amountType={amountType}
        setAmountType={setAmountType}
        amountValue={amountValue}
        setAmountValue={setAmountValue}
        transactions={transactions}
        formatCurrency={formatCurrency}
      />

      {formError && <p className="text-[10px] text-rose-500 dark:text-rose-300">{formError}</p>}

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleSave}
            disabled={isBusy}
            className="text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 px-2.5 py-1 rounded cursor-pointer disabled:opacity-50"
          >
            {isBusy ? "Đang lưu..." : "Lưu"}
          </button>
          <button
            type="button"
            onClick={cancelEdit}
            disabled={isBusy}
            className="text-xs font-semibold text-(--sst-text-secondary) hover:bg-(--sst-surface-hover) px-2.5 py-1 rounded cursor-pointer disabled:opacity-50"
          >
            Hủy
          </button>
        </div>
        {config && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={isBusy}
            className="text-[10px] font-semibold text-rose-600 dark:text-rose-300 hover:underline cursor-pointer disabled:opacity-50"
          >
            Xoá cấu hình
          </button>
        )}
      </div>
    </div>
  );
}
