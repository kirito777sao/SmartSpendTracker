import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

/**
 * [T-S124, 22/08/2026] Context xác nhận toàn cục, viết mới hoàn toàn — thay
 * thế 4 chỗ dùng `window.confirm()` native (TransactionHistory.tsx x2,
 * BudgetLimits.tsx, AuthAndTelegram.tsx) bằng modal trong app, đúng dark
 * mode (token --sst-*, theo CONSTITUTION §1.26), đồng nhất phong cách với
 * modal đã có sẵn (xem SavingGoals.tsx modal "Xem tất cả" — overlay
 * bg-slate-900/40 + backdrop-blur-sm + đóng bằng click overlay/Esc/nút).
 *
 * API dạng Promise (`confirm(options): Promise<boolean>`) để giữ nguyên
 * luồng code gọi chỗ cũ gần như không đổi:
 *   if (!window.confirm("...")) return;
 *   -->
 *   if (!(await confirm({ message: "..." }))) return;
 */
export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** "danger" tô đỏ nút xác nhận — dùng cho hành động phá huỷ (xoá, huỷ liên kết). */
  variant?: "default" | "danger";
}

interface ConfirmState extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

interface ConfirmContextValue {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConfirmState | null>(null);

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setState({ ...options, resolve });
    });
  }, []);

  const settle = useCallback(
    (result: boolean) => {
      state?.resolve(result);
      setState(null);
    },
    [state]
  );

  // Đóng bằng phím Esc — cùng hành vi modal đã có ở SavingGoals.tsx (T-S26).
  useEffect(() => {
    if (!state) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") settle(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [state, settle]);

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {state && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4"
          onClick={() => settle(false)}
        >
          <div
            className="bg-(--sst-surface) rounded-2xl shadow-2xl border border-(--sst-border) w-full max-w-sm p-5"
            onClick={(e) => e.stopPropagation()}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-dialog-message"
          >
            {state.title && <h3 className="text-sm font-bold text-(--sst-text) mb-2">{state.title}</h3>}
            <p
              id="confirm-dialog-message"
              className="text-sm text-(--sst-text-secondary) leading-relaxed whitespace-pre-wrap"
            >
              {state.message}
            </p>
            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => settle(false)}
                autoFocus
                className="px-4 py-2 text-xs font-bold rounded-xl text-(--sst-text-secondary) hover:bg-(--sst-surface-hover) transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
              >
                {state.cancelLabel || "Huỷ"}
              </button>
              <button
                onClick={() => settle(true)}
                className={`px-4 py-2 text-xs font-bold rounded-xl text-white transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 ${
                  state.variant === "danger"
                    ? "bg-red-600 hover:bg-red-700 focus-visible:ring-red-400"
                    : "bg-indigo-600 hover:bg-indigo-700 focus-visible:ring-indigo-400"
                }`}
              >
                {state.confirmLabel || "Xác nhận"}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

/** Trả trực tiếp hàm `confirm` (không phải object) — dùng gọn ở nơi gọi: `const confirm = useConfirm();` */
export function useConfirm(): ConfirmContextValue["confirm"] {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error("useConfirm() phải được gọi bên trong <ConfirmProvider>");
  }
  return ctx.confirm;
}
