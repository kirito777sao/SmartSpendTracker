import { useEffect, useRef, useState } from "react";
import { Bell, CheckCheck } from "lucide-react";
import { useActivityLog, useMarkActivityRead } from "../hooks/useActivityLog";
import { ActivityLogEntry } from "../types";

/**
 * [T-S27, CONSTITUTION §1.11] Chuông thông báo — viết MỚI HOÀN TOÀN, đọc
 * `activity_log` thật qua `useActivityLog` (Realtime đã bao gồm bảng này từ
 * migration 0030, xem `useRealtimeSync.ts`) — không kế thừa bất kỳ code/type
 * nào của cơ chế `server.ts` cũ đã xoá ở T-S06f-b3 (đúng quyết định đã CHỐT
 * 15/08/2026, xem CONSTITUTION cuối file).
 *
 * Không tự viết click-outside-to-close riêng — theo đúng pattern dropdown
 * "Tài khoản & Thiết lập" đã có sẵn ở App.tsx (chỉ đóng qua nút toggle/khi
 * chọn 1 hành động trong panel), giữ nhất quán UX trong cùng 1 header.
 */

const ACTION_ICON: Record<string, string> = {
  "budget.exceeded": "⚠️",
  "transaction.create": "🧾",
  "transaction.update": "✏️",
  "transaction.delete_by_member": "🗑️",
  "goal.completed": "🎉",
  "goal.contribution": "🐷",
  "category.budget_created": "💰",
};

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "Vừa xong";
  if (diffMin < 60) return `${diffMin} phút trước`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} giờ trước`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay} ngày trước`;
}

function NotificationRow({ entry }: { entry: ActivityLogEntry }) {
  const isUnread = !entry.readAt;
  return (
    <div
      className={`flex items-start gap-2.5 px-3.5 py-2.5 border-b border-(--sst-border) last:border-b-0 ${
        isUnread ? "bg-indigo-50/40 dark:bg-indigo-500/10" : ""
      }`}
    >
      <span className="text-base leading-none mt-0.5 shrink-0">{ACTION_ICON[entry.action] ?? "🔔"}</span>
      <div className="min-w-0 flex-1">
        <p className={`text-xs leading-snug ${isUnread ? "font-semibold text-(--sst-text)" : "text-(--sst-text-secondary)"}`}>
          {entry.message}
        </p>
        <span className="text-[10px] text-(--sst-text-muted)">{timeAgo(entry.createdAt)}</span>
      </div>
      {isUnread && <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 mt-1.5 shrink-0" />}
    </div>
  );
}

// T-S97 — bước tăng mỗi lần bấm "Xem thêm" (không phân trang cursor thật,
// chỉ tăng limit rồi refetch lại từ đầu — đủ dùng ở quy mô app cá nhân/hộ
// gia đình, tránh over-engineer cursor pagination cho 1 cái chuông).
const PAGE_SIZE = 50;

export default function NotificationBell() {
  const [isOpen, setIsOpen] = useState(false);
  const [visibleLimit, setVisibleLimit] = useState(PAGE_SIZE);
  const { data: entries, isLoading, isFetching, refetch } = useActivityLog(visibleLimit);
  const markRead = useMarkActivityRead();
  const panelRef = useRef<HTMLDivElement>(null);

  const unreadCount = entries?.filter((e) => !e.readAt).length ?? 0;
  // Đủ 1 trang đầy = có thể còn dữ liệu cũ hơn chưa lấy — hiện nút "Xem
  // thêm". Không chính xác 100% (đúng ra cần biết tổng số dòng thật) nhưng
  // đủ tốt cho UI, tránh thêm 1 query COUNT riêng chỉ để hiện/ẩn 1 nút.
  const mayHaveMore = (entries?.length ?? 0) >= visibleLimit;

  // Đóng panel khi click ra ngoài — cần riêng cho chuông (khác dropdown
  // "Tài khoản" không cần vì luôn có hành động rõ ràng đóng nó); danh sách
  // thông báo có thể chỉ đọc lướt rồi bấm ra ngoài mà không chọn gì.
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const handleToggle = async () => {
    const next = !isOpen;
    setIsOpen(next);
    if (next) {
      // [Bug thật 18/08/2026] Không tin tưởng tuyệt đối Realtime đã đẩy kịp
      // — luôn đối soát lại bằng 1 lần fetch REST mỗi khi mở chuông, để dữ
      // liệu ĐÚNG ngay cả khi WS bị rớt event ở phiên này (xem comment ở
      // useActivityLog.ts). Chờ refetch xong rồi mới xét đánh dấu đã đọc —
      // nếu xét TRƯỚC khi refetch xong sẽ dùng nhầm state cũ, bỏ sót đúng
      // những dòng vừa bị rớt Realtime (lý do ta đang vá ở đây).
      const fresh = await refetch();
      // [T-S97, thay đổi 18/08/2026] TRƯỚC ĐÂY gọi `markRead.mutate(undefined)`
      // — đánh dấu đã đọc MỌI dòng RLS cho phép, kể cả dòng cũ hơn
      // `visibleLimit` chưa từng hiện ra cho người dùng thấy (họ chưa hề
      // "đọc" gì cả, chỉ là chuông tự ý đánh dấu hộ). Giờ chỉ đánh dấu đúng
      // những dòng ĐANG hiển thị và đang unread — id tường minh, không còn
      // `undefined` (mark-all).
      const unreadVisibleIds = (fresh.data ?? []).filter((e) => !e.readAt).map((e) => e.id);
      if (unreadVisibleIds.length > 0) {
        markRead.mutate(unreadVisibleIds);
      }
    }
  };

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={handleToggle}
        className="relative p-1.5 sm:p-2 rounded-xl text-(--sst-text-muted) hover:text-indigo-600 hover:bg-indigo-50/70 dark:hover:text-amber-300 dark:hover:bg-(--sst-surface-hover) border border-(--sst-border-strong) transition-all cursor-pointer shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
        title="Thông báo"
        aria-label="Thông báo"
      >
        <Bell className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center shadow-xs">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] bg-(--sst-surface) border border-(--sst-border-strong) rounded-2xl shadow-xl z-50 overflow-hidden transform origin-top-right transition-all">
          <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-(--sst-border) bg-(--sst-surface-2)">
            <span className="font-extrabold text-(--sst-text) text-xs">Thông báo</span>
            {entries && entries.some((e) => !e.readAt) && (
              <button
                onClick={() => markRead.mutate(undefined)}
                className="flex items-center gap-1 text-[10px] font-semibold text-indigo-600 dark:text-indigo-300 hover:text-indigo-800 dark:hover:text-indigo-200 cursor-pointer"
              >
                <CheckCheck className="w-3 h-3" />
                Đánh dấu tất cả
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {isLoading && <p className="text-xs text-(--sst-text-muted) text-center py-6">Đang tải...</p>}
            {!isLoading && (!entries || entries.length === 0) && (
              <p className="text-xs text-(--sst-text-muted) text-center py-6">Không có hoạt động nào.</p>
            )}
            {entries?.map((entry) => (
              <NotificationRow key={entry.id} entry={entry} />
            ))}
            {/* T-S97 — trước đây cap cứng 50, không cách nào xem thông báo
                cũ hơn dù vẫn còn tồn tại trong DB. */}
            {mayHaveMore && (
              <button
                onClick={() => setVisibleLimit((n) => n + PAGE_SIZE)}
                disabled={isFetching}
                className="w-full text-center text-[11px] font-semibold text-indigo-600 dark:text-indigo-300 hover:text-indigo-800 dark:hover:text-indigo-200 py-2.5 border-t border-(--sst-border) disabled:opacity-50 cursor-pointer"
              >
                {isFetching ? "Đang tải..." : "Xem thêm"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}