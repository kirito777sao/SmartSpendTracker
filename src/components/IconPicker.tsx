import { useEffect, useRef, useState } from "react";

// T-S44 (09/08/2026) — picker icon dùng chung, thay cho danh sách cuộn ngang
// cũ ở BudgetLimits.tsx (kéo trượt mất thời gian). Bấm nút hiện icon đang
// chọn -> mở popover dạng LƯỚI nhiều cột (click chọn ngay, không dropdown/
// scroll ngang) -> đóng khi chọn xong hoặc click ra ngoài. Dùng ở mọi nơi
// chọn icon category (BudgetLimits form tạo/sửa, SmartAllocator dòng "Tự chọn").

interface IconPickerProps {
  value: string;
  icons: string[];
  onChange: (icon: string) => void;
  label?: string;
  disabled?: boolean;
}

export default function IconPicker({ value, icons, onChange, label, disabled }: IconPickerProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [open]);

  return (
    <div className="relative" ref={containerRef}>
      {label && <label className="block text-xs font-semibold text-(--sst-text-secondary) mb-1">{label}</label>}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 text-lg bg-(--sst-surface) border border-(--sst-border-strong) hover:border-indigo-400 dark:hover:border-indigo-400 rounded-lg px-3 py-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <span>{value || "❓"}</span>
        <span className="text-xs text-(--sst-text-muted)">Đổi biểu tượng</span>
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-64 max-h-56 overflow-y-auto bg-(--sst-surface) border border-(--sst-border-strong) rounded-xl shadow-lg shadow-(--sst-shadow) p-2 grid grid-cols-6 gap-1">
          {icons.map((ico) => (
            <button
              key={ico}
              type="button"
              onClick={() => {
                onChange(ico);
                setOpen(false);
              }}
              className={`text-lg p-1.5 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-500/10 border transition-all ${
                value === ico
                  ? "border-indigo-500 dark:border-indigo-400 bg-indigo-50 dark:bg-indigo-500/10 scale-110"
                  : "border-transparent"
              }`}
            >
              {ico}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}