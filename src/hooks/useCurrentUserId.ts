import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

/**
 * Lấy `auth.uid()` hiện tại để các data hook (useTransactions/useCategories/
 * useGoals/useHousehold) tự dựng scope, KHÔNG nhận qua props từ App.tsx
 * (CONSTITUTION §1.1 — bỏ prop-drilling). Cố ý KHÔNG dùng TanStack Query cho
 * việc này: đây là auth state do supabase-js tự quản lý session/refresh
 * token, không phải server data cần cache/invalidate qua React Query.
 *
 * currentUser đầy đủ (profile, tên hiển thị...) vẫn ở App.tsx (T-S04) — hook
 * này chỉ trả về id, đủ dùng để build query key/scope.
 */
export function useCurrentUserId(): string | undefined {
  const [userId, setUserId] = useState<string | undefined>(undefined);

  useEffect(() => {
    let isMounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (isMounted) setUserId(data.session?.user.id);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user.id);
    });

    return () => {
      isMounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  return userId;
}
