import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

/**
 * [T-S135, 23/08/2026] Context tour chào mừng toàn cục — theo đúng pattern
 * `ScopeContext`/`ConfirmContext` đã có (CONSTITUTION §1.1 "gọi hook tại nơi
 * dùng, không prop-drill"). Đặt ở Context (không phải state cục bộ trong
 * App.tsx) vì T-S136 (trung tâm trợ giúp, CHƯA code) cần gọi lại
 * `openTour()` từ 1 component hoàn toàn khác App.tsx mà không phải truyền
 * props qua nhiều tầng.
 *
 * Trạng thái "đã xem" lưu `localStorage` (đúng quyết định CHỐT 22/08/2026 ở
 * TASKS.md T-S135 — trạng thái UI thuần, không phải dữ liệu tài chính, chấp
 * nhận không đồng bộ giữa thiết bị/trình duyệt khác nhau).
 */
const WELCOME_TOUR_SEEN_KEY = "smartspend_welcome_tour_seen";

interface WelcomeTourContextValue {
  isOpen: boolean;
  /** true nếu đã từng xem hết hoặc bấm "Bỏ qua" ở trình duyệt này. */
  hasSeenTour: boolean;
  /** Mở tour bất kể đã xem hay chưa — dùng cho nút mở lại thủ công (T-S136). */
  openTour: () => void;
  /** Đóng tour + đánh dấu "đã xem" (đi hết bước hoặc bấm Bỏ qua đều gọi hàm này). */
  closeTour: () => void;
}

const WelcomeTourContext = createContext<WelcomeTourContextValue | null>(null);

export function WelcomeTourProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [hasSeenTour, setHasSeenTour] = useState(
    () => localStorage.getItem(WELCOME_TOUR_SEEN_KEY) === "1"
  );

  const openTour = useCallback(() => {
    setIsOpen(true);
  }, []);

  const closeTour = useCallback(() => {
    setIsOpen(false);
    localStorage.setItem(WELCOME_TOUR_SEEN_KEY, "1");
    setHasSeenTour(true);
  }, []);

  return (
    <WelcomeTourContext.Provider value={{ isOpen, hasSeenTour, openTour, closeTour }}>
      {children}
    </WelcomeTourContext.Provider>
  );
}

export function useWelcomeTour(): WelcomeTourContextValue {
  const ctx = useContext(WelcomeTourContext);
  if (!ctx) {
    throw new Error("useWelcomeTour() phải được gọi bên trong <WelcomeTourProvider>");
  }
  return ctx;
}
