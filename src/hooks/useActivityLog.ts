import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listActivityLog, markActivityRead } from "../services/activityLog";
import { rowToActivityLogEntry } from "../lib/mapRows";
import { useCurrentUserId } from "./useCurrentUserId";

/**
 * [T-S27] KHÔNG dùng `useDataScope` (khác `useCategories`/`useGoals`) —
 * chuông không tách theo scope hiện tại, xem comment ở
 * `services/activityLog.ts`. Chỉ cần biết đã có user đăng nhập hay chưa để
 * tránh gọi query khi session còn đang load (đúng pattern `enabled` các
 * hook khác đang dùng).
 *
 * [Bug thật phát hiện 18/08/2026, xem CHANGELOG "T-S27 — vá lỗ hổng
 * Realtime rớt event"]: Realtime `postgres_changes` xác nhận đã đẩy LIVE
 * đúng cho actor (chủ hộ thấy ngay không cần F5), nhưng RỚT event ở phía
 * thành viên khác cùng hộ (chỉ thấy lại sau F5 — tức REST/RLS luôn đúng,
 * chỉ WebSocket bị rớt) — race condition/mất kết nối WS cổ điển, không có
 * cách nào loại trừ 100% chỉ bằng đẩy Realtime. Theo đúng cách
 * Messenger/Instagram/Slack/Gmail vận hành thật: KHÔNG bao giờ chỉ tin vào
 * WS, luôn có lớp "đối soát" (reconcile) qua fetch lại làm lưới an toàn —
 * `refetchOnWindowFocus` (đổi tab/mở lại máy) + gọi `refetch()` mỗi lần mở
 * chuông (xem `NotificationBell.tsx`).
 */
/**
 * T-S97 (đề xuất quản lý thông báo, người dùng xác nhận làm 18/08/2026):
 * `limit` giờ truyền được từ ngoài vào (mặc định 50, giữ nguyên hành vi cũ
 * khi không truyền) — cho phép `NotificationBell.tsx` tăng dần khi bấm
 * "Xem thêm" thay vì cap cứng 50 vĩnh viễn. `queryKey` gồm `limit` để mỗi
 * mức limit là 1 cache entry riêng (đúng pattern TanStack Query, tránh
 * hiển thị nhầm data cũ khi limit đổi).
 */
export function useActivityLog(limit = 50) {
  const userId = useCurrentUserId();

  return useQuery({
    queryKey: ["activityLog", limit],
    queryFn: async () => (await listActivityLog(limit)).map(rowToActivityLogEntry),
    enabled: !!userId,
    refetchOnWindowFocus: true,
    staleTime: 15_000,
  });
}

export function useMarkActivityRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids?: string[]) => markActivityRead(ids),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["activityLog"] }),
  });
}