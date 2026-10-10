import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

/**
 * T-S07 — Context toast toàn cục, viết mới hoàn toàn (dự án chưa có sẵn cơ
 * chế toast/snackbar nào, không có thư viện nào cài sẵn — kiểm tra
 * package.json trước khi viết). Đặt ở Context (giống ScopeContext) thay vì
 * state cục bộ từng component vì Undo cần hoạt động nhất quán ở MỌI nơi gọi
 * xoá giao dịch (hiện tại: TransactionHistory.tsx, xoá đơn lẻ + xoá hàng
 * loạt), không riêng 1 màn hình.
 */
export interface ToastOptions {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  /** ms — mặc định 5000 (đúng AC "Undo trong 5s"). */
  duration?: number;
  /** [T-S131, 22/08/2026] "error" tô đỏ — dùng khi thay `alert()` báo lỗi
      (khác thông báo thành công/thông tin, giữ tông tối mặc định). */
  variant?: "default" | "error";
}

interface ToastItem extends ToastOptions {
  id: string;
}

interface ToastContextValue {
  showToast: (options: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const showToast = useCallback(
    (options: ToastOptions) => {
      const id = crypto.randomUUID();
      const duration = options.duration ?? 5000;
      setToasts((prev) => [...prev, { ...options, id }]);
      const timer = setTimeout(() => dismiss(id), duration);
      timers.current.set(id, timer);
    },
    [dismiss]
  );

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {/* Góc dưới bên phải — không che nội dung chính, quen thuộc với UX
          toast phổ biến (Gmail/Slack đều đặt góc dưới). */}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 items-end pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-center gap-3 text-white text-xs sm:text-sm rounded-xl shadow-xl px-4 py-3 max-w-[calc(100vw-2rem)] animate-in fade-in slide-in-from-bottom-2 ${
              t.variant === "error" ? "bg-red-600" : "bg-slate-900"
            }`}
          >
            <span className="whitespace-pre-wrap">{t.message}</span>
            {t.actionLabel && t.onAction && (
              <button
                onClick={() => {
                  t.onAction?.();
                  dismiss(t.id);
                }}
                className="font-bold text-indigo-300 hover:text-indigo-100 cursor-pointer shrink-0 uppercase tracking-wide"
              >
                {t.actionLabel}
              </button>
            )}
            <button
              onClick={() => dismiss(t.id)}
              className="text-slate-400 hover:text-white cursor-pointer shrink-0"
              aria-label="Đóng"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast() phải được gọi bên trong <ToastProvider>");
  }
  return ctx;
}
