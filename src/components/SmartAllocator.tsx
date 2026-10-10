import { useState, useEffect, useMemo } from "react";
import { Coins, ChevronRight, Check, Info, TrendingUp, Sparkles, PieChart as PieIcon, Trash2, Plus, RefreshCw, AlertTriangle } from "lucide-react";
import { AllocationFormula, AllocationItem } from "../types";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend } from "recharts";
import { useCategories, useCreateCategory, useUpdateCategory, useSoftDeleteCategory } from "../hooks/useCategories";
import { useTransactions } from "../hooks/useTransactions";
import { getCurrentMonthIncomeStats, getRecentMonthsIncomeAverage, getCumulativeBalance } from "../lib/incomeStats";
import { useDataScope } from "../hooks/useDataScope";
import { useCurrentUserId } from "../hooks/useCurrentUserId";
import { useHousehold, useHouseholdMembers } from "../hooks/useHousehold";
import { rowToCategory, rowsToTransactions } from "../lib/mapRows";
import { EXPENSE_ICONS } from "../lib/categoryIcons";
import IconPicker from "./IconPicker";
import { useCreateAutoContributionConfig } from "../hooks/useAutoContribution";
import { AutoContributionCategoryConfigPending, PendingCategoryAutoContribution } from "./AutoContributionCategoryConfig";

// T-S40 (09/08/2026, bổ sung) — nội dung box giải thích ngắn cho từng công
// thức phân bổ, hiện ngay dưới dropdown "Quy tắc phân bổ", đổi theo lựa
// chọn hiện tại (không cần bấm Áp Dụng). 4 phần cố định: Ý tưởng cốt lõi /
// Vì sao chia vậy / Phù hợp ai / Gợi ý tuỳ biến.
//
// LƯU Ý: nội dung dưới đây do Claude tự soạn ngày 11/08/2026 — TASKS.md ghi
// nội dung này "đã chốt sẵn 09/08/2026" nhưng bảng gốc không còn tồn tại
// trong CHANGELOG.md/PRD.md/CONSTITUTION.md (grep không ra kết quả). Người
// yêu cầu đã xác nhận cho soạn mới, cần DUYỆT LẠI nội dung trước khi coi là
// "chốt" chính thức — xem CHANGELOG mục T-S40.
//
// Phủ đủ cả 7 công thức hiện có trong dropdown, kể cả "bare_bones" (T-S41 —
// nội dung do Claude soạn cùng lúc với công thức, không phải phần "6/7 đã
// có sẵn từ T-S40").
const FORMULA_EXPLANATION: Record<
  AllocationFormula,
  { coreIdea: string; whySplit: string; suitableFor: string; customizeTip: string }
> = {
  "50_30_20": {
    coreIdea: "Chia thu nhập sau thuế thành 3 phần: 50% Thiết yếu, 30% Mong muốn, 20% Tiết kiệm/trả nợ.",
    whySplit: "Tỷ lệ đơn giản, dễ nhớ, đủ rộng để không cần theo dõi từng đồng nhưng vẫn ép được một khoản tiết kiệm cố định mỗi tháng.",
    suitableFor: "Người mới bắt đầu quản lý chi tiêu, thu nhập ổn định, chưa muốn phân loại chi tiết.",
    customizeTip: "Thu nhập thấp hoặc chi phí sống đắt đỏ có thể nới Thiết yếu lên 60-70%, giảm Mong muốn tương ứng — miễn giữ được phần Tiết kiệm dù nhỏ.",
  },
  "6_jars": {
    coreIdea: "Chia thành 6 \"lọ\": Thiết yếu 55%, Tiết kiệm dài hạn 10%, Giáo dục 10%, Hưởng thụ 10%, Tự do tài chính 10%, Từ thiện 5%.",
    whySplit: "Tách bạch mục đích của từng đồng tiền — kể cả tiết kiệm cũng chia làm 2 loại (đầu tư dài hạn và quỹ tự do), giúp không dồn hết vào chi tiêu trước mắt.",
    suitableFor: "Người muốn kỷ luật tài chính rõ ràng theo từng mục đích, có thu nhập đều và ổn định.",
    customizeTip: "Không có nhu cầu Từ thiện có thể gộp 5% đó vào Tiết kiệm dài hạn hoặc Tự do tài chính, miễn tổng vẫn 100%.",
  },
  zero_based: {
    coreIdea: "Mỗi đồng thu nhập được gán cho một nhiệm vụ cụ thể (chi tiêu, tiết kiệm, trả nợ...) cho tới khi phần chưa phân bổ về đúng 0.",
    whySplit: "Không phân bổ theo tỷ lệ cố định mà theo hạng mục chi tiêu thật của chính bạn — không có \"tiền dư trôi nổi\" không rõ đi đâu.",
    suitableFor: "Người có nhiều khoản chi cố định/khác nhau theo tháng, muốn kiểm soát chi tiết từng hạng mục thay vì theo % chung.",
    customizeTip: "Rà lại danh mục chi tiêu định kỳ trước khi dùng công thức này — càng đủ category thật, bản phân bổ càng sát thực tế.",
  },
  pay_yourself_first: {
    coreIdea: "Trích tiết kiệm ngay khi có thu nhập (thường 20%), phần còn lại mới chia tiếp cho Thiết yếu/Mong muốn — đảo ngược thứ tự so với cách chi tiêu trước rồi mới tiết kiệm phần dư.",
    whySplit: "Tiết kiệm hay bị hy sinh đầu tiên khi chi tiêu tăng nếu để \"tiết kiệm phần còn lại cuối tháng\" — trích trước loại bỏ hẳn rủi ro đó.",
    suitableFor: "Người có mục tiêu tiết kiệm/đầu tư rõ ràng, hay bị \"tiêu hết trước khi kịp để dành\".",
    customizeTip: "20% chỉ là mức khởi điểm — có thể tăng dần khi thu nhập tăng, hoặc giảm tạm thời trong tháng phát sinh chi phí lớn đã biết trước.",
  },
  kakeibo: {
    coreIdea: "Phương pháp sổ chi tiêu Nhật Bản, chia 4 nhóm: Thiết yếu 50%, Văn hoá & phát triển bản thân 15%, Mong muốn 25%, Phát sinh bất thường 10%.",
    whySplit: "Nhấn mạnh việc TỰ VẤN trước khi chi (Kakeibo gốc là hỏi 4 câu: có bao nhiêu tiền, muốn tiết kiệm bao nhiêu, tiêu vào đâu, cải thiện thế nào) hơn là chỉ áp tỷ lệ máy móc.",
    suitableFor: "Người thích ghi chép/phản tỉnh chi tiêu định kỳ, muốn cân bằng giữa hưởng thụ và phát triển bản thân chứ không chỉ tiết kiệm thuần tuý.",
    customizeTip: "Cuối mỗi tháng nên tự hỏi lại 4 câu gốc của Kakeibo thay vì chỉ nhìn vào % đã chia — tỷ lệ chỉ là điểm khởi đầu để đối chiếu.",
  },
  bare_bones: {
    coreIdea: "Gần như toàn bộ thu nhập (95%) dồn cho Thiết yếu, chỉ giữ 5% Mong muốn, KHÔNG trích tiết kiệm mới trong giai đoạn này.",
    whySplit: "Khi thu nhập giảm mạnh hoặc mất nguồn thu, ưu tiên số 1 là duy trì các nhu cầu sống còn — tạm dừng tiết kiệm/mở rộng để tránh thâm hụt.",
    suitableFor: "Giai đoạn thu nhập giảm đột ngột, mất việc tạm thời, hoặc đang xử lý một khoản chi khẩn cấp lớn.",
    customizeTip: "Chỉ nên dùng tạm thời — khi thu nhập ổn định trở lại, cân nhắc chuyển sang 50/30/20 hoặc Trả Bản Thân Trước để tiết kiệm quay lại.",
  },
  custom: {
    coreIdea: "Tự đặt tên và tỷ lệ % cho từng hạng mục theo đúng nhu cầu riêng, không theo bất kỳ công thức có sẵn nào.",
    whySplit: "Không phải ai cũng khớp với 1 trong các công thức chuẩn — hạng mục và ưu tiên tài chính của mỗi hộ gia đình khác nhau.",
    suitableFor: "Người đã quen với các công thức chuẩn và muốn điều chỉnh riêng, hoặc có hạng mục đặc thù không công thức nào bao quát đủ.",
    customizeTip: "Dùng nút \"Cân bằng về 100%\" sau khi thêm/sửa hạng mục để tránh tổng tỷ lệ bị lệch do làm tròn số.",
  },
};

function AllocationFormulaExplanation({ formula }: { formula: AllocationFormula }) {
  const content = FORMULA_EXPLANATION[formula];
  if (!content) return null;
  return (
    <div className="p-3 bg-indigo-50/60 dark:bg-indigo-500/10 border border-indigo-100 dark:border-indigo-500/25 rounded-xl text-xs text-(--sst-text-secondary) space-y-1.5 animate-fade-in">
      <p><strong className="text-indigo-700 dark:text-indigo-300">Ý tưởng cốt lõi:</strong> {content.coreIdea}</p>
      <p><strong className="text-indigo-700 dark:text-indigo-300">Vì sao chia vậy:</strong> {content.whySplit}</p>
      <p><strong className="text-indigo-700 dark:text-indigo-300">Phù hợp ai:</strong> {content.suitableFor}</p>
      <p><strong className="text-indigo-700 dark:text-indigo-300">Gợi ý tuỳ biến:</strong> {content.customizeTip}</p>
    </div>
  );
}

interface SmartAllocatorProps {
  isOwner?: boolean;
  // [T-S37, 09/08/2026] Nâng lên App.tsx (cùng cấp `activeTab`) để sống
  // được qua các lần đổi tab — trước đây là `useState` cục bộ trong
  // component này nên bị xoá sạch mỗi khi unmount (đổi tab, vì App.tsx
  // render kiểu conditional `{activeTab === "allocator" && (...)}`). Chỉ
  // mất khi F5/đóng trình duyệt (không dùng localStorage/sessionStorage —
  // đây là dữ liệu tạm của phiên làm việc, không phải nguồn sự thật tài
  // chính).
  lastApplySnapshot: ApplySnapshotEntry[] | null;
  setLastApplySnapshot: (snapshot: ApplySnapshotEntry[] | null) => void;
  isUndoing: boolean;
  setIsUndoing: (v: boolean) => void;
}

// [T-S37] Tách type ra ngoài component để App.tsx dùng chung được (khai báo
// state ở đó cần đúng type này).
export interface ApplySnapshotEntry {
  id: string;
  wasNew: boolean;
  prevLimitAmount: number | null;
  prevName: string;
  prevIcon: string | null;
}

// T-S06f bước 2/4 (09/08/2026) — trước đây SmartAllocator nhận `categories`
// qua props từ App.tsx, nhưng nguồn đó là state legacy (mock/localStorage/
// server.ts cũ), KHÔNG phải bảng `categories` thật trên Supabase mà
// BudgetLimits.tsx đang hiển thị — 2 màn hình lệch dữ liệu nhau. Bấm "Áp
// dụng" trước đây chỉ ghi vào state ảo đó, KHÔNG hề ghi lên Supabase, nên
// tính năng phân bổ hoàn toàn không có tác dụng thật. Sửa bằng cách tự đọc/
// tự ghi qua hook Supabase thật (`useCategories`/`useCreateCategory`/
// `useUpdateCategory`), đúng pattern `BudgetLimits.tsx` (T-S06e2) đã dùng —
// không còn nhận categories/onApplyLimits qua props.
const iconForCategoryName = (name: string): string => {
  const lower = name.toLowerCase();
  if (lower.includes("ăn") || lower.includes("uống") || lower.includes("cà phê") || lower.includes("cafe") || lower.includes("nhà hàng")) return "🍔";
  if (lower.includes("đi") || lower.includes("xe") || lower.includes("di chuyển") || lower.includes("bus") || lower.includes("taxi") || lower.includes("xăng")) return "🚗";
  if (lower.includes("nhà") || lower.includes("ở") || lower.includes("phòng") || lower.includes("thuê")) return "🏠";
  if (lower.includes("sức khỏe") || lower.includes("y tế") || lower.includes("thuốc") || lower.includes("bệnh")) return "💊";
  if (lower.includes("học") || lower.includes("sách") || lower.includes("trường") || lower.includes("study")) return "📚";
  if (lower.includes("mua") || lower.includes("sắm") || lower.includes("shopping")) return "🛒";
  if (lower.includes("tiết kiệm") || lower.includes("tích lũy") || lower.includes("tích luỹ") || lower.includes("heo") || lower.includes("quỹ")) return "🐖";
  if (lower.includes("giải trí") || lower.includes("chơi") || lower.includes("game") || lower.includes("phim")) return "🎮";
  return "📦";
};

// T-S38 (10/08/2026) — bộ danh mục CHI TIÊU mẫu built-in, chỉ dùng khi tài
// khoản CHƯA có category chi tiêu thật nào (`categories.length === 0`) cho 3
// công thức 50/30/20 / 6 lọ / Zero-based (KHÔNG áp dụng cho "custom" — nhánh
// đó vẫn giữ nguyên hành vi cũ dựa trên `customSuggestions`, chỉ khởi tạo
// được từ category thật). Tên chọn cố ý để khớp đúng các bộ từ khoá
// `essentialKws`/`wantsKws`/`savingsKws`/`eduKws` đã có sẵn bên dưới — không
// viết logic phân nhóm mới, tái dùng nguyên xi pipeline `matchesKeywords`.
// Có `id: ""` (không phải category thật) để tận dụng đúng nhánh "khớp theo
// categoryId" trong `handleApply` tự fallback qua khớp-theo-tên/tạo-mới khi
// `categoryId` rỗng (xem `cat.id || undefined` ở nơi dựng `items`).
type SampleCategory = { id: string; name: string; icon: string };
const SAMPLE_EXPENSE_CATEGORIES: SampleCategory[] = [
  // Nhóm Thiết yếu
  { id: "", name: "Ăn uống", icon: "🍔" },
  { id: "", name: "Thuê nhà", icon: "🏠" },
  { id: "", name: "Đi lại", icon: "🚗" },
  { id: "", name: "Điện nước", icon: "⚡" },
  { id: "", name: "Sức khỏe", icon: "💊" },
  // Nhóm Mong muốn
  { id: "", name: "Giải trí", icon: "🎮" },
  { id: "", name: "Mua sắm", icon: "🛒" },
  { id: "", name: "Cà phê", icon: "☕" },
  { id: "", name: "Du lịch", icon: "✈️" },
  // Nhóm Tiết kiệm & Khác
  { id: "", name: "Tiết kiệm & Đầu tư", icon: "🐖" },
  { id: "", name: "Học tập", icon: "📚" },
  { id: "", name: "Dự phòng phát sinh", icon: "📦" },
];

export default function SmartAllocator({
  isOwner: legacyIsOwnerProp = true,
  lastApplySnapshot,
  setLastApplySnapshot,
  isUndoing,
  setIsUndoing,
}: SmartAllocatorProps) {
  const { data: categoryRows = [] } = useCategories();
  const { scopeMode, householdId } = useDataScope();
  const userId = useCurrentUserId();
  const { data: household } = useHousehold();
  const { data: memberRows = [] } = useHouseholdMembers(household?.id);
  const currentMember = memberRows.find((m) => m.id === userId);

  // [BUGFIX T-S43 09/08/2026] Cùng lỗi gốc đã sửa ở `BudgetLimits.tsx`
  // 08/08/2026: prop `isOwner` truyền từ `App.tsx` dựa trên state legacy
  // (`household` cũ, mặc định `true` khi chưa có household thật) —
  // không đáng tin. Tính lại từ `household_role` thật (Supabase, cùng
  // pattern `isHouseholdOwner` ở BudgetLimits.tsx) — RBAC không đổi (chỉ
  // chủ hộ được Áp Dụng phân bổ ngân sách, CONSTITUTION §3 policy
  // `categories`). Tham số cũ đổi tên `legacyIsOwnerProp` (giữ lại để
  // không phá interface, không còn dùng) — xoá hẳn khi App.tsx bỏ truyền
  // (T-S37/T-S06f dọn App.tsx).
  const isOwner = scopeMode !== "household" || currentMember?.household_role === "owner";
  void legacyIsOwnerProp;
  const createCategoryMutation = useCreateCategory();
  const updateCategoryMutation = useUpdateCategory();
  const softDeleteCategoryMutation = useSoftDeleteCategory();
  // [T-S143] Trích tự động hàng tháng cho dòng gợi ý khớp từ khoá tiết
  // kiệm (vd "Tiết kiệm & Đầu tư") — key theo INDEX trong `suggestions`
  // (không theo categoryId vì dòng "Tự chọn"/category mới chưa có id lúc
  // đang chỉnh sửa). Reset khi Áp Dụng xong (xem `handleApply`).
  const createAutoContributionConfigMutation = useCreateAutoContributionConfig();
  const [autoContribByRow, setAutoContribByRow] = useState<Record<number, PendingCategoryAutoContribution | null>>({});

  // Phân bổ ngân sách chỉ có ý nghĩa cho danh mục CHI TIÊU (khớp đúng cách
  // BudgetLimits.tsx tính "đã chi" — không phân bổ % thu nhập cho 1 danh
  // mục thu nhập, vô nghĩa).
  const categories = useMemo(
    () => categoryRows.map(rowToCategory).filter((c) => c.type !== "income"),
    [categoryRows]
  );

  const buildScope = () =>
    scopeMode === "household" ? { household_id: householdId } : { owner_id: userId };

  const [incomeInput, setIncomeInput] = useState("15000000"); // Default 15 million
  // T-S41 — tự động điền "Tổng thu nhập tháng này" = tổng giao dịch
  // `type='income'` tháng hiện tại (tái dùng `getCurrentMonthIncomeStats`,
  // trích ra từ đúng cách tính của FinancialDashboard.tsx). Người dùng vẫn
  // sửa tay được — `incomeManuallyEdited` chặn không cho auto-fill ghi đè
  // lên giá trị họ vừa gõ (đúng AC "sửa tay → không bị ghi đè lại").
  const { data: transactionRows } = useTransactions();
  const [incomeManuallyEdited, setIncomeManuallyEdited] = useState(false);
  const currentMonthIncome = useMemo(
    () => getCurrentMonthIncomeStats(rowsToTransactions(transactionRows ?? [], categoryRows, memberRows)),
    [transactionRows, categoryRows, memberRows]
  );
  useEffect(() => {
    if (incomeManuallyEdited) return;
    setIncomeInput(currentMonthIncome.total > 0 ? String(currentMonthIncome.total) : "0");
  }, [currentMonthIncome.total, incomeManuallyEdited]);

  // [T-S51, CONSTITUTION §1.15 mục 3] Checkbox tuỳ chọn, mặc định TẮT —
  // "Gộp cả số dư luỹ kế vào tổng để phân bổ". KHÔNG lưu trạng thái bật/tắt
  // qua phiên khác (đúng AC — chỉ `useState` cục bộ, không localStorage).
  const [includeCumulativeBalance, setIncludeCumulativeBalance] = useState(false);
  // Dùng lại đúng danh sách transactions đã build ở trên (currentMonthIncome/
  // recentIncomeAverage) — không query/convert lại lần nữa.
  const allTransactions = useMemo(
    () => rowsToTransactions(transactionRows ?? [], categoryRows, memberRows),
    [transactionRows, categoryRows, memberRows]
  );
  // [T-S50/T-S51] Cùng hàm dùng chung `getCumulativeBalance` với
  // `FinancialDashboard.tsx` — đúng nguyên tắc "1 công thức tài chính, 1 hàm
  // dùng chung" (CONSTITUTION §5).
  const cumulativeBalance = useMemo(() => getCumulativeBalance(allTransactions), [allTransactions]);
  // [T-S51] Tổng DÙNG ĐỂ TÍNH % PHÂN BỔ — nguồn DUY NHẤT mọi nơi trong file
  // cần "tổng thu nhập" phải gọi hàm này (thay vì tự viết lại
  // `Number(incomeInput) || 0`), để bật/tắt checkbox có tác dụng NHẤT QUÁN
  // ở mọi công thức/mọi thao tác sửa %, không sót chỗ nào. Tắt checkbox →
  // trả về đúng giá trị gốc cũ (`Number(incomeInput) || 0`), không đổi hành
  // vi khi checkbox chưa từng được bật (đúng AC "không có sai lệch làm tròn
  // tích luỹ" khi tắt lại).
  const getAllocationTotal = () =>
    (Number(incomeInput) || 0) + (includeCumulativeBalance ? cumulativeBalance : 0);
  const [formula, setFormula] = useState<AllocationFormula>("50_30_20");
  // T-S41 điểm 3 — banner GỢI Ý (không tự động đổi, đúng CONSTITUTION §5)
  // khi thu nhập tự động điền của tháng hiện tại thấp hơn 50% so với trung
  // bình các tháng gần nhất CÓ dữ liệu thu nhập. So sánh dựa trên giá trị
  // TỰ TÍNH (`currentMonthIncome.total`), không phải giá trị người dùng đã
  // sửa tay trong ô nhập — đúng nghĩa "thu nhập tự động điền" trong AC.
  const recentIncomeAverage = useMemo(
    () => getRecentMonthsIncomeAverage(rowsToTransactions(transactionRows ?? [], categoryRows, memberRows)),
    [transactionRows, categoryRows, memberRows]
  );
  const showLowIncomeBanner =
    formula !== "bare_bones" &&
    recentIncomeAverage.monthsWithData > 0 &&
    currentMonthIncome.total > 0 &&
    currentMonthIncome.total < recentIncomeAverage.average * 0.5;
  const [suggestions, setSuggestions] = useState<AllocationItem[]>([]);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [isApplying, setIsApplying] = useState(false);
  // [T-S37] `isUndoing`/`lastApplySnapshot` giờ nhận qua props từ App.tsx
  // (xem giải thích ở khai báo `SmartAllocatorProps`), không còn khai báo
  // `useState` cục bộ ở đây nữa — sống được qua các lần đổi tab.
  // T-S35 — snapshot lần Áp Dụng gần nhất để "Hoàn tác": mỗi phần tử ghi lại
  // trạng thái TRƯỚC khi ghi, đủ để phục hồi — category có sẵn bị đổi
  // `limit_amount` (và `name` nếu có đổi) → trả lại giá trị cũ; category MỚI
  // tạo ra ở lần áp dụng đó → xoá mềm luôn (không phải "trả về rỗng", vì nó
  // không tồn tại trước khi áp dụng). Còn giữ tới khi Hoàn Tác chạy xong
  // (đổi ngữ nghĩa T-S37: KHÔNG còn bị ghi đè bởi các lần Áp Dụng kế tiếp
  // trong cùng phiên — xem `handleApply` bên dưới).
  const [customSuggestions, setCustomSuggestions] = useState<AllocationItem[]>([]);

  // Initialize customSuggestions once from categories
  useEffect(() => {
    if (customSuggestions.length === 0 && categories.length > 0) {
      const totalLimits = categories.reduce((sum, c) => sum + (c.limitAmount || 0), 0);
      let items: AllocationItem[] = [];
      if (totalLimits > 0) {
        let pctSum = 0;
        items = categories.map((cat, idx) => {
          const currentLimit = cat.limitAmount || 0;
          let percent = Math.round((currentLimit / totalLimits) * 100);
          if (idx === categories.length - 1) {
            percent = 100 - pctSum;
          } else {
            pctSum += percent;
          }
          percent = Math.max(0, percent);
          return {
            categoryName: cat.name,
            categoryId: cat.id,
            percent,
            suggestedAmount: 0,
            description: `Tự chọn phân bổ ngân sách riêng cho mục ${cat.name}`,
            icon: cat.icon,
          };
        });
      } else {
        const count = categories.length || 1;
        const pct = Math.floor(100 / count);
        const remainingPct = 100 - pct * count;
        items = categories.map((cat, idx) => {
          const itemPct = idx === 0 ? pct + remainingPct : pct;
          return {
            categoryName: cat.name,
            categoryId: cat.id,
            percent: itemPct,
            suggestedAmount: 0,
            description: `Tự chọn phân bổ ngân sách riêng cho mục ${cat.name}`,
            icon: cat.icon,
          };
        });
      }
      setCustomSuggestions(items);
    }
  }, [categories, customSuggestions.length]);

  const handleAddCustomItem = () => {
    setCustomSuggestions((prev) => [
      ...prev,
      {
        categoryName: `Hạng mục mới ${prev.length + 1}`,
        percent: 10,
        suggestedAmount: 0,
        description: "Hạng mục phân bổ tự chọn bổ sung",
      },
    ]);
  };

  const handleDeleteCustomItem = (index: number) => {
    setCustomSuggestions((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleUpdateCustomItem = (index: number, field: keyof AllocationItem, value: any) => {
    setCustomSuggestions((prev) => {
      const updated = [...prev];
      updated[index] = {
        ...updated[index],
        [field]: value,
      };
      return updated;
    });
  };

  // [T-S55 11/08/2026] Trước chỉ áp cho "custom" (`customSuggestions`).
  // Mở rộng: mọi công thức mẫu đều cho sửa tay % từng dòng qua
  // `handleUpdatePercent` (ghi thẳng vào `suggestions`, không đi qua
  // `calculateAllocation` nữa) — nếu người dùng tự chỉnh làm lệch khỏi
  // 100%, cần cùng 1 nút "Cân bằng về 100%" để hỗ trợ, không riêng gì
  // "Tự chọn". Nhánh "custom" giữ NGUYÊN hành vi cũ (chỉnh
  // `customSuggestions`, `calculateAllocation` tự đồng bộ lại
  // `suggestions`/`suggestedAmount` qua effect có sẵn) — nhánh còn lại
  // chỉnh thẳng `suggestions` + tự tính lại `suggestedAmount` tại đây
  // (không có effect nào làm hộ vì `suggestions` không nằm trong deps).
  const handleNormalizePercentages = () => {
    const totalIncome = getAllocationTotal();
    const source = formula === "custom" ? customSuggestions : suggestions;
    if (source.length === 0) return;

    const totalCurrentPct = source.reduce((sum, item) => sum + item.percent, 0);

    const applyEqualSplit = () => {
      const count = source.length;
      const pct = Math.floor(100 / count);
      const remainingPct = 100 - pct * count;
      return source.map((item, idx) => {
        const percent = idx === 0 ? pct + remainingPct : pct;
        return {
          ...item,
          percent,
          ...(formula === "custom" ? {} : { suggestedAmount: (totalIncome * percent) / 100 }),
        };
      });
    };

    const applyScaled = () => {
      let allocatedSum = 0;
      return source.map((item, idx) => {
        let scaledPct = Math.round((item.percent / totalCurrentPct) * 100);
        if (idx === source.length - 1) {
          scaledPct = 100 - allocatedSum;
        } else {
          allocatedSum += scaledPct;
        }
        const percent = Math.max(0, scaledPct);
        return {
          ...item,
          percent,
          ...(formula === "custom" ? {} : { suggestedAmount: (totalIncome * percent) / 100 }),
        };
      });
    };

    const updated = totalCurrentPct === 0 ? applyEqualSplit() : applyScaled();

    if (formula === "custom") {
      setCustomSuggestions(updated);
    } else {
      setSuggestions(updated);
    }
  };

  const calculateAllocation = () => {
    const totalIncome = getAllocationTotal();
    if (totalIncome <= 0) {
      setSuggestions([]);
      return;
    }
    // [T-S38 10/08/2026] "custom" giữ NGUYÊN hành vi cũ — không có category
    // chi tiêu thật nào thì không có gì để gợi ý (nhánh này đọc từ
    // `customSuggestions`, chỉ khởi tạo được từ category thật, không phải
    // chỗ áp dụng bộ mẫu). 3 công thức còn lại mới dùng bộ mẫu khi rỗng.
    if (formula === "custom" && categories.length === 0) {
      setSuggestions([]);
      return;
    }
    // [T-S38] Chưa có category chi tiêu thật nào (và không phải "custom") →
    // dùng bộ mẫu built-in làm nguồn cho đúng pipeline phân nhóm theo từ
    // khoá bên dưới, KHÔNG viết lại logic phân nhóm riêng cho mẫu.
    const sourceCategories: { id: string; name: string; icon: string }[] =
      categories.length === 0 ? SAMPLE_EXPENSE_CATEGORIES : categories;

    let items: AllocationItem[] = [];

    // Helper to match keywords
    const matchesKeywords = (name: string, keywords: string[]) => {
      const lower = name.toLowerCase();
      return keywords.some((kw) => lower.includes(kw));
    };

    const essentialKws = ["ăn", "uống", "nhà", "ở", "đi lại", "di chuyển", "xe", "sức khỏe", "y tế", "điện", "nước", "gas", "phòng", "nhà trọ", "tiền điện", "tiền nước"];
    const wantsKws = ["giải trí", "mua sắm", "shopping", "du lịch", "cà phê", "cafe", "tiệc", "nhậu", "quà", "chơi", "trí", "sắm", "mua"];
    const savingsKws = ["tích lũy", "tiết kiệm", "heo đất", "đầu tư", "quỹ", "dành", "để dành"];
    const eduKws = ["học", "sách", "giáo dục", "tập", "khóa học", "study"];

    if (formula === "50_30_20") {
      // Essentials (50%), Wants (30%), Savings & Others (20%)
      const essentials = sourceCategories.filter((c) => matchesKeywords(c.name, essentialKws));
      const wants = sourceCategories.filter((c) => matchesKeywords(c.name, wantsKws));
      const savings = sourceCategories.filter((c) => matchesKeywords(c.name, savingsKws));
      const others = sourceCategories.filter((c) => !essentials.includes(c) && !wants.includes(c) && !savings.includes(c));

      const eCount = essentials.length;
      const wCount = wants.length;
      const sCount = savings.length;
      const oCount = others.length;

      // Distribute 50% to essentials
      const ePctEach = eCount > 0 ? Math.floor(50 / eCount) : 0;
      const eRem = eCount > 0 ? 50 - ePctEach * eCount : 0;

      // Distribute 30% to wants
      const wPctEach = wCount > 0 ? Math.floor(30 / wCount) : 0;
      const wRem = wCount > 0 ? 30 - wPctEach * wCount : 0;

      // Distribute 20% to savings + others
      const totalSavingsOthersCount = sCount + oCount;
      const sPctEach = totalSavingsOthersCount > 0 ? Math.floor(20 / totalSavingsOthersCount) : 0;
      const sRem = totalSavingsOthersCount > 0 ? 20 - sPctEach * totalSavingsOthersCount : 0;

      let sCountSoFar = 0;

      items = sourceCategories.map((cat) => {
        let percent = 0;
        let desc = "";

        if (essentials.includes(cat)) {
          const isLast = essentials[essentials.length - 1] === cat;
          percent = ePctEach + (isLast ? eRem : 0);
          desc = "Nhu cầu Thiết yếu (Thuộc nhóm 50% ăn uống, nhà ở, xe cộ, sức khoẻ...)";
        } else if (wants.includes(cat)) {
          const isLast = wants[wants.length - 1] === cat;
          percent = wPctEach + (isLast ? wRem : 0);
          desc = "Mong muốn Cá nhân (Thuộc nhóm 30% giải trí, mua sắm, du lịch, thưởng thức...)";
        } else {
          const isLast = sCountSoFar === totalSavingsOthersCount - 1;
          percent = sPctEach + (isLast ? sRem : 0);
          desc = savings.includes(cat)
            ? "Tích lũy & Tiết kiệm (Thuộc nhóm 20% tích luỹ tương lai, đầu tư...)"
            : "Phát triển bản thân / Khác (Thuộc nhóm 20% học tập, dự phòng phát sinh...)";
          sCountSoFar++;
        }

        return {
          categoryName: cat.name,
          categoryId: cat.id || undefined,
          icon: cat.icon,
          percent,
          suggestedAmount: (totalIncome * percent) / 100,
          description: desc,
        };
      });

    } else if (formula === "6_jars") {
      // NEC (55%), FFA (10%), LTSS (10%), EDU (10%), PLAY (10%), GIVE (5%)
      const necCats = sourceCategories.filter((c) => matchesKeywords(c.name, essentialKws));
      const eduCats = sourceCategories.filter((c) => matchesKeywords(c.name, eduKws));
      const playCats = sourceCategories.filter((c) => matchesKeywords(c.name, wantsKws));
      const savingsCats = sourceCategories.filter((c) => matchesKeywords(c.name, savingsKws));
      const remainingCats = sourceCategories.filter(
        (c) =>
          !necCats.includes(c) &&
          !eduCats.includes(c) &&
          !playCats.includes(c) &&
          !savingsCats.includes(c)
      );

      // Nec count
      const nPct = necCats.length > 0 ? Math.floor(55 / necCats.length) : 0;
      const nRem = necCats.length > 0 ? 55 - nPct * necCats.length : 0;

      // Edu count
      const ePct = eduCats.length > 0 ? Math.floor(10 / eduCats.length) : 0;
      const eRem = eduCats.length > 0 ? 10 - ePct * eduCats.length : 0;

      // Play count
      const pPct = playCats.length > 0 ? Math.floor(10 / playCats.length) : 0;
      const pRem = playCats.length > 0 ? 10 - pPct * playCats.length : 0;

      // Savings (FFA + LTSS = 20%)
      const sPct = savingsCats.length > 0 ? Math.floor(20 / savingsCats.length) : 0;
      const sRem = savingsCats.length > 0 ? 20 - sPct * savingsCats.length : 0;

      // Give/Others (5%)
      const rPct = remainingCats.length > 0 ? Math.floor(5 / remainingCats.length) : 0;
      const rRem = remainingCats.length > 0 ? 5 - rPct * remainingCats.length : 0;

      items = sourceCategories.map((cat) => {
        let percent = 0;
        let desc = "";

        if (necCats.includes(cat)) {
          const isLast = necCats[necCats.length - 1] === cat;
          percent = nPct + (isLast ? nRem : 0);
          desc = "Lọ Thiết yếu NEC - 55% (Ăn uống, Nhà ở, Hóa đơn điện nước...)";
        } else if (eduCats.includes(cat)) {
          const isLast = eduCats[eduCats.length - 1] === cat;
          percent = ePct + (isLast ? eRem : 0);
          desc = "Lọ Giáo dục EDU - 10% (Sách vở, Khóa học ngoại ngữ, phát triển...)";
        } else if (playCats.includes(cat)) {
          const isLast = playCats[playCats.length - 1] === cat;
          percent = pPct + (isLast ? pRem : 0);
          desc = "Lọ Hưởng thụ PLAY - 10% (Giải trí, Du lịch, Spa, Cafe quán xá...)";
        } else if (savingsCats.includes(cat)) {
          const isLast = savingsCats[savingsCats.length - 1] === cat;
          percent = sPct + (isLast ? sRem : 0);
          desc = "Lọ Tiết kiệm LTSS & Tự do FFA - 20% (Quỹ dự phòng, đầu tư, để dành...)";
        } else {
          const isLast = remainingCats[remainingCats.length - 1] === cat;
          percent = rPct + (isLast ? rRem : 0);
          desc = "Lọ Từ thiện & Khác GIVE - 5% (Sẻ chia, quà cáp, đám tiệc phát sinh...)";
        }

        return {
          categoryName: cat.name,
          categoryId: cat.id || undefined,
          icon: cat.icon,
          percent,
          suggestedAmount: (totalIncome * percent) / 100,
          description: desc,
        };
      });

    } else if (formula === "zero_based") {
      // Equal split among active user categories
      const count = sourceCategories.length || 1;
      const pct = Math.floor(100 / count);
      const remainingPct = 100 - pct * count;

      items = sourceCategories.map((cat, idx) => {
        const itemPct = idx === 0 ? pct + remainingPct : pct;
        return {
          categoryName: cat.name,
          categoryId: cat.id || undefined,
          icon: cat.icon,
          percent: itemPct,
          suggestedAmount: (totalIncome * itemPct) / 100,
          description: `Ngân sách Zero-based: Cân đối chi tiết 100% cho mục ${cat.name}`,
        };
      });

    } else if (formula === "pay_yourself_first") {
      // [T-S39 10/08/2026] "Trả Bản Thân Trước" — trích Tiết kiệm & Đầu tư
      // 20% TRƯỚC, phần còn lại 80% chia tiếp 50% Thiết yếu / 30% Mong muốn
      // TRÊN PHẦN CÒN LẠI đó (quy đổi ra % trên tổng thu nhập: Thiết yếu
      // 40% / Mong muốn 24% / Tiết kiệm 20%). 50%+30%=80% chỉ dùng hết 80%
      // của phần 80% còn lại (= 64% tổng thu nhập), phần dư 16% (đã CHỐT
      // PRD/CONSTITUTION §1.9 khu vực T-S39) GỘP VÀO Thiết yếu theo tỷ lệ
      // → Thiết yếu thật sự = 40% + 16% = 56%. Danh mục KHÔNG khớp nhóm nào
      // (essential/wants/savings) cũng gộp chung vào nhóm Thiết yếu (đúng
      // tinh thần "phần dư gộp vào Thiết yếu"), giống cách 50/30/20 gộp
      // "others" vào nhóm Tiết kiệm.
      const ESSENTIAL_PYF_PCT = 56;
      const WANTS_PYF_PCT = 24;
      const SAVINGS_PYF_PCT = 20;

      const savingsPyf = sourceCategories.filter((c) => matchesKeywords(c.name, savingsKws));
      const wantsPyf = sourceCategories.filter(
        (c) => !savingsPyf.includes(c) && matchesKeywords(c.name, wantsKws)
      );
      const essentialPyf = sourceCategories.filter((c) => !savingsPyf.includes(c) && !wantsPyf.includes(c));

      const ePctEach = essentialPyf.length > 0 ? Math.floor(ESSENTIAL_PYF_PCT / essentialPyf.length) : 0;
      const eRem = essentialPyf.length > 0 ? ESSENTIAL_PYF_PCT - ePctEach * essentialPyf.length : 0;
      const wPctEach = wantsPyf.length > 0 ? Math.floor(WANTS_PYF_PCT / wantsPyf.length) : 0;
      const wRem = wantsPyf.length > 0 ? WANTS_PYF_PCT - wPctEach * wantsPyf.length : 0;
      const sPctEach = savingsPyf.length > 0 ? Math.floor(SAVINGS_PYF_PCT / savingsPyf.length) : 0;
      const sRem = savingsPyf.length > 0 ? SAVINGS_PYF_PCT - sPctEach * savingsPyf.length : 0;

      items = sourceCategories.map((cat) => {
        let percent = 0;
        let desc = "";
        if (savingsPyf.includes(cat)) {
          const isLast = savingsPyf[savingsPyf.length - 1] === cat;
          percent = sPctEach + (isLast ? sRem : 0);
          desc = "Tiết kiệm & Đầu tư - 20% (trích NGAY khi có thu nhập, trước cả chi tiêu — đúng tinh thần 'Trả Bản Thân Trước')";
        } else if (wantsPyf.includes(cat)) {
          const isLast = wantsPyf[wantsPyf.length - 1] === cat;
          percent = wPctEach + (isLast ? wRem : 0);
          desc = "Mong muốn Cá nhân - 24% (giải trí, mua sắm, du lịch... chia trên phần thu nhập còn lại sau khi đã trích tiết kiệm)";
        } else {
          const isLast = essentialPyf[essentialPyf.length - 1] === cat;
          percent = ePctEach + (isLast ? eRem : 0);
          desc = "Nhu cầu Thiết yếu - 56% (ăn uống, nhà ở, đi lại... gồm cả phần dư chưa phân bổ, gộp vào nhóm này)";
        }
        return {
          categoryName: cat.name,
          categoryId: cat.id || undefined,
          icon: cat.icon,
          percent,
          suggestedAmount: (totalIncome * percent) / 100,
          description: desc,
        };
      });
    } else if (formula === "kakeibo") {
      // [T-S39 10/08/2026] Kakeibo (kế toán chi tiêu Nhật Bản) — 4 nhóm:
      // Thiết yếu 50% / Văn hoá & phát triển bản thân 15% / Mong muốn 25% /
      // Phát sinh bất thường 10%. Nhóm "Văn hoá" tái dùng eduKws + bổ sung
      // từ khoá giải trí tinh thần/sách; nhóm "Phát sinh bất thường" là
      // nhóm từ khoá MỚI (hiếu hỉ, sửa chữa, quà, phát sinh) — kiểm tra
      // TRƯỚC nhóm Mong muốn để "quà"/"quà tặng" rơi đúng nhóm Phát sinh
      // bất thường thay vì bị wantsKws ("quà") bắt trước (đúng AC T-S39).
      // Danh mục KHÔNG khớp nhóm nào cũng gộp vào "Phát sinh bất thường"
      // (nhóm bắt tất, cùng tinh thần "others" ở các công thức khác).
      const cultureKws = [...eduKws, "văn hóa", "văn hoá", "phim", "âm nhạc", "đọc sách"];
      const unexpectedKws = ["hiếu hỉ", "sửa chữa", "quà", "phát sinh"];

      const necCats = sourceCategories.filter((c) => matchesKeywords(c.name, essentialKws));
      const unexpectedCats = sourceCategories.filter(
        (c) => !necCats.includes(c) && matchesKeywords(c.name, unexpectedKws)
      );
      const cultureCats = sourceCategories.filter(
        (c) => !necCats.includes(c) && !unexpectedCats.includes(c) && matchesKeywords(c.name, cultureKws)
      );
      const wantsKakeiboCats = sourceCategories.filter(
        (c) =>
          !necCats.includes(c) &&
          !unexpectedCats.includes(c) &&
          !cultureCats.includes(c) &&
          matchesKeywords(c.name, wantsKws)
      );
      const remainderCats = sourceCategories.filter(
        (c) =>
          !necCats.includes(c) &&
          !unexpectedCats.includes(c) &&
          !cultureCats.includes(c) &&
          !wantsKakeiboCats.includes(c)
      );
      // Nhóm bắt-tất "Phát sinh bất thường" = khớp từ khoá + phần dư không khớp nhóm nào.
      const unexpectedGroup = [...unexpectedCats, ...remainderCats];

      const NEC_PCT = 50;
      const CULTURE_PCT = 15;
      const WANTS_PCT = 25;
      const UNEXPECTED_PCT = 10;

      const nPctEach = necCats.length > 0 ? Math.floor(NEC_PCT / necCats.length) : 0;
      const nRem = necCats.length > 0 ? NEC_PCT - nPctEach * necCats.length : 0;
      const cPctEach = cultureCats.length > 0 ? Math.floor(CULTURE_PCT / cultureCats.length) : 0;
      const cRem = cultureCats.length > 0 ? CULTURE_PCT - cPctEach * cultureCats.length : 0;
      const wPctEach = wantsKakeiboCats.length > 0 ? Math.floor(WANTS_PCT / wantsKakeiboCats.length) : 0;
      const wRem = wantsKakeiboCats.length > 0 ? WANTS_PCT - wPctEach * wantsKakeiboCats.length : 0;
      const uPctEach = unexpectedGroup.length > 0 ? Math.floor(UNEXPECTED_PCT / unexpectedGroup.length) : 0;
      const uRem = unexpectedGroup.length > 0 ? UNEXPECTED_PCT - uPctEach * unexpectedGroup.length : 0;

      items = sourceCategories.map((cat) => {
        let percent = 0;
        let desc = "";
        if (necCats.includes(cat)) {
          const isLast = necCats[necCats.length - 1] === cat;
          percent = nPctEach + (isLast ? nRem : 0);
          desc = "Thiết yếu - 50% (ăn uống, nhà ở, đi lại, sức khoẻ, hoá đơn điện nước...)";
        } else if (cultureCats.includes(cat)) {
          const isLast = cultureCats[cultureCats.length - 1] === cat;
          percent = cPctEach + (isLast ? cRem : 0);
          desc = "Văn hoá & Phát triển bản thân - 15% (sách, học tập, phim, âm nhạc, giải trí tinh thần...)";
        } else if (wantsKakeiboCats.includes(cat)) {
          const isLast = wantsKakeiboCats[wantsKakeiboCats.length - 1] === cat;
          percent = wPctEach + (isLast ? wRem : 0);
          desc = "Mong muốn - 25% (mua sắm, du lịch, cà phê, tiệc tùng...)";
        } else {
          const isLast = unexpectedGroup[unexpectedGroup.length - 1] === cat;
          percent = uPctEach + (isLast ? uRem : 0);
          desc = "Phát sinh bất thường - 10% (hiếu hỉ, sửa chữa, quà cáp, chi phí phát sinh ngoài kế hoạch...)";
        }
        return {
          categoryName: cat.name,
          categoryId: cat.id || undefined,
          icon: cat.icon,
          percent,
          suggestedAmount: (totalIncome * percent) / 100,
          description: desc,
        };
      });
    } else if (formula === "bare_bones") {
      // [T-S41 11/08/2026] "Ngân sách Tối giản/Khẩn cấp" (bare-bones) — cho
      // tình huống mất/giảm mạnh nguồn thu. 95% Thiết yếu / 5% Mong muốn,
      // KHÔNG có nhóm Tiết kiệm riêng (đúng yêu cầu "không trích tiết kiệm
      // mới ở công thức này") — category tên có từ khoá tiết kiệm
      // (`savingsKws`) VẪN bị gộp vào nhóm Thiết yếu ở đây, không được cấp
      // % riêng như các công thức khác, cùng tinh thần "others gộp vào
      // nhóm bắt-tất" đã dùng ở 50/30/20/Kakeibo.
      const ESSENTIAL_BB_PCT = 95;
      const WANTS_BB_PCT = 5;

      const wantsBB = sourceCategories.filter((c) => matchesKeywords(c.name, wantsKws));
      const essentialBB = sourceCategories.filter((c) => !wantsBB.includes(c));

      const ePctEach = essentialBB.length > 0 ? Math.floor(ESSENTIAL_BB_PCT / essentialBB.length) : 0;
      const eRem = essentialBB.length > 0 ? ESSENTIAL_BB_PCT - ePctEach * essentialBB.length : 0;
      const wPctEach = wantsBB.length > 0 ? Math.floor(WANTS_BB_PCT / wantsBB.length) : 0;
      const wRem = wantsBB.length > 0 ? WANTS_BB_PCT - wPctEach * wantsBB.length : 0;

      items = sourceCategories.map((cat) => {
        let percent = 0;
        let desc = "";
        if (wantsBB.includes(cat)) {
          const isLast = wantsBB[wantsBB.length - 1] === cat;
          percent = wPctEach + (isLast ? wRem : 0);
          desc = "Mong muốn - 5% (chỉ giữ mức tối thiểu, ưu tiên gần như toàn bộ cho Thiết yếu trong giai đoạn thu nhập thấp/khẩn cấp)";
        } else {
          const isLast = essentialBB[essentialBB.length - 1] === cat;
          percent = ePctEach + (isLast ? eRem : 0);
          desc = "Thiết yếu - 95% (ăn uống, nhà ở, đi lại, sức khoẻ, hoá đơn... không trích tiết kiệm mới trong giai đoạn này)";
        }
        return {
          categoryName: cat.name,
          categoryId: cat.id || undefined,
          icon: cat.icon,
          percent,
          suggestedAmount: (totalIncome * percent) / 100,
          description: desc,
        };
      });
    } else if (formula === "custom") {
      const totalIncome = getAllocationTotal();
      items = customSuggestions.map((item) => ({
        ...item,
        suggestedAmount: (totalIncome * item.percent) / 100,
      }));
    }

    // [T-S55 11/08/2026] Bảo đảm tổng LUÔN đúng 100% cho mọi công thức mẫu
    // (khác "custom" — công thức đó đã có nút "Cân bằng về 100%" riêng,
    // không tự động đụng vào để giữ đúng CONSTITUTION §5 "không tự quyết").
    // Gap gốc: 1 vài công thức (6 lọ, Kakeibo, Trả Bản Thân Trước, Tối
    // giản/Khẩn cấp, và cả 50/30/20 ở 2 nhóm không có "others" đỡ) định
    // nghĩa NHIỀU nhóm % cố định theo từ khoá — nếu danh mục thật của
    // người dùng không có category nào khớp 1 nhóm nào đó, % của nhóm đó
    // bị rớt hẳn (vd GIVE 5% ở 6 lọ không có category "Từ thiện/Khác" nào
    // → tổng chỉ còn 95%). Xử lý CHỐT (xem CHANGELOG "T-S55" — người yêu
    // cầu chọn phương án "chia đều cho TẤT CẢ danh mục hiện có"): phần %
    // bị thiếu so với 100% được chia đều cho MỌI danh mục đang hiển thị
    // (không riêng nhóm bị rớt), cùng pattern floor + phần dư dồn vào mục
    // cuối đã dùng nhất quán trong toàn file. Chỉ cộng thêm khi tổng ĐANG
    // THIẾU (< 100) — tổng đã đủ/không có danh mục nào thì bỏ qua, không
    // trừ bớt của ai (an toàn 2 chiều, dù nhánh vượt 100% đã được vá ở
    // T-S54 nên trên thực tế không còn xảy ra).
    if (formula !== "custom" && items.length > 0) {
      const currentTotalPct = items.reduce((sum, it) => sum + it.percent, 0);
      const shortfallPct = 100 - currentTotalPct;
      if (shortfallPct > 0) {
        const bonusEach = Math.floor(shortfallPct / items.length);
        const bonusRem = shortfallPct - bonusEach * items.length;
        items = items.map((it, idx) => {
          const bonus = bonusEach + (idx === items.length - 1 ? bonusRem : 0);
          const newPercent = it.percent + bonus;
          return {
            ...it,
            percent: newPercent,
            suggestedAmount: (totalIncome * newPercent) / 100,
          };
        });
      }
    }

    setSuggestions(items);
  };

  useEffect(() => {
    calculateAllocation();
  }, [incomeInput, formula, categories, customSuggestions, includeCumulativeBalance, cumulativeBalance]);

  const handleUpdatePercent = (index: number, newPercent: number) => {
    const val = Math.max(0, Math.min(100, isNaN(newPercent) ? 0 : newPercent));
    const totalIncome = getAllocationTotal();
    if (formula === "custom") {
      setCustomSuggestions((prev) => {
        const updated = [...prev];
        updated[index] = {
          ...updated[index],
          percent: val,
          suggestedAmount: (totalIncome * val) / 100,
        };
        return updated;
      });
    } else {
      const updated = [...suggestions];
      updated[index] = {
        ...updated[index],
        percent: val,
        suggestedAmount: (totalIncome * val) / 100,
        categoryName: updated[index].categoryName,
        description: updated[index].description,
      };
      setSuggestions(updated);
    }
  };

  const handleApply = async () => {
    if (suggestions.length === 0 || isApplying) return;
    setApplyError(null);
    setIsApplying(true);

    try {
      // T-S35 — dựng theo TỪNG DÒNG `suggestions` (không gộp qua limitsMap
      // theo tên nữa) để dùng được `categoryId` khi có, tránh bug tạo trùng
      // category nếu người dùng đổi tên hiển thị của 1 dòng vốn bắt nguồn từ
      // category có sẵn (T-S06f bước 2/4 dùng khớp-theo-tên gây ra bug này).
      // Khớp theo id trước — chỉ fallback khớp theo tên cho dòng KHÔNG có id
      // (dòng "Tự chọn" người dùng tự thêm mới). Dedupe theo id/tên đã xử lý
      // trong vòng lặp để 2 dòng trùng không ghi 2 lần.
      const processedIds = new Set<string>();
      const processedNames = new Set<string>();
      const snapshot: ApplySnapshotEntry[] = [];
      // [T-S37] Đổi ngữ nghĩa: snapshot chỉ đại diện đúng mốc TRƯỚC lần Áp
      // Dụng ĐẦU TIÊN của 1 "phiên sạch" (lastApplySnapshot đang null). Nếu
      // đã có snapshot đang giữ (từ 1 lần Áp Dụng trước đó chưa Hoàn tác),
      // không được ghi đè prev-value của các category ĐÃ có trong snapshot
      // cũ — giữ nguyên mốc gốc đó, chỉ BỔ SUNG entry cho category/dòng MỚI
      // lần này chưa từng xuất hiện trong snapshot cũ (kể cả category mới
      // tạo ở lần này, hoặc category có sẵn nhưng lần trước chưa đụng tới).
      const priorSnapshotIds = new Set((lastApplySnapshot ?? []).map((e) => e.id));

      for (const [idx, item] of suggestions.entries()) {
        const trimmedName = item.categoryName.trim();
        if (!trimmedName) continue;
        const roundedAmount = Math.round(item.suggestedAmount);
        // [T-S143] Nơi duy nhất biết được category id THẬT của dòng này sau
        // khi Áp Dụng (có sẵn nếu khớp category cũ, hoặc `created.id` nếu
        // vừa tạo mới) — set ở 3 nhánh bên dưới, dùng ở cuối vòng lặp.
        let resolvedCategoryId: string | null = null;

        if (item.categoryId) {
          if (processedIds.has(item.categoryId)) continue;
          processedIds.add(item.categoryId);
          const existing = categories.find((c) => c.id === item.categoryId);
          if (!existing) continue; // category đã bị xoá giữa chừng — bỏ qua an toàn
          resolvedCategoryId = existing.id;
          const nameChanged = existing.name.trim() !== trimmedName;
          snapshot.push({
            id: existing.id,
            wasNew: false,
            prevLimitAmount: existing.limitAmount ?? null,
            prevName: existing.name,
            prevIcon: existing.icon ?? null,
          });
          await updateCategoryMutation.mutateAsync({
            id: existing.id,
            patch: {
              limit_amount: roundedAmount,
              // [T-S44 bugfix 09/08/2026] Trước chỉ truyền limit_amount/name,
              // bỏ sót icon người dùng chọn tay qua IconPicker ở dòng
              // "Tự chọn" khi category đó KHỚP category đã có sẵn (theo
              // categoryId) — số tiền/tên cập nhật đúng nhưng icon vẫn giữ
              // icon cũ bên Ngân sách. Chỉ ghi đè khi item có icon (không
              // ghi đè icon cũ về rỗng cho các item không đi qua IconPicker,
              // vd item khớp category có sẵn qua gợi ý tự động không đổi icon).
              ...(item.icon ? { icon: item.icon } : {}),
              ...(nameChanged ? { name: trimmedName } : {}),
            },
          });
        } else {
          const lowerName = trimmedName.toLowerCase();
          if (processedNames.has(lowerName)) continue;
          processedNames.add(lowerName);
          const existing = categories.find((c) => c.name.trim().toLowerCase() === lowerName);
          if (existing) {
            if (processedIds.has(existing.id)) continue;
            processedIds.add(existing.id);
            resolvedCategoryId = existing.id;
            snapshot.push({
              id: existing.id,
              wasNew: false,
              prevLimitAmount: existing.limitAmount ?? null,
              prevName: existing.name,
              prevIcon: existing.icon ?? null,
            });
            await updateCategoryMutation.mutateAsync({
              id: existing.id,
              // [T-S44 bugfix 09/08/2026] Cùng lý do ở nhánh khớp theo
              // categoryId phía trên — nhánh này khớp category có sẵn theo
              // TÊN trùng (case-insensitive), cũng bỏ sót icon.
              patch: { limit_amount: roundedAmount, ...(item.icon ? { icon: item.icon } : {}) },
            });
          } else {
            if (!userId) continue;
            const created = await createCategoryMutation.mutateAsync({
              ...buildScope(),
              name: trimmedName,
              icon: item.icon || iconForCategoryName(trimmedName),
              type: "expense",
              limit_amount: roundedAmount,
              is_recurring: true,
              created_by: userId,
            });
            if (created?.id) {
              resolvedCategoryId = created.id;
              snapshot.push({ id: created.id, wasNew: true, prevLimitAmount: null, prevName: trimmedName, prevIcon: null });
            }
          }
        }

        // [T-S143] Tạo config trích tự động hàng tháng cho dòng này NẾU
        // người dùng đã bật (state theo idx) — chỉ hợp lệ khi id thật đã
        // resolve được (không tạo config cho dòng bị `continue` bỏ qua ở
        // trên). [27/08/2026 — BỎ gating từ khoá theo phản hồi người dùng]
        // Tạo cho MỌI dòng có bật toggle, không cần tên khớp từ khoá tiết
        // kiệm nữa — người dùng có thể muốn trích tự động cho bất kỳ
        // category nào (VD "Xe máy", "Học phí con"...), không chỉ tiết kiệm.
        const pendingAuto = autoContribByRow[idx];
        if (pendingAuto && resolvedCategoryId) {
          try {
            await createAutoContributionConfigMutation.mutateAsync({
              categoryId: resolvedCategoryId,
              triggerType: "monthly_schedule",
              amountType: pendingAuto.amountType,
              amountValue: pendingAuto.amountValue,
              dayOfMonth: pendingAuto.dayOfMonth,
            });
          } catch (autoErr: any) {
            // Không rollback phần phân bổ ngân sách đã áp dụng thành công —
            // chỉ báo riêng lỗi phần trích tự động (đúng yêu cầu "thông báo
            // đầy đủ... sau khi đã làm" của T-S143).
            setApplyError(
              `Đã áp dụng ngân sách, nhưng KHÔNG bật được trích tự động cho "${trimmedName}": ${
                autoErr?.message || "lỗi không xác định"
              }.`
            );
          }
        }
      }

      // [T-S37] Merge với snapshot cũ (nếu đang giữ) thay vì ghi đè — chỉ
      // thêm entry cho id CHƯA có trong snapshot cũ, giữ nguyên prev-value
      // gốc của các entry đã có từ lần Áp Dụng trước trong cùng phiên.
      const mergedSnapshot = lastApplySnapshot
        ? [...lastApplySnapshot, ...snapshot.filter((e) => !priorSnapshotIds.has(e.id))]
        : snapshot;
      setLastApplySnapshot(mergedSnapshot);
      setAutoContribByRow({});
      setSuccessMsg("Đã áp dụng hạn mức chi tiêu thành công trực tiếp cho ngân sách của bạn!");
    } catch (err: any) {
      // [T-S114, 19/08/2026] Mã 23505 = Postgres chặn tạo category trùng tên
      // (migration 0034) — hiếm khi xảy ra ở đây vì đã tự kiểm tra trùng tên
      // (case-insensitive) trước khi tạo ở trên, nhưng vẫn có thể lộ ra nếu
      // 2 request "Áp Dụng" chạy đồng thời (race condition).
      setApplyError(
        err?.code === "23505"
          ? "1 danh mục cùng tên vừa được tạo ở nơi khác trong lúc bạn áp dụng. Hãy tải lại trang và thử lại."
          : err.message || "Không thể áp dụng hạn mức. Chỉ chủ hộ mới được sửa ngân sách."
      );
    } finally {
      setIsApplying(false);
    }
  };

  // T-S35 — hoàn tác lần Áp Dụng gần nhất: category có sẵn → trả lại
  // `limit_amount`/`name` cũ; category MỚI tạo ở lần đó → xoá mềm (đúng
  // pattern `useSoftDeleteCategory` đã có, không xoá cứng — vẫn khôi phục
  // lại được qua `useRestoreCategory` nếu cần sau này).
  const handleUndoApply = async () => {
    if (!lastApplySnapshot || lastApplySnapshot.length === 0 || isUndoing) return;
    setIsUndoing(true);
    setApplyError(null);
    try {
      for (const entry of lastApplySnapshot) {
        if (entry.wasNew) {
          await softDeleteCategoryMutation.mutateAsync(entry.id);
        } else {
          await updateCategoryMutation.mutateAsync({
            id: entry.id,
            // [T-S44 bugfix 09/08/2026] Trước chỉ hoàn tác limit_amount/name,
            // giờ hoàn tác cả icon (đồng bộ với việc Áp Dụng giờ có thể đổi
            // icon — xem 2 nhánh update phía trên).
            patch: { limit_amount: entry.prevLimitAmount, name: entry.prevName, icon: entry.prevIcon ?? undefined },
          });
        }
      }
      setLastApplySnapshot(null);
      setSuccessMsg("Đã hoàn tác lần áp dụng gần nhất, ngân sách trở lại như trước.");
    } catch (err: any) {
      setApplyError(err.message || "Không thể hoàn tác toàn bộ — 1 số category có thể đã bị đổi/xoá bởi thao tác khác.");
    } finally {
      setIsUndoing(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(amount);
  };

  // Recharts Pie Colors
  const COLORS = ["#4f46e5", "#06b6d4", "#10b981", "#f59e0b", "#ec4899", "#8b5cf6", "#3b82f6"];

  const pieData = suggestions.map((s, idx) => ({
    name: `${s.categoryName} (${s.percent}%)`,
    value: s.suggestedAmount,
  }));

  return (
    <div className="bg-(--sst-surface) rounded-2xl shadow-sm border border-(--sst-border) p-6 space-y-6" id="smart-allocator-section">
      <div>
        <h2 className="text-lg font-semibold text-(--sst-text) flex items-center gap-2">
          <Coins className="w-5 h-5 text-indigo-500 dark:text-indigo-300" />
          Gợi Ý Phân Bổ Ngân Sách Thông Minh
        </h2>
        <p className="text-xs text-(--sst-text-secondary) mt-1">
          Nhập tổng thu nhập hàng tháng để hệ thống đề xuất tỷ lệ vàng phân chia ngân sách.
        </p>
      </div>

      <div className="bg-indigo-50/55 dark:bg-indigo-500/10 border border-indigo-100/70 dark:border-indigo-500/25 rounded-2xl p-4 flex gap-3 text-xs leading-relaxed text-indigo-950 dark:text-indigo-300 animate-fade-in">
        <Info className="w-5 h-5 text-indigo-500 dark:text-indigo-300 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <span className="font-bold text-indigo-900 dark:text-indigo-300 block">💡 Phân bổ mẫu & Tuỳ chỉnh thủ công tự do</span>
          <p className="text-indigo-800/90 dark:text-indigo-300 text-[11px]">
            Hạn mức từ AI chỉ mang tính chất khuyên dùng. Nếu bạn muốn hoặc thấy hợp lý, hãy nhấn nút <strong className="text-indigo-900 dark:text-indigo-300">"Áp dụng ngân sách đề xuất"</strong> ở bên dưới. 
            Nếu không, bạn có thể <strong className="text-indigo-900 dark:text-indigo-300">tự do thêm, sửa, xóa các danh mục, hạn mức</strong> theo ý muốn của mình trực tiếp tại tab <strong className="text-indigo-900 dark:text-indigo-300 font-semibold">"Hạn Mức Ngân Sách"</strong> để phù hợp với hoàn cảnh thực tế!
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Settings Area */}
        <div className="lg:col-span-7 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-(--sst-text-secondary) mb-1.5">Tổng thu nhập tháng này (VNĐ)</label>
              <div className="relative">
                <input
                  type="number"
                  className="w-full text-sm font-semibold text-(--sst-text) bg-(--sst-surface-2) border border-(--sst-border-strong) focus:border-indigo-500 rounded-xl px-3.5 py-2.5 outline-none focus:ring-2 focus:ring-indigo-100 transition-all"
                  value={incomeInput}
                  onChange={(e) => {
                    setIncomeManuallyEdited(true);
                    setIncomeInput(e.target.value);
                  }}
                  placeholder="Ví dụ: 15000000"
                />
                <span className="absolute right-3.5 top-3 text-xs font-medium text-(--sst-text-muted)">VNĐ</span>
              </div>
              {/* [T-S51, CONSTITUTION §1.15 mục 3] Checkbox tuỳ chọn, mặc
                  định TẮT, cạnh ô thu nhập tháng này (T-S41). */}
              <label className="mt-2 flex items-center gap-2 text-[11px] font-medium text-(--sst-text-secondary) cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="w-3.5 h-3.5 rounded border-(--sst-border-strong) text-indigo-600 dark:text-indigo-300 focus:ring-indigo-400 cursor-pointer"
                  checked={includeCumulativeBalance}
                  onChange={(e) => setIncludeCumulativeBalance(e.target.checked)}
                />
                <span>
                  + Gộp cả số dư luỹ kế ({formatCurrency(cumulativeBalance)}) vào tổng để phân bổ
                </span>
              </label>
              {/* [T-S51, bổ sung 15/08/2026 — người dùng phát hiện qua test
                  tay + ảnh chụp UI: bật checkbox khi `cumulativeBalance` âm
                  đủ lớn khiến `getAllocationTotal() <= 0` → `calculateAllocation`
                  im lặng `setSuggestions([])`, khu vực biểu đồ chỉ hiện lại
                  đúng placeholder rỗng chung "Vui lòng nhập số tiền hợp lệ"
                  (dòng ~1344) — GIỐNG HỆT trường hợp chưa nhập thu nhập, dễ
                  hiểu lầm là lỗi nhập liệu trong khi nguyên nhân thật là số
                  dư luỹ kế âm. Thêm banner RIÊNG, chỉ hiện đúng lúc checkbox
                  đang BẬT và tổng đã gộp ≤ 0 — không đụng nhánh checkbox tắt/
                  tổng hợp lệ (không đổi hành vi cũ). */}
              {includeCumulativeBalance && getAllocationTotal() <= 0 && (
                <div className="mt-2 p-2.5 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/25 text-rose-800 dark:text-rose-300 rounded-xl text-[11px] font-medium flex items-start gap-2 animate-fade-in">
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-600 dark:text-rose-300 shrink-0 mt-0.5" />
                  <span>
                    Số dư luỹ kế đang âm ({formatCurrency(cumulativeBalance)}) khiến tổng dùng để phân bổ ≤ 0 ({formatCurrency(getAllocationTotal())}) — chưa thể đề xuất phân bổ. Bỏ chọn ô trên để chỉ dùng thu nhập tháng này, hoặc nhập lại thu nhập cho đủ bù phần âm.
                  </span>
                </div>
              )}
              {/* T-S41 — breakdown ngắn theo từng category thu nhập đã phát
                  sinh trong tháng, chỉ hiện khi có dữ liệu tự động (không
                  hiện gì nếu tháng chưa có giao dịch thu nhập nào, đúng AC
                  "không báo lỗi"). */}
              {currentMonthIncome.breakdown.length > 0 && (
                <p className="mt-1 text-[11px] text-(--sst-text-muted) leading-relaxed">
                  {currentMonthIncome.breakdown
                    .map((b) => `${b.category} ${formatCurrency(b.total)}`)
                    .join(" + ")}
                </p>
              )}
              {/* T-S41 điểm 3 — banner GỢI Ý đổi công thức, KHÔNG tự động
                  đổi dropdown (CONSTITUTION §5). Chỉ đổi khi người dùng tự
                  bấm nút bên dưới. */}
              {showLowIncomeBanner && (
                <div className="mt-2 p-2.5 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/25 text-amber-800 dark:text-amber-300 rounded-xl text-[11px] font-medium flex items-start gap-2 animate-fade-in">
                  <Info className="w-3.5 h-3.5 text-amber-600 dark:text-amber-300 shrink-0 mt-0.5" />
                  <div className="space-y-1.5">
                    <span>
                      Thu nhập tháng này ({formatCurrency(currentMonthIncome.total)}) thấp hơn hẳn trung bình {recentIncomeAverage.monthsWithData} tháng gần nhất ({formatCurrency(recentIncomeAverage.average)}) — cân nhắc dùng Ngân sách Tối giản/Khẩn cấp.
                    </span>
                    <button
                      type="button"
                      onClick={() => setFormula("bare_bones")}
                      className="px-2.5 py-1 bg-amber-100 dark:bg-amber-500/10 hover:bg-amber-200 dark:hover:bg-amber-500/10 active:scale-95 text-amber-900 dark:text-amber-300 rounded-lg text-[11px] font-semibold transition-all cursor-pointer border border-amber-300 dark:border-amber-500/25"
                    >
                      🚨 Đổi sang Tối giản/Khẩn cấp
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-(--sst-text-secondary) mb-1.5">Quy tắc phân bổ</label>
              <select
                className="w-full text-sm font-semibold text-(--sst-text) bg-(--sst-surface-2) border border-(--sst-border-strong) focus:border-indigo-500 rounded-xl px-3 py-2.5 outline-none focus:ring-2 focus:ring-indigo-100 transition-all cursor-pointer"
                value={formula}
                onChange={(e) => setFormula(e.target.value as AllocationFormula)}
              >
                <option value="50_30_20">Quy tắc vàng 50 / 30 / 20</option>
                <option value="6_jars">Quy tắc 6 chiếc lọ (T. Harv Eker)</option>
                <option value="zero_based">Phương pháp Ngân sách Zero-based</option>
                <option value="pay_yourself_first">💰 Trả Bản Thân Trước (Pay Yourself First)</option>
                <option value="kakeibo">📓 Kakeibo (Kế toán chi tiêu Nhật Bản)</option>
                <option value="bare_bones">🚨 Ngân sách Tối giản / Khẩn cấp</option>
                <option value="custom">⚙️ Tự thiết lập phân bổ tùy chỉnh</option>
              </select>
            </div>
          </div>

          <AllocationFormulaExplanation formula={formula} />

          {/* [T-S55 11/08/2026] "Cân bằng về 100%" trước chỉ hiện ở "custom"
              — mở rộng cho MỌI công thức vì `handleUpdatePercent` (stepper
              +/- từng dòng) đã cho sửa tay % ở tất cả công thức từ trước,
              không riêng "custom", nên chỗ nào sửa tay được thì cũng cần
              nút hỗ trợ cân bằng lại nếu lỡ chỉnh lệch 100%. "Thêm hạng
              mục" vẫn CHỈ "custom" (các công thức mẫu khác lấy danh mục cố
              định từ `categories`/mẫu, không có khái niệm thêm dòng mới). */}
          {(formula === "custom" || suggestions.length > 0) && (
            <div className="flex flex-wrap items-center gap-2 pb-1.5 animate-fade-in">
              {formula === "custom" && (
                <button
                  type="button"
                  onClick={handleAddCustomItem}
                  className="px-3.5 py-2 bg-indigo-50 dark:bg-indigo-500/10 hover:bg-indigo-100 dark:hover:bg-indigo-500/10 active:scale-95 text-indigo-700 dark:text-indigo-300 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer border border-indigo-100 dark:border-indigo-500/25 shadow-xs"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Thêm hạng mục
                </button>
              )}
              <button
                type="button"
                onClick={handleNormalizePercentages}
                className="px-3.5 py-2 bg-(--sst-surface-hover) hover:bg-slate-200 dark:hover:bg-(--sst-border-strong) active:scale-95 text-(--sst-text) rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer border border-(--sst-border-strong) shadow-xs"
                title="Cân bằng tỷ lệ các hạng mục sao cho tổng bằng 100%"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Cân bằng về 100%
              </button>
            </div>
          )}

          {/* [T-S38 10/08/2026] Banner chỉ hiện khi đang dùng bộ danh mục
              MẪU (chưa có category chi tiêu thật nào, và không phải công
              thức "custom" — nhánh đó không đụng tới bộ mẫu). */}
          {formula !== "custom" && categories.length === 0 && suggestions.length > 0 && (
            <div className="p-3 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/25 text-amber-800 dark:text-amber-300 rounded-xl text-xs font-medium flex items-start gap-2 animate-fade-in">
              <Info className="w-4 h-4 text-amber-600 dark:text-amber-300 shrink-0 mt-0.5" />
              <span>
                Bạn chưa có danh mục ngân sách nào — đây là gợi ý mẫu phổ biến, có thể sửa tên/tỷ lệ hoặc xoá bớt trước khi Áp Dụng.
              </span>
            </div>
          )}

          <div className="space-y-3 max-h-[320px] overflow-y-auto pr-1">
            {suggestions.map((item, idx) => (
              <div
                key={idx}
                className="p-3.5 rounded-xl border border-(--sst-border) bg-slate-50/50 dark:bg-(--sst-surface-2) flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-sm hover:bg-(--sst-surface-2) dark:hover:bg-(--sst-surface-hover) transition-all"
              >
                <div className="flex-1 flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: COLORS[idx % COLORS.length] }}
                    ></span>
                    
                    {formula === "custom" ? (
                      <div className="flex-1 flex gap-2 items-center min-w-0">
                        <IconPicker
                          value={item.icon || iconForCategoryName(item.categoryName)}
                          icons={EXPENSE_ICONS}
                          onChange={(ico) => handleUpdateCustomItem(idx, "icon", ico)}
                        />
                        <input
                          type="text"
                          className="flex-1 bg-(--sst-surface) border border-(--sst-border-strong) focus:border-indigo-500 rounded-lg px-2.5 py-1 text-xs font-semibold text-(--sst-text) outline-none focus:ring-1 focus:ring-indigo-100 transition-all placeholder:text-(--sst-text-faint) min-w-[120px]"
                          value={item.categoryName}
                          onChange={(e) => handleUpdateCustomItem(idx, "categoryName", e.target.value)}
                          placeholder="Tên hạng mục..."
                        />
                        <button
                          type="button"
                          onClick={() => handleDeleteCustomItem(idx)}
                          className="p-1.5 bg-rose-50 dark:bg-rose-500/10 hover:bg-rose-100 dark:hover:bg-rose-500/10 text-rose-500 dark:text-rose-300 hover:text-rose-600 dark:hover:text-rose-300 rounded-md transition-all cursor-pointer shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
                          title="Xóa hạng mục"
                          aria-label="Xóa hạng mục"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <span className="font-semibold text-(--sst-text)">{item.categoryName}</span>
                    )}

                    {/* Stepper controls to fine-tune allocation percentages.
                        T-S130: bấm +/-5% là hành động dùng thường xuyên nhất
                        trong màn hình này — nâng từ 20x20px lên đúng chuẩn
                        40x40px tối thiểu cho ngón tay, không chỉ dựa vào cỡ
                        chữ nhỏ hiển thị bên trong. */}
                    <div className="flex items-center gap-1 bg-(--sst-surface) border border-(--sst-border-strong) rounded-lg p-0.5 shadow-sm ml-auto sm:ml-0 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleUpdatePercent(idx, item.percent - 5)}
                        className="w-10 h-10 hover:bg-(--sst-surface-2) text-(--sst-text-secondary) rounded flex items-center justify-center font-bold text-xs cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                        title="Giảm 5%"
                        aria-label="Giảm 5%"
                      >
                        -
                      </button>
                      <input
                        type="number"
                        className="w-10 text-center text-xs font-semibold text-indigo-600 dark:text-indigo-300 bg-transparent outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        value={item.percent}
                        onChange={(e) => handleUpdatePercent(idx, parseInt(e.target.value) || 0)}
                      />
                      <span className="text-[10px] text-(--sst-text-muted) font-bold mr-1">%</span>
                      <button
                        type="button"
                        onClick={() => handleUpdatePercent(idx, item.percent + 5)}
                        className="w-10 h-10 hover:bg-(--sst-surface-2) text-(--sst-text-secondary) rounded flex items-center justify-center font-bold text-xs cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                        title="Tăng 5%"
                        aria-label="Tăng 5%"
                      >
                        +
                      </button>
                    </div>
                  </div>

                  {formula === "custom" ? (
                    <input
                      type="text"
                      className="w-full bg-(--sst-surface) border border-(--sst-border-strong) focus:border-indigo-500 rounded-lg px-2.5 py-1 text-[11px] text-(--sst-text-secondary) outline-none focus:ring-1 focus:ring-indigo-100 transition-all placeholder:text-(--sst-text-faint)"
                      value={item.description}
                      onChange={(e) => handleUpdateCustomItem(idx, "description", e.target.value)}
                      placeholder="Mô tả mục đích (ví dụ: Ăn uống, Tiết kiệm xe...)"
                    />
                  ) : (
                    <p className="text-xs text-(--sst-text-muted) leading-normal max-w-sm">{item.description}</p>
                  )}

                  {/* [T-S143, 27/08/2026 — BỎ gating từ khoá] Hiện cho MỌI
                      dòng gợi ý, không chỉ dòng tên khớp "tiết kiệm/đầu
                      tư/...". Cấu hình ở đây chỉ là PENDING, config thật
                      chỉ được tạo SAU khi bấm "Áp Dụng Cho Ngân Sách Các
                      Danh Mục" thành công (xem `handleApply`), vì cần
                      category id thật. */}
                  <AutoContributionCategoryConfigPending
                    value={autoContribByRow[idx] ?? null}
                    onChange={(next) => setAutoContribByRow((prev) => ({ ...prev, [idx]: next }))}
                    transactions={allTransactions}
                    formatCurrency={formatCurrency}
                  />
                </div>

                <div className="text-right shrink-0 flex flex-row sm:flex-col items-center sm:items-end justify-between sm:justify-center gap-2">
                  <span className="text-xs text-(--sst-text-muted) sm:hidden">Hạn mức đề xuất:</span>
                  <span className="text-sm font-bold text-(--sst-text)">{formatCurrency(item.suggestedAmount)}</span>
                </div>
              </div>
            ))}
          </div>

          {suggestions.length > 0 && (() => {
            const totalPct = suggestions.reduce((sum, s) => sum + s.percent, 0);
            // [T-S89] Chênh lệch SỐ TIỀN (VNĐ) — không chỉ %. `totalPct` có
            // thể tròn đúng 100% nhờ redistribution (T-S55) nhưng
            // `suggestedAmount` từng dòng vẫn có thể lệch vài đồng do làm
            // tròn (Math.round ở handleApply) hoặc do người dùng sửa tay %
            // — hiện rõ số tiền thật đang thiếu/dư thay vì chỉ báo %.
            const totalAllocated = suggestions.reduce((sum, s) => sum + s.suggestedAmount, 0);
            const allocationTotal = getAllocationTotal();
            const amountDiff = allocationTotal - totalAllocated; // >0: còn thiếu (chưa phân bổ hết) — <0: đã phân bổ vượt (dư/thừa)
            const isBalanced = totalPct === 100 && Math.abs(amountDiff) < 1; // sai số làm tròn dưới 1đ coi như khớp
            return (
              <div
                className={
                  isBalanced
                    ? "p-3 bg-(--sst-surface-2) border border-(--sst-border-strong) rounded-xl text-xs font-semibold space-y-1.5"
                    : "p-3 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/25 rounded-xl text-xs font-semibold space-y-1.5"
                }
              >
                <div className="flex items-center justify-between">
                  <span className="text-(--sst-text-secondary)">Tổng tỷ lệ điều chỉnh:</span>
                  <span className={isBalanced ? "text-emerald-600 dark:text-emerald-300 flex items-center gap-1.5 font-bold" : "text-amber-600 dark:text-amber-300 flex items-center gap-1.5 font-bold"}>
                    {isBalanced ? (
                      <>
                        <Check className="w-4 h-4 text-emerald-500 dark:text-emerald-300" /> Đúng 100% (Sẵn sàng áp dụng)
                      </>
                    ) : (
                      <>
                        <Info className="w-4 h-4 text-amber-500 dark:text-amber-300" /> {totalPct}% (Nên cân đối lại về 100%)
                      </>
                    )}
                  </span>
                </div>
                {!isBalanced && (
                  <div className="flex items-start justify-between gap-2 pt-1.5 border-t border-amber-200/70 dark:border-amber-500/25 text-[11px] font-medium text-amber-800 dark:text-amber-300">
                    <span className="text-(--sst-text-secondary) font-semibold shrink-0">Số tiền:</span>
                    <span className="text-right">
                      Đang phân bổ {formatCurrency(totalAllocated)} / tổng {formatCurrency(allocationTotal)} —{" "}
                      {amountDiff > 0 ? (
                        <strong className="text-amber-900 dark:text-amber-300">còn thiếu {formatCurrency(amountDiff)} chưa phân bổ</strong>
                      ) : (
                        <strong className="text-rose-700 dark:text-rose-300">đang dư/vượt {formatCurrency(-amountDiff)} so với thu nhập</strong>
                      )}
                    </span>
                  </div>
                )}
              </div>
            );
          })()}

          {applyError && (
            <div className="p-3 bg-rose-50 dark:bg-rose-500/10 border border-rose-100 dark:border-rose-500/25 text-rose-700 dark:text-rose-300 rounded-xl text-xs font-medium flex items-center gap-2">
              <Info className="w-4 h-4 text-rose-500 dark:text-rose-300 shrink-0" />
              <span>{applyError}</span>
            </div>
          )}

          {successMsg && (
            <div className="p-3 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/25 text-emerald-700 dark:text-emerald-300 rounded-xl text-xs font-medium flex items-center justify-between gap-2 flex-wrap">
              <span className="flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-500 dark:text-emerald-300 shrink-0" />
                {successMsg}
              </span>
            </div>
          )}

          {/* [T-S37 bugfix, 09/08/2026] Trước đây nút "Hoàn tác" lồng bên
              trong `{successMsg && (...)}` — `successMsg` là state CỤC BỘ
              (không nâng lên App.tsx cùng `lastApplySnapshot`), nên dù
              snapshot đã sống sót qua đổi tab, nút vẫn biến mất vì
              `successMsg` bị reset về `null` mỗi lần component unmount/
              remount theo tab. Tách nút ra khỏi điều kiện `successMsg`,
              hiện riêng chỉ dựa vào `lastApplySnapshot` (đúng nguồn sự thật
              đã nâng lên App.tsx) — đây mới là fix thật cho T-S37, phần nâng
              state trước đó là điều kiện cần nhưng chưa đủ. */}
          {lastApplySnapshot && lastApplySnapshot.length > 0 && (
            <div className="p-3 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/25 text-emerald-700 dark:text-emerald-300 rounded-xl text-xs font-medium flex items-center justify-between gap-2 flex-wrap">
              <span className="flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-500 dark:text-emerald-300 shrink-0" />
                Có 1 lần Áp Dụng gần đây có thể hoàn tác.
              </span>
              <button
                type="button"
                onClick={handleUndoApply}
                disabled={isUndoing}
                className="px-2.5 py-2 bg-(--sst-surface) hover:bg-emerald-100 dark:hover:bg-emerald-500/10 disabled:opacity-50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/25 rounded-md text-[11px] font-semibold cursor-pointer shrink-0"
              >
                {isUndoing ? "Đang hoàn tác..." : "Hoàn tác"}
              </button>
            </div>
          )}

          {!isOwner && (
            <div className="p-3 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/25 text-amber-800 dark:text-amber-300 rounded-xl text-xs font-semibold flex items-center gap-2">
              <Info className="w-4 h-4 text-amber-600 dark:text-amber-300 shrink-0" />
              <span>Chỉ có Chủ hộ mới được quyền áp dụng phân bổ ngân sách chung cho cả gia đình.</span>
            </div>
          )}

          <div className="flex justify-end pt-2">
            <button
              onClick={handleApply}
              disabled={suggestions.length === 0 || !isOwner || isApplying}
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold shadow-md shadow-indigo-100 hover:scale-102 active:scale-98 transition-all flex items-center gap-1.5 cursor-pointer"
              id="btn-apply-allocation"
            >
              <Sparkles className="w-4 h-4" />
              {isApplying ? "Đang áp dụng..." : "Áp Dụng Cho Ngân Sách Các Danh Mục"}
            </button>
          </div>
        </div>

        {/* Chart Area */}
        <div className="lg:col-span-5 flex flex-col items-center justify-center bg-(--sst-surface-2) rounded-2xl p-4 border border-slate-100/60 dark:border-(--sst-border) min-h-[260px]">
          <h3 className="text-xs font-bold text-(--sst-text-secondary) flex items-center gap-1 mb-2 uppercase tracking-wider">
            <PieIcon className="w-3.5 h-3.5" />
            Biểu đồ tỷ lệ phân bổ
          </h3>

          {suggestions.length > 0 ? (
            <div className="w-full h-56 flex items-center justify-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={75}
                    paddingAngle={4}
                    dataKey="value"
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value) => formatCurrency(Number(value))}
                    contentStyle={{ borderRadius: "8px", border: "1px solid #f1f5f9", fontSize: "11px" }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="text-center py-10 text-(--sst-text-muted) text-xs">Vui lòng nhập số tiền hợp lệ để xem tỷ lệ phân bổ</div>
          )}

          <div className="text-[10px] text-(--sst-text-muted) italic text-center leading-normal max-w-xs mt-2">
            <Info className="w-3 h-3 inline mr-1 text-(--sst-text-muted)" />
            Định luật tiết kiệm: Luôn dành cố định ít nhất 1 phần trăm thu nhập cho việc tích lũy trước khi tiêu xài.
          </div>
        </div>
      </div>
    </div>
  );
}