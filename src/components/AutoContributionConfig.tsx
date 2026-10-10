import { useState } from "react";
import { Repeat, Info } from "lucide-react";
import {
  useAutoContributionConfigs,
  useCreateAutoContributionConfig,
  useUpdateAutoContributionConfig,
  useDeleteAutoContributionConfig,
  useToggleAutoContributionConfig,
} from "../hooks/useAutoContribution";
import { getCurrentMonthIncomeStats, getPreviousMonthIncomeTotal } from "../lib/incomeStats";
import type { Transaction } from "../types";

type TriggerType = "on_income" | "monthly_schedule";
type AmountType = "fixed" | "percent";

interface AutoContributionConfigProps {
  goalId: string;
  /** [T-S139 AC] Xem trước dựa trên thu nhập tháng gần nhất, tái dùng đúng
   * `getCurrentMonthIncomeStats`/`getPreviousMonthIncomeTotal`
   * (`lib/incomeStats.ts`) — KHÔNG tạo nguồn tính thu nhập thứ 2, truyền
   * nguyên `transactions` đã có sẵn ở `SavingGoals.tsx` xuống đây. */
  transactions: Transaction[];
  formatCurrency: (amount: number) => string;
}

/**
 * [T-S139, CHỐT 25/08/2026, phụ thuộc T-S138+T-S140] UI bật/tắt + cấu hình
 * "Trích ngân sách tự động" cho 1 GOAL THỦ CÔNG (target `goal_id`, KHÁC
 * target `category_id` thuộc T-S143 — xem CONSTITUTION §1.28/§1.28.2).
 *
 * Đặt tại `SavingGoals.tsx`, tách thành component con riêng (quyết định
 * 26/08/2026, người yêu cầu chọn hướng A sau khi nghe phân tích ưu/nhược 2
 * vị trí SavingGoals.tsx vs Settings.tsx) — giữ đúng ngữ cảnh (bật trích tự
 * động là hành động gắn liền 1 goal cụ thể, không phải cấu hình hệ thống
 * chung như API key/Telegram ở Settings.tsx), tránh phải tự dựng lại
 * dropdown chọn goal + hiển thị lặp thông tin goal đã có sẵn ở
 * `SavingGoals.tsx`, đồng thời không phình thêm dòng trực tiếp vào file
 * chính (2335 dòng, đã khá dài).
 *
 * **Cả 2 trigger (on_income/monthly_schedule) đều BẬT** (khác bản nháp AC
 * gốc ghi "(b) disabled kèm ghi chú sắp có" — tại thời điểm viết AC đó,
 * T-S140 chưa code; nay T-S140 đã 🔒 xong, hỗ trợ đầy đủ `monthly_schedule`
 * cho target `goal_id`, không còn lý do khoá (b) nữa).
 */
export default function AutoContributionConfig({ goalId, transactions, formatCurrency }: AutoContributionConfigProps) {
  const { data: configs = [] } = useAutoContributionConfigs();
  const config = configs.find((c) => c.goal_id === goalId);

  const createMutation = useCreateAutoContributionConfig();
  const updateMutation = useUpdateAutoContributionConfig();
  const deleteMutation = useDeleteAutoContributionConfig();
  const toggleMutation = useToggleAutoContributionConfig();

  const [isEditing, setIsEditing] = useState(false);
  const [triggerType, setTriggerType] = useState<TriggerType>("on_income");
  const [amountType, setAmountType] = useState<AmountType>("fixed");
  const [amountValue, setAmountValue] = useState("");
  const [dayOfMonth, setDayOfMonth] = useState("5");
  const [formError, setFormError] = useState<string | null>(null);

  const isBusy = createMutation.isPending || updateMutation.isPending || deleteMutation.isPending || toggleMutation.isPending;

  const startEdit = () => {
    setFormError(null);
    if (config) {
      setTriggerType(config.trigger_type);
      setAmountType(config.amount_type);
      setAmountValue(String(config.amount_value));
      setDayOfMonth(config.day_of_month ? String(config.day_of_month) : "5");
    } else {
      setTriggerType("on_income");
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
    const numDay = triggerType === "monthly_schedule" ? parseInt(dayOfMonth, 10) : null;
    if (triggerType === "monthly_schedule" && (!numDay || numDay < 1 || numDay > 31)) {
      setFormError("Chọn ngày trong tháng từ 1 đến 31.");
      return;
    }

    if (config) {
      updateMutation.mutate(
        { configId: config.id, triggerType, amountType, amountValue: numAmount, dayOfMonth: numDay },
        {
          onSuccess: () => setIsEditing(false),
          onError: (err: any) => setFormError(err.message || "Không thể lưu cấu hình."),
        }
      );
    } else {
      createMutation.mutate(
        { goalId, triggerType, amountType, amountValue: numAmount, dayOfMonth: numDay },
        {
          onSuccess: () => setIsEditing(false),
          onError: (err: any) => setFormError(err.message || "Không thể tạo cấu hình."),
        }
      );
    }
  };

  const handleToggle = (enabled: boolean) => {
    if (!config) return;
    setFormError(null);
    toggleMutation.mutate(
      { configId: config.id, enabled },
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

  // [T-S139 AC + CONSTITUTION §1.28.2] Xem trước — mốc % KHÁC nhau theo
  // trigger, đúng công thức backend thật (không phải 1 con số chung chung):
  // on_income dùng tổng thu THÁNG NÀY (proxy cho "giao dịch thu nhập kế
  // tiếp", vì backend áp % lên ĐÚNG giao dịch vừa ghi, không biết trước
  // được số chính xác); monthly_schedule dùng tổng thu THÁNG TRƯỚC (khớp
  // 100% công thức run_monthly_auto_contributions() đã code ở T-S140).
  const previewBase =
    triggerType === "monthly_schedule" ? getPreviousMonthIncomeTotal(transactions) : getCurrentMonthIncomeStats(transactions).total;
  const numAmountForPreview = parseFloat(amountValue) || 0;
  const previewAmount = amountType === "fixed" ? numAmountForPreview : Math.round((previewBase * numAmountForPreview) / 100);

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
                {config.trigger_type === "on_income" ? "mỗi khi có thu nhập" : `vào ngày ${config.day_of_month} hàng tháng`}
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
        <Repeat className="w-3 h-3" /> Trích ngân sách tự động
      </h4>

      <div className="space-y-1">
        <label className="block text-[10px] font-bold text-(--sst-text-secondary)">Thời điểm trích</label>
        <select
          className="w-full text-xs bg-(--sst-surface) border border-(--sst-border-strong) focus:border-indigo-500 rounded px-2 py-1.5 outline-none cursor-pointer"
          value={triggerType}
          onChange={(e) => setTriggerType(e.target.value as TriggerType)}
        >
          <option value="on_income">Mỗi khi có khoản thu nhập mới</option>
          <option value="monthly_schedule">Vào 1 ngày cố định hàng tháng</option>
        </select>
      </div>

      {triggerType === "monthly_schedule" && (
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
      )}

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="block text-[10px] font-bold text-(--sst-text-secondary)">Kiểu tính</label>
          <select
            className="w-full text-xs bg-(--sst-surface) border border-(--sst-border-strong) focus:border-indigo-500 rounded px-2 py-1.5 outline-none cursor-pointer"
            value={amountType}
            onChange={(e) => setAmountType(e.target.value as AmountType)}
          >
            <option value="fixed">Số tiền cố định</option>
            <option value="percent">% thu nhập</option>
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
            placeholder={amountType === "fixed" ? "500000" : "10"}
          />
        </div>
      </div>

      {numAmountForPreview > 0 && (
        <p className="text-[10px] text-teal-700 dark:text-teal-300 bg-teal-50 dark:bg-teal-500/10 border border-teal-100 dark:border-teal-500/25 rounded px-2 py-1.5 flex items-start gap-1">
          <Info className="w-3 h-3 mt-0.5 shrink-0" />
          <span>
            Ước tính lần trích tiếp theo: <strong>{formatCurrency(previewAmount)}</strong>
            {amountType === "percent" && (
              <>
                {" "}
                (dựa trên thu nhập {triggerType === "monthly_schedule" ? "tháng trước" : "tháng này"}:{" "}
                {formatCurrency(previewBase)})
              </>
            )}
            . Số thật khi trích có thể khác nếu thu nhập thay đổi.
          </span>
        </p>
      )}

      <p className="text-[10px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/25 rounded px-2 py-1.5">
        ⚠️ Tắt = chỉ dừng các lần trích SAU, KHÔNG hoàn lại các lần đã trích trước đó.
      </p>

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