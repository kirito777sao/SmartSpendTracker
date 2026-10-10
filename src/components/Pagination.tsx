import { useState, useRef, useEffect } from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";

// T-S132 — component phân trang DÙNG CHUNG, thay 3 bản trùng lặp
// (CategoryPagination trong BudgetLimits.tsx, GoalPagination trong
// SavingGoals.tsx, logic inline trong TransactionHistory.tsx). Giữ ĐÚNG style
// gốc đã có ở TransactionHistory.tsx (nút "Trước"/"Sau" có chữ + icon, số
// trang dạng ô vuông bo góc, "..." dạng chữ) — chỉ bổ sung: nút về
// đầu/cuối (« »), và "..." giờ bấm được để mở ô nhập số trang nhảy nhanh
// (trước đây chỉ là span trang trí). T-S133 sẽ gắn vào 3 nơi và xoá bản cũ.

interface PaginationProps {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}

export default function Pagination({ page, totalPages, onChange }: PaginationProps) {
  const [jumpOpenKey, setJumpOpenKey] = useState<"left" | "right" | null>(null);
  const [jumpValue, setJumpValue] = useState("");
  const jumpInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (jumpOpenKey) jumpInputRef.current?.focus();
  }, [jumpOpenKey]);

  if (totalPages <= 1) return null;

  const goTo = (p: number) => {
    const clamped = Math.min(Math.max(1, p), totalPages);
    onChange(clamped);
  };

  const commitJump = () => {
    const parsed = parseInt(jumpValue, 10);
    if (!isNaN(parsed)) goTo(parsed);
    setJumpOpenKey(null);
    setJumpValue("");
  };

  const navBtnClass =
    "p-1.5 px-2.5 text-xs font-semibold text-(--sst-text-secondary) bg-(--sst-surface) border border-(--sst-border-strong) rounded-lg hover:bg-(--sst-surface-hover) disabled:opacity-40 disabled:hover:bg-(--sst-surface) cursor-pointer transition-all flex items-center gap-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400";

  const iconBtnClass =
    "w-8 h-8 shrink-0 flex items-center justify-center text-(--sst-text-secondary) bg-(--sst-surface) border border-(--sst-border-strong) rounded-lg hover:bg-(--sst-surface-hover) disabled:opacity-40 disabled:hover:bg-(--sst-surface) cursor-pointer transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400";

  // "..." bấm được — mở ô nhập số trang, Enter hoặc blur để nhảy. `side` chỉ
  // dùng làm key phân biệt 2 dấu "..." (trái/phải current) khi cả 2 cùng
  // hiện — không có ý nghĩa gì khác.
  const renderEllipsis = (side: "left" | "right") => {
    if (jumpOpenKey === side) {
      return (
        <input
          key={side}
          ref={jumpInputRef}
          type="number"
          min={1}
          max={totalPages}
          value={jumpValue}
          onChange={(e) => setJumpValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitJump();
            if (e.key === "Escape") {
              setJumpOpenKey(null);
              setJumpValue("");
            }
          }}
          onBlur={commitJump}
          placeholder={`1-${totalPages}`}
          aria-label={`Nhập số trang từ 1 đến ${totalPages}`}
          className="w-14 h-8 text-center text-xs font-bold rounded-lg border border-indigo-300 dark:border-indigo-500/40 bg-(--sst-surface) text-(--sst-text) outline-none focus:ring-2 focus:ring-indigo-400 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />
      );
    }
    return (
      <button
        key={side}
        type="button"
        onClick={() => {
          setJumpOpenKey(side);
          setJumpValue("");
        }}
        title={`Nhập số trang (1-${totalPages})`}
        aria-label={`Nhập số trang (1-${totalPages})`}
        className="text-(--sst-text-muted) hover:text-indigo-600 dark:hover:text-indigo-300 px-1.5 h-8 text-xs select-none cursor-pointer rounded-lg hover:bg-(--sst-surface-hover) transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
      >
        ...
      </button>
    );
  };

  return (
    <div className="flex items-center justify-center gap-1.5 flex-wrap">
      <button
        type="button"
        onClick={() => goTo(1)}
        disabled={page === 1}
        title="Về trang đầu"
        aria-label="Về trang đầu"
        className={iconBtnClass}
      >
        <ChevronsLeft className="w-4 h-4" />
      </button>

      <button
        type="button"
        onClick={() => goTo(page - 1)}
        disabled={page === 1}
        className={navBtnClass}
      >
        <ChevronLeft className="w-4 h-4" />
        <span>Trước</span>
      </button>

      {/* Dải số trang: luôn hiện trang 1, trang cuối, và các trang lân cận
          trang hiện tại — chỗ hở ở giữa thay bằng "..." bấm được. */}
      {Array.from({ length: totalPages }).map((_, i) => {
        const pageNum = i + 1;
        if (pageNum === 1 || pageNum === totalPages || Math.abs(pageNum - page) <= 1) {
          return (
            <button
              key={pageNum}
              type="button"
              onClick={() => goTo(pageNum)}
              aria-current={page === pageNum ? "page" : undefined}
              className={`w-8 h-8 text-xs font-bold rounded-lg transition-all cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
                page === pageNum
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "bg-(--sst-surface) hover:bg-(--sst-surface-hover) text-(--sst-text-secondary) border border-(--sst-border-strong)"
              }`}
            >
              {pageNum}
            </button>
          );
        }
        if (pageNum === 2 || pageNum === totalPages - 1) {
          return renderEllipsis(pageNum === 2 ? "left" : "right");
        }
        return null;
      })}

      <button
        type="button"
        onClick={() => goTo(page + 1)}
        disabled={page === totalPages}
        className={navBtnClass}
      >
        <span>Sau</span>
        <ChevronRight className="w-4 h-4" />
      </button>

      <button
        type="button"
        onClick={() => goTo(totalPages)}
        disabled={page === totalPages}
        title="Đến trang cuối"
        aria-label="Đến trang cuối"
        className={iconBtnClass}
      >
        <ChevronsRight className="w-4 h-4" />
      </button>
    </div>
  );
}
