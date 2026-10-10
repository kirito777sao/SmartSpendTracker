import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

/**
 * [T-S134] Lấy email người dùng hiện tại qua `session.user.email` (Supabase
 * Auth) — KHÔNG round-trip bảng `profiles`, email đã có sẵn ngay trong
 * session. Dùng cho việc so khớp admin (ẩn tab "Postgres RLS Schema" trong
 * HouseholdManagement.tsx) — cùng pattern với `useCurrentUserId.ts`, cố ý
 * KHÔNG dùng TanStack Query vì đây là auth state do supabase-js tự quản lý,
 * không phải server data cần cache/invalidate.
 *
 * LƯU Ý ĐÃ THỐNG NHẤT (xem PRD.md "Chốt 22/08/2026"): đây chỉ là gate ở TẦNG
 * GIAO DIỆN, không phải chặn thật từ server — nội dung ẩn đi vẫn nằm trong JS
 * bundle gửi cho mọi trình duyệt.
 */
export function useCurrentUserEmail(): string | undefined {
  const [email, setEmail] = useState<string | undefined>(undefined);

  useEffect(() => {
    let isMounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (isMounted) setEmail(data.session?.user.email);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user.email);
    });

    return () => {
      isMounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  return email;
}
