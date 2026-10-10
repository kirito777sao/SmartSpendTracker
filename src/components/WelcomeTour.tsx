import { useEffect, useState } from "react";
import {
  Users,
  Sparkles,
  ShieldAlert,
  PiggyBank,
  BookOpen,
  Send,
  HelpCircle,
  X,
} from "lucide-react";
import { useWelcomeTour } from "../context/WelcomeTourContext";

/**
 * [T-S135, 23/08/2026] Tour chào mừng lần đầu — modal 7 bước, tự động hiện
 * ở lần đăng nhập đầu tiên trong trình duyệt này (App.tsx gọi `openTour()`
 * khi phát hiện `!hasSeenTour` sau khi đăng nhập). Có nút "Bỏ qua" ở mọi
 * bước — không ép xem hết. Style theo đúng mẫu modal đã có (ConfirmContext),
 * dùng token `--sst-*` (CONSTITUTION §1.26), không tự sáng tạo màu riêng.
 */
interface TourStep {
  icon: typeof Users;
  title: string;
  description: string;
}

const TOUR_STEPS: TourStep[] = [
  {
    icon: Users,
    title: "2 chế độ: Cá nhân & Hộ gia đình",
    description:
      "Chuyển đổi nhanh giữa sổ chi tiêu riêng của bạn và sổ chung của cả nhà bằng nút ở góc trên bên phải. Mỗi chế độ có danh mục, ngân sách và mục tiêu tiết kiệm hoàn toàn riêng biệt.",
  },
  {
    icon: Sparkles,
    title: "Nhập nhanh — gõ tự nhiên hoặc để AI lo",
    description:
      'Chỉ cần gõ "cà phê 20k, xăng xe 50 nghìn" — hệ thống tự nhận diện số tiền và danh mục, có AI hỗ trợ khi câu phức tạp hơn. Không cần điền form từng ô.',
  },
  {
    icon: ShieldAlert,
    title: "Ngân sách theo danh mục",
    description:
      "Đặt hạn mức cho từng danh mục chi tiêu (ăn uống, di chuyển, giải trí...) để theo dõi bạn đã tiêu bao nhiêu % ngân sách tháng này, tránh chi vượt tay.",
  },
  {
    icon: PiggyBank,
    title: "Mục tiêu tiết kiệm",
    description:
      "Tạo mục tiêu (mua laptop, đi du lịch...) và góp quỹ dần — hoặc liên kết thẳng với 1 danh mục ngân sách để tự động theo dõi. Khi đủ tiền, đánh dấu hoàn thành ngay trong ứng dụng.",
  },
  {
    icon: BookOpen,
    title: "Sổ giao dịch",
    description:
      "Xem lại, sửa, xoá mọi giao dịch đã ghi — lọc theo ngày, danh mục, loại thu/chi. Đây cũng là nơi xuất dữ liệu ra Excel khi cần.",
  },
  {
    icon: Send,
    title: "Liên kết Telegram",
    description:
      "Vào tab Cài Đặt để liên kết tài khoản Telegram — từ đó có thể nhắn tin trực tiếp cho bot để ghi giao dịch mà không cần mở ứng dụng.",
  },
  {
    icon: HelpCircle,
    title: "Cần xem lại hướng dẫn?",
    description:
      "Bạn có thể mở lại hướng dẫn này bất cứ lúc nào qua nút trợ giúp (❓) trên giao diện — không cần nhớ hết ngay từ lần đầu.",
  },
];

export default function WelcomeTour() {
  const { isOpen, closeTour } = useWelcomeTour();
  const [stepIndex, setStepIndex] = useState(0);

  // Reset về bước đầu mỗi lần mở lại (kể cả mở lại thủ công sau này từ T-S136).
  useEffect(() => {
    if (isOpen) setStepIndex(0);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") closeTour();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, closeTour]);

  if (!isOpen) return null;

  const step = TOUR_STEPS[stepIndex];
  const Icon = step.icon;
  const isLastStep = stepIndex === TOUR_STEPS.length - 1;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4"
      onClick={closeTour}
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-tour-title"
    >
      <div
        className="bg-(--sst-surface) rounded-2xl shadow-2xl border border-(--sst-border) w-full max-w-md p-6 relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={closeTour}
          className="absolute top-3 right-3 p-1.5 rounded-lg text-(--sst-text-muted) hover:text-(--sst-text) hover:bg-(--sst-surface-hover) transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          aria-label="Đóng hướng dẫn"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-1.5 mb-4">
          {TOUR_STEPS.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                i === stepIndex
                  ? "w-6 bg-indigo-600"
                  : i < stepIndex
                    ? "w-1.5 bg-indigo-300 dark:bg-indigo-500/40"
                    : "w-1.5 bg-(--sst-border-strong)"
              }`}
            />
          ))}
        </div>

        <div className="inline-flex p-3 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-300 border border-indigo-100/60 dark:border-indigo-500/25 rounded-2xl mb-4">
          <Icon className="w-6 h-6" />
        </div>

        <h3 id="welcome-tour-title" className="text-base font-black text-(--sst-text) tracking-tight mb-2">
          {step.title}
        </h3>
        <p className="text-sm text-(--sst-text-secondary) leading-relaxed mb-6">{step.description}</p>

        <div className="flex items-center justify-between gap-2">
          <button
            onClick={closeTour}
            className="px-3 py-2 text-xs font-bold rounded-xl text-(--sst-text-muted) hover:text-(--sst-text) hover:bg-(--sst-surface-hover) transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          >
            Bỏ qua
          </button>

          <div className="flex items-center gap-2">
            {stepIndex > 0 && (
              <button
                onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
                className="px-4 py-2 text-xs font-bold rounded-xl text-(--sst-text-secondary) border border-(--sst-border-strong) hover:bg-(--sst-surface-hover) transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
              >
                Quay lại
              </button>
            )}
            <button
              onClick={() => (isLastStep ? closeTour() : setStepIndex((i) => i + 1))}
              autoFocus
              className="px-4 py-2 text-xs font-bold rounded-xl text-white bg-indigo-600 hover:bg-indigo-700 transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            >
              {isLastStep ? "Bắt đầu dùng ngay" : "Tiếp theo"}
            </button>
          </div>
        </div>

        <div className="text-center mt-3 text-[10px] font-bold text-(--sst-text-faint)">
          Bước {stepIndex + 1}/{TOUR_STEPS.length}
        </div>
      </div>
    </div>
  );
}
