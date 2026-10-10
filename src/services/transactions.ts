import { supabase } from "../lib/supabaseClient";
import type { Database } from "../lib/database.types";

type TransactionRow = Database["public"]["Tables"]["transactions"]["Row"];
type TransactionInsert = Database["public"]["Tables"]["transactions"]["Insert"];
type TransactionUpdate = Database["public"]["Tables"]["transactions"]["Update"];

/**
 * T-S96 (nối tiếp AC còn treo của T-S07: "ngắt mạng giả lập → rollback
 * đúng") — bug thật phát hiện qua test tay 18/08/2026: khi mất mạng THẬT
 * (không phải throttle DevTools mà tắt hẳn WiFi/Airplane mode/VPN chết),
 * `fetch()` của trình duyệt không phải lúc nào cũng reject ngay — tuỳ
 * trạng thái routing của OS/VPN, request có thể "treo" (pending) vô thời
 * hạn thay vì báo lỗi mạng nhanh. Hệ quả: `useCreateTransaction`/
 * `useSoftDeleteTransaction` (useTransactions.ts) không bao giờ có gì để
 * `onError` xử lý → dòng optimistic ("bóng ma") ở lại vĩnh viễn trên UI dù
 * KHÔNG hề được ghi xuống DB — đúng bug người dùng test thấy (3 dòng "cá
 * chép" trùng nhau, không có trong DB).
 *
 * Fix: ép mọi request có 1 timeout cứng (10s, đủ dư so với round-trip
 * bình thường tới Supabase) bằng `AbortSignal.timeout()` (Web API chuẩn,
 * có sẵn trong `lib: DOM` — không cần cài thêm gì). Hết giờ chưa có phản
 * hồi → tự huỷ, `error` được ném ra như lỗi mạng thật → `onError` có cái
 * để rollback đúng AC gốc.
 */
const MUTATION_TIMEOUT_MS = 10_000;

/**
 * `AbortSignal.timeout()` huỷ request bằng `DOMException` tên
 * `TimeoutError`/`AbortError` — message gốc kỹ thuật, khó hiểu với người
 * dùng cuối ("signal timed out"). Đổi thành thông báo tiếng Việt rõ nghĩa
 * trước khi ném lại, giữ nguyên mọi lỗi khác (RLS, validate DB...) không
 * đổi — chỉ chặn đúng 1 loại lỗi này.
 */
function rethrowFriendly(err: unknown): never {
  if (err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError")) {
    throw new Error("Mất kết nối — giao dịch chưa được lưu, vui lòng thử lại.");
  }
  throw err;
}

export async function listTransactions(scope: {
  ownerId?: string;
  householdId?: string;
}): Promise<TransactionRow[]> {
  let query = supabase.from("transactions").select("*").order("date", { ascending: false });

  if (scope.householdId) {
    query = query.eq("household_id", scope.householdId);
  } else if (scope.ownerId) {
    query = query.eq("owner_id", scope.ownerId);
  } else {
    throw new Error("listTransactions cần ownerId hoặc householdId.");
  }

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

/**
 * Insert giao dịch nguồn web (`source` mặc định 'web' — DB default).
 * `member_id` bắt buộc = auth.uid() khi household_id có giá trị, do RLS
 * insert policy đòi hỏi đúng vậy (CONSTITUTION §3) — hàm này không tự set,
 * để nguyên trách nhiệm gọi đúng cho tầng gọi (hook T-S06), tránh service
 * layer âm thầm đoán ý người gọi.
 */
export async function createTransaction(input: TransactionInsert): Promise<TransactionRow> {
  try {
    const { data, error } = await supabase
      .from("transactions")
      .insert(input)
      .select()
      .abortSignal(AbortSignal.timeout(MUTATION_TIMEOUT_MS))
      .single();
    if (error) throw error;
    return data;
  } catch (err) {
    rethrowFriendly(err);
  }
}

export async function updateTransaction(
  id: string,
  patch: TransactionUpdate
): Promise<TransactionRow> {
  try {
    const { data, error } = await supabase
      .from("transactions")
      .update(patch)
      .eq("id", id)
      .select()
      .abortSignal(AbortSignal.timeout(MUTATION_TIMEOUT_MS))
      .single();
    if (error) throw error;
    return data;
  } catch (err) {
    rethrowFriendly(err);
  }
}

/**
 * Soft delete — RBAC vẫn đúng như đã chốt (member chỉ sửa/xoá giao dịch của
 * chính mình, chủ hộ override mọi giao dịch) — KHÔNG đổi. Đổi CÁCH gọi:
 * bug thật phát hiện ở T-S05 test (transactions.test.ts fail đúng thông
 * điệp RLS 42501 ở bước soft-delete) — nguyên nhân giống hệt category (xem
 * CHANGELOG.md "sửa lần 2"): Postgres yêu cầu dòng KẾT QUẢ của UPDATE có
 * WHERE phải thoả SELECT policy cả TRƯỚC LẪN SAU khi update, không liên
 * quan RETURNING, không liên quan security invoker/definer. SELECT policy
 * của transactions lọc `deleted_at is null` nên mọi UPDATE đổi deleted_at
 * chạy dưới quyền người gọi thường (security invoker, cách cũ ở
 * 0004_rpc_soft_delete_no_returning.sql — ĐÃ SAI, giữ làm hồ sơ) đều tự vi
 * phạm. Fix: gọi qua RPC SECURITY DEFINER
 * (0006_fix_soft_delete_restore_transaction_security_definer.sql) — hàm tự
 * kiểm tra quyền thủ công y hệt điều kiện policy UPDATE đã CHỐT ở §3 rồi
 * mới UPDATE bằng quyền definer, không đổi RBAC, chỉ đổi cơ chế thực thi.
 */
export async function softDeleteTransaction(id: string): Promise<void> {
  try {
    const { error } = await supabase
      .rpc("soft_delete_transaction", { p_id: id })
      .abortSignal(AbortSignal.timeout(MUTATION_TIMEOUT_MS));
    if (error) throw error;
  } catch (err) {
    rethrowFriendly(err);
  }
}

/** Hoàn tác xoá (nút Undo trong 5s, T-S07) — trigger DB tự cộng lại current_amount nếu có goal_id. */
export async function restoreTransaction(id: string): Promise<void> {
  try {
    const { error } = await supabase
      .rpc("restore_transaction", { p_id: id })
      .abortSignal(AbortSignal.timeout(MUTATION_TIMEOUT_MS));
    if (error) throw error;
  } catch (err) {
    rethrowFriendly(err);
  }
}