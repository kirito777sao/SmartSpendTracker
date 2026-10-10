import { useState, useEffect } from "react";
import { Key, Eye, EyeOff, ShieldCheck, AlertCircle, CheckCircle2, Settings as SettingsIcon } from "lucide-react";
import { User, Household } from "../types";
import TelegramLinkCard from "./TelegramLinkCard";

interface SettingsProps {
  currentUser: User;
  onLogin: (user: User) => void;
  household: Household | null;
}

/**
 * [T-S137] Màn "Cài đặt" cấp điều hướng chính — gộp mọi cấu hình CÁ NHÂN
 * (không phụ thuộc hộ gia đình): API key AI riêng + liên kết Telegram. Trước
 * đây 2 khối này "ở nhờ" trong tab "Hộ Gia Đình" (HouseholdManagement.tsx +
 * AuthAndTelegram.tsx) dù không phải cấu hình của hộ, gây rối giao diện —
 * xem PRD.md/CHANGELOG.md "Chốt 22/08/2026" và ảnh chụp màn hình người dùng
 * gửi để biết bối cảnh quyết định tách.
 *
 * Khối API key: state/handler trích NGUYÊN VẸN từ `HouseholdManagement.tsx`
 * (không đổi logic/copy, chỉ đổi vị trí + tên biến `showXKey` gộp lại 1
 * object cho gọn vì không còn ràng buộc gì với phần household nữa).
 */
export default function Settings({ currentUser, onLogin, household }: SettingsProps) {
  const [activeProvider, setActiveProvider] = useState<"gemini" | "openai" | "groq" | "deepseek">("groq"); // [T-S09 patch 16/08/2026] mặc định Groq (free tier rộng hơn)
  const [geminiKey, setGeminiKey] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [groqKey, setGroqKey] = useState("");
  const [deepseekKey, setDeepseekKey] = useState("");

  const [showGeminiKey, setShowGeminiKey] = useState(false);
  const [showOpenaiKey, setShowOpenaiKey] = useState(false);
  const [showGroqKey, setShowGroqKey] = useState(false);
  const [showDeepseekKey, setShowDeepseekKey] = useState(false);

  const [isKeySaved, setIsKeySaved] = useState(false);

  // [T-S32 08/08/2026] Snapshot cấu hình AI ĐÃ LƯU thật vào localStorage —
  // tách khỏi state form phía trên (đổi ngay khi gõ, TRƯỚC khi bấm "Lưu Cấu
  // Hình AI"). Trạng thái kết nối hiển thị PHẢI đọc từ đây, không đọc thẳng
  // state form.
  const [savedConfig, setSavedConfig] = useState({
    provider: "groq" as "gemini" | "openai" | "groq" | "deepseek",
    geminiKey: "",
    openaiKey: "",
    groqKey: "",
    deepseekKey: "",
  });

  useEffect(() => {
    const savedGemini = localStorage.getItem("user_gemini_api_key") || "";
    const savedOpenai = localStorage.getItem("user_openai_api_key") || "";
    const savedGroq = localStorage.getItem("user_groq_api_key") || "";
    const savedDeepseek = localStorage.getItem("user_deepseek_api_key") || "";
    const savedProvider = (localStorage.getItem("user_active_ai_provider") as any) || "groq";

    setGeminiKey(savedGemini);
    setOpenaiKey(savedOpenai);
    setGroqKey(savedGroq);
    setDeepseekKey(savedDeepseek);
    setActiveProvider(savedProvider);
    setSavedConfig({
      provider: savedProvider,
      geminiKey: savedGemini,
      openaiKey: savedOpenai,
      groqKey: savedGroq,
      deepseekKey: savedDeepseek,
    });
  }, []);

  const handleSaveApiKeys = () => {
    const trimmedGemini = geminiKey.trim();
    const trimmedOpenai = openaiKey.trim();
    const trimmedGroq = groqKey.trim();
    const trimmedDeepseek = deepseekKey.trim();

    localStorage.setItem("user_gemini_api_key", trimmedGemini);
    localStorage.setItem("user_openai_api_key", trimmedOpenai);
    localStorage.setItem("user_groq_api_key", trimmedGroq);
    localStorage.setItem("user_deepseek_api_key", trimmedDeepseek);
    localStorage.setItem("user_active_ai_provider", activeProvider);

    setSavedConfig({
      provider: activeProvider,
      geminiKey: trimmedGemini,
      openaiKey: trimmedOpenai,
      groqKey: trimmedGroq,
      deepseekKey: trimmedDeepseek,
    });
    setIsKeySaved(true);
    setTimeout(() => setIsKeySaved(false), 2500);
  };

  const handleClearApiKeys = () => {
    localStorage.removeItem("user_gemini_api_key");
    localStorage.removeItem("user_openai_api_key");
    localStorage.removeItem("user_groq_api_key");
    localStorage.removeItem("user_deepseek_api_key");
    localStorage.removeItem("user_active_ai_provider");

    setGeminiKey("");
    setOpenaiKey("");
    setGroqKey("");
    setDeepseekKey("");
    setActiveProvider("groq");
    setIsKeySaved(false);
    setSavedConfig({
      provider: "groq",
      geminiKey: "",
      openaiKey: "",
      groqKey: "",
      deepseekKey: "",
    });
  };

  return (
    <div className="space-y-6" id="settings-tab">
      <div className="bg-(--sst-surface) rounded-2xl p-4.5 border border-(--sst-border) shadow-sm flex items-center gap-3">
        <div className="p-2.5 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-300 rounded-xl">
          <SettingsIcon className="w-5 h-5" />
        </div>
        <div>
          <h2 className="text-sm font-bold text-(--sst-text)">Cài Đặt Cá Nhân</h2>
          <p className="text-[11px] text-(--sst-text-secondary) mt-0.5">
            Cấu hình API AI riêng và liên kết Telegram — áp dụng cho tài khoản của bạn, không phụ thuộc chế độ Cá nhân/Hộ gia đình.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* AI Settings Section */}
        <div className="bg-(--sst-surface) rounded-2xl shadow-sm border border-(--sst-border) p-6 space-y-5 h-fit">
          <div className="flex items-center gap-2.5 pb-2.5 border-b border-(--sst-border)">
            <div className="p-2 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-300 rounded-xl">
              <Key className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-bold text-(--sst-text) uppercase tracking-wider">Cấu hình API AI Cá Nhân</h3>
              <p className="text-[10px] text-(--sst-text-muted) mt-0.5">Hỗ trợ Gemini, OpenAI, Groq, DeepSeek riêng tư</p>
            </div>
          </div>

          <p className="text-xs text-(--sst-text-secondary) leading-relaxed">
            Ứng dụng hỗ trợ sẵn khóa hệ thống dùng chung. Để tránh giới hạn lưu lượng hoặc tùy biến mô hình NLP yêu thích, bạn hãy chọn nhà cung cấp và cấu hình khóa riêng của mình.
          </p>

          {/* Active Provider Selector */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold text-(--sst-text-secondary) uppercase tracking-wider">
              Nhà cung cấp AI hoạt động:
            </label>
            <select
              value={activeProvider}
              onChange={(e) => setActiveProvider(e.target.value as any)}
              className="w-full text-xs bg-(--sst-surface-2) border border-(--sst-border-strong) focus:border-indigo-500 focus:bg-(--sst-surface) rounded-xl px-3 py-2.5 outline-none font-semibold text-(--sst-text) cursor-pointer transition-all"
            >
              <option value="gemini">Google Gemini (Mô hình gemini-3.5-flash)</option>
              <option value="openai">OpenAI (Mô hình gpt-4o-mini)</option>
              <option value="groq">Groq Cloud (Mặc định - Mô hình cực nhanh llama-3.3-70b)</option>
              <option value="deepseek">DeepSeek AI (Mô hình deepseek-chat)</option>
            </select>
            {(() => {
              const keyByProvider: Record<string, string> = {
                gemini: geminiKey,
                openai: openaiKey,
                groq: groqKey,
                deepseek: deepseekKey,
              };
              const labelByProvider: Record<string, string> = {
                gemini: "Google Gemini",
                openai: "OpenAI",
                groq: "Groq Cloud",
                deepseek: "DeepSeek AI",
              };
              const otherProviderWithKey = (Object.keys(keyByProvider) as Array<keyof typeof keyByProvider>).find(
                (p) => p !== activeProvider && keyByProvider[p].trim() !== ""
              );
              if (!otherProviderWithKey) return null;
              return (
                <div className="flex items-start gap-1.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/25 rounded-lg px-2.5 py-2">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>
                    Bạn đã nhập API Key cho <strong>{labelByProvider[otherProviderWithKey]}</strong> nhưng nhà cung cấp
                    AI đang hoạt động vẫn là <strong>{labelByProvider[activeProvider]}</strong> — hệ thống sẽ KHÔNG dùng
                    key {labelByProvider[otherProviderWithKey]} cho tới khi bạn chọn đúng nó ở dropdown trên rồi bấm Lưu lại.
                  </span>
                </div>
              );
            })()}
          </div>

          <div className="space-y-4 pt-1 border-t border-(--sst-border)">
            <label className="text-[11px] font-bold text-(--sst-text-secondary) uppercase tracking-wider block">
              Nhập API Keys cá nhân:
            </label>

            {/* Gemini Input */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-(--sst-text-secondary)">Gemini API Key</span>
                <span className="text-[9px] text-(--sst-text-muted) font-mono">Google AI Studio</span>
              </div>
              <div className="relative">
                <input
                  type={showGeminiKey ? "text" : "password"}
                  className="w-full text-xs font-mono bg-(--sst-surface-2) border border-(--sst-border-strong) focus:border-indigo-500 focus:bg-(--sst-surface) rounded-xl pl-3.5 pr-10 py-2 outline-none transition-all"
                  placeholder="Nhập GEMINI_API_KEY (AIzaSy...)"
                  value={geminiKey}
                  onChange={(e) => setGeminiKey(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowGeminiKey(!showGeminiKey)}
                  className="absolute right-3.5 top-2 text-(--sst-text-muted) hover:text-(--sst-text-secondary) cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded"
                  title={showGeminiKey ? "Ẩn Gemini API Key" : "Hiện Gemini API Key"}
                  aria-label={showGeminiKey ? "Ẩn Gemini API Key" : "Hiện Gemini API Key"}
                >
                  {showGeminiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            {/* OpenAI Input */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-(--sst-text-secondary)">OpenAI API Key</span>
                <span className="text-[9px] text-(--sst-text-muted) font-mono">OpenAI Platform</span>
              </div>
              <div className="relative">
                <input
                  type={showOpenaiKey ? "text" : "password"}
                  className="w-full text-xs font-mono bg-(--sst-surface-2) border border-(--sst-border-strong) focus:border-indigo-500 focus:bg-(--sst-surface) rounded-xl pl-3.5 pr-10 py-2 outline-none transition-all"
                  placeholder="Nhập OPENAI_API_KEY (sk-...)"
                  value={openaiKey}
                  onChange={(e) => setOpenaiKey(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowOpenaiKey(!showOpenaiKey)}
                  className="absolute right-3.5 top-2 text-(--sst-text-muted) hover:text-(--sst-text-secondary) cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded"
                  title={showOpenaiKey ? "Ẩn OpenAI API Key" : "Hiện OpenAI API Key"}
                  aria-label={showOpenaiKey ? "Ẩn OpenAI API Key" : "Hiện OpenAI API Key"}
                >
                  {showOpenaiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            {/* Groq Input */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-(--sst-text-secondary)">Groq API Key</span>
                <span className="text-[9px] text-(--sst-text-muted) font-mono">Groq Console</span>
              </div>
              <div className="relative">
                <input
                  type={showGroqKey ? "text" : "password"}
                  className="w-full text-xs font-mono bg-(--sst-surface-2) border border-(--sst-border-strong) focus:border-indigo-500 focus:bg-(--sst-surface) rounded-xl pl-3.5 pr-10 py-2 outline-none transition-all"
                  placeholder="Nhập GROQ_API_KEY (gsk_...)"
                  value={groqKey}
                  onChange={(e) => setGroqKey(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowGroqKey(!showGroqKey)}
                  className="absolute right-3.5 top-2 text-(--sst-text-muted) hover:text-(--sst-text-secondary) cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded"
                  title={showGroqKey ? "Ẩn Groq API Key" : "Hiện Groq API Key"}
                  aria-label={showGroqKey ? "Ẩn Groq API Key" : "Hiện Groq API Key"}
                >
                  {showGroqKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            {/* DeepSeek Input */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-(--sst-text-secondary)">DeepSeek API Key</span>
                <span className="text-[9px] text-(--sst-text-muted) font-mono">DeepSeek Platform</span>
              </div>
              <div className="relative">
                <input
                  type={showDeepseekKey ? "text" : "password"}
                  className="w-full text-xs font-mono bg-(--sst-surface-2) border border-(--sst-border-strong) focus:border-indigo-500 focus:bg-(--sst-surface) rounded-xl pl-3.5 pr-10 py-2 outline-none transition-all"
                  placeholder="Nhập DEEPSEEK_API_KEY (sk-...)"
                  value={deepseekKey}
                  onChange={(e) => setDeepseekKey(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowDeepseekKey(!showDeepseekKey)}
                  className="absolute right-3.5 top-2 text-(--sst-text-muted) hover:text-(--sst-text-secondary) cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded"
                  title={showDeepseekKey ? "Ẩn DeepSeek API Key" : "Hiện DeepSeek API Key"}
                  aria-label={showDeepseekKey ? "Ẩn DeepSeek API Key" : "Hiện DeepSeek API Key"}
                >
                  {showDeepseekKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            <div className="flex gap-2 justify-end text-xs font-bold pt-2">
              {(geminiKey || openaiKey || groqKey || deepseekKey) && (
                <button
                  type="button"
                  onClick={handleClearApiKeys}
                  className="px-3.5 py-2 text-rose-600 dark:text-rose-300 bg-rose-50 dark:bg-rose-500/10 hover:bg-rose-100 dark:hover:bg-rose-500/10 rounded-xl transition-all cursor-pointer font-semibold"
                >
                  Xóa tất cả
                </button>
              )}
              <button
                type="button"
                onClick={handleSaveApiKeys}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-xs transition-all cursor-pointer flex items-center gap-1 font-semibold"
              >
                {isKeySaved ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Đã lưu cấu hình!
                  </>
                ) : (
                  "Lưu Cấu Hình AI"
                )}
              </button>
            </div>
          </div>

          {/* Security Shield Callout */}
          <div className="bg-emerald-50/50 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/25 rounded-xl p-3.5 flex gap-3 text-[11px] text-emerald-800 dark:text-emerald-300 leading-relaxed">
            <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-300 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <p className="font-bold">🔒 Cam Kết Bảo Mật Tuyệt Đối</p>
              <p className="text-emerald-700/90 dark:text-emerald-300/90">
                Mã API Key của bạn được lưu <strong>duy nhất tại Local Storage</strong> trên trình duyệt của bạn. Key chỉ được truyền trực tiếp đến backend máy chủ ứng dụng thông qua kết nối mã hóa HTTPS tuyệt mật để gọi API của nhà cung cấp tương ứng, hoàn toàn không bao giờ bị lưu vào cơ sở dữ liệu, không bị ghi lại log, và không để lộ cho bên thứ ba.
              </p>
            </div>
          </div>

          {/* API Key Status Indicator — [T-S32] đọc từ savedConfig (đã ghi
              localStorage thật), KHÔNG đọc thẳng state form đang gõ. */}
          <div className="flex items-center justify-between pt-2.5 text-[10px] font-bold text-(--sst-text-secondary) uppercase tracking-wide">
            <span>Trạng thái kết nối AI:</span>
            <span className="flex items-center gap-1 text-indigo-600 dark:text-indigo-300">
              <span className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse" />
              {savedConfig.provider === "gemini" && (savedConfig.geminiKey ? "Dùng Key Gemini cá nhân 🛡️" : "Dùng Key Gemini hệ thống ⚙️")}
              {savedConfig.provider === "openai" && (savedConfig.openaiKey ? "Dùng Key OpenAI cá nhân 🛡️" : "Dùng Key OpenAI hệ thống ⚙️")}
              {savedConfig.provider === "groq" && (savedConfig.groqKey ? "Dùng Key Groq cá nhân 🛡️" : "Dùng Key Groq hệ thống ⚙️")}
              {savedConfig.provider === "deepseek" && (savedConfig.deepseekKey ? "Dùng Key DeepSeek cá nhân 🛡️" : "Dùng Key DeepSeek hệ thống ⚙️")}
            </span>
          </div>
          {(activeProvider !== savedConfig.provider ||
            geminiKey.trim() !== savedConfig.geminiKey ||
            openaiKey.trim() !== savedConfig.openaiKey ||
            groqKey.trim() !== savedConfig.groqKey ||
            deepseekKey.trim() !== savedConfig.deepseekKey) && (
            <div className="flex items-center gap-1.5 text-[10px] font-semibold text-amber-600 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/25 rounded-lg px-2.5 py-1.5">
              <AlertCircle className="w-3 h-3 shrink-0" />
              Có thay đổi CHƯA lưu — bấm "Lưu Cấu Hình AI" để áp dụng, nếu không hệ thống vẫn đang dùng cấu hình cũ ở trên.
            </div>
          )}
        </div>

        {/* Telegram Section: link card thật + khối giải thích phân biệt
            thành viên (trước đây 2 khối này tách rời nhau ở 2 file khác
            nhau — gộp lại đây vì cùng chủ đề, người cấu hình Telegram nên
            thấy luôn cách hệ thống phân biệt nhiều thành viên). */}
        <div className="space-y-6 h-fit">
          <TelegramLinkCard currentUser={currentUser} onLogin={onLogin} household={household} />

          <div className="bg-(--sst-surface) rounded-2xl shadow-sm border border-(--sst-border) p-6 space-y-3.5">
            <h3 className="text-xs font-bold text-(--sst-text) uppercase tracking-wider flex items-center gap-1.5">
              🤖 Phân Biệt Thành Viên Qua Telegram
            </h3>
            <p className="text-xs text-(--sst-text-secondary) leading-relaxed">
              Khi nhiều thành viên trong gia đình sử dụng chung một Bot Telegram hoặc nhiều Bot khác nhau để báo cáo chi tiêu, hệ thống bóc tách NLP thông minh sẽ tự động:
            </p>
            <ul className="text-xs text-(--sst-text-secondary) space-y-2 list-disc pl-4.5">
              <li>Nhận diện từ khóa danh xưng đặc trưng như <strong className="text-(--sst-text)">"vợ"</strong>, <strong className="text-(--sst-text)">"chồng"</strong>, <strong className="text-(--sst-text)">"con"</strong> để gán chính xác chủ thể.</li>
              <li>Hỗ trợ gán mã Chat ID riêng biệt cho từng thành viên để phân biệt tài khoản gửi tin nhắn mà không cần nhập tên.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
