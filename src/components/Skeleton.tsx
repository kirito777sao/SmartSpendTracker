// T-S129 — Skeleton loading dùng chung, thay cho việc mỗi component tự viết
// khung "Đang tải" riêng lẻ (hoặc không có gì, gây nháy trạng thái rỗng khi
// mạng chậm). Dùng token `--sst-surface-2`/`--sst-border` sẵn có (đúng
// CONSTITUTION §1.26), không hardcode màu — tự đổi đúng theo dark mode.

/** 1 khối chữ nhật bo góc, nhấp nháy — đơn vị nhỏ nhất để ghép thành mọi hình
 * dạng skeleton (dòng chữ, avatar tròn, thanh progress...). */
export function SkeletonBlock({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse bg-(--sst-surface-2) rounded-lg ${className}`} />;
}

/** Khung skeleton cho 1 "thẻ" nội dung kiểu card (dùng ở SavingGoals,
 * BudgetLimits — mỗi mục là 1 card có tiêu đề + thanh progress + số liệu). */
export function SkeletonCard() {
  return (
    <div className="bg-(--sst-surface) border border-(--sst-border) rounded-2xl p-4.5 space-y-3">
      <div className="flex items-center justify-between">
        <SkeletonBlock className="h-4 w-32" />
        <SkeletonBlock className="h-4 w-14" />
      </div>
      <SkeletonBlock className="h-2.5 w-full rounded-full" />
      <div className="flex items-center justify-between">
        <SkeletonBlock className="h-3 w-20" />
        <SkeletonBlock className="h-3 w-16" />
      </div>
    </div>
  );
}

/** Danh sách N SkeletonCard xếp dọc — dùng khi màn hình là 1 lưới/cột các
 * thẻ (BudgetLimits danh mục, SavingGoals mục tiêu). */
export function SkeletonCardList({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

/** Khung skeleton cho 1 dòng giao dịch (icon tròn + 2 dòng chữ + số tiền) —
 * dùng ở TransactionHistory (cả bảng desktop lẫn danh sách thẻ mobile). */
export function SkeletonTransactionRow() {
  return (
    <div className="flex items-center gap-3 p-3.5 border-b border-(--sst-border) last:border-b-0">
      <SkeletonBlock className="h-9 w-9 rounded-xl shrink-0" />
      <div className="flex-1 space-y-1.5">
        <SkeletonBlock className="h-3.5 w-2/5" />
        <SkeletonBlock className="h-3 w-1/4" />
      </div>
      <SkeletonBlock className="h-4 w-16 shrink-0" />
    </div>
  );
}

export function SkeletonTransactionList({ count = 6 }: { count?: number }) {
  return (
    <div className="bg-(--sst-surface) border border-(--sst-border) rounded-2xl overflow-hidden">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonTransactionRow key={i} />
      ))}
    </div>
  );
}

/** Khung skeleton cho 1 ô số liệu tổng quan (dùng ở FinancialDashboard —
 * các thẻ tổng thu/chi/số dư ở đầu trang). */
export function SkeletonStatCard() {
  return (
    <div className="bg-(--sst-surface) border border-(--sst-border) rounded-2xl p-4.5 space-y-2.5">
      <SkeletonBlock className="h-3 w-20" />
      <SkeletonBlock className="h-6 w-28" />
    </div>
  );
}

/** Khung skeleton toàn trang Dashboard: hàng thẻ tổng quan + 1 khối biểu đồ
 * lớn — không cố mô phỏng chi tiết biểu đồ (không cần thiết), chỉ giữ đúng
 * bố cục để tránh giật layout khi dữ liệu thật load xong. */
export function SkeletonDashboard() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonStatCard key={i} />
        ))}
      </div>
      <div className="bg-(--sst-surface) border border-(--sst-border) rounded-2xl p-5">
        <SkeletonBlock className="h-4 w-40 mb-4" />
        <SkeletonBlock className="h-56 w-full" />
      </div>
    </div>
  );
}
