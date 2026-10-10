import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "../lib/supabaseClient";
import { useCurrentUserId } from "./useCurrentUserId";
import { useHousehold } from "./useHousehold";

/**
 * T-S08 (CONSTITUTION §1.24): thay polling 4s (đã xoá ở T-S06f-b3) bằng
 * Supabase Realtime (`postgres_changes`). Gọi ĐÚNG 1 LẦN ở gốc `App.tsx` —
 * KHÔNG gọi lại ở bất kỳ component con nào khác (tránh mở trùng subscription
 * cho cùng 1 user).
 *
 * Mở đồng thời CẢ 2 kênh, không chỉ theo `scopeMode` đang xem (§1.24 lý do:
 * scopeMode đổi liên tục qua nút Cá nhân/Hộ gia đình, subscribe lại mỗi lần
 * đổi tab vừa thêm độ trễ vừa dễ bỏ sót nếu đổi nhanh):
 *  - Kênh cá nhân: filter `owner_id=eq.<userId>`
 *  - Kênh hộ gia đình: filter `household_id=eq.<householdId>`, CHỈ mở khi
 *    user đang thuộc 1 hộ.
 * Cho cả 3 bảng transactions/categories/saving_goals.
 *
 * `filter` ở đây KHÔNG phải cơ chế bảo mật — RLS (§3) vẫn là lớp chặn thật,
 * Realtime tự áp SELECT policy cho từng row trước khi bắn event ra client.
 * `filter` thuần tối ưu giảm nhiễu event không liên quan tới user hiện tại.
 *
 * Mọi event chỉ gọi `queryClient.invalidateQueries` với key RỘNG (không kèm
 * scope) — đúng pattern đã có ở mọi mutation hook (T-S06c). KHÔNG tự ý
 * `setQueryData` thẳng từ payload event, tránh lệch dữ liệu nếu payload
 * event không đủ field so với `rowToX()` mong đợi (optimistic update tức
 * thời thuộc đúng phạm vi T-S07, đặt SAU T-S08 theo lộ trình đã chốt
 * 15/08/2026).
 *
 * Hạ tầng DB bắt buộc đi kèm: migration 0029 (bật `supabase_realtime`
 * publication + `REPLICA IDENTITY FULL` cho 3 bảng trên).
 *
 * [T-S27, migration 0030] Thêm `activity_log` vào danh sách đồng bộ — chuông
 * thông báo cần cập nhật tức thời khi DB trigger sinh sự kiện mới (đúng lý
 * do đã ghi ở CONSTITUTION §1.11 "SAU T-S08 để chuông cập nhật tức thời qua
 * kênh postgres_changes có sẵn, không nối polling trước rồi sửa lại"). Cả 2
 * filter `owner_id=eq.<userId>` / `household_id=eq.<householdId>` áp dụng
 * được thẳng vì `activity_log` đã có cả 2 cột này (activity_log_scope_xor).
 */

const SYNCED_TABLES = ["transactions", "categories", "saving_goals", "activity_log"] as const;
type SyncedTable = (typeof SYNCED_TABLES)[number];

/** Map tên bảng DB -> tiền tố query key TanStack Query đang dùng thật. */
const QUERY_KEY_BY_TABLE: Record<SyncedTable, string> = {
  transactions: "transactions",
  categories: "categories",
  saving_goals: "goals",
  activity_log: "activityLog",
};

export function useRealtimeSync() {
  const queryClient = useQueryClient();
  const userId = useCurrentUserId();
  const { data: household } = useHousehold();
  const householdId = household?.id;

  useEffect(() => {
    // Chưa xác định được user (session đang load) -> chưa có gì để mở kênh.
    if (!userId) return;

    const invalidateFor = (table: SyncedTable) => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY_BY_TABLE[table]] });
      // transactions có thể gắn goal_id -> trigger DB apply_goal_contribution
      // (§2.6) cộng/trừ saving_goals.current_amount -> goals phải refetch
      // theo, đúng lý do đã áp dụng ở mọi mutation hook transactions T-S06c.
      if (table === "transactions") {
        queryClient.invalidateQueries({ queryKey: ["goals"] });
      }
    };

    const channels: RealtimeChannel[] = [];

    // Kênh cá nhân — luôn mở khi đã có userId, không phụ thuộc scopeMode.
    const personalChannel = supabase.channel(`personal-sync-${userId}`);
    for (const table of SYNCED_TABLES) {
      personalChannel.on(
        "postgres_changes",
        { event: "*", schema: "public", table, filter: `owner_id=eq.${userId}` },
        () => invalidateFor(table)
      );
    }
    personalChannel.subscribe();
    channels.push(personalChannel);

    // Kênh hộ gia đình — chỉ mở khi user đang thuộc 1 hộ.
    if (householdId) {
      const householdChannel = supabase.channel(`household-sync-${householdId}`);
      for (const table of SYNCED_TABLES) {
        householdChannel.on(
          "postgres_changes",
          { event: "*", schema: "public", table, filter: `household_id=eq.${householdId}` },
          () => invalidateFor(table)
        );
      }
      householdChannel.subscribe();
      channels.push(householdChannel);
    }

    return () => {
      for (const channel of channels) {
        supabase.removeChannel(channel);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, householdId, queryClient]);
}
