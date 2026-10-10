import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createHousehold,
  deleteHousehold,
  getMyHousehold,
  joinHouseholdByCode,
  leaveHousehold,
  listHouseholdMembers,
  removeMember,
  transferOwnership,
} from "../services/household";
import { useCurrentUserId } from "./useCurrentUserId";

/**
 * Household hiện tại của user (không phụ thuộc scopeMode — CONSTITUTION
 * §1.1: household luôn là hộ user đang thuộc về, bất kể đang xem sổ cá nhân
 * hay hộ gia đình). RLS tự lọc đúng hộ của auth.uid(), không cần tham số.
 */
export function useHousehold() {
  const userId = useCurrentUserId();

  return useQuery({
    queryKey: ["household", userId],
    queryFn: getMyHousehold,
    enabled: !!userId,
  });
}

/** Danh sách thành viên của 1 household — dùng ở HouseholdManagement (T-S06d/e). */
export function useHouseholdMembers(householdId: string | undefined) {
  return useQuery({
    queryKey: ["household-members", householdId],
    queryFn: () => listHouseholdMembers(householdId as string),
    enabled: !!householdId,
  });
}

/**
 * Hồ sơ (profiles row) của chính user hiện tại trong household đang thuộc về
 * — dùng để hiển thị "Thành viên thực hiện" bằng TÊN HIỂN THỊ thật
 * (`name`/`personal_role`), không phải email, khi ghi giao dịch ở scope hộ
 * gia đình (T-S06e1, CONSTITUTION §1.2). Không tạo query riêng: tái dùng
 * useHouseholdMembers (RLS đã cho phép đọc profile chính mình + cùng hộ).
 */
export function useCurrentMember() {
  const userId = useCurrentUserId();
  const { data: household } = useHousehold();
  const { data: members = [] } = useHouseholdMembers(household?.id);
  return members.find((m) => m.id === userId);
}

/** "${personal_role} (${name})" — khớp format `authMapping.buildUserFromProfile.displayName`. */
export function formatMemberDisplayName(member: { name: string; personal_role: string }): string {
  return `${member.personal_role} (${member.name})`;
}

/**
 * T-S06c mutations. Join/leave/create đổi `household_id` của user -> đổi
 * luôn scopeKey mà useDataScope() dùng để dựng query key cho
 * transactions/categories/goals (CONSTITUTION §1.1: "Đổi scopeMode hoặc
 * householdId -> key đổi tự nhiên"). Nhưng vì householdId chỉ được BIẾT sau
 * khi query "household" refetch xong (round-trip riêng), 3 domain còn lại
 * có thể tạm giữ data cũ 1 nhịp nếu chỉ chờ đổi key tự nhiên. Để tránh lệch
 * dữ liệu ngay sau khi tạo/tham gia/rời hộ, invalidate luôn cả 3 domain ở
 * đây thay vì chỉ dựa vào key thay đổi.
 */
function invalidateHouseholdAndScopedData(
  queryClient: ReturnType<typeof useQueryClient>,
  userId: string | undefined
) {
  queryClient.invalidateQueries({ queryKey: ["household", userId] });
  queryClient.invalidateQueries({ queryKey: ["household-members"] });
  queryClient.invalidateQueries({ queryKey: ["transactions"] });
  queryClient.invalidateQueries({ queryKey: ["categories"] });
  queryClient.invalidateQueries({ queryKey: ["goals"] });
}

export function useCreateHousehold() {
  const queryClient = useQueryClient();
  const userId = useCurrentUserId();
  return useMutation({
    mutationFn: (name: string) => createHousehold(name),
    onSuccess: () => invalidateHouseholdAndScopedData(queryClient, userId),
  });
}

export function useJoinHousehold() {
  const queryClient = useQueryClient();
  const userId = useCurrentUserId();
  return useMutation({
    mutationFn: (inviteCode: string) => joinHouseholdByCode(inviteCode),
    onSuccess: () => invalidateHouseholdAndScopedData(queryClient, userId),
  });
}

/** RPC raise nếu owner rời khi còn thành viên khác (CONSTITUTION §4/T-S03) — lỗi tự propagate qua isError/error của mutation. */
export function useLeaveHousehold() {
  const queryClient = useQueryClient();
  const userId = useCurrentUserId();
  return useMutation({
    mutationFn: () => leaveHousehold(),
    onSuccess: () => invalidateHouseholdAndScopedData(queryClient, userId),
  });
}

/** Chỉ chủ hộ gọi được — RPC tự kiểm tra, raise nếu không phải owner. */
export function useRemoveMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (memberId: string) => removeMember(memberId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["household-members"] });
    },
  });
}

/** Chuyển quyền chủ hộ cho 1 thành viên khác cùng hộ (T-S03b). */
export function useTransferOwnership() {
  const queryClient = useQueryClient();
  const userId = useCurrentUserId();
  return useMutation({
    mutationFn: (newOwnerId: string) => transferOwnership(newOwnerId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["household", userId] });
      queryClient.invalidateQueries({ queryKey: ["household-members"] });
    },
  });
}

/**
 * Xoá hộ gia đình (T-S15) — hành động tường minh, tách hẳn "Rời nhóm"
 * (useLeaveHousehold). RPC tự chặn nếu không phải chủ hộ hoặc còn thành
 * viên khác (raise, propagate qua isError/error của mutation). UI gọi hook
 * này PHẢI có bước xác nhận riêng, không dùng chung nút với "Rời nhóm".
 */
export function useDeleteHousehold() {
  const queryClient = useQueryClient();
  const userId = useCurrentUserId();
  return useMutation({
    mutationFn: () => deleteHousehold(),
    onSuccess: () => invalidateHouseholdAndScopedData(queryClient, userId),
  });
}