import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createCategory,
  listCategories,
  restoreCategory,
  softDeleteCategory,
  updateCategory,
} from "../services/categories";
import { useDataScope } from "./useDataScope";
import type { Database } from "../lib/database.types";

type CategoryInsert = Database["public"]["Tables"]["categories"]["Insert"];
type CategoryUpdate = Database["public"]["Tables"]["categories"]["Update"];

export function useCategories() {
  const { scopeMode, isReady, scopeKey, serviceScope } = useDataScope();

  return useQuery({
    queryKey: ["categories", scopeMode, scopeKey],
    queryFn: () => listCategories(serviceScope),
    enabled: isReady,
  });
}

export function useCreateCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CategoryInsert) => createCategory(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["categories"] }),
  });
}

export function useUpdateCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: CategoryUpdate }) =>
      updateCategory(id, patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["categories"] }),
  });
}

export function useSoftDeleteCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => softDeleteCategory(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["categories"] }),
  });
}

/** Hoàn tác xoá (T-S07 dùng, base hook đã sẵn ở đây theo T-S06c). */
export function useRestoreCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => restoreCategory(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["categories"] }),
  });
}
