import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  createTransaction,
  listTransactions,
  restoreTransaction,
  softDeleteTransaction,
  updateTransaction,
} from "../services/transactions";
import { useDataScope } from "./useDataScope";
import type { Database } from "../lib/database.types";

type TransactionRow = Database["public"]["Tables"]["transactions"]["Row"];
type TransactionInsert = Database["public"]["Tables"]["transactions"]["Insert"];
type TransactionUpdate = Database["public"]["Tables"]["transactions"]["Update"];

export function useTransactions() {
  const { scopeMode, isReady, scopeKey, serviceScope } = useDataScope();

  return useQuery({
    queryKey: ["transactions", scopeMode, scopeKey],
    queryFn: () => listTransactions(serviceScope),
    enabled: isReady,
  });
}

/**
 * T-S07 (CONSTITUTION §1.1, cố ý làm SAU T-S08) — cache đang lưu
 * `TransactionRow[]` THÔ (chưa map qua `rowToTransaction`, việc map tên
 * category/member diễn ra ở tầng component lúc đọc — xem `mapRows.ts`), nên
 * optimistic update chỉ cần chèn/xoá đúng shape `TransactionRow`, KHÔNG cần
 * tự resolve tên hiển thị — component tiêu thụ sẽ tự map lại như bình
 * thường ngay khi cache đổi.
 */
function cancelAndSnapshot(queryClient: QueryClient, queryKey: readonly unknown[]) {
  return queryClient.cancelQueries({ queryKey }).then(() => ({
    queryKey,
    previousData: queryClient.getQueryData<TransactionRow[]>(queryKey),
  }));
}

/**
 * T-S06c: base mutation (invalidate sau khi server xác nhận thành công).
 *
 * T-S07: thêm `onMutate` chèn NGAY 1 dòng tạm vào cache (id giả
 * `temp-<uuid>`) trước khi server trả về — người dùng thấy giao dịch xuất
 * hiện tức thời. `onError` rollback đúng về snapshot cũ nếu request thất
 * bại (vd mất mạng). `onSettled` vẫn invalidate như T-S06c — dòng tạm sẽ
 * được THAY THẾ bằng dữ liệu thật khi refetch xong, dù invalidate đến từ
 * chính mutation này hay từ Realtime (T-S08) bắn gần như đồng thời — cả 2
 * chỉ cùng gọi `invalidateQueries`/refetch, React Query tự gộp, không có 2
 * nguồn `setQueryData` giẫm lên nhau nên không nhấp nháy.
 *
 * Invalidate cả "goals": transaction có thể gắn goal_id -> trigger DB
 * (CONSTITUTION §2.6) tự cộng/trừ saving_goals.current_amount, nên UI mục
 * tiêu phải refetch theo, không chỉ riêng transactions.
 */
export function useCreateTransaction() {
  const queryClient = useQueryClient();
  const { scopeMode, scopeKey } = useDataScope();

  return useMutation({
    // T-S98 (bug thật, xem CHANGELOG): mặc định networkMode 'online' của
    // TanStack Query khiến mutationFn KHÔNG được gọi khi navigator.onLine
    // false — bị "pause" chờ sự kiện 'online', nên AbortSignal.timeout(10s)
    // trong createTransaction không bao giờ có cơ hội chạy trong đúng kịch
    // bản mất mạng thật. 'always' ép fn() luôn chạy ngay, để timeout ở
    // service layer thực sự có tác dụng và onError rollback được kích hoạt.
    networkMode: "always",
    mutationFn: (input: TransactionInsert) => createTransaction(input),
    onMutate: async (input) => {
      const queryKey = ["transactions", scopeMode, scopeKey] as const;
      const { previousData } = await cancelAndSnapshot(queryClient, queryKey);

      const now = new Date().toISOString();
      const tempRow: TransactionRow = {
        id: `temp-${crypto.randomUUID()}`,
        owner_id: input.owner_id ?? null,
        household_id: input.household_id ?? null,
        member_id: input.member_id ?? null,
        type: input.type,
        description: input.description,
        amount: input.amount,
        date: input.date,
        note: input.note ?? null,
        category_id: input.category_id ?? null,
        goal_id: input.goal_id ?? null,
        source: input.source ?? "web",
        telegram_batch_id: null,
        deleted_at: null,
        created_at: now,
        updated_at: now,
        member_name_snapshot: null,
        withdrawal_group_id: input.withdrawal_group_id ?? null,
      };

      queryClient.setQueryData<TransactionRow[]>(queryKey, (old) => [tempRow, ...(old ?? [])]);

      return { queryKey, previousData };
    },
    onError: (_err, _input, context) => {
      if (context) queryClient.setQueryData(context.queryKey, context.previousData);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["goals"] });
    },
  });
}

export function useUpdateTransaction() {
  const queryClient = useQueryClient();
  return useMutation({
    // T-S98 — xem giải thích networkMode ở useCreateTransaction phía trên.
    // Hook này không có onMutate/onError (không optimistic), nhưng vẫn cần
    // 'always' để lỗi "Mất kết nối..." hiện ra sau 10s thay vì mutation kẹt
    // ở trạng thái pending vô thời hạn khi mất mạng thật.
    networkMode: "always",
    mutationFn: ({ id, patch }: { id: string; patch: TransactionUpdate }) =>
      updateTransaction(id, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["goals"] });
    },
  });
}

/**
 * T-S07: `onMutate` ẩn NGAY dòng bị xoá khỏi cache (lọc theo id) — UI phản
 * hồi tức thời thay vì đợi server. `onError` rollback lại đúng danh sách cũ
 * (dòng vừa "biến mất" xuất hiện lại) nếu request thất bại.
 */
export function useSoftDeleteTransaction() {
  const queryClient = useQueryClient();
  const { scopeMode, scopeKey } = useDataScope();

  return useMutation({
    // T-S98 — xem giải thích networkMode ở useCreateTransaction phía trên.
    networkMode: "always",
    mutationFn: (id: string) => softDeleteTransaction(id),
    onMutate: async (id) => {
      const queryKey = ["transactions", scopeMode, scopeKey] as const;
      const { previousData } = await cancelAndSnapshot(queryClient, queryKey);

      queryClient.setQueryData<TransactionRow[]>(queryKey, (old) =>
        (old ?? []).filter((t) => t.id !== id)
      );

      return { queryKey, previousData };
    },
    onError: (_err, _id, context) => {
      if (context) queryClient.setQueryData(context.queryKey, context.previousData);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["goals"] });
    },
  });
}

/**
 * Hoàn tác xoá — nút Undo (T-S07). CỐ Ý KHÔNG optimistic ở đây (khác 2 hook
 * trên) — phục hồi là thao tác hiếm, nhanh (1 UPDATE đơn), và cần
 * `saving_goals.current_amount` cộng lại ĐÚNG qua trigger DB thật (§2.6)
 * trước khi hiện lại cho người dùng thấy số dư mục tiêu; tự đoán lại số
 * trước khi server xác nhận dễ sai nếu có góp quỹ liên quan.
 */
export function useRestoreTransaction() {
  const queryClient = useQueryClient();
  return useMutation({
    // T-S98 — xem giải thích networkMode ở useCreateTransaction phía trên.
    networkMode: "always",
    mutationFn: (id: string) => restoreTransaction(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["goals"] });
    },
  });
}