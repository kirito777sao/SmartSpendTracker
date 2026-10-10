import { supabase } from "../lib/supabaseClient";
import type { Database } from "../lib/database.types";

type HouseholdRow = Database["public"]["Tables"]["households"]["Row"];
type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];

/**
 * Bảng households không có policy INSERT/UPDATE cho client (CONSTITUTION §3
 * — "insert/join đi qua RPC SECURITY DEFINER"). Mọi mutation ở service này
 * PHẢI đi qua .rpc(), không bao giờ .insert()/.update() thẳng vào bảng.
 */

/**
 * Hộ ĐANG hoạt động của user hiện tại (khớp ý nghĩa query key
 * ['household', userId] — CONSTITUTION §1.1, không phụ thuộc scopeMode).
 * BẮT BUỘC lọc `deleted_at is null` ở đây: từ migration 0010, RLS SELECT
 * trên `households` có thêm 1 nhánh cho phép chủ hộ CŨ đọc lại hộ đã xoá
 * (archive-view, phục vụ T-S16) — nếu không lọc, hàm này sẽ vô tình trả
 * về hộ vừa bị `delete_household()` xoá thay vì null (bug thật gặp khi
 * verify T-S15, xem CHANGELOG). Archive-view có hàm riêng bên dưới,
 * không gộp vào đây để giữ đúng 1 ý nghĩa/hàm.
 */
export async function getMyHousehold(): Promise<HouseholdRow | null> {
  const { data, error } = await supabase
    .from("households")
    .select("*")
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Danh sách hộ ĐÃ xoá mà user hiện tại từng là chủ hộ (archive-view, T-S16).
 * Dựa đúng nhánh RLS `is_archived_household_owner` thêm ở migration 0010 —
 * KHÔNG dùng cho luồng chính (HouseholdManagement hiện tại), chỉ phục vụ
 * màn hình "hộ đã lưu trữ" khi UI đó được lập kế hoạch (backlog, xem
 * CONSTITUTION §1.6 "Đề xuất bổ sung").
 */
export async function getArchivedHouseholds(): Promise<HouseholdRow[]> {
  const { data, error } = await supabase
    .from("households")
    .select("*")
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Danh sách thành viên hộ — đọc qua profiles, RLS đã tự lọc cùng household. */
export async function listHouseholdMembers(householdId: string): Promise<ProfileRow[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("household_id", householdId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/** Tạo hộ mới — raise nếu đang ở hộ khác (xử lý message lỗi tiếng Việt từ RPC, xem CONSTITUTION §4/0003). */
export async function createHousehold(name: string): Promise<string> {
  const { data, error } = await supabase.rpc("create_household", { p_name: name });
  if (error) throw error;
  return data as string;
}

export async function joinHouseholdByCode(inviteCode: string): Promise<string> {
  const { data, error } = await supabase.rpc("join_household_by_code", {
    p_invite_code: inviteCode,
  });
  if (error) throw error;
  return data as string;
}

/** Rời hộ — nếu là chủ hộ và còn thành viên khác, RPC raise exception (chặn), không giải tán ngầm. */
export async function leaveHousehold(): Promise<void> {
  const { error } = await supabase.rpc("leave_household");
  if (error) throw error;
}

/** Chỉ chủ hộ gọi được — RPC tự kiểm tra, raise nếu không phải owner. */
export async function removeMember(memberId: string): Promise<void> {
  const { error } = await supabase.rpc("remove_member", { p_member_id: memberId });
  if (error) throw error;
}

/** Chuyển quyền chủ hộ cho 1 thành viên khác cùng hộ (T-S03b). */
export async function transferOwnership(newOwnerId: string): Promise<void> {
  const { error } = await supabase.rpc("transfer_ownership", { p_new_owner_id: newOwnerId });
  if (error) throw error;
}

/**
 * Xoá hộ gia đình (T-S15, soft-delete) — hành động TƯỜNG MINH, khác hẳn
 * "Rời hộ" (leaveHousehold). Chỉ chủ hộ gọi được, chỉ khi là thành viên
 * duy nhất còn lại (RPC tự kiểm tra, raise nếu không đúng điều kiện).
 * Dữ liệu categories/saving_goals/transactions/activity_log của hộ KHÔNG
 * bị đụng — chỉ households.deleted_at được set. UI gọi hàm này PHẢI có
 * bước xác nhận rõ ràng (khác "Rời nhóm") vì đây là hành động khó đảo
 * ngược qua UI thường (chỉ chủ hộ cũ còn xem lại được qua archive-view).
 */
export async function deleteHousehold(): Promise<void> {
  const { error } = await supabase.rpc("delete_household");
  if (error) throw error;
}