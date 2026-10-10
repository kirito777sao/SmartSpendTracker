import React, { useState, useEffect } from "react";
import { 
  User as UserIcon, 
  Lock, 
  Mail, 
  UserCheck, 
  AlertCircle,
  Eye,
  EyeOff
} from "lucide-react";
import { User, Household } from "../types";
import { supabase } from "../lib/supabaseClient";
import { buildUserFromProfile } from "../lib/authMapping";
import { useConfirm } from "../context/ConfirmContext";
import { useToast } from "../context/ToastContext";

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" />
      <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" />
      <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" />
      <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z" />
    </svg>
  );
}

function mapAuthError(message: string): string {
  if (message.includes("Invalid login credentials")) return "Email hoặc mật khẩu không đúng.";
  if (message.includes("User already registered")) return "Email này đã được đăng ký.";
  if (message.includes("Password should be at least")) return "Mật khẩu quá ngắn theo yêu cầu của hệ thống.";
  return message;
}

interface AuthAndTelegramProps {
  currentUser: User | null;
  onLogin: (user: User) => void;
  onLogout: () => void;
  household: Household | null;
}

export default function AuthAndTelegram({
  currentUser,
  onLogin,
  onLogout,
  household
}: AuthAndTelegramProps) {
  const confirm = useConfirm();
  const { showToast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("Chồng");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const pwdStatus = {
    hasUpper: /[A-Z]/.test(password),
    hasLower: /[a-z]/.test(password),
    hasNumber: /[0-9]/.test(password),
    hasSpecial: /[^A-Za-z0-9]/.test(password),
    isLengthOk: password.length >= 6,
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    // 1. Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setError("Email không đúng định dạng. Vui lòng nhập đúng email (Ví dụ: ten@domain.com).");
      return;
    }

    // 2. Password strength validation for registration
    if (isRegister) {
      if (!pwdStatus.isLengthOk) {
        setError("Mật khẩu quá ngắn. Phải dài ít nhất 6 ký tự.");
        return;
      }
      if (!pwdStatus.hasUpper || !pwdStatus.hasLower || !pwdStatus.hasNumber || !pwdStatus.hasSpecial) {
        setError("Mật khẩu yếu! Phải bao gồm cả chữ hoa, chữ thường, chữ số và ký tự đặc biệt.");
        return;
      }
    }

    setLoading(true);

    try {
      if (isRegister) {
        const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { name } },
        });
        if (signUpError) throw new Error(mapAuthError(signUpError.message));

        if (!signUpData.session) {
          // Dự án Supabase đang bật "Confirm email" — không có session ngay.
          setSuccess("Đăng ký thành công! Kiểm tra email để xác nhận tài khoản trước khi đăng nhập.");
          setLoading(false);
          return;
        }

        const userId = signUpData.session.user.id;
        // Trigger on_auth_user_created đã tự tạo profiles.name; cập nhật thêm personal_role.
        await supabase.from("profiles").update({ personal_role: role }).eq("id", userId);

        if (inviteCode) {
          const { error: joinError } = await supabase.rpc("join_household_by_code", {
            p_invite_code: inviteCode,
          });
          if (joinError) {
            setError(`Tạo tài khoản thành công nhưng tham gia hộ gia đình thất bại: ${joinError.message}`);
          }
        }

        const user = await buildUserFromProfile(userId);
        if (!user) throw new Error("Tạo tài khoản thành công nhưng không đọc được hồ sơ. Thử đăng nhập lại.");
        onLogin(user);
        setSuccess("Đăng ký tài khoản thành công!");
      } else {
        const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (signInError) throw new Error(mapAuthError(signInError.message));

        const user = await buildUserFromProfile(signInData.user.id);
        if (!user) throw new Error("Đăng nhập thành công nhưng không đọc được hồ sơ.");
        onLogin(user);
        setSuccess("Đăng nhập thành công!");
      }

      setTimeout(() => {
        setIsOpen(false);
        setError(null);
        setSuccess(null);
      }, 1500);
    } catch (err: any) {
      setError(err.message || "Không thể kết nối máy chủ");
    } finally {
      setLoading(false);
    }
  };

  // T-S04b: đăng nhập Google OAuth. Supabase JS tự xử lý redirect + trao đổi
  // token qua URL callback — không tự parse token ở đây. Sau khi quay lại app,
  // supabase.auth.onAuthStateChange (đăng ký sẵn trong App.tsx, T-S04) tự bắn
  // sự kiện SIGNED_IN và build User qua buildUserFromProfile, dùng chung
  // trigger tạo `profiles` với luồng email/password — không tạo đường riêng.
  const handleGoogleLogin = async () => {
    setError(null);
    setSuccess(null);
    setGoogleLoading(true);
    try {
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: window.location.origin },
      });
      if (oauthError) {
        throw new Error(mapAuthError(oauthError.message));
      }
      // Thành công: trình duyệt redirect sang Google ngay, không cần setGoogleLoading(false) ở đây.
    } catch (err: any) {
      setError(err.message || "Không thể khởi tạo đăng nhập Google. Thử lại sau.");
      setGoogleLoading(false);
    }
  };

  if (!currentUser) {
    return (
      <div className="bg-(--sst-surface) rounded-3xl border border-(--sst-border) shadow-xl max-w-md w-full mx-auto p-8 space-y-6 animate-scale-up" id="auth-card-direct">
        <div className="text-center space-y-2">
          <div className="inline-flex p-3.5 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-300 rounded-2xl mb-1">
            <UserIcon className="w-6 h-6 animate-pulse" />
          </div>
          <h3 className="text-xl font-black text-(--sst-text) tracking-tight">
            {isRegister ? "Đăng ký thành viên mới" : "Đăng nhập tài khoản"}
          </h3>
          <p className="text-xs text-(--sst-text-muted) max-w-sm mx-auto">
            {isRegister 
              ? "Tạo tài khoản cá nhân hoặc gia đình để đồng bộ chi tiêu đám mây & liên kết Telegram" 
              : "Đăng nhập để tiếp tục quản lý chi tiêu và xem báo cáo phân tích tài chính"
            }
          </p>
        </div>

        {error && (
          <div className="bg-rose-50 dark:bg-rose-500/10 border border-rose-100 dark:border-rose-500/25 rounded-xl p-3 flex gap-2.5 text-rose-700 dark:text-rose-300 text-xs items-center animate-fade-in">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/25 rounded-xl p-3 flex gap-2.5 text-emerald-700 dark:text-emerald-300 text-xs items-center animate-fade-in">
            <UserCheck className="w-4 h-4 shrink-0 text-green-500 dark:text-emerald-400" />
            <span>{success}</span>
          </div>
        )}

        <form onSubmit={handleAuth} className="flex flex-col gap-4">
          {/* Email */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-(--sst-text-secondary)">Email của bạn</label>
            <div className="relative">
              <Mail className="absolute left-3.5 top-3 w-4 h-4 text-(--sst-text-muted)" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="E.g. member@gmail.com"
                className="w-full pl-10 pr-4 py-2.5 bg-(--sst-surface-2) border border-(--sst-border) rounded-xl text-xs focus:outline-hidden focus:border-indigo-400 focus:bg-(--sst-surface) transition-all shadow-xs"
              />
            </div>
          </div>

          {/* Password */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-(--sst-text-secondary)">Mật khẩu</label>
            <div className="relative">
              <Lock className="absolute left-3.5 top-3.5 w-4 h-4 text-(--sst-text-muted)" />
              <input
                type={showPassword ? "text" : "password"}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full pl-10 pr-11 py-3 bg-(--sst-surface-2) border border-(--sst-border) rounded-xl text-xs focus:outline-hidden focus:border-indigo-400 focus:bg-(--sst-surface) transition-all shadow-xs"
                id="auth-password-input"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-2.5 p-1 text-(--sst-text-muted) hover:text-(--sst-text-secondary) transition-all cursor-pointer select-none focus:outline-hidden focus-visible:ring-2 focus-visible:ring-indigo-400"
                id="toggle-password-visibility-btn"
                title={showPassword ? "Ẩn mật khẩu" : "Hiển thị mật khẩu"}
                aria-label={showPassword ? "Ẩn mật khẩu" : "Hiển thị mật khẩu"}
              >
                {showPassword ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            </div>

            {/* Password Criteria Checklist - Professional live helper */}
            {isRegister && password.length > 0 && (
              <div className="mt-1.5 p-3 bg-(--sst-surface-2) border border-(--sst-border) rounded-xl space-y-1.5 text-[10px] sm:text-xs">
                <span className="font-bold text-(--sst-text-secondary) block">Yêu cầu bảo mật mật khẩu:</span>
                <div className="grid grid-cols-2 gap-x-2 gap-y-1 font-bold">
                  <div className={`flex items-center gap-1.5 ${pwdStatus.hasUpper ? "text-emerald-600 dark:text-emerald-400" : "text-(--sst-text-muted)"}`}>
                    <span className="text-[11px]">{pwdStatus.hasUpper ? "✓" : "○"}</span>
                    <span>Chữ hoa (A-Z)</span>
                  </div>
                  <div className={`flex items-center gap-1.5 ${pwdStatus.hasLower ? "text-emerald-600 dark:text-emerald-400" : "text-(--sst-text-muted)"}`}>
                    <span className="text-[11px]">{pwdStatus.hasLower ? "✓" : "○"}</span>
                    <span>Chữ thường (a-z)</span>
                  </div>
                  <div className={`flex items-center gap-1.5 ${pwdStatus.hasNumber ? "text-emerald-600 dark:text-emerald-400" : "text-(--sst-text-muted)"}`}>
                    <span className="text-[11px]">{pwdStatus.hasNumber ? "✓" : "○"}</span>
                    <span>Số (0-9)</span>
                  </div>
                  <div className={`flex items-center gap-1.5 ${pwdStatus.hasSpecial ? "text-emerald-600 dark:text-emerald-400" : "text-(--sst-text-muted)"}`}>
                    <span className="text-[11px]">{pwdStatus.hasSpecial ? "✓" : "○"}</span>
                    <span>Ký tự đặc biệt (!@#...)</span>
                  </div>
                </div>
                <div className={`text-[10px] font-bold ${pwdStatus.isLengthOk ? "text-emerald-600 dark:text-emerald-400" : "text-(--sst-text-muted)"} mt-0.5`}>
                  {pwdStatus.isLengthOk ? "✓" : "○"} Độ dài tối thiểu 6 ký tự
                </div>
              </div>
            )}
          </div>

          {isRegister && (
            <>
              {/* Name */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-(--sst-text-secondary)">Tên hiển thị</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="E.g. Lan, Minh, Đức..."
                  className="w-full px-4 py-2.5 bg-(--sst-surface-2) border border-(--sst-border) rounded-xl text-xs focus:outline-hidden focus:border-indigo-400 focus:bg-(--sst-surface) transition-all shadow-xs"
                />
              </div>

              {/* Role dropdown */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-(--sst-text-secondary)">Vai trò / Định danh tài khoản</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="w-full px-4 py-2.5 bg-(--sst-surface-2) border border-(--sst-border) rounded-xl text-xs focus:outline-hidden focus:border-indigo-400 focus:bg-(--sst-surface) transition-all shadow-xs cursor-pointer"
                >
                  <option value="Cá nhân">Cá nhân (Quản lý độc lập 👤)</option>
                  <option value="Chồng">Chồng (Gia đình 🏡)</option>
                  <option value="Vợ">Vợ (Gia đình 🏡)</option>
                  <option value="Con">Con (Gia đình 🏡)</option>
                  <option value="Bố">Bố (Gia đình 🏡)</option>
                  <option value="Mẹ">Mẹ (Gia đình 🏡)</option>
                  <option value="Khác">Khác</option>
                </select>
              </div>

              {/* Household Code to Join */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-(--sst-text-secondary)">Mã mời hộ gia đình (nếu có)</label>
                <input
                  type="text"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  placeholder="E.g. 7F3K-9QXZ (để trống nếu là tài khoản Cá Nhân độc lập)"
                  className="w-full px-4 py-2.5 bg-(--sst-surface-2) border border-(--sst-border) rounded-xl text-xs uppercase font-mono tracking-wider focus:outline-hidden focus:border-indigo-400 focus:bg-(--sst-surface) transition-all shadow-xs"
                />
              </div>
            </>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-xl text-xs transition-all shadow-md shadow-indigo-100 cursor-pointer disabled:opacity-50 mt-2 hover:scale-101 active:scale-99"
          >
            {loading ? "Đang xử lý..." : isRegister ? "Tạo tài khoản & Bắt đầu" : "Đăng nhập ngay"}
          </button>
        </form>

        <div className="flex items-center gap-3">
          <div className="flex-1 border-t border-(--sst-border)" />
          <span className="text-[10px] font-bold text-(--sst-text-muted) uppercase tracking-wider shrink-0">Hoặc</span>
          <div className="flex-1 border-t border-(--sst-border)" />
        </div>

        <button
          type="button"
          onClick={handleGoogleLogin}
          disabled={googleLoading || loading}
          className="w-full flex items-center justify-center gap-2.5 bg-(--sst-surface) border border-(--sst-border-strong) hover:bg-(--sst-surface-hover) text-(--sst-text-secondary) font-bold py-3 rounded-xl text-xs transition-all shadow-xs cursor-pointer disabled:opacity-50"
          id="google-oauth-btn"
        >
          <GoogleIcon className="w-4 h-4 shrink-0" />
          {googleLoading ? "Đang chuyển hướng đến Google..." : "Tiếp tục với Google"}
        </button>

        <div className="border-t border-(--sst-border) pt-4 text-center">
          <button
            type="button"
            onClick={() => {
              setError(null);
              setIsRegister(!isRegister);
              setShowPassword(false);
            }}
            className="text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 font-bold cursor-pointer"
          >
            {isRegister ? "Đã có tài khoản? Đăng nhập tại đây" : "Chưa có tài khoản? Đăng ký tại đây"}
          </button>
        </div>
      </div>
    );
  }

  // [T-S137] Nhánh "đã đăng nhập" (thẻ Telegram) đã chuyển sang
  // `TelegramLinkCard.tsx` (màn Cài đặt mới) — component này giờ CHỈ CÒN
  // đúng 1 nơi gọi (màn chào mừng lúc chưa đăng nhập, `currentUser` luôn
  // `null` ở đó), nên nhánh dưới đây không còn cần thiết. Giữ nguyên chữ ký
  // component (props onLogin/onLogout/household không đổi) để không phải
  // sửa nơi gọi trong App.tsx — dù các props đó không còn dùng trong hàm
  // (TypeScript không báo lỗi vì đây là props destructure, không phải biến
  // cục bộ chưa dùng).
  return null;
}
