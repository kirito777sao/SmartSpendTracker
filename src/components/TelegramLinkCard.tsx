import { useState } from "react";
import { Send, Copy, Check, RefreshCw, Info, ArrowRight } from "lucide-react";
import { User, Household } from "../types";
import { supabase } from "../lib/supabaseClient";
import { useConfirm } from "../context/ConfirmContext";
import { useToast } from "../context/ToastContext";

// T-S10 (16/08/2026): 1 bot Telegram DÙNG CHUNG cho toàn hệ thống
// (CONSTITUTION §4, LOCKED) — không còn per-user bot token/webhook nữa.
const TELEGRAM_BOT_USERNAME =
  (import.meta.env.VITE_TELEGRAM_BOT_USERNAME as string | undefined) || "DH_Smart_Spendbot";
const TELEGRAM_BOT_URL = `https://t.me/${TELEGRAM_BOT_USERNAME.replace(/^@/, "")}`;

interface TelegramLinkCardProps {
  currentUser: User;
  onLogin: (user: User) => void;
  household: Household | null;
}

/**
 * [T-S137] Trích nguyên vẹn từ nhánh "đã đăng nhập" của `AuthAndTelegram.tsx`
 * (chỉ đổi vị trí, KHÔNG đổi logic/copy) — chuyển sang màn "Cài đặt" mới vì
 * đây là cấu hình CÁ NHÂN, không thuộc tab "Hộ Gia Đình". Tại thời điểm
 * chuyển, `AuthAndTelegram.tsx` chỉ còn đúng 1 nơi gọi (màn chào mừng lúc
 * chưa đăng nhập, `currentUser` luôn `null`) nên nhánh này bị xoá khỏi đó để
 * tránh code chết.
 */
export default function TelegramLinkCard({ currentUser, onLogin, household }: TelegramLinkCardProps) {
  const confirm = useConfirm();
  const { showToast } = useToast();
  const [copiedToken, setCopiedToken] = useState(false);
  const [isUnlinking, setIsUnlinking] = useState(false);

  const handleRefreshLinkToken = async () => {
    try {
      const { data, error } = await supabase.rpc("refresh_telegram_link_token");
      if (error) throw error;
      const updatedUser = { ...currentUser, linkToken: data as string };
      onLogin(updatedUser);
    } catch (err) {
      console.error("Failed to refresh link token:", err);
    }
  };

  const handleCopyToken = () => {
    navigator.clipboard.writeText(currentUser.linkToken);
    setCopiedToken(true);
    setTimeout(() => setCopiedToken(false), 2000);
  };

  const handleUnlinkTelegram = async () => {
    if (
      !(await confirm({
        title: "Huỷ liên kết Telegram",
        message: "Bạn có chắc chắn muốn hủy liên kết tài khoản này với Telegram không? Sau khi hủy, bot sẽ không nhận chép chi tiêu từ chat Telegram này nữa.",
        confirmLabel: "Huỷ liên kết",
        variant: "danger",
      }))
    ) {
      return;
    }

    setIsUnlinking(true);
    try {
      const { error } = await supabase.rpc("unlink_telegram_account");
      if (error) throw error;

      onLogin({ ...currentUser, telegramChatId: undefined, telegramUsername: undefined });
      showToast({ message: "Đã hủy liên kết Telegram thành công!" });
    } catch (err) {
      console.error("Failed to unlink Telegram:", err);
      showToast({ message: "Đã có lỗi xảy ra khi kết nối máy chủ.", variant: "error" });
    } finally {
      setIsUnlinking(false);
    }
  };

  return (
    <div id="auth-and-telegram-section" className="bg-(--sst-surface) p-5 rounded-2xl border border-(--sst-border) shadow-sm flex flex-col gap-5">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Send className="w-4.5 h-4.5 text-sky-500 shrink-0" />
            <h4 className="text-xs font-extrabold text-(--sst-text) uppercase tracking-wider">
              Tích hợp Telegram Chatbot
            </h4>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
              currentUser.telegramChatId 
                ? "bg-green-50 dark:bg-emerald-500/10 text-green-600 dark:text-emerald-300 border-green-100 dark:border-emerald-500/25" 
                : "bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-300 border-amber-100 dark:border-amber-500/25"
            }`}>
              {currentUser.telegramChatId 
                ? `Đã kết nối (${currentUser.telegramUsername ? "@" + currentUser.telegramUsername : "ID: " + currentUser.telegramChatId})` 
                : "Chưa liên kết"
              }
            </span>
            {currentUser.telegramChatId && (
              <button
                type="button"
                onClick={handleUnlinkTelegram}
                disabled={isUnlinking}
                className="text-[10px] font-bold px-2 py-2.5 rounded-full bg-rose-50 dark:bg-rose-500/10 hover:bg-rose-100 dark:hover:bg-rose-500/20 text-rose-600 dark:text-rose-300 border border-rose-100 dark:border-rose-500/25 transition-all cursor-pointer disabled:opacity-50"
                title="Hủy kích hoạt / ngắt liên kết Telegram"
              >
                {isUnlinking ? "Đang hủy..." : "Hủy liên kết"}
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-4.5">
          {/* Action panel to link */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Box A: Token & Bot Command */}
            <div className="bg-(--sst-surface-2) rounded-xl border border-(--sst-border) p-4 flex flex-col gap-3">
              <span className="text-[10px] font-bold text-(--sst-text-muted) uppercase tracking-wider">Mã liên kết tài khoản của bạn</span>
              <div className="flex items-center gap-2">
                <div className="bg-(--sst-surface) border border-(--sst-border) px-3.5 py-2 rounded-xl text-sm font-bold font-mono tracking-widest text-indigo-600 dark:text-indigo-400 flex-1 flex justify-between items-center shadow-xs">
                  <span>{currentUser.linkToken}</span>
                  <button 
                    onClick={handleCopyToken}
                    className="p-1 hover:bg-(--sst-surface-hover) rounded-md text-(--sst-text-muted) hover:text-(--sst-text-secondary) transition-all cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                    title="Sao chép"
                    aria-label="Sao chép mã liên kết"
                  >
                    {copiedToken ? <Check className="w-4 h-4 text-green-500 dark:text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
                <button 
                  onClick={handleRefreshLinkToken}
                  className="p-2.5 bg-(--sst-surface) border border-(--sst-border) hover:bg-(--sst-surface-hover) text-(--sst-text-secondary) hover:text-(--sst-text) rounded-xl shadow-xs transition-all cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                  title="Làm mới mã"
                  aria-label="Làm mới mã liên kết"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>
              <p className="text-[11px] text-(--sst-text-secondary) leading-relaxed">
                Nhắn tin cho Telegram Bot của bạn cú pháp dưới đây để thực hiện liên kết tự động:
                <code className="block bg-indigo-50/40 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border border-indigo-100/40 dark:border-indigo-500/25 px-2.5 py-1.5 rounded-lg font-mono text-xs mt-1.5 select-all font-semibold">
                  /link {currentUser.linkToken}
                </code>
              </p>
            </div>

            {/* Box B: Mở bot chung — không còn cấu hình bot token/webhook riêng */}
            <div className="bg-(--sst-surface-2) rounded-xl border border-(--sst-border) p-4 flex flex-col gap-3">
              <span className="text-[10px] font-bold text-(--sst-text-muted) uppercase tracking-wider">Bước 2: Mở Bot & gửi mã liên kết</span>
              <p className="text-[11px] text-(--sst-text-secondary) leading-relaxed">
                Bấm nút bên dưới để mở Telegram Bot, sau đó dán đúng cú pháp <code className="bg-(--sst-surface-2) px-1 py-0.5 rounded font-mono text-indigo-600 dark:text-indigo-400">/link {currentUser.linkToken}</code> vào khung chat.
              </p>
              <a
                href={TELEGRAM_BOT_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center justify-center gap-2 px-3.5 py-2.5 bg-sky-500 hover:bg-sky-600 text-white text-xs font-bold rounded-xl shadow-xs cursor-pointer transition-all hover:scale-[1.02] active:scale-[0.98]"
              >
                <Send className="w-3.5 h-3.5" />
                Mở Telegram Bot @{TELEGRAM_BOT_USERNAME}
                <ArrowRight className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>

          {/* Hướng dẫn ngắn gọn — bot dùng chung 1 hệ thống, không còn bước tạo/cấu hình bot riêng cho từng người */}
          <div className="bg-indigo-50/30 dark:bg-indigo-500/10 border border-indigo-100/50 dark:border-indigo-500/25 rounded-xl p-4 flex flex-col gap-3 text-xs leading-relaxed text-(--sst-text-secondary)">
            <h5 className="font-bold text-indigo-900 dark:text-indigo-200 flex items-center gap-1.5">
              <Info className="w-4 h-4 shrink-0 text-indigo-500 dark:text-indigo-400" />
              CÁCH LIÊN KẾT (chỉ 2 bước, không cần cấu hình gì thêm)
            </h5>
            <ol className="list-decimal pl-4.5 space-y-2 text-(--sst-text-secondary)">
              <li>
                Bấm nút <strong>"Mở Telegram Bot @{TELEGRAM_BOT_USERNAME}"</strong> ở trên (hoặc tự tìm bot này trên Telegram).
              </li>
              <li>
                Gửi cú pháp <code className="bg-(--sst-surface-2) px-1 py-0.5 rounded font-mono">/link {currentUser.linkToken}</code> vào khung chat. Bot sẽ trả lời xác nhận liên kết thành công ngay lập tức.
              </li>
            </ol>
            <div className="border-t border-indigo-100/50 dark:border-indigo-500/25 pt-2 mt-1">
              <span className="font-bold text-(--sst-text) block mb-1">💡 Cơ chế phân biệt nhiều thành viên (Đồng bộ chung hộ gia đình):</span>
              <p className="text-(--sst-text-secondary)">
                Nếu 2 thành viên trong gia đình bạn (ví dụ: Chồng và Vợ) đều đăng ký tài khoản trên web, tham gia vào cùng một hộ gia đình (chung mã mời <code className="bg-(--sst-surface-2) px-1 py-0.5 rounded font-mono">{household?.inviteCode || "..."}</code>) và đều liên kết Telegram với đúng bot @{TELEGRAM_BOT_USERNAME} này — khi bất kỳ ai nhắn tin chi tiêu, bot tự phân biệt qua ChatID riêng của từng người, gán đúng định danh người chi tiêu và cập nhật đồng thời lên bảng điều khiển chung!
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
