import { useState, useEffect, useRef } from "react";
import {
  Sparkles,
  Wallet,
  BookOpen,
  ShieldAlert,
  PiggyBank,
  Coins,
  TrendingUp,
  LayoutDashboard,
  Heart,
  Calendar,
  Layers,
  HelpCircle,
  Users,
  LogOut,
  User as UserIcon,
  Menu,
  ChevronDown,
  Info,
  Sun,
  Moon,
  Settings as SettingsIcon,
} from "lucide-react";
import { Household, HouseholdMember, User } from "./types";
import SmartInput from "./components/SmartInput";
import BudgetLimits from "./components/BudgetLimits";
import SavingGoals from "./components/SavingGoals";
import SmartAllocator, { ApplySnapshotEntry } from "./components/SmartAllocator";
import FinancialDashboard from "./components/FinancialDashboard";
import TransactionHistory from "./components/TransactionHistory";
import HouseholdManagement from "./components/HouseholdManagement";
import AuthAndTelegram from "./components/AuthAndTelegram";
import Settings from "./components/Settings";
import AIAssistantBubble from "./components/AIAssistantBubble";
import NotificationBell from "./components/NotificationBell";
import HelpCenter from "./components/HelpCenter";
import WelcomeTour from "./components/WelcomeTour";
import { supabase } from "./lib/supabaseClient";
import { getUserFromCurrentSession, buildUserFromProfile } from "./lib/authMapping";
import { useScope } from "./context/ScopeContext";
import { useWelcomeTour } from "./context/WelcomeTourContext";
import { useHousehold, useHouseholdMembers, formatMemberDisplayName } from "./hooks/useHousehold";
import { useCurrentUserId } from "./hooks/useCurrentUserId";
import { useRealtimeSync } from "./hooks/useRealtimeSync";

type AppTab = "dashboard" | "smart-input" | "transactions" | "budgets" | "goals" | "allocator" | "household" | "settings";

// [T-S123, 22/08/2026, CONSTITUTION §1.27] Danh sách hợp lệ để validate param
// `?tab=` đọc từ URL — không tin dữ liệu từ URL (có thể bị gõ tay/cũ).
const VALID_TABS: AppTab[] = ["dashboard", "smart-input", "transactions", "budgets", "goals", "allocator", "household", "settings"];

function readTabFromUrl(): AppTab {
  const param = new URLSearchParams(window.location.search).get("tab");
  return VALID_TABS.includes(param as AppTab) ? (param as AppTab) : "dashboard";
}

export default function App() {
  // [T-S123] Khởi tạo từ URL ngay lần đầu (không đợi useEffect) — tránh
  // nháy về "dashboard" rồi mới nhảy đúng tab khi F5 ở 1 tab khác.
  const [activeTab, setActiveTab] = useState<AppTab>(() => readTabFromUrl());
  // [T-S37, 09/08/2026] Nâng từ `useState` cục bộ trong `SmartAllocator.tsx`
  // lên đây — trước đây App.tsx render `SmartAllocator` kiểu conditional
  // (`{activeTab === "allocator" && (...)}`) nên đổi tab là unmount hẳn,
  // xoá sạch snapshot "Hoàn tác" dù vừa Áp Dụng. Đặt cùng cấp `activeTab`
  // để sống được qua mọi lần đổi tab, chỉ mất khi F5/đóng trình duyệt.
  const [smartAllocatorSnapshot, setSmartAllocatorSnapshot] = useState<ApplySnapshotEntry[] | null>(null);
  const [smartAllocatorIsUndoing, setSmartAllocatorIsUndoing] = useState(false);
  const [currentDateTime, setCurrentDateTime] = useState(new Date());

  // Dark mode — chỉ là tuỳ chọn giao diện (UI preference), không phải dữ liệu
  // nghiệp vụ, nên vẫn hợp lệ để trong localStorage kể cả sau khi migrate
  // Supabase (CONSTITUTION §1: localStorage hạ cấp thành cache đọc-thôi cho
  // dữ liệu nghiệp vụ, không cấm lưu preference UI thuần tuý).
  const [theme, setTheme] = useState<"light" | "dark">(
    () => (localStorage.getItem("smartspend_theme") as "light" | "dark") || "light"
  );

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("smartspend_theme", theme);
  }, [theme]);

  // [T-S123, 22/08/2026, CONSTITUTION §1.27] Đồng bộ activeTab → URL bằng
  // history API thuần (KHÔNG cài react-router-dom, xem CONSTITUTION §1.27).
  // updateActiveTab THAY THẾ mọi nơi gọi setActiveTab trực tiếp do người
  // dùng bấm (menu tab, nút điều hướng trong FinancialDashboard) — dùng
  // pushState để giữ lịch sử back/forward. Đọc URL lúc mount đã xử lý ở
  // useState initializer (readTabFromUrl) nên effect này CHỈ lo 2 việc còn
  // lại: (1) lắng nghe nút Back/Forward (popstate — không tự pushState lại,
  // trình duyệt đã tự điều hướng lịch sử); (2) đảm bảo URL ban đầu có đúng
  // ?tab= ngay cả khi truy cập không kèm param (dùng replaceState, không
  // pushState, để không tạo thêm 1 bước lịch sử thừa lúc tải trang).
  function updateActiveTab(tab: AppTab) {
    setActiveTab(tab);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    window.history.pushState(null, "", url);
  }

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("tab") !== activeTab) {
      url.searchParams.set("tab", activeTab);
      window.history.replaceState(null, "", url);
    }

    function handlePopState() {
      setActiveTab(readTabFromUrl());
    }
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // State
  const [scopeMode, setScopeMode] = useState<"personal" | "household">("personal");
  // T-S06e1 (fix): nút chuyển Cá nhân/Hộ gia đình trước đây chỉ đổi state
  // legacy `scopeMode` ở trên (vẫn cần cho phần UI/localStorage chưa migrate
  // hết), KHÔNG đổi `ScopeContext` thật mà mọi hook dữ liệu (useCategories/
  // useGoals/useTransactions/useHousehold...) dùng để dựng query key — nên
  // bấm nút trên UI không đổi scope thật, phải mở debug panel để đổi tay.
  // CONSTITUTION §1.2 ghi nhận gap này là "đã vá" nhưng App.tsx chưa từng gọi
  // useScope() — vá thật ở đây: mọi nơi đổi scopeMode phải đổi CẢ 2.
  const { setScopeMode: setRealScopeMode } = useScope();
  const setScopeModeSynced = (mode: "personal" | "household") => {
    setScopeMode(mode);
    setRealScopeMode(mode);
  };
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);

  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);

  // [T-S135, 23/08/2026] Tour chào mừng — tự động mở đúng 1 lần khi phát
  // hiện đăng nhập xong (currentUser có giá trị) mà chưa từng xem ở trình
  // duyệt này (hasSeenTour đọc từ localStorage, xem WelcomeTourContext).
  // `autoOpenChecked` (ref, không phải state) đảm bảo chỉ kiểm tra ĐÚNG 1
  // lần trong vòng đời component App — tránh tự mở lại mỗi khi currentUser
  // đổi tham chiếu (vd handleUpdateUser sau khi sửa hồ sơ), điều này KHÔNG
  // liên quan gì đến "đăng nhập lần đầu".
  const { openTour, hasSeenTour } = useWelcomeTour();
  const autoOpenCheckedRef = useRef(false);
  useEffect(() => {
    if (isAuthLoading || autoOpenCheckedRef.current) return;
    autoOpenCheckedRef.current = true;
    if (currentUser && !hasSeenTour) {
      openTour();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthLoading, currentUser]);

  // T-S06f-b3 (15/08/2026): household không còn là state cục bộ nạp qua
  // /api/household/get + polling — đọc thẳng Supabase thật qua React Query
  // (CONSTITUTION §1.23). Map 2 query (household row + members) sang đúng
  // shape `Household` cũ để không phải sửa AuthAndTelegram.tsx/logic isOwner
  // bên dưới (ngoài phạm vi task này) — đây là 1 lớp adapter đọc-thôi, không
  // phải nguồn sự thật thứ 2.
  const currentUserId = useCurrentUserId();
  const { data: householdRow } = useHousehold();
  const { data: memberRows = [] } = useHouseholdMembers(householdRow?.id);
  // [T-S08] Mở Realtime subscription (thay polling 4s đã xoá ở T-S06f-b3) —
  // gọi ĐÚNG 1 LẦN ở gốc App, không gọi lại ở component con nào khác.
  useRealtimeSync();
  const household: Household | null = householdRow
    ? {
        id: householdRow.id,
        name: householdRow.name,
        inviteCode: householdRow.invite_code,
        createdAt: householdRow.created_at,
        members: memberRows.map(
          (m): HouseholdMember => ({
            id: m.id,
            name: m.name,
            role: m.personal_role as HouseholdMember["role"],
            displayName: formatMemberDisplayName(m),
            joinedAt: m.created_at,
            telegramChatId: m.telegram_chat_id ?? undefined,
            isOwner: m.household_role === "owner",
          })
        ),
      }
    : null;

  // T-S04: khôi phục đăng nhập từ session Supabase sau khi refresh trang,
  // thay cho localStorage.getItem("smartspend_user") cũ. Chỉ đụng đúng phần
  // bootstrap phiên đăng nhập — phần load household/transactions/categories/
  // goals bên trong handleLogin giữ nguyên, thuộc phạm vi T-S05/T-S06.
  useEffect(() => {
    let isMounted = true;

    getUserFromCurrentSession().then((user) => {
      if (isMounted && user) {
        handleLogin(user);
      }
      if (isMounted) setIsAuthLoading(false);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === "SIGNED_OUT") {
        setCurrentUser(null);
        return;
      }
      if ((event === "SIGNED_IN" || event === "TOKEN_REFRESHED") && session?.user) {
        const user = await buildUserFromProfile(session.user.id);
        if (user) setCurrentUser(user);
      }
    });

    return () => {
      isMounted = false;
      authListener.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLogin = (user: User) => {
    setCurrentUser(user);
    localStorage.setItem("smartspend_user", JSON.stringify(user));
    // T-S06f-b3/b4: household không còn nạp ở đây — useHousehold() tự
    // refetch đúng hộ thật khi currentUserId đổi (query key
    // ["household", userId]). categories cũng không còn state cục bộ nào để
    // nạp (đã xoá hẳn ở T-S06f-b4 — 100% qua useCategories() từ T-S06f-b2).
  };

  const handleUpdateUser = (updatedUser: User | null) => {
    setCurrentUser(updatedUser);
    if (updatedUser) {
      localStorage.setItem("smartspend_user", JSON.stringify(updatedUser));
    } else {
      localStorage.removeItem("smartspend_user");
    }
  };

  const handleLogout = () => {
    supabase.auth.signOut();
    setCurrentUser(null);
    localStorage.removeItem("smartspend_user");
    // T-S06f-b3: household không còn state cục bộ để "revert về mặc định"
    // thủ công — sau signOut, currentUserId về undefined -> useHousehold()
    // tự vô hiệu (enabled:false) -> household về null tự nhiên.
  };

  const getEffectiveMembers = () => {
    if (scopeMode === "household" && household && household.members && household.members.length > 0) {
      return household.members;
    }
    if (currentUser) {
      return [{
        id: currentUser.id,
        name: currentUser.name,
        displayName: currentUser.displayName || `${currentUser.role} (${currentUser.name})`,
        role: currentUser.role as any,
        joinedAt: new Date().toISOString()
      }];
    }
    return [];
  };

  // Clock update effect
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentDateTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // T-S06f-b4: state categories cục bộ, hydrate effect, saveCategories, 4
  // handler category chết (handleUpdateCategory/handleToggleRecurring/
  // handleAddCategory/handleDeleteCategory) — ĐÃ XOÁ HẲN. Category giờ 100%
  // qua useCategories() (React Query, T-S06f-b2), không còn component nào
  // nhận qua props kể từ T-S06e2. Nút "Đặt lại dữ liệu mẫu"/handleResetDemoData
  // cũng xoá hẳn cùng đợt (hướng 2, đã xác nhận 16/08/2026): nút cũ chỉ thật
  // sự reset categories, trong khi modal xác nhận hứa xoá cả giao dịch/hộ
  // gia đình — sai lệch có sẵn từ trước; để nút tồn tại dưới dạng no-op sau
  // khi xoá categories sẽ khiến 1 nút vốn đã sai giờ 100% giả, dễ khiến
  // người dùng tưởng đã xoá dữ liệu thật trong khi không có gì xảy ra.

  const isOwner = (() => {
    if (scopeMode === "personal") return true;
    if (!household) return true; // Offline guest/No household has full access
    if (!currentUser) return true; // Guest defaults to true for smooth local testing
    
    const myMember = household.members.find((m) => m.id === currentUser.id);
    if (!myMember) return false;
    return myMember.isOwner === true;
  })();

  return (
    <div className="min-h-screen bg-(--sst-canvas) flex flex-col font-sans antialiased text-(--sst-text) transition-colors" id="main-app-shell">
      {/* [T-S135] Tour chào mừng lần đầu — tự gate theo isOpen bên trong,
          luôn render ở đây để có thể mở lại bất cứ lúc nào (kể cả từ T-S136
          sau này) mà không cần đổi vị trí. */}
      <WelcomeTour />

      {/* Header Bar */}
      <header className="bg-(--sst-surface) border-b border-(--sst-border) shadow-sm sticky top-0 z-20 transition-colors">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2.5 flex items-center justify-between gap-1.5">
          <div className="flex items-center gap-1.5 shrink-0">
            <div className="p-1.5 sm:p-2 bg-indigo-600 rounded-xl text-white shadow-md shadow-indigo-100 shrink-0">
              <TrendingUp className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <div className="flex flex-col justify-center">
              <h1 className="text-xs sm:text-base font-black text-(--sst-text) tracking-tight leading-none">
                Smart Spend
              </h1>
              <div className="flex items-center mt-1">
                <span className="text-[8px] sm:text-[9.5px] bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-300 border border-indigo-100/60 dark:border-indigo-500/25 font-black px-1.5 py-0.5 rounded-md leading-none transform scale-90 origin-left">
                  AI v1.5
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-3 ml-auto">
            {/* Mode Switcher */}
            <div className="bg-(--sst-surface-2) p-0.5 rounded-xl flex items-center border border-(--sst-border-strong) shadow-xs">
              <button
                onClick={() => setScopeModeSynced("personal")}
                className={`px-2 py-1 sm:px-2.5 sm:py-1.5 rounded-lg text-[10px] sm:text-[11px] font-black tracking-tight transition-all cursor-pointer select-none flex items-center gap-1 ${
                  scopeMode === "personal"
                    ? "bg-(--sst-surface) text-(--sst-text) shadow-2xs border border-(--sst-border-strong)"
                    : "text-(--sst-text-muted) hover:text-(--sst-text)"
                }`}
                title="Sổ chi tiêu cá nhân"
              >
                <span>👤</span>
                <span className="hidden sm:inline">Cá nhân</span>
              </button>
              <button
                onClick={() => setScopeModeSynced("household")}
                className={`px-2 py-1 sm:px-2.5 sm:py-1.5 rounded-lg text-[10px] sm:text-[11px] font-black tracking-tight transition-all cursor-pointer select-none flex items-center gap-1 ${
                  scopeMode === "household"
                    ? "bg-(--sst-surface) text-(--sst-text) shadow-2xs border border-(--sst-border-strong)"
                    : "text-(--sst-text-muted) hover:text-(--sst-text)"
                }`}
                title="Sổ chi tiêu hộ gia đình"
              >
                <span>🏡</span>
                <span className="hidden sm:inline">Hộ gia đình</span>
              </button>
            </div>

            {/* Dark mode toggle */}
            <button
              onClick={() => setTheme(theme === "light" ? "dark" : "light")}
              className="p-1.5 sm:p-2 rounded-xl text-(--sst-text-muted) hover:text-indigo-600 hover:bg-indigo-50/70 dark:hover:text-amber-300 dark:hover:bg-(--sst-surface-hover) border border-(--sst-border-strong) transition-all cursor-pointer shrink-0"
              title={theme === "light" ? "Chuyển sang chế độ tối" : "Chuyển sang chế độ sáng"}
            >
              {theme === "light" ? (
                <Moon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              ) : (
                <Sun className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              )}
            </button>

            {/* [T-S27, migration 0030] Chuông thông báo — thay thế placeholder
                đã ghi ở T-S06f-b3 (15/08/2026, xem CONSTITUTION §1.23), viết
                mới hoàn toàn, đọc activity_log thật. */}
            <NotificationBell />

            {/* [T-S136, 23/08/2026] Trung tâm trợ giúp thường trực — nút "?"
                luôn có sẵn trên mọi tab (khác T-S135 chỉ tự hiện lần đầu),
                đặt cạnh chuông thông báo theo đúng cụm icon-button header. */}
            <HelpCenter />

            {/* Real-time date and running clock display - hidden on smallest mobile for breathability */}
            <div className="hidden md:flex items-center gap-2 bg-indigo-50/55 dark:bg-indigo-500/10 border border-indigo-100/60 dark:border-indigo-500/25 rounded-full px-3 py-1.5 text-indigo-800 dark:text-indigo-300 font-semibold text-xs transition-all shadow-xs">
              <Calendar className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
              <span className="whitespace-nowrap capitalize text-[11px]">
                {currentDateTime.toLocaleDateString("vi-VN", {
                  weekday: "short",
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                })}
              </span>
              <span className="inline-block w-[1px] h-3 bg-indigo-200 dark:bg-indigo-500/30" />
              <span className="font-mono tabular-nums tracking-wide text-[11px] text-indigo-600 dark:text-indigo-300 bg-(--sst-surface-2) px-2 py-0.5 rounded-full border border-indigo-100 dark:border-indigo-500/25">
                {currentDateTime.toLocaleTimeString("vi-VN", {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </span>
            </div>

            {/* Trạng thái định danh ở trên thanh trên cùng */}
            {currentUser ? (
              <div className="relative">
                <button
                  onClick={() => setIsProfileOpen(!isProfileOpen)}
                  className="flex items-center gap-1 bg-indigo-55 dark:bg-indigo-500/10 hover:bg-indigo-100/70 dark:hover:bg-indigo-500/20 border border-indigo-100/40 dark:border-indigo-500/25 rounded-full p-1 text-xs shrink-0 cursor-pointer transition-all active:scale-[0.98]"
                  title="Tài khoản & Thiết lập"
                >
                  <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold text-[11px] uppercase shadow-xs shrink-0">
                    {currentUser.name ? currentUser.name.charAt(0) : "U"}
                  </div>
                  <ChevronDown className="w-3 h-3 text-(--sst-text-muted) mr-1 shrink-0" />
                </button>

                {isProfileOpen && (
                  <div className="absolute right-0 mt-2 w-64 bg-(--sst-surface) border border-(--sst-border-strong) rounded-2xl shadow-xl z-50 overflow-hidden transform origin-top-right transition-all">
                    <div className="p-3.5 border-b border-(--sst-border) bg-(--sst-surface-2)">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center font-black text-xs uppercase shadow-sm">
                          {currentUser.name ? currentUser.name.charAt(0) : "U"}
                        </div>
                        <div className="flex flex-col min-w-0">
                          <span className="font-extrabold text-(--sst-text) text-xs truncate">{currentUser.displayName || currentUser.name}</span>
                          <span className="text-[10px] text-(--sst-text-muted) truncate">{currentUser.email}</span>
                        </div>
                      </div>
                      <div className="mt-2 text-[9px] bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 font-extrabold px-2 py-1 rounded-lg inline-block">
                        {currentUser.householdInviteCode ? `Mã nhóm: ${currentUser.householdInviteCode}` : "Tài khoản cá nhân 👤"}
                      </div>
                    </div>
                    <div className="p-1.5 space-y-0.5">
                      {/* T-S06f-b4 (16/08/2026, hướng 2 đã chốt): nút "Đặt
                          lại dữ liệu mẫu" xoá hẳn khỏi đây — nút cũ chỉ thật
                          sự reset `categories` (state legacy giờ đã xoá),
                          trong khi modal xác nhận hứa xoá cả giao dịch/hộ
                          gia đình, sai lệch có sẵn từ trước khi có task này.
                          Nếu sau này muốn có tính năng reset dữ liệu mẫu
                          THẬT (xoá transactions/goals/household qua Supabase),
                          cần mở task mới riêng, thuộc "Hỏi trước khi làm" §5
                          vì đụng dữ liệu thật của người dùng. */}

                      <button
                        onClick={() => {
                          setIsProfileOpen(false);
                          handleLogout();
                        }}
                        className="w-full text-left px-3 py-2 text-[11px] font-bold text-rose-600 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-xl transition-all flex items-center gap-2 cursor-pointer"
                      >
                        <LogOut className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                        <span>Đăng xuất tài khoản</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-1 bg-(--sst-surface-2) border border-(--sst-border) rounded-full px-2 py-1 text-xs text-(--sst-text-muted) font-bold shrink-0">
                <UserIcon className="w-3 h-3" />
                <span className="text-[8px] sm:text-[9px] tracking-wider uppercase">Chưa định danh</span>
              </div>
            )}
          </div>
        </div>

        {/* Mobile Real-time Status Bar */}
        <div className="md:hidden bg-indigo-50/45 dark:bg-indigo-500/10 border-t border-(--sst-border) px-4 py-2 flex items-center justify-between text-[11px] font-bold text-indigo-700 dark:text-indigo-300">
          <div className="flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
            <span className="capitalize text-[11px] font-bold text-(--sst-text-secondary)">
              {currentDateTime.toLocaleDateString("vi-VN", {
                weekday: "long",
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
              })}
            </span>
          </div>
          <div className="flex items-center gap-1.5 bg-(--sst-surface-2) border border-indigo-100/70 dark:border-indigo-500/25 rounded-full px-2.5 py-1 text-[10px] text-indigo-600 dark:text-indigo-300 font-mono tracking-wide shadow-2xs">
            <span className="relative flex h-2 w-2 mr-0.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span>
              {currentDateTime.toLocaleTimeString("vi-VN", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </span>
          </div>
        </div>
      </header>

      {/* Main Body */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-6 flex flex-col gap-4 sm:gap-6">
        {!currentUser ? (
          <div className="max-w-md w-full mx-auto py-8 px-4">
            <div className="text-center mb-6">
              <div className="inline-block p-4 bg-indigo-55 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-300 rounded-3xl shadow-sm mb-3">
                <TrendingUp className="w-10 h-10 animate-pulse" />
              </div>
              <h2 className="text-xl font-black text-(--sst-text) tracking-tight">Chào mừng đến với Smart Spend AI</h2>
              <p className="text-xs text-(--sst-text-secondary) mt-2 leading-relaxed">
                Hãy đăng nhập hoặc đăng ký tài khoản để bắt đầu đồng bộ đám mây và kết nối Telegram Chatbot thông minh.
              </p>
            </div>
            <AuthAndTelegram
              currentUser={currentUser}
              onLogin={handleLogin}
              onLogout={handleLogout}
              household={household}
            />
          </div>
        ) : (
          <>
            {/* Navigation Tabs Container - Dual Mode */}
            <div className="space-y-3">
              {/* Desktop view: Beautiful grid/row tabs */}
              <div className="hidden md:flex bg-(--sst-surface) p-1 rounded-2xl border border-(--sst-border) shadow-xs gap-1.5 w-full">
                {[
                  { id: "dashboard", label: "Phân Tích", icon: LayoutDashboard },
                  { id: "smart-input", label: "Nhập Liệu AI", icon: Sparkles },
                  { id: "transactions", label: "Sổ Giao Dịch", icon: BookOpen },
                  { id: "budgets", label: "Ngân Sách", icon: ShieldAlert },
                  { id: "goals", label: "Tích Lũy", icon: PiggyBank },
                  { id: "allocator", label: "Smart Advisor", icon: Coins },
                  { id: "household", label: "Hộ Gia Đình", icon: Users },
                  { id: "settings", label: "Cài Đặt", icon: SettingsIcon },
                ].map((tab) => {
                  const Icon = tab.icon;
                  const isSelected = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => updateActiveTab(tab.id as AppTab)}
                      className={`flex-1 flex items-center justify-center gap-1.5 px-4 py-3 rounded-xl text-xs font-bold whitespace-nowrap transition-all cursor-pointer focus:outline-none select-none ${
                        isSelected
                          ? "bg-indigo-600 text-white shadow-xs shadow-indigo-100 dark:shadow-none"
                          : "text-(--sst-text-muted) hover:text-(--sst-text) hover:bg-(--sst-surface-2)"
                      }`}
                      id={`tab-desktop-${tab.id}`}
                    >
                      <Icon className={`w-4 h-4 shrink-0 ${isSelected ? "text-white" : "text-(--sst-text-muted)"}`} />
                      <span>{tab.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Mobile view: Beautiful expandable feature directory dropdown & quick access bar */}
              <div className="md:hidden space-y-2.5">
                {/* Active Tab Indicator & Dropdown Trigger */}
                <div 
                  onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                  className="flex items-center justify-between bg-(--sst-surface) border border-(--sst-border) rounded-2xl p-3 shadow-sm cursor-pointer active:bg-(--sst-surface-2) transition-all select-none"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-300 rounded-xl">
                      {(() => {
                        const activeTabObj = [
                          { id: "dashboard", icon: LayoutDashboard },
                          { id: "smart-input", icon: Sparkles },
                          { id: "transactions", icon: BookOpen },
                          { id: "budgets", icon: ShieldAlert },
                          { id: "goals", icon: PiggyBank },
                          { id: "allocator", icon: Coins },
                          { id: "household", icon: Users },
                          { id: "settings", icon: SettingsIcon },
                        ].find(t => t.id === activeTab);
                        const ActiveIcon = activeTabObj?.icon || LayoutDashboard;
                        return <ActiveIcon className="w-5 h-5" />;
                      })()}
                    </div>
                    <div>
                      <span className="text-[10px] text-(--sst-text-muted) uppercase tracking-wider font-extrabold leading-none block">Chức năng hiện tại</span>
                      <h3 className="text-xs sm:text-sm font-bold text-(--sst-text) mt-1 leading-none">
                        {
                          {
                            dashboard: "Phân Tích & Biểu Đồ",
                            "smart-input": "Nhập Liệu AI Thông Minh",
                            transactions: "Sổ Ghi Chép Giao Dịch",
                            budgets: "Hạn Mức Ngân Sách",
                            goals: "Mục Tiêu Tích Lũy",
                            allocator: "Smart Advisor (Cố Vấn 50/30/20)",
                            household: "Quản Lý Hộ Gia Đình & Nhóm",
                            settings: "Cài Đặt Cá Nhân"
                          }[activeTab]
                        }
                      </h3>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-300 bg-indigo-50/75 dark:bg-indigo-500/10 px-2 py-1 rounded-lg">
                      {isMobileMenuOpen ? "Đóng menu" : "Mở rộng ☰"}
                    </span>
                    <div className="w-7 h-7 rounded-full bg-(--sst-surface-2) flex items-center justify-center border border-(--sst-border) shrink-0">
                      <ChevronDown className={`w-3.5 h-3.5 text-(--sst-text-muted) transition-transform duration-300 ${isMobileMenuOpen ? "rotate-180" : ""}`} />
                    </div>
                  </div>
                </div>

                {/* Expanded Menu Grid - Highly polished like a mobile system menu */}
                {isMobileMenuOpen && (
                  <div className="bg-(--sst-surface) border border-(--sst-border) rounded-2xl p-3.5 shadow-md space-y-3">
                    <div className="flex items-center justify-between border-b border-(--sst-border) pb-2">
                      <span className="text-[10px] font-bold text-(--sst-text-muted) uppercase tracking-wider">Danh mục chức năng (8 công cụ)</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {[
                        { id: "dashboard", label: "Phân Tích", desc: "Biểu đồ chi tiêu & chỉ số tài chính tổng quan", icon: LayoutDashboard, color: "bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-300" },
                        { id: "smart-input", label: "Nhập Liệu AI", desc: "Thêm giao dịch siêu tốc bằng giọng nói & văn bản", icon: Sparkles, color: "bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-300" },
                        { id: "transactions", label: "Sổ Giao Dịch", desc: "Lịch sử giao dịch, bộ lọc thông minh & xuất Excel", icon: BookOpen, color: "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-300" },
                        { id: "budgets", label: "Ngân Sách", desc: "Thiết lập & cảnh báo hạn mức chi tiêu cho gia đình", icon: ShieldAlert, color: "bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-300" },
                        { id: "goals", label: "Tích Lũy", desc: "Lập và theo dõi các mục tiêu tiết kiệm dài hạn", icon: PiggyBank, color: "bg-purple-50 dark:bg-purple-500/10 text-purple-600 dark:text-purple-300" },
                        { id: "allocator", label: "Smart Advisor", desc: "Cố vấn phân bổ ngân sách tối ưu theo tỉ lệ vàng", icon: Coins, color: "bg-cyan-50 dark:bg-cyan-500/10 text-cyan-600 dark:text-cyan-300" },
                        { id: "household", label: "Hộ Gia Đình", desc: "Đồng bộ hóa nhóm thành viên & chuyển quyền chủ hộ", icon: Users, color: "bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-300" },
                        { id: "settings", label: "Cài Đặt", desc: "API key AI riêng & liên kết Telegram cá nhân", icon: SettingsIcon, color: "bg-slate-100 dark:bg-slate-500/10 text-slate-600 dark:text-slate-300" },
                      ].map((tab) => {
                        const Icon = tab.icon;
                        const isSelected = activeTab === tab.id;
                        return (
                          <button
                            key={tab.id}
                            onClick={() => {
                              updateActiveTab(tab.id as AppTab);
                              setIsMobileMenuOpen(false);
                            }}
                            className={`flex items-start gap-3 p-2.5 rounded-xl border transition-all text-left cursor-pointer active:scale-98 ${
                              isSelected
                                ? "bg-indigo-50/55 dark:bg-indigo-500/10 border-indigo-200 dark:border-indigo-500/25 ring-1 ring-indigo-200 dark:ring-indigo-500/25"
                                : "bg-slate-50/50 dark:bg-(--sst-surface-2) border-slate-100 dark:border-(--sst-border) hover:border-slate-200 dark:hover:border-(--sst-border-strong)"
                            }`}
                          >
                            <div className={`p-2 rounded-lg shrink-0 ${tab.color} ${isSelected ? "font-bold scale-105" : ""}`}>
                              <Icon className="w-4 h-4" />
                            </div>
                            <div className="space-y-0.5 min-w-0">
                              <div className="text-xs font-bold text-(--sst-text) flex items-center gap-1.5 truncate">
                                {tab.label}
                                {isSelected && <span className="inline-block w-1.5 h-1.5 rounded-full bg-indigo-600 shrink-0" />}
                              </div>
                              <p className="text-[10px] text-(--sst-text-muted) font-medium leading-tight truncate">{tab.desc}</p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

              </div>
            </div>

            {/* Warning if switching to household mode but not in a household */}
            {scopeMode === "household" && !household && (
              <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200/60 dark:border-amber-500/25 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-2xs">
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 rounded-xl mt-0.5 sm:mt-0 shrink-0">
                    <Info className="w-5 h-5 text-amber-700 dark:text-amber-300" />
                  </div>
                  <div>
                    <h4 className="text-xs sm:text-sm font-black text-amber-900 dark:text-amber-200">Bạn chưa tham gia hay khởi tạo Hộ gia đình nào</h4>
                    <p className="text-[11px] text-amber-700 dark:text-amber-300/90 mt-1 leading-relaxed">
                      Sổ chi tiêu Hộ gia đình đang trống do bạn chưa kết nối thành viên. Hãy tạo một Hộ gia đình mới hoặc nhập Mã mời từ người thân của bạn để đồng bộ chi tiêu thời gian thực!
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => updateActiveTab("household")}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-xs shrink-0"
                >
                  Thiết lập Hộ gia đình 🏡
                </button>
              </div>
            )}

            {/* Dynamic Tab Panel */}
            <div className="flex-1" id="active-tab-panel">
              {activeTab === "dashboard" && (
                // T-S06d: FinancialDashboard tự đọc dữ liệu qua hook (không
                // còn nhận transactions/categories/goals qua props).
                <FinancialDashboard setActiveTab={updateActiveTab} />
              )}

              {activeTab === "smart-input" && (
                // T-S06e1: SmartInput tự gọi mutation hook thật, không còn
                // nhận onAddTransactions/members qua props.
                <SmartInput />
              )}

              {activeTab === "transactions" && (
                // T-S06d/e1: TransactionHistory tự đọc + tự ghi (add/edit/delete)
                // qua hook thật, không còn nhận handler/members qua props.
                <TransactionHistory isOwner={isOwner} />
              )}

              {activeTab === "budgets" && (
                // T-S06e2: BudgetLimits tự đọc VÀ tự ghi (create/update/soft-
                // delete category) qua hook thật — không còn nhận
                // onUpdateCategory/onToggleRecurring/onAddCategory/
                // onDeleteCategory qua props. handleUpdateCategory/
                // handleToggleRecurring/handleAddCategory/handleDeleteCategory
                // ở trên giờ không còn nơi gọi (dead code) — xoá hẳn thuộc
                // phạm vi T-S06f, không mở rộng ở đây.
                <BudgetLimits isOwner={isOwner} />
              )}

              {activeTab === "goals" && (
                // T-S06e3: SavingGoals tự đọc VÀ tự ghi (create/update/soft-
                // delete goal, đóng góp quỹ qua transaction có goal_id) —
                // không còn nhận onAddGoal/onUpdateGoalAmount/onDeleteGoal/
                // onEditGoal qua props. handleAddGoal/handleUpdateGoalAmount/
                // handleDeleteGoal/handleEditGoal ở trên giờ không còn nơi
                // gọi (dead code) — xoá hẳn thuộc phạm vi T-S06f.
                <SavingGoals />
              )}

              {activeTab === "allocator" && (
                <SmartAllocator
                  isOwner={isOwner}
                  lastApplySnapshot={smartAllocatorSnapshot}
                  setLastApplySnapshot={setSmartAllocatorSnapshot}
                  isUndoing={smartAllocatorIsUndoing}
                  setIsUndoing={setSmartAllocatorIsUndoing}
                />
              )}

              {activeTab === "household" && (
                <div className="flex flex-col gap-6">
                  {/* T-S06e4: HouseholdManagement tự đọc/ghi qua hook Supabase thật, không
                      còn nhận household/currentUser/onUpdateHousehold/onLoadFullData/onUpdateUser
                      qua props — tự chuyển scopeMode sang "household" nội bộ sau khi tạo/tham
                      gia thành công (xem CHANGELOG "AUDIT — T-S06e4"). */}
                  <HouseholdManagement />
                </div>
              )}

              {/* [T-S137] Cài đặt cá nhân (API key AI + liên kết Telegram) —
                  trước đây "ở nhờ" trong tab Hộ Gia Đình dù không phải cấu
                  hình của hộ, gây rối giao diện (người dùng phát hiện qua
                  ảnh chụp màn hình thật). Tách thành tab riêng, không phụ
                  thuộc scopeMode Cá nhân/Hộ gia đình. */}
              {activeTab === "settings" && (
                <Settings currentUser={currentUser} onLogin={handleLogin} household={household} />
              )}
            </div>

            {/* Global AI Floating Assistant Chatbot Bubble */}
            {/* T-S06e1: AIAssistantBubble tự gọi mutation hook thật, không còn
                nhận onAddTransactions/members qua props. */}
            <AIAssistantBubble />
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="bg-(--sst-surface) border-t border-(--sst-border) py-6 mt-12 shrink-0">
        <div className="max-w-7xl mx-auto px-4 text-center space-y-2">
          <p className="text-xs text-(--sst-text-muted) font-medium">
            Smart Spend Tracker • D.Hale
          </p>
          <div className="flex items-center justify-center gap-1.5 text-[10px] text-(--sst-text-muted)">
            <span>Thiết kế tinh xảo cho quản lý tài chính gia đình Việt</span>
            <Heart className="w-3 h-3 text-rose-400 fill-rose-400" />
            <span>2026</span>
          </div>
        </div>
      </footer>
    </div>
  );
}