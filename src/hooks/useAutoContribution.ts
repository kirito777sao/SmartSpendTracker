import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listAutoContributionConfigs,
  createAutoContributionConfig,
  updateAutoContributionConfig,
  deleteAutoContributionConfig,
  toggleAutoContributionConfig,
} from "../services/autoContribution";
import { useDataScope } from "./useDataScope";

/**
 * [T-S139, CONSTITUTION §1.1 query key factory] Đọc TOÀN BỘ config trong
 * scope hiện tại (không lọc theo goal ở tầng query) — component tự
 * `.find(c => c.goal_id === goalId)`, đúng cùng nguyên tắc `useGoals`/
 * `useCategories` (1 query cho cả danh sách, cache dedupe giữa nhiều thẻ
 * goal cùng đọc 1 lần thay vì mỗi thẻ tự query riêng).
 */
export function useAutoContributionConfigs() {
  const { scopeMode, isReady, scopeKey, serviceScope } = useDataScope();

  return useQuery({
    queryKey: ["autoContributionConfigs", scopeMode, scopeKey],
    queryFn: () => listAutoContributionConfigs(serviceScope),
    enabled: isReady,
  });
}

export function useCreateAutoContributionConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createAutoContributionConfig,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["autoContributionConfigs"] }),
  });
}

export function useUpdateAutoContributionConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateAutoContributionConfig,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["autoContributionConfigs"] }),
  });
}

export function useDeleteAutoContributionConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteAutoContributionConfig,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["autoContributionConfigs"] }),
  });
}

export function useToggleAutoContributionConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ configId, enabled }: { configId: string; enabled: boolean }) =>
      toggleAutoContributionConfig(configId, enabled),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["autoContributionConfigs"] }),
  });
}
