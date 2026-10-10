import { useEffect, useRef, useState } from "react";
import { HelpCircle, X, ChevronDown, Wallet, ArrowLeftRight, PiggyBank, Sparkles, BookOpen } from "lucide-react";
import { useWelcomeTour } from "../context/WelcomeTourContext";

/**
 * [T-S136, 23/08/2026] Trung tâm trợ giúp thường trực — nút "?" luôn có sẵn
 * trên header (không chỉ hiện lần đầu như T-S135, xem CHANGELOG bàn giao
 * T-S135). Mở panel giải thích 4 khái niệm cơ bản cho người mới dùng quản
 * lý tài chính cá nhân, có nút gọi lại tour chào mừng T-S135.
 *
 * State (isOpen, expandedTopic) là cục bộ trong chính component này —
 * KHÔNG cần Context riêng như WelcomeTour, vì chỉ 1 nơi duy nhất (nút "?"
 * trong header) vừa sở hữu nút bấm vừa sở hữu panel, không có component nào
 * khác cần mở hộ nó (khác lý do WelcomeTourContext cần tồn tại — xem
 * comment ở WelcomeTourContext.tsx). Theo đúng pattern `NotificationBell`
 * (nút + panel tự quản lý state, click-outside-to-close) để nhất quán UX
 * trong cùng 1 header, style dùng token `--sst-*` (CONSTITUTION §1.26).
 */
interface HelpTopic {
  icon: typeof Wallet;
  title: string;
  body: string[];
}

const HELP_TOPICS: HelpTopic[] = [
  {
    icon: Wallet,
    title: "Hạn mức ngân sách là gì?",
    body: [
      "Hạn mức ngân sách là số tiền tối đa bạn tự đặt cho 1 danh mục chi tiêu trong tháng (ví dụ: Ăn uống — 3.000.000đ/tháng).",
      "App tự cộng dồn mọi giao dịch Chi thuộc danh mục đó theo tháng hiện tại và hiện thanh tiến độ % đã dùng so với hạn mức, giúp bạn biết còn được chi bao nhiêu trước khi vượt tay.",
      "Đặt hạn mức ở tab Ngân Sách — chọn danh mục rồi nhập số tiền, có thể sửa lại bất cứ lúc nào.",
    ],
  },
  {
    icon: ArrowLeftRight,
    title: "Phân biệt Thu / Chi / Chuyển khoản",
    body: [
      "Thu (income): tiền vào — lương, thưởng, thu nhập phụ...",
      "Chi (expense): tiền ra tiêu thật sự — ăn uống, mua sắm, hoá đơn... Đây là con số dùng để tính hạn mức ngân sách và các báo cáo chi tiêu.",
      "Chuyển khoản (transfer): tiền di chuyển nội bộ, KHÔNG phải tiêu thật — dùng chủ yếu khi bạn góp quỹ tay vào 1 mục tiêu tiết kiệm thủ công. Loại này tách riêng, không tính vào Thu/Chi để báo cáo không bị méo.",
    ],
  },
  {
    icon: PiggyBank,
    title: "Mục tiêu tiết kiệm hoạt động thế nào?",
    body: [
      "Có 2 cách theo dõi 1 mục tiêu, chỉ chọn đúng 1 loại khi tạo:",
      "① Thủ công — tạo mục tiêu (vd \"Mua laptop\"), sau đó tự góp quỹ dần bằng giao dịch loại Chuyển khoản; mỗi lần góp cộng thẳng vào tiến độ đã gom.",
      "② Liên kết danh mục — gắn mục tiêu với 1 danh mục ngân sách có sẵn cùng khoảng ngày tự chọn; tiến độ TỰ TÍNH bằng tổng các khoản Chi thật trong danh mục đó suốt khoảng ngày, không cần góp quỹ tay.",
      "Khi đã gom đủ, bạn có thể \"Rút quỹ\" nhiều lần khi thật sự dùng tiền — mục tiêu vẫn sống tiếp cho tới khi bạn chủ động đóng.",
    ],
  },
  {
    icon: Sparkles,
    title: "Cách dùng Nhập nhanh AI hiệu quả",
    body: [
      "Gõ câu tự nhiên ở tab Nhập Nhanh, ví dụ: \"cà phê 20k, xăng xe 50 nghìn\" — hệ thống tự tách từng khoản, nhận số tiền và đoán danh mục.",
      "Câu phức tạp hơn hoặc app chưa đoán đúng danh mục sẽ tự chuyển sang AI hỗ trợ phân loại chính xác hơn.",
      "Luôn xem lại và chỉnh sửa danh mục/số tiền được đoán trước khi lưu — app không tự lưu khi bạn chưa xác nhận.",
      "Cách dùng tương tự cũng áp dụng được qua Telegram sau khi liên kết tài khoản ở tab Cài Đặt, không cần mở app.",
    ],
  },
];

export default function HelpCenter() {
  const [isOpen, setIsOpen] = useState(false);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const { openTour } = useWelcomeTour();

  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setIsOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  function handleReplayTour() {
    setIsOpen(false);
    // useWelcomeTour().openTour() không phụ thuộc hasSeenTour — chạy lại từ
    // đầu dù trước đó người dùng đã xem hết hoặc đã bấm Bỏ qua (đúng AC gốc
    // T-S136, đã thiết kế sẵn từ T-S135 — xem CHANGELOG bàn giao).
    openTour();
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setIsOpen((v) => !v)}
        className="relative p-1.5 sm:p-2 rounded-xl text-(--sst-text-muted) hover:text-indigo-600 hover:bg-indigo-50/70 dark:hover:text-amber-300 dark:hover:bg-(--sst-surface-hover) border border-(--sst-border-strong) transition-all cursor-pointer shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
        title="Trợ giúp"
        aria-label="Trợ giúp"
        aria-expanded={isOpen}
      >
        <HelpCircle className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
      </button>

      {isOpen && (
        <div
          className="absolute right-0 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] bg-(--sst-surface) border border-(--sst-border-strong) rounded-2xl shadow-xl z-50 overflow-hidden transform origin-top-right transition-all"
          role="dialog"
          aria-modal="true"
          aria-label="Trung tâm trợ giúp"
        >
          <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-(--sst-border) bg-(--sst-surface-2)">
            <span className="font-extrabold text-(--sst-text) text-xs">Trung tâm trợ giúp</span>
            <button
              onClick={() => setIsOpen(false)}
              className="p-1 rounded-lg text-(--sst-text-muted) hover:text-(--sst-text) hover:bg-(--sst-surface-hover) transition-colors cursor-pointer"
              aria-label="Đóng trợ giúp"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="max-h-[26rem] overflow-y-auto">
            {HELP_TOPICS.map((topic, i) => {
              const Icon = topic.icon;
              const isExpanded = expandedIndex === i;
              return (
                <div key={topic.title} className="border-b border-(--sst-border) last:border-b-0">
                  <button
                    onClick={() => setExpandedIndex(isExpanded ? null : i)}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left cursor-pointer hover:bg-(--sst-surface-hover) transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-inset"
                    aria-expanded={isExpanded}
                  >
                    <span className="inline-flex p-1.5 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-300 border border-indigo-100/60 dark:border-indigo-500/25 rounded-lg shrink-0">
                      <Icon className="w-3.5 h-3.5" />
                    </span>
                    <span className="flex-1 text-xs font-bold text-(--sst-text)">{topic.title}</span>
                    <ChevronDown
                      className={`w-3.5 h-3.5 text-(--sst-text-muted) shrink-0 transition-transform ${
                        isExpanded ? "rotate-180" : ""
                      }`}
                    />
                  </button>
                  {isExpanded && (
                    <div className="px-3.5 pb-3 pl-[2.9rem] space-y-1.5">
                      {topic.body.map((paragraph, j) => (
                        <p key={j} className="text-[11px] leading-relaxed text-(--sst-text-secondary)">
                          {paragraph}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="p-2.5 border-t border-(--sst-border) bg-(--sst-surface-2)">
            <button
              onClick={handleReplayTour}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-[11px] font-bold rounded-xl text-indigo-600 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-100/60 dark:border-indigo-500/25 hover:bg-indigo-100/70 dark:hover:bg-indigo-500/20 transition-colors cursor-pointer"
            >
              <BookOpen className="w-3.5 h-3.5" />
              Xem lại hướng dẫn ban đầu
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
