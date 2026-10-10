import { useState, useEffect, FormEvent } from "react";
import {
  Users,
  Trash2,
  Copy,
  Check,
  ShieldAlert,
  Database,
  LogOut,
  AlertCircle,
  Share2,
  Crown,
  ArrowRightLeft,
  X,
  Plus,
} from "lucide-react";
// T-S06e4: HouseholdManagement tự đọc VÀ tự ghi qua hook thật — không còn
// nhận household/currentUser/onUpdateHousehold/onLoadFullData/onUpdateUser
// qua props (mô hình state cục bộ + Express API cũ). Đọc qua
// useHousehold/useHouseholdMembers/useCurrentUserId, ghi qua
// useCreateHousehold/useJoinHousehold/useLeaveHousehold/useRemoveMember/
// useTransferOwnership (T-S06c) — đúng 5 thao tác AC gốc yêu cầu.
//
// 2 tính năng bản cũ KHÔNG có trong bản mới (đã đối chiếu `services/household.ts`
// — bảng `households` có `Insert: never; Update: never`, mọi ghi đi qua RPC
// SECURITY DEFINER, không có RPC nào cho 2 việc dưới):
// - "Sửa tên Hộ gia đình": không có RPC/service update tên hộ.
// - "Thêm thành viên trực tiếp" (chủ hộ tự thêm 1 member không qua mời): đây
//   là giả lập thời state cục bộ — mô hình Supabase thật bắt buộc mỗi thành
//   viên có tài khoản auth riêng, tự `join_household_by_code`, không thể tạo
//   hộ từ phía chủ hộ. Muốn có lại 2 tính năng này cần thêm RPC mới — không
//   thuộc phạm vi T-S06e4 (chỉ nối hook có sẵn từ T-S06c), ghi backlog nếu cần.
import { formatMemberDisplayName, useCreateHousehold, useHousehold, useHouseholdMembers, useJoinHousehold, useLeaveHousehold, useRemoveMember, useTransferOwnership } from "../hooks/useHousehold";
import { useCurrentUserId } from "../hooks/useCurrentUserId";
import { useCurrentUserEmail } from "../hooks/useCurrentUserEmail";
import { useScope } from "../context/ScopeContext";
import { useToast } from "../context/ToastContext";

export default function HouseholdManagement() {
  const { showToast } = useToast();
  const userId = useCurrentUserId();
  const { data: household } = useHousehold();
  const { data: members = [] } = useHouseholdMembers(household?.id);
  const myMember = members.find((m) => m.id === userId);
  const isOwner = myMember?.household_role === "owner";

  // Auto-chuyển scope sang "household" ngay sau khi tạo/tham gia thành công —
  // giữ đúng hành vi UX bản cũ (`onLoadFullData` callback trước T-S06e4, xem
  // CHANGELOG "AUDIT — T-S06e4"), nay tự làm nội bộ component thay vì qua props.
  const { setScopeMode } = useScope();

  const createHouseholdMutation = useCreateHousehold();
  const joinHouseholdMutation = useJoinHousehold();
  const leaveHouseholdMutation = useLeaveHousehold();
  const removeMemberMutation = useRemoveMember();
  const transferOwnershipMutation = useTransferOwnership();
  // Tabs within Household tab: "Quản lý" (Management), "Database SQL & RLS" (SQL Schema & Security)
  const [subTab, setSubTab] = useState<"manage" | "sql">("manage");

  // [T-S134] Tab "Postgres RLS Schema" chỉ hiện cho đúng 1 email admin — xem
  // PRD.md "Chốt 22/08/2026": đây là gate Ở GIAO DIỆN (không phải chặn thật
  // từ server), chấp nhận được vì nội dung không chứa bí mật thật.
  const currentUserEmail = useCurrentUserEmail();
  const isRlsAdmin = currentUserEmail === "duchoan772003@gmail.com";
  useEffect(() => {
    if (subTab === "sql" && !isRlsAdmin) setSubTab("manage");
  }, [subTab, isRlsAdmin]);

  // Household Management Local States
  const [hName, setHName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [inviteInput, setInviteInput] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);

  // Custom inline confirmations (to avoid iframe blocking)
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmRemoveMemberId, setConfirmRemoveMemberId] = useState<string | null>(null);
  const [confirmTransferId, setConfirmTransferId] = useState<string | null>(null);

  // UX feedbacks
  const [copiedCode, setCopiedCode] = useState(false);
  const [activeTabSql, setActiveTabSql] = useState<"all" | "tables" | "trigger" | "security">("all");

  // Tạo hộ gia đình mới — RPC `create_household` (chỉ nhận tên, không nhận
  // displayName/role/email như API Express cũ — hồ sơ cá nhân đã có sẵn từ
  // lúc đăng ký, không set lại ở đây).
  const handleCreateHousehold = (e: FormEvent) => {
    e.preventDefault();
    if (!hName.trim()) return;
    setCreateError(null);
    createHouseholdMutation.mutate(hName.trim(), {
      onSuccess: () => {
        setHName("");
        setScopeMode("household");
      },
      onError: (err: any) => setCreateError(err.message || "Lỗi tạo hộ gia đình"),
    });
  };

  // RPC `remove_member` tự kiểm tra quyền chủ hộ, raise nếu gọi sai quyền —
  // không cần tự kiểm tra permission phía client như bản cũ nữa.
  const handleRemoveMember = (memberId: string) => {
    removeMemberMutation.mutate(memberId, {
      onError: (err: any) => showToast({ message: err.message || "Lỗi xoá thành viên", variant: "error" }),
    });
    setConfirmRemoveMemberId(null);
  };

  // T-S06e4 — mới hoàn toàn, chưa có ở bản UI cũ. RPC `transfer_ownership`
  // (T-S03b) tự kiểm tra người gọi đúng là chủ hộ hiện tại.
  const handleTransferOwnership = (memberId: string) => {
    transferOwnershipMutation.mutate(memberId, {
      onError: (err: any) => showToast({ message: err.message || "Lỗi chuyển quyền chủ hộ", variant: "error" }),
    });
    setConfirmTransferId(null);
  };

  // Tham gia hộ bằng mã mời — RPC `join_household_by_code` chỉ nhận mã mời,
  // không nhận displayName/role (hồ sơ cá nhân giữ nguyên khi gia nhập).
  const handleJoinByCode = (e: FormEvent) => {
    e.preventDefault();
    setJoinError(null);

    const cleanCode = inviteInput.trim().toUpperCase();
    // Khớp đúng format RPC thật (0003_rpc_household_partial.sql:22): 6 ký tự
    // chữ/số, KHÔNG dấu gạch ngang. Bản trước validate theo format "XXXX-YYYY"
    // (9 ký tự) — tàn dư từ 1 thiết kế cũ chưa từng khớp RPC đã chốt, khiến
    // MỌI mã mời thật đều bị chặn ngay ở client (gap phát hiện khi user test
    // T-S06e4 thật, 07/08/2026).
    if (!/^[A-Z0-9]{6}$/.test(cleanCode)) {
      setJoinError("Định dạng mã mời không hợp lệ. Mã mời gồm đúng 6 ký tự chữ/số (vd: BA6CAA).");
      return;
    }
    if (household && cleanCode === household.invite_code) {
      setJoinError("Bạn đã là thành viên của Hộ gia đình này rồi.");
      return;
    }

    joinHouseholdMutation.mutate(cleanCode, {
      onSuccess: () => {
        setInviteInput("");
        setScopeMode("household");
      },
      onError: (err: any) => setJoinError(err.message || "Lỗi tham gia hộ gia đình"),
    });
  };

  const handleCopyCode = () => {
    if (!household) return;
    navigator.clipboard.writeText(household.invite_code);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  // SQL code blocks requested by user
  const sqlSchemaCode = `-- ====================================================================
-- 1. THIẾT KẾ BẢNG DỮ LIỆU CHÍNH HỘ GIA ĐÌNH & THÀNH VIÊN (PostgreSQL)
-- ====================================================================

-- Bảng households (Thông tin chung về hộ gia đình)
CREATE TABLE households (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  invite_code VARCHAR(9) UNIQUE, -- Định dạng 8 ký tự kèm dấu gạch ngang, vd: 7F3K-9QXZ
  owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Bảng household_members (Thành viên liên kết trong hộ)
CREATE TABLE household_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name VARCHAR(100) NOT NULL,
  role VARCHAR(50) CHECK (role IN ('Chồng', 'Vợ', 'Con', 'Mẹ', 'Bố', 'Khác')) NOT NULL,
  initials VARCHAR(4),
  joined_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  CONSTRAINT unique_household_member UNIQUE(household_id, user_id)
);`;

  const sqlTriggerCode = `-- ====================================================================
-- 2. TRIGGER TỰ ĐỘNG SINH MÃ INVITE_CODE KHÔNG TRÙNG, KHÔNG CẦN NHẬP TAY
-- ====================================================================

CREATE OR REPLACE FUNCTION generate_unique_invite_code()
RETURNS TRIGGER AS $$
DECLARE
  new_code VARCHAR(9);
  chars TEXT := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  i INT;
  code_exists BOOLEAN;
BEGIN
  -- Lặp cho tới khi sinh được mã invite_code duy nhất, không trùng lặp
  LOOP
    new_code := '';
    -- Sinh 4 ký tự đầu
    FOR i IN 1..4 LOOP
      new_code := new_code || substr(chars, floor(random() * length(chars) + 1)::int, 1);
    END LOOP;
    
    new_code := new_code || '-';
    
    -- Sinh 4 ký tự sau
    FOR i IN 1..4 LOOP
      new_code := new_code || substr(chars, floor(random() * length(chars) + 1)::int, 1);
    END LOOP;
    
    -- Kiểm tra xem mã này đã tồn tại trong database chưa
    SELECT EXISTS(SELECT 1 FROM households WHERE invite_code = new_code) INTO code_exists;
    EXIT WHEN NOT code_exists; -- Nếu không trùng thì ngắt lặp
  END LOOP;
  
  NEW.invite_code := new_code;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Gán trigger chạy BEFORE INSERT trên bảng households
CREATE OR REPLACE TRIGGER trigger_auto_invite_code
BEFORE INSERT ON households
FOR EACH ROW
EXECUTE FUNCTION generate_unique_invite_code();`;

  const sqlSecurityDefinerCode = `-- ====================================================================
-- 3. HÀM SECURITY DEFINER GIẢI QUYẾT BẢO MẬT RLS (MÃ MỜI TRUY CẬP)
-- ====================================================================
-- GHI CHÚ BẢO MẬT: Do RLS ngăn chặn người dùng chưa gia nhập đọc bảng households,
-- ta cần dùng SECURITY DEFINER để chạy hàm dưới quyền superuser (được kiểm soát),
-- cho phép tra cứu mã và ghi danh thành viên mà không rò rỉ toàn bộ danh sách.

-- Hàm 1: Tạo hộ gia đình cùng với chủ sở hữu trong một Transaction
CREATE OR REPLACE FUNCTION create_household_with_owner(
  p_household_name TEXT,
  p_display_name TEXT,
  p_role TEXT
)
RETURNS UUID AS $$
DECLARE
  v_household_id UUID;
  v_user_id UUID := auth.uid(); -- Lấy user_id hiện tại từ context Auth
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Bạn cần phải đăng nhập để tạo hộ gia đình.';
  END IF;

  -- Tạo Household mới (Trigger sẽ tự sinh invite_code)
  INSERT INTO households (name, owner_id)
  VALUES (p_household_name, v_user_id)
  RETURNING id INTO v_household_id;

  -- Thêm ngay người tạo làm chủ sở hữu (owner) trong bảng household_members
  INSERT INTO household_members (household_id, user_id, display_name, role)
  VALUES (v_household_id, v_user_id, p_display_name, p_role);

  RETURN v_household_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- Hàm 2: Gia nhập hộ gia đình bằng Invite Code vượt qua rào cản RLS một cách an toàn
CREATE OR REPLACE FUNCTION join_household_by_code(
  p_invite_code VARCHAR(9),
  p_display_name TEXT,
  p_role TEXT
)
RETURNS TABLE (
  household_id UUID,
  household_name VARCHAR
) AS $$
DECLARE
  v_household_id UUID;
  v_household_name VARCHAR;
  v_user_id UUID := auth.uid();
BEGIN
  -- 1. Kiểm tra đăng nhập
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Bạn cần phải đăng nhập để gia nhập hộ gia đình.';
  END IF;

  -- 2. Truy vấn hộ gia đình theo invite_code (Bypass RLS thông qua SECURITY DEFINER)
  SELECT id, name INTO v_household_id, v_household_name
  FROM households
  WHERE invite_code = UPPER(p_invite_code);

  -- 3. Trả về lỗi rõ ràng nếu code sai
  IF v_household_id IS NULL THEN
    RAISE EXCEPTION 'Mã mời "%" không tồn tại hoặc đã hết hạn.', p_invite_code;
  END IF;

  -- 4. Kiểm tra xem người dùng đã là thành viên chưa
  IF EXISTS (
    SELECT 1 FROM household_members 
    WHERE household_id = v_household_id AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'Bạn đã là thành viên của hộ gia đình này rồi.';
  END IF;

  -- 5. Đăng ký thành viên mới
  INSERT INTO household_members (household_id, user_id, display_name, role)
  VALUES (v_household_id, v_user_id, p_display_name, p_role);

  RETURN QUERY SELECT v_household_id, v_household_name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;`;

  return (
    <div className="space-y-6" id="household-management-tab">
      {/* Upper Navigation Card */}
      <div className="bg-(--sst-surface) rounded-2xl p-4.5 border border-(--sst-border) shadow-sm flex flex-wrap gap-2.5 items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-300 rounded-xl">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-(--sst-text)">Quản Lý Hộ Gia Đình</h2>
            <p className="text-[11px] text-(--sst-text-secondary) mt-0.5">
              Tạo, tham gia hoặc quản lý thành viên hộ gia đình, phân quyền bằng Postgres RLS.
            </p>
          </div>
        </div>

        {/* [T-S134 UX follow-up] Khối chuyển tab chỉ có Ý NGHĨA khi có ≥2 tab
            để chọn. Với người dùng thường (không phải admin), tab "Postgres
            RLS Schema" đã ẩn hoàn toàn nên chỉ còn đúng 1 lựa chọn — hiện nó
            dưới dạng nút bấm kiểu segmented-tab sẽ gây khó hiểu (bấm vào
            không đổi gì, trông như thiếu chức năng). Chỉ render khối này khi
            còn ≥2 tab thật sự (tức đang là admin). */}
        {isRlsAdmin && (
          <div className="flex w-full md:w-auto gap-1 bg-(--sst-surface-2) p-1 rounded-xl border border-(--sst-border)">
            <button
              onClick={() => setSubTab("manage")}
              className={`flex-1 md:flex-initial text-center px-2.5 sm:px-4 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-all ${
                subTab === "manage"
                  ? "bg-(--sst-surface) text-indigo-600 dark:text-indigo-300 shadow-xs"
                  : "text-(--sst-text-secondary) hover:text-(--sst-text)"
              }`}
            >
              <span className="inline md:hidden">Thành viên</span>
              <span className="hidden md:inline">Quản lý Thành viên</span>
            </button>
            <button
              onClick={() => setSubTab("sql")}
              className={`flex-1 md:flex-initial text-center px-2.5 sm:px-4 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-all flex items-center justify-center gap-1 ${
                subTab === "sql"
                  ? "bg-(--sst-surface) text-indigo-600 dark:text-indigo-300 shadow-xs"
                  : "text-(--sst-text-secondary) hover:text-(--sst-text)"
              }`}
            >
              <Database className="w-3.5 h-3.5 shrink-0" />
              <span className="inline md:hidden">RLS Schema</span>
              <span className="hidden md:inline">Postgres RLS Schema</span>
            </button>
          </div>
        )}
      </div>

      {subTab === "manage" || !isRlsAdmin ? (
        <div className="space-y-6">
          {household ? (
            /* Active Household Card */
            <div className="bg-(--sst-surface) rounded-2xl shadow-sm border border-(--sst-border) p-6 space-y-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <span className="text-[10px] bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-300 font-bold px-2 py-0.5 rounded-full border border-indigo-100/50 dark:border-indigo-500/25">
                    🏡 ĐANG HOẠT ĐỘNG
                  </span>
                  <div className="flex items-center gap-2 mt-1.5">
                    <h3 className="text-base font-bold text-(--sst-text)">{household.name}</h3>
                  </div>
                </div>

                {confirmLeave ? (
                  <div className="flex items-center gap-1.5 bg-rose-50 dark:bg-rose-500/10 border border-rose-100 dark:border-rose-500/25 p-1.5 rounded-xl shrink-0 animate-fade-in">
                    <span className="text-[10px] text-rose-700 dark:text-rose-300 font-bold">Rời nhóm sẽ đưa về chế độ cá nhân. Đồng ý?</span>
                    <button
                      onClick={() => {
                        leaveHouseholdMutation.mutate(undefined, {
                          onError: (err: any) => showToast({ message: err.message || "Lỗi rời hộ gia đình (chủ hộ phải chuyển quyền cho người khác trước khi rời, nếu hộ còn thành viên khác)", variant: "error" }),
                        });
                        setConfirmLeave(false);
                      }}
                      className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-lg text-[10px] cursor-pointer"
                    >
                      Có, rời
                    </button>
                    <button
                      onClick={() => setConfirmLeave(false)}
                      className="px-2.5 py-1 bg-(--sst-surface-2) hover:bg-(--sst-surface-hover) text-(--sst-text) font-medium rounded-lg text-[10px] cursor-pointer"
                    >
                      Hủy
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmLeave(true)}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs text-rose-600 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-xl transition-all cursor-pointer font-semibold border border-rose-100 dark:border-rose-500/25 shrink-0"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    Rời nhóm
                  </button>
                )}
              </div>

              {/* Invite Code Generator Box */}
              <div className="bg-gradient-to-r from-indigo-50/70 dark:from-indigo-500/10 to-(--sst-surface-2) border border-indigo-100/60 dark:border-indigo-500/25 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <span className="text-[10px] text-(--sst-text-secondary) font-bold uppercase tracking-wider">Mã mời gia nhập gia đình</span>
                  <p className="text-xs text-(--sst-text-secondary)">Gửi mã này cho Vợ, Chồng hoặc Con để họ nhập vào và cùng đồng bộ chi tiêu.</p>
                </div>

                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-bold bg-(--sst-surface) text-indigo-600 dark:text-indigo-300 px-3.5 py-1.5 rounded-lg border border-indigo-100 dark:border-indigo-500/25 select-all tracking-wider shadow-xs">
                    {household.invite_code}
                  </span>
                  <button
                    onClick={handleCopyCode}
                    className="p-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-all cursor-pointer shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                    title="Sao chép mã mời"
                    aria-label="Sao chép mã mời"
                  >
                    {copiedCode ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              {/* Household Members List — đọc từ profiles thật qua useHouseholdMembers */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold text-(--sst-text-secondary) uppercase tracking-wider flex items-center gap-1.5">
                  Danh sách thành viên ({members.length})
                </h4>

                <div className="border border-(--sst-border) rounded-xl overflow-hidden divide-y divide-(--sst-border)">
                  {members.map((m) => {
                    const isOwnerRow = m.household_role === "owner";
                    const isConfirmingDeleteThis = confirmRemoveMemberId === m.id;
                    const isConfirmingTransferThis = confirmTransferId === m.id;

                    return (
                      <div key={m.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 bg-(--sst-surface-2) hover:bg-(--sst-surface-hover) transition-all gap-3">
                        <div className="flex items-center gap-3 flex-1">
                          <div className="w-8 h-8 rounded-full bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 flex items-center justify-center font-bold text-xs border border-indigo-100 dark:border-indigo-500/25 shrink-0">
                            {m.personal_role.substring(0, 1)}
                          </div>
                          <div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-bold text-(--sst-text)">{formatMemberDisplayName(m)}</span>
                              {isOwnerRow && (
                                <span className="text-[9px] bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 font-bold px-1.5 py-0.5 rounded border border-amber-200/50 dark:border-amber-500/25 flex items-center gap-0.5">
                                  <Crown className="w-2.5 h-2.5" /> Chủ hộ
                                </span>
                              )}
                            </div>
                            <p className="text-[10px] text-(--sst-text-muted)">Gia nhập: {new Date(m.created_at).toLocaleDateString("vi-VN")}</p>
                          </div>
                        </div>

                        {isOwner && (
                          <div className="flex items-center justify-end gap-1.5">
                            {!isOwnerRow && (
                              isConfirmingTransferThis ? (
                                <div className="flex items-center gap-1 bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/25 p-1 rounded-lg">
                                  <span className="text-[9px] text-amber-700 dark:text-amber-300 font-bold px-1">Chuyển quyền chủ hộ?</span>
                                  <button
                                    onClick={() => handleTransferOwnership(m.id)}
                                    className="px-1.5 py-0.5 bg-amber-600 hover:bg-amber-700 text-white text-[9px] font-bold rounded"
                                  >
                                    Có
                                  </button>
                                  <button
                                    onClick={() => setConfirmTransferId(null)}
                                    className="px-1.5 py-0.5 bg-(--sst-surface-2) hover:bg-(--sst-surface-hover) text-(--sst-text) text-[9px] font-medium rounded"
                                  >
                                    Không
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => setConfirmTransferId(m.id)}
                                  className="p-1.5 text-(--sst-text-muted) hover:text-amber-600 dark:hover:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-500/10 rounded-lg transition-all cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                                  title="Chuyển quyền chủ hộ cho thành viên này"
                                  aria-label="Chuyển quyền chủ hộ cho thành viên này"
                                >
                                  <ArrowRightLeft className="w-3.5 h-3.5" />
                                </button>
                              )
                            )}

                            {!isOwnerRow && (
                              isConfirmingDeleteThis ? (
                                <div className="flex items-center gap-1 bg-rose-50 dark:bg-rose-500/10 border border-rose-100 dark:border-rose-500/25 p-1 rounded-lg">
                                  <span className="text-[9px] text-rose-700 dark:text-rose-300 font-bold px-1">Xóa?</span>
                                  <button
                                    onClick={() => handleRemoveMember(m.id)}
                                    className="px-1.5 py-0.5 bg-rose-600 hover:bg-rose-700 text-white text-[9px] font-bold rounded"
                                  >
                                    Có
                                  </button>
                                  <button
                                    onClick={() => setConfirmRemoveMemberId(null)}
                                    className="px-1.5 py-0.5 bg-(--sst-surface-2) hover:bg-(--sst-surface-hover) text-(--sst-text) text-[9px] font-medium rounded"
                                  >
                                    Không
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => setConfirmRemoveMemberId(m.id)}
                                  className="p-1.5 text-(--sst-text-muted) hover:text-rose-600 dark:hover:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition-all cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
                                  title="Xóa khỏi gia đình"
                                  aria-label="Xóa khỏi gia đình"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Mời thành viên mới — CHỈ qua mã mời (mỗi người tự có tài
                  khoản riêng, tự `join_household_by_code`). Bản UI cũ có
                  form "Thêm thành viên trực tiếp" giả lập — đã bỏ, xem
                  comment ở đầu file. */}
              {!isOwner && (
                <div className="border-t border-(--sst-border) pt-5 text-center p-4 bg-amber-50/50 dark:bg-amber-500/10 rounded-2xl border border-dashed border-amber-200 dark:border-amber-500/25">
                  <ShieldAlert className="w-5 h-5 text-amber-500 dark:text-amber-300 mx-auto mb-1.5" />
                  <h4 className="text-xs font-bold text-amber-800 dark:text-amber-300">Mã Mời Tự Tham Gia Gia Đình</h4>
                  <p className="text-[11px] text-(--sst-text-secondary) mt-1 max-w-md mx-auto leading-relaxed">
                    Bạn không phải là Chủ hộ của hộ gia đình này. Để mời thành viên khác vào nhóm, hãy gửi Mã mời ở trên để họ tự tạo tài khoản và gia nhập.
                  </p>
                </div>
              )}
            </div>
          ) : (
            /* Setup Household Card (Empty State) */
            <div className="space-y-6">
              {/* Intro banner */}
              <div className="bg-gradient-to-r from-indigo-900 to-slate-800 text-indigo-100 rounded-2xl p-6 shadow-md relative overflow-hidden">
                <div className="absolute right-0 bottom-0 opacity-10 transform translate-x-4 translate-y-4">
                  <Users className="w-48 h-48" />
                </div>
                <div className="relative z-10 space-y-2">
                  <h3 className="text-base font-bold text-white flex items-center gap-1.5">
                    Đồng bộ chi tiêu Hộ Gia Đình 👨‍👩‍👧‍👦
                  </h3>
                  <p className="text-xs text-indigo-200/90 leading-relaxed">
                    Chuyển đổi từ quản lý tài chính cá nhân đơn lẻ sang một sổ chi tiêu gia đình thống nhất. Bạn có thể tự sinh mã mời, cấp tài khoản cho Vợ/Chồng/Con để cùng gửi báo cáo chi tiêu qua Telegram hoặc giao diện chính!
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Create New Card */}
                <div className="bg-(--sst-surface) border border-(--sst-border) rounded-2xl p-5 shadow-xs flex flex-col justify-between space-y-4">
                  <div className="space-y-1.5">
                    <div className="p-2 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-300 rounded-xl w-fit">
                      <Plus className="w-4.5 h-4.5" />
                    </div>
                    <h4 className="text-xs font-bold text-(--sst-text) uppercase tracking-wider">Tạo Hộ Gia Đình Mới</h4>
                    <p className="text-xs text-(--sst-text-secondary) leading-relaxed">
                      Khởi tạo một gia đình mới, bạn sẽ là chủ nhóm và được cấp mã invite_code ngẫu nhiên 6 ký tự.
                    </p>
                  </div>

                  <form onSubmit={handleCreateHousehold} className="space-y-3 pt-2">
                    {/* [T-S119, 20/08/2026 — bug thật phát hiện qua audit
                        logic dòng tiền/hộ gia đình] createError được gán ở
                        handleCreateHousehold (onError) nhưng CHƯA TỪNG có
                        khối JSX nào hiển thị nó — lỗi tạo hộ gia đình (tên
                        trùng, RLS từ chối, mất mạng...) bị nuốt hoàn toàn,
                        người dùng bấm "Khởi tạo" không thấy phản hồi gì.
                        Thêm đúng theo mẫu joinError đã có sẵn ở form kế bên. */}
                    {createError && (
                      <div className="text-[10px] text-rose-600 dark:text-rose-300 bg-rose-50 dark:bg-rose-500/10 border border-rose-100 dark:border-rose-500/25 rounded-lg p-2 flex items-start gap-1">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        <span>{createError}</span>
                      </div>
                    )}
                    <input
                      type="text"
                      className="w-full text-xs bg-(--sst-surface) border border-(--sst-border-strong) focus:border-indigo-500 rounded-xl px-3 py-2 outline-none text-(--sst-text)"
                      placeholder="Tên Hộ gia đình (vd: Gia đình họ Nguyễn...)"
                      value={hName}
                      onChange={(e) => setHName(e.target.value)}
                      required
                    />
                    <button
                      type="submit"
                      className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-xs"
                    >
                      Khởi tạo Gia Đình
                    </button>
                  </form>
                </div>

                {/* Join by Code Card */}
                <div className="bg-(--sst-surface) border border-(--sst-border) rounded-2xl p-5 shadow-xs flex flex-col justify-between space-y-4">
                  <div className="space-y-1.5">
                    <div className="p-2 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 rounded-xl w-fit">
                      <Share2 className="w-4.5 h-4.5" />
                    </div>
                    <h4 className="text-xs font-bold text-(--sst-text) uppercase tracking-wider">Gia Nhập Bằng Mã Mời</h4>
                    <p className="text-xs text-(--sst-text-secondary) leading-relaxed">
                      Bạn nhận được mã invite_code (vd: BA6CAA) từ thành viên khác? Hãy nhập mã để liên kết.
                    </p>
                  </div>

                  <form onSubmit={handleJoinByCode} className="space-y-2.5 pt-2">
                    {joinError && (
                      <div className="text-[10px] text-rose-600 dark:text-rose-300 bg-rose-50 dark:bg-rose-500/10 border border-rose-100 dark:border-rose-500/25 rounded-lg p-2 flex items-start gap-1">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        <span>{joinError}</span>
                      </div>
                    )}
                    {/* Chỉ nhận mã mời — RPC `join_household_by_code` (CONSTITUTION §3/§4)
                        chỉ nhận đúng 1 tham số invite_code, không nhận tên hiển thị/vai trò:
                        hồ sơ cá nhân (`profiles.name`/`personal_role`) đã có sẵn từ lúc đăng
                        ký, giữ nguyên khi gia nhập hộ. 2 field "Tên hiển thị"/"Vai trò" ở bản
                        UI cũ (giả lập state cục bộ) đã bỏ hẳn, không phục hồi — xem CHANGELOG
                        "AUDIT — T-S06e4". */}
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        type="text"
                        className="text-xs bg-(--sst-surface) border border-(--sst-border-strong) focus:border-indigo-500 rounded-xl px-3 py-2 outline-none text-(--sst-text) uppercase w-full"
                        placeholder="MÃ MỜI (BA6CAA)"
                        value={inviteInput}
                        onChange={(e) => setInviteInput(e.target.value)}
                        maxLength={6}
                        required
                      />
                      <button
                        type="submit"
                        className="w-full sm:w-auto sm:shrink-0 px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-xs text-center"
                      >
                        Gia nhập nhóm
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* SQL Schema & RLS Security tab */
        <div className="bg-(--sst-surface) rounded-2xl shadow-sm border border-(--sst-border) p-6 space-y-6">
          <div className="space-y-2">
            <h3 className="text-sm font-bold text-(--sst-text) flex items-center gap-2">
              <Database className="w-4.5 h-4.5 text-indigo-600 dark:text-indigo-300" />
              Giải Pháp Bảo Mật Row Level Security (RLS) Cho Hộ Gia Đình
            </h3>
            <p className="text-xs text-(--sst-text-secondary) leading-relaxed">
              Trong kiến trúc cơ sở dữ liệu nhiều người dùng (Multi-tenant), chính sách <strong>Row Level Security (RLS)</strong> được áp dụng để đảm bảo chỉ những thành viên đã gia nhập hộ gia đình mới có thể đọc/ghi dữ liệu của hộ đó.
            </p>
          </div>

          {/* RLS Security explanation requested by user */}
          <div className="bg-amber-50/50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/25 rounded-xl p-4.5 space-y-3 text-xs leading-relaxed text-amber-900 dark:text-amber-300">
            <h4 className="font-bold text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
              ⚠️ Rào Cản RLS Khi Tra Cứu Mã Mời & Giải Pháp Security Definer
            </h4>
            <div className="space-y-2">
              <p>
                <strong>Vấn đề bảo mật:</strong> Nếu chính sách RLS chặn tuyệt đối không cho người lạ đọc bảng <code>households</code>, thì khi một người dùng mới nhập mã mời <code>7F3K-9QXZ</code> để gia nhập, câu lệnh <code>SELECT</code> tra cứu mã mời của họ sẽ bị <strong>RLS chặn ngay lập tức</strong> (vì họ chưa thuộc hộ gia đình đó).
              </p>
              <p>
                <strong>Giải pháp tối ưu:</strong> Ta thiết kế 2 hàm database bằng ngôn ngữ <strong>PL/pgSQL</strong> với khai báo <strong>`SECURITY DEFINER`</strong>. Các hàm này khi thực thi sẽ tạm thời chạy vượt quyền RLS (dưới danh nghĩa quyền Superuser thiết lập ra nó), thực hiện việc kiểm tra mã mời và thêm bản ghi đăng ký thành viên mới vào bảng <code>household_members</code> trong một transaction duy nhất, sau đó trả về kết quả an toàn mà không làm lộ dữ liệu của các hộ khác!
              </p>
            </div>
          </div>

          {/* Code Tabs */}
          <div className="space-y-4">
            <div className="flex border-b border-(--sst-border) gap-3 text-xs">
              {[
                { id: "all", label: "Toàn bộ SQL script" },
                { id: "tables", label: "1. Khởi tạo Tables" },
                { id: "trigger", label: "2. Trigger Mã mời tự sinh" },
                { id: "security", label: "3. Hàm Security Definer" },
              ].map((t) => (
                <button
                  key={t.id}
                  onClick={() => setActiveTabSql(t.id as any)}
                  className={`pb-2.5 font-bold cursor-pointer transition-all ${
                    activeTabSql === t.id
                      ? "text-indigo-600 dark:text-indigo-300 border-b-2 border-indigo-600 dark:border-indigo-400"
                      : "text-(--sst-text-muted) hover:text-(--sst-text-secondary)"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="bg-slate-900 text-slate-100 rounded-xl p-4.5 font-mono text-[11px] overflow-x-auto border border-slate-800 relative group max-h-[500px]">
              <button
                onClick={() => {
                  let copyText = "";
                  if (activeTabSql === "all") copyText = `${sqlSchemaCode}\n\n${sqlTriggerCode}\n\n${sqlSecurityDefinerCode}`;
                  else if (activeTabSql === "tables") copyText = sqlSchemaCode;
                  else if (activeTabSql === "trigger") copyText = sqlTriggerCode;
                  else if (activeTabSql === "security") copyText = sqlSecurityDefinerCode;
                  navigator.clipboard.writeText(copyText);
                  showToast({ message: "Đã sao chép SQL script thành công!" });
                }}
                className="absolute top-3 right-3 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white rounded text-[10px] font-bold cursor-pointer opacity-80 group-hover:opacity-100 transition-all border border-slate-700"
              >
                Sao chép SQL
              </button>

              <pre className="whitespace-pre">
                {activeTabSql === "all" && (
                  <>
                    {sqlSchemaCode}
                    {"\n\n"}
                    {sqlTriggerCode}
                    {"\n\n"}
                    {sqlSecurityDefinerCode}
                  </>
                )}
                {activeTabSql === "tables" && sqlSchemaCode}
                {activeTabSql === "trigger" && sqlTriggerCode}
                {activeTabSql === "security" && sqlSecurityDefinerCode}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}