import { useState, useMemo } from "react";
import {
  TrendingDown,
  TrendingUp,
  Wallet,
  ArrowUpRight,
  ArrowDownRight,
  Percent,
  Calendar,
  AlertCircle,
  HelpCircle,
  ChevronDown,
  FileSpreadsheet,
  PiggyBank,
  ShieldAlert,
  ArrowRight,
  Sparkles,
  BookOpen,
  Plus,
  Landmark,
} from "lucide-react";
import { DashboardStats } from "../types";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip as ChartTooltip,
  PieChart,
  Pie,
  Cell,
} from "recharts";
// T-S06d: đọc dữ liệu qua hook TanStack Query (CONSTITUTION §1.1), không
// còn nhận transactions/categories/goals qua props từ App.tsx.
import { useTransactions } from "../hooks/useTransactions";
import { useCategories } from "../hooks/useCategories";
import { useGoals } from "../hooks/useGoals";
import { useHousehold, useHouseholdMembers } from "../hooks/useHousehold";
import { rowsToTransactions, rowToCategory, rowToGoal } from "../lib/mapRows";
import { isExpenseTx, isIncomeTx, isTransferTx } from "../lib/txClassify";
import { getCumulativeBalance, getCurrentMonthCategorySpending } from "../lib/incomeStats";
import { useToast } from "../context/ToastContext";
import { SkeletonDashboard } from "./Skeleton";

interface FinancialDashboardProps {
  setActiveTab: (tab: "dashboard" | "smart-input" | "transactions" | "budgets" | "goals" | "allocator" | "household") => void;
}

export type TimeFilter = "all" | "today" | "week" | "month" | "year" | "custom";

export default function FinancialDashboard({ setActiveTab }: FinancialDashboardProps) {
  const { showToast } = useToast();
  // T-S06d: query hook đọc đúng scope hiện tại (ScopeContext) — không nhận
  // qua props nữa. `household?.id` chỉ cần để resolve tên member; hook tự
  // đọc householdId thật qua useDataScope() nội bộ, không truyền tay ở đây.
  const { data: transactionRows = [], isLoading: isLoadingTransactions } = useTransactions();
  const { data: categoryRows = [], isLoading: isLoadingCategories } = useCategories();
  const { data: goalRows = [], isLoading: isLoadingGoals } = useGoals();
  const { data: household } = useHousehold();
  const { data: memberRows = [] } = useHouseholdMembers(household?.id);

  const categories = useMemo(() => categoryRows.map(rowToCategory), [categoryRows]);
  const goals = useMemo(() => goalRows.map(rowToGoal), [goalRows]);
  const transactions = useMemo(
    () => rowsToTransactions(transactionRows, categoryRows, memberRows),
    [transactionRows, categoryRows, memberRows]
  );

  const [timeFilter, setTimeFilter] = useState<TimeFilter>("month");
  const [customStartDate, setCustomStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toLocaleDateString("en-CA");
  });
  const [customEndDate, setCustomEndDate] = useState(() => new Date().toLocaleDateString("en-CA"));

  // Format currency helpers
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(amount);
  };

  // [T-S100b] Rút gọn số tiền kiểu Việt cho nhãn trục tung biểu đồ — số đầy
  // đủ có quá nhiều số 0 (vd "1.000.000") không đọc kịp trên trục nhỏ; hover
  // vào điểm dữ liệu vẫn hiện `formatCurrency` đầy đủ nên không mất thông
  // tin. CHỈ dùng "k" (nghìn) và "tr" (triệu) — không dùng slang "lít/củ"
  // vì không phải ai cũng hiểu, dễ gây nhầm lẫn trên một app tài chính.
  const formatCompactVND = (amount: number) => {
    const sign = amount < 0 ? "-" : "";
    const abs = Math.abs(amount);
    const trim = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, ""));

    if (abs >= 1_000_000) return `${sign}${trim(abs / 1_000_000)}tr`;
    if (abs >= 1_000) return `${sign}${trim(abs / 1_000)}k`;
    return `${sign}${abs}`;
  };

  // 1. Filtered Transactions based on Selected Time range
  const filteredTransactions = useMemo(() => {
    const today = new Date();
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    return transactions.filter((t) => {
      const tDate = new Date(t.date);

      if (timeFilter === "all") {
        return true;
      } else if (timeFilter === "today") {
        return tDate >= startOfToday;
      } else if (timeFilter === "week") {
        const oneWeekAgo = new Date();
        oneWeekAgo.setDate(today.getDate() - 7);
        return tDate >= oneWeekAgo;
      } else if (timeFilter === "month") {
        const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        return tDate >= startOfMonth;
      } else if (timeFilter === "year") {
        const startOfYear = new Date(today.getFullYear(), 0, 1);
        return tDate >= startOfYear;
      } else if (timeFilter === "custom") {
        const start = new Date(customStartDate);
        const end = new Date(customEndDate);
        end.setHours(23, 59, 59, 999);
        return tDate >= start && tDate <= end;
      }
      return true;
    });
  }, [transactions, timeFilter, customStartDate, customEndDate]);

  // 2. Calculations for Income vs Expense
  const stats = useMemo<DashboardStats>(() => {
    let income = 0;
    let expense = 0;

    // [BUGFIX T-S21b 08/08/2026] Trước đây khối này tự lặp lại heuristic so
    // tên category ("Thu nhập"/"Lương") thay vì dùng txClassify.ts — sót lại
    // từ T-S21 (T-S21 chỉ sửa 5 điểm tính khác, không đụng khối `stats` này).
    // Đổi sang isTransferTx/isIncomeTx/isExpenseTx (nguồn sự thật `t.type`),
    // giữ đúng logic bỏ qua `transfer` khỏi cả thu lẫn chi đã có.
    filteredTransactions.forEach((t) => {
      if (isTransferTx(t)) return;
      if (isIncomeTx(t)) {
        income += Math.abs(t.amount);
      } else if (isExpenseTx(t)) {
        expense += t.amount;
      }
    });

    const net = income - expense;
    const rate = income > 0 ? (net / income) * 100 : 0;

    return {
      totalIncome: income,
      totalExpense: expense,
      netSavings: net,
      savingsRate: rate,
    };
  }, [filteredTransactions]);

  // 2b. [T-S50, CONSTITUTION §1.15] "Số dư luỹ kế" — tính qua hàm dùng
  // CHUNG `getCumulativeBalance` (`incomeStats.ts`, cũng dùng ở
  // `SmartAllocator.tsx`/T-S51 — đúng nguyên tắc "1 công thức tài chính, 1
  // hàm dùng chung", tránh viết lại logic trùng như bài học T-S64). CỐ Ý
  // dùng `transactions` (chưa qua `timeFilter`) — KHÁC hẳn `stats` ở trên:
  // KPI này không đổi khi người dùng chuyển khoảng thời gian đang xem trên
  // Dashboard, đúng bản chất "còn lại tới hiện tại", không phải "phát sinh
  // trong kỳ". KHÔNG ghi giao dịch/bản ghi nào để "chuyển số dư" giữa các
  // tháng — thuần tính lại mỗi lần render.
  const cumulativeBalance = useMemo(() => getCumulativeBalance(transactions), [transactions]);

  // 3. Category Data for Pie Chart
  // [BUGFIX 08/08/2026] Trước đây chỉ loại trừ 2 tên category cứng
  // "Thu nhập"/"Lương" — bất kỳ giao dịch thu nhập nào dùng category khác
  // (vd "Khác" do user tự đặt) hoặc giao dịch chuyển khoản góp quỹ
  // (`type='transfer'`) đều lọt vào pie chart "chi tiêu", làm tỉ lệ % sai
  // nghiêm trọng (quan sát thật: 1 category thu nhập chiếm "1937%" biểu đồ
  // chi). Đổi sang `isExpenseTx` (xem `src/lib/txClassify.ts`), nguồn sự
  // thật là `t.type`, không so tên category nữa.
  const categoryChartData = useMemo(() => {
    const map: { [key: string]: number } = {};

    filteredTransactions.forEach((t) => {
      if (isExpenseTx(t)) {
        map[t.category] = (map[t.category] || 0) + t.amount;
      }
    });

    return Object.entries(map).map(([name, value]) => {
      const catObj = categories.find((c) => c.name === name);
      return {
        name,
        value,
        icon: catObj ? catObj.icon : "🍔",
      };
    });
  }, [filteredTransactions, categories]);

  // 4. Daily Spend Trend over Time
  // [BUGFIX 08/08/2026] Cùng lỗi so tên category như categoryChartData ở
  // trên — đổi sang `isExpenseTx`.
  const dailySpendData = useMemo(() => {
    const map: { [key: string]: number } = {};

    filteredTransactions.forEach((t) => {
      if (isExpenseTx(t)) {
        const dateStr = new Date(t.date).toLocaleDateString("vi-VN", {
          month: "numeric",
          day: "numeric",
        });
        map[dateStr] = (map[dateStr] || 0) + t.amount;
      }
    });

    return Object.entries(map)
      .map(([date, amount]) => ({ date, "Số tiền": amount }))
      .reverse();
  }, [filteredTransactions]);

  // 5. Top 5 Large Expenses
  // [BUGFIX 08/08/2026] Cùng lỗi so tên category — bất kỳ giao dịch thu
  // nhập nào KHÔNG dùng đúng tên "Thu nhập"/"Lương" (vd "Lương" gán category
  // "Khác", hoặc category thu nhập tự đặt tên khác) lọt vào "Top 5 Khoản Chi
  // Lớn Nhất" (quan sát thật: "Lương 15.000.000đ"/"200.000.000đ" hiện trong
  // danh sách chi tiêu). Đổi sang `isExpenseTx`.
  const topExpenses = useMemo(() => {
    return [...filteredTransactions]
      .filter(isExpenseTx)
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);
  }, [filteredTransactions]);

  // 6. 5 Most Recent Transactions
  const recentTransactions = useMemo(() => {
    return [...transactions]
      .sort((a, b) => {
        // Sort by date then createdAt
        const dDiff = new Date(b.date).getTime() - new Date(a.date).getTime();
        if (dDiff !== 0) return dDiff;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      })
      .slice(0, 5);
  }, [transactions]);

  // 7. Budget status calculations (Actual spent vs budget limit)
  // [BUGFIX 08/08/2026] Thiếu `isExpenseTx(t)` khiến giao dịch chuyển khoản
  // góp quỹ tiết kiệm (`type='transfer'`, vẫn giữ category) bị tính vào "đã
  // chi" của ngân sách — đã sửa lúc đó.
  // [BUGFIX T-S112, 19/08/2026 — bug thật phát hiện qua audit logic dòng
  // tiền] Bản sửa 08/08 vẫn dùng `filteredTransactions` (đi theo `timeFilter`
  // Dashboard đang chọn: today/week/month/year/custom/all) làm nguồn tính
  // "đã chi" — trong khi `limitAmount` LUÔN là hạn mức THEO THÁNG (đúng
  // nghĩa gốc ở `BudgetLimits.tsx`, không phụ thuộc filter nào). Đổi Dashboard
  // sang "Năm nay"/"Tự chọn" khoảng dài khiến widget cộng dồn chi tiêu cả kỳ
  // dài rồi so với hạn mức 1 tháng → % sai nghiêm trọng, không khớp tab
  // Ngân Sách thật. Sửa: dùng `getCurrentMonthCategorySpending` (dùng CHUNG
  // với `BudgetLimits.tsx`, xem `incomeStats.ts`) trên `transactions` GỐC
  // (chưa qua `timeFilter`) — widget này KHÔNG còn phụ thuộc bộ lọc thời
  // gian của Dashboard nữa, luôn đúng nghĩa "tháng hiện tại", giống hệt số
  // liệu thật ở tab Ngân Sách.
  const budgetLimitsWithStatus = useMemo(() => {
    return categories
      .filter((c) => c.limitAmount && c.limitAmount > 0)
      .map((c) => {
        const spent = getCurrentMonthCategorySpending(c.id, transactions); // [T-S114] theo id, không theo tên
        const limit = c.limitAmount || 0;
        const percent = limit > 0 ? (spent / limit) * 100 : 0;
        
        return {
          ...c,
          spent,
          limit,
          percent,
        };
      });
  }, [categories, transactions]);

  // Export Analytics and Filtered Transactions to CSV
  const handleExportAnalyticsCSV = () => {
    if (filteredTransactions.length === 0) {
      showToast({ message: "Không có dữ liệu giao dịch nào trong khoảng thời gian này để xuất!" });
      return;
    }

    const BOM = "\uFEFF";
    const rows: string[] = [];

    rows.push("BÁO CÁO PHÂN TÍCH TÀI CHÍNH NHÀ CỬA SMART SPEND");
    
    let timeLabel = "";
    if (timeFilter === "all") timeLabel = "Tất cả";
    else if (timeFilter === "today") timeLabel = "Hôm nay";
    else if (timeFilter === "week") timeLabel = "Tuần này";
    else if (timeFilter === "month") timeLabel = "Tháng này";
    else if (timeFilter === "year") timeLabel = "Năm nay";
    else if (timeFilter === "custom") timeLabel = `Tự chọn (${customStartDate} đến ${customEndDate})`;
    
    rows.push(`Chu kỳ lọc thời gian,${timeLabel}`);
    rows.push(`Ngày xuất báo cáo,${new Date().toLocaleString("vi-VN")}`);
    rows.push("");

    // Section 1: KPI Stats
    rows.push("1. CHỈ SỐ TÀI CHÍNH CHỦ CHỐT TRONG CHU KỲ LỌC");
    rows.push(`Tổng chi tiêu,${stats.totalExpense} VNĐ`);
    rows.push(`Tổng thu nhập,${stats.totalIncome} VNĐ`);
    rows.push(`Còn lại khả dụng (Số dư ròng),${stats.netSavings} VNĐ`);
    rows.push(`Tỉ lệ tiết kiệm ròng,${Math.round(stats.savingsRate)}%`);
    rows.push("");

    // Section 2: Category distribution
    rows.push("2. PHÂN BỔ CHI TIÊU THEO DANH MỤC");
    rows.push("Danh mục,Số tiền chi tiêu (VNĐ),Tỷ lệ (%)");
    categoryChartData.forEach((item) => {
      const totalExp = stats.totalExpense || 1;
      const pct = (item.value / totalExp) * 100;
      rows.push(`"${item.icon} ${item.name}",${item.value},${Math.round(pct)}%`);
    });
    rows.push("");

    // Section 3: Budget control
    rows.push("3. TIẾN ĐỘ THỰC HIỆN NGÂN SÁCH (HẠN MỨC)");
    rows.push("Danh mục,Đã chi tiêu (VNĐ),Hạn mức tối đa (VNĐ),Tiến độ sử dụng (%),Trạng thái");
    if (budgetLimitsWithStatus.length > 0) {
      budgetLimitsWithStatus.forEach((b) => {
        const isOver = b.spent > b.limit;
        const statusMsg = isOver 
          ? "⚠️ Vượt hạn mức chi tiêu!" 
          : b.percent >= 75 
            ? "🟡 Sắp chạm ngưỡng an toàn" 
            : "🟢 Trong vùng chi tiêu an toàn";
        rows.push(`"${b.icon} ${b.name}",${b.spent},${b.limit},${Math.round(b.percent)}%,"${statusMsg}"`);
      });
    } else {
      rows.push("Chưa cấu hình hạn mức ngân sách nào cho chu kỳ này.,,,,");
    }
    rows.push("");

    // Section 4: Saving goals progress
    rows.push("4. MỤC TIÊU TÍCH LŨY GIA ĐÌNH CHỦ LỰC");
    rows.push("Tên mục tiêu,Đã tích lũy (VNĐ),Mục tiêu cần đạt (VNĐ),Tiến độ hoàn thành (%),Trạng thái");
    if (goals.length > 0) {
      goals.forEach((g) => {
        const target = g.targetAmount || 0;
        const pct = target > 0 ? (g.currentAmount / target) * 100 : 100;
        const isCompleted = g.currentAmount >= target && target > 0;
        const statusMsg = isCompleted ? "🎉 Đã hoàn thành!" : "💼 Đang tích lũy";
        rows.push(`"${g.name}",${g.currentAmount},${target},${Math.round(pct)}%,"${statusMsg}"`);
      });
    } else {
      rows.push("Chưa thiết lập mục tiêu tích lũy gia đình nào.,,,,");
    }
    rows.push("");

    // Section 5: Top 5 expenses
    rows.push("5. TOP 5 KHOẢN CHI TIÊU LỚN NHẤT");
    rows.push("Mô tả giao dịch,Ngày chi tiêu,Danh mục,Thành viên chịu trách nhiệm,Số tiền (VNĐ)");
    if (topExpenses.length > 0) {
      topExpenses.forEach((t) => {
        rows.push([
          `"${t.description.replace(/"/g, '""')}"`,
          t.date,
          `"${t.category}"`,
          t.member ? `"${t.member}"` : '"Cá nhân"',
          t.amount
        ].join(","));
      });
    } else {
      rows.push("Chưa ghi nhận khoản chi tiêu nào.,,,,");
    }
    rows.push("");

    // Section 6: Detailed transactions
    rows.push("6. DANH SÁCH CHI TIẾT GIAO DỊCH TRONG CHU KỲ LỌC");
    rows.push("Mã giao dịch,Mô tả,Loại giao dịch,Số tiền (VNĐ),Số tiền thực tế (VNĐ),Danh mục,Ngày chi tiêu,Thành viên,Ghi chú");
    filteredTransactions.forEach((t) => {
      const isIncome = isIncomeTx(t); // [T-S115, 19/08/2026] nguồn sự thật txClassify.ts — vị trí thứ 6 của cùng lớp bug, trong chính báo cáo CSV xuất ra ("Xuất Phân Tích Excel"), ảnh hưởng cột "Loại giao dịch"/"Số tiền thực tế".
      // gộp vào "Chi tiêu" như trước khi sửa (đúng CONSTITUTION §1.9).
      const typeLabel = t.type === "transfer" ? "Chuyển khoản" : isIncome ? "Thu nhập" : "Chi tiêu";
      // transfer: giữ số dương, không mang dấu âm như chi tiêu thật (không
      // phải tiền mất đi).
      const signedAmount = t.type === "transfer" ? Math.abs(t.amount) : isIncome ? Math.abs(t.amount) : -t.amount;
      rows.push([
        t.id,
        `"${t.description.replace(/"/g, '""')}"`,
        typeLabel,
        Math.abs(t.amount),
        signedAmount,
        `"${t.category}"`,
        t.date,
        t.member ? `"${t.member}"` : '""',
        t.note ? `"${t.note.replace(/"/g, '""')}"` : '""',
      ].join(","));
    });

    const csvContent = BOM + rows.join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);

    const timeString = timeFilter === "custom" ? `${customStartDate}_to_${customEndDate}` : timeFilter;
    link.setAttribute("download", `Bao_Cao_Phan_Tich_Tai_Chinh_${timeString}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const CHART_COLORS = ["#4f46e5", "#06b6d4", "#10b981", "#f59e0b", "#ec4899", "#8b5cf6", "#3b82f6", "#e2e8f0"];

  // T-S129 — trước đây không có trạng thái loading nào (chỉ destructure
  // `data`), khiến màn hình rơi vào nhánh "0 giao dịch" 1 nhịp trước khi dữ
  // liệu thật load xong (gây hiểu lầm là hộ/cá nhân chưa có dữ liệu gì). Early
  // return AN TOÀN ở đây vì không còn hook nào phía dưới điểm này.
  if (isLoadingTransactions || isLoadingCategories || isLoadingGoals) {
    return <SkeletonDashboard />;
  }

  return (
    <div className="space-y-6" id="dashboard-analytics-section">
      {/* Filters and Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-(--sst-surface) p-4 rounded-2xl border border-(--sst-border) shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-indigo-500 dark:text-indigo-400" />
            <h2 className="font-bold text-(--sst-text) text-xs sm:text-sm whitespace-nowrap">Bộ lọc thời gian:</h2>
          </div>
          <div className="flex flex-wrap gap-1">
            {(["all", "today", "week", "month", "year", "custom"] as TimeFilter[]).map((filter) => {
               const labels = {
                 all: "Tất cả",
                 today: "Hôm nay",
                 week: "Tuần này",
                 month: "Tháng này",
                 year: "Năm nay",
                 custom: "Tự chọn",
               };
              return (
                <button
                  key={filter}
                  onClick={() => setTimeFilter(filter)}
                  className={`text-xs px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                    timeFilter === filter
                      ? "bg-indigo-600 text-white shadow-sm shadow-indigo-100"
                      : "bg-(--sst-surface-2) hover:bg-(--sst-surface-hover) text-(--sst-text-secondary)"
                  }`}
                >
                  {labels[filter]}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          {timeFilter === "custom" && (
            <div className="flex items-center gap-1.5 text-xs w-full sm:w-auto">
              <input
                type="date"
                className="bg-(--sst-surface-2) border border-(--sst-border-strong) rounded-lg px-2 py-1.5 outline-none text-(--sst-text) flex-1 sm:flex-initial"
                value={customStartDate}
                onChange={(e) => setCustomStartDate(e.target.value)}
              />
              <span className="text-(--sst-text-muted) shrink-0">đến</span>
              <input
                type="date"
                className="bg-(--sst-surface-2) border border-(--sst-border-strong) rounded-lg px-2 py-1.5 outline-none text-(--sst-text) flex-1 sm:flex-initial"
                value={customEndDate}
                onChange={(e) => setCustomEndDate(e.target.value)}
              />
            </div>
          )}

          <button
            onClick={handleExportAnalyticsCSV}
            className="px-3.5 py-2 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 rounded-xl border border-emerald-100 dark:border-emerald-500/25 transition-all text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer w-full sm:w-auto"
            title="Xuất báo cáo phân tích sang Excel/CSV"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <span>Xuất phân tích Excel</span>
          </button>
        </div>
      </div>

      {/* KPI Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
        {/* KPI: Total Expense */}
        <div className="bg-(--sst-surface) p-3.5 sm:p-5 rounded-2xl border border-(--sst-border) shadow-sm flex items-center justify-between gap-1.5 min-w-0 hover:border-indigo-100 transition-all">
          <div className="space-y-0.5 sm:space-y-1 min-w-0">
            <span className="text-[10px] sm:text-xs font-semibold text-(--sst-text-muted) uppercase tracking-wider block truncate">Tổng Chi</span>
            <h3 className="text-sm sm:text-xl font-bold text-(--sst-text) truncate" title={formatCurrency(stats.totalExpense)}>
              {formatCurrency(stats.totalExpense)}
            </h3>
            <span className="text-[9px] sm:text-[10px] text-rose-500 dark:text-rose-400 font-bold flex items-center gap-0.5">
              <ArrowUpRight className="w-3 h-3 shrink-0" /> Thực chi
            </span>
          </div>
          <div className="p-2 sm:p-3 bg-rose-50 dark:bg-rose-500/10 text-rose-500 dark:text-rose-300 rounded-xl shrink-0">
            <Wallet className="w-4 h-4 sm:w-5 sm:h-5" />
          </div>
        </div>

        {/* KPI: Total Income */}
        <div className="bg-(--sst-surface) p-3.5 sm:p-5 rounded-2xl border border-(--sst-border) shadow-sm flex items-center justify-between gap-1.5 min-w-0 hover:border-indigo-100 transition-all">
          <div className="space-y-0.5 sm:space-y-1 min-w-0">
            <span className="text-[10px] sm:text-xs font-semibold text-(--sst-text-muted) uppercase tracking-wider block truncate">Tổng Thu</span>
            <h3 className="text-sm sm:text-xl font-bold text-(--sst-text) truncate" title={formatCurrency(stats.totalIncome)}>
              {formatCurrency(stats.totalIncome)}
            </h3>
            <span className="text-[9px] sm:text-[10px] text-emerald-500 dark:text-emerald-400 font-bold flex items-center gap-0.5">
              <ArrowDownRight className="w-3 h-3 shrink-0" /> Thu nhập
            </span>
          </div>
          <div className="p-2 sm:p-3 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-500 dark:text-emerald-300 rounded-xl shrink-0">
            <Wallet className="w-4 h-4 sm:w-5 sm:h-5" />
          </div>
        </div>

        {/* KPI: Net Savings */}
        <div className="bg-(--sst-surface) p-3.5 sm:p-5 rounded-2xl border border-(--sst-border) shadow-sm flex items-center justify-between gap-1.5 min-w-0 hover:border-indigo-100 transition-all">
          <div className="space-y-0.5 sm:space-y-1 min-w-0">
            <span className="text-[10px] sm:text-xs font-semibold text-(--sst-text-muted) uppercase tracking-wider block truncate">Còn Lại Khả Dụng</span>
            <h3 className={`text-sm sm:text-xl font-bold truncate ${stats.netSavings >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`} title={formatCurrency(stats.netSavings)}>
              {formatCurrency(stats.netSavings)}
            </h3>
            <span className="text-[9px] sm:text-[10px] text-(--sst-text-muted) font-bold block truncate">Số dư tích lũy ròng</span>
          </div>
          <div className="p-2 sm:p-3 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-500 dark:text-indigo-300 rounded-xl shrink-0">
            <Wallet className="w-4 h-4 sm:w-5 sm:h-5" />
          </div>
        </div>

        {/* KPI: Savings Rate */}
        <div className="bg-(--sst-surface) p-3.5 sm:p-5 rounded-2xl border border-(--sst-border) shadow-sm flex items-center justify-between gap-1.5 min-w-0 hover:border-indigo-100 transition-all">
          <div className="space-y-0.5 sm:space-y-1 min-w-0">
            <span className="text-[10px] sm:text-xs font-semibold text-(--sst-text-muted) uppercase tracking-wider block truncate">Tỉ Lệ Tiết Kiệm</span>
            <h3 className="text-sm sm:text-xl font-bold text-(--sst-text) truncate">{Math.round(stats.savingsRate)}%</h3>
            <span className="text-[9px] sm:text-[10px] text-indigo-600 dark:text-indigo-400 font-bold block truncate">Mục tiêu: &gt;= 20%</span>
          </div>
          <div className="p-2 sm:p-3 bg-amber-50 dark:bg-amber-500/10 text-amber-500 dark:text-amber-300 rounded-xl shrink-0">
            <Percent className="w-4 h-4 sm:w-5 sm:h-5" />
          </div>
        </div>

        {/* KPI: Cumulative Balance (T-S50, CONSTITUTION §1.15) — thuần TÍNH
            HIỂN THỊ từ toàn bộ lịch sử, KHÔNG đổi theo timeFilter đang chọn
            ở trên, khác 4 thẻ còn lại. */}
        <div className="bg-(--sst-surface) p-3.5 sm:p-5 rounded-2xl border border-(--sst-border) shadow-sm flex items-center justify-between gap-1.5 min-w-0 hover:border-indigo-100 transition-all">
          <div className="space-y-0.5 sm:space-y-1 min-w-0">
            <span className="text-[10px] sm:text-xs font-semibold text-(--sst-text-muted) uppercase tracking-wider block truncate">Số Dư Luỹ Kế</span>
            <h3 className={`text-sm sm:text-xl font-bold truncate ${cumulativeBalance >= 0 ? "text-(--sst-text)" : "text-rose-600 dark:text-rose-400"}`} title={formatCurrency(cumulativeBalance)}>
              {formatCurrency(cumulativeBalance)}
            </h3>
            <span className="text-[9px] sm:text-[10px] text-(--sst-text-muted) font-bold block truncate">Toàn bộ lịch sử, không đổi theo bộ lọc</span>
          </div>
          <div className="p-2 sm:p-3 bg-violet-50 dark:bg-violet-500/10 text-violet-500 dark:text-violet-300 rounded-xl shrink-0">
            <Landmark className="w-4 h-4 sm:w-5 sm:h-5" />
          </div>
        </div>
      </div>

      {/* Primary Analytics Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Trend Area Chart (Line / Area) */}
        <div className="lg:col-span-8 bg-(--sst-surface) p-5 rounded-2xl border border-(--sst-border) shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-(--sst-text) text-sm">Biểu Đồ Xu Hướng Chi Tiêu</h3>
              <p className="text-[11px] text-(--sst-text-muted) mt-0.5 font-medium">Biến động dòng tiền ra qua các ngày trong kỳ.</p>
            </div>
            <span className="text-[10px] font-bold text-(--sst-text-muted) bg-(--sst-surface-2) px-2 py-1 rounded-lg">
              {timeFilter === "all" ? "Tất cả" : timeFilter === "month" ? "Tháng này" : timeFilter === "week" ? "Tuần này" : timeFilter === "today" ? "Hôm nay" : timeFilter === "year" ? "Năm nay" : "Tự chọn"}
            </span>
          </div>

          <div className="w-full h-64 mt-4">
            {dailySpendData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={dailySpendData} margin={{ left: 0, right: 10, top: 10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="spendGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#4f46e5" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="date" tickLine={false} style={{ fontSize: "10px", fill: "var(--sst-text-muted)" }} />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={formatCompactVND}
                    width={38}
                    tickMargin={4}
                    style={{ fontSize: "10px", fill: "var(--sst-text-muted)" }}
                  />
                  <ChartTooltip
                    formatter={(value) => formatCurrency(Number(value))}
                    contentStyle={{ borderRadius: "8px", border: "1px solid var(--sst-border-strong)", fontSize: "11px", backgroundColor: "var(--sst-surface)", color: "var(--sst-text)" }}
                  />
                  <Area
                    type="monotone"
                    dataKey="Số tiền"
                    stroke="#4f46e5"
                    strokeWidth={2.5}
                    fillOpacity={1}
                    fill="url(#spendGrad)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-(--sst-text-muted) text-xs italic space-y-1">
                <AlertCircle className="w-5 h-5 text-(--sst-text-faint)" />
                <span>Chưa có dữ liệu chi tiêu trong khoảng thời gian này.</span>
              </div>
            )}
          </div>
        </div>

        {/* Category Weight (Pie Chart / Donut Chart) */}
        <div className="lg:col-span-4 bg-(--sst-surface) p-5 rounded-2xl border border-(--sst-border) shadow-sm flex flex-col justify-between">
          <div>
            <h3 className="font-bold text-(--sst-text) text-sm">Phân Bổ Chi Tiêu Theo Danh Mục</h3>
            <p className="text-[11px] text-(--sst-text-muted) mt-0.5 font-medium">Tỷ trọng của từng nhóm danh mục chi tiêu.</p>
          </div>

          <div className="w-full h-52 flex items-center justify-center mt-3">
            {categoryChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={categoryChartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={75}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {categoryChartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <ChartTooltip
                    formatter={(value) => formatCurrency(Number(value))}
                    contentStyle={{ borderRadius: "8px", border: "1px solid var(--sst-border-strong)", fontSize: "11px", backgroundColor: "var(--sst-surface)", color: "var(--sst-text)" }}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-center text-(--sst-text-muted) text-xs italic">Không có dữ liệu chi tiêu</div>
            )}
          </div>

          {/* Table List percent */}
          <div className="mt-2 space-y-1.5 overflow-y-auto max-h-[140px] pr-1">
            {categoryChartData.map((item, idx) => {
              const totalExp = stats.totalExpense || 1;
              const pct = (item.value / totalExp) * 100;
              return (
                <div key={idx} className="flex items-center justify-between text-xs border-b border-(--sst-border) pb-1 last:border-0 last:pb-0">
                  <div className="flex items-center gap-1.5 text-(--sst-text) font-medium truncate max-w-[50%]">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: CHART_COLORS[idx % CHART_COLORS.length] }}
                    ></span>
                    <span>{item.icon}</span>
                    <span className="truncate">{item.name}</span>
                  </div>
                  <div className="text-[11px] text-(--sst-text-muted) shrink-0">
                    <span className="font-bold text-(--sst-text) mr-1.5">{formatCurrency(item.value)}</span>
                    <span>({Math.round(pct)}%)</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* NEW: Bento Grid layout for Family Budgets & Savings Goals */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Family Budgets Tracker (Ngân sách theo mục) */}
        <div className="bg-(--sst-surface) p-5 rounded-2xl border border-(--sst-border) shadow-sm space-y-4 flex flex-col justify-between">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <h3 className="font-bold text-(--sst-text) text-sm flex items-center gap-1.5">
                <ShieldAlert className="w-4 h-4 text-indigo-500 dark:text-indigo-400" />
                Kiểm Soát Hạn Mức Ngân Sách
              </h3>
              <p className="text-[11px] text-(--sst-text-muted) font-medium">Theo dõi thực chi so với giới hạn đã thiết lập.</p>
            </div>
            <button
              onClick={() => setActiveTab("budgets")}
              className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 hover:underline flex items-center gap-0.5"
            >
              Xem chi tiết <ArrowRight className="w-3 h-3" />
            </button>
          </div>

          <div className="space-y-3.5 flex-1 mt-2">
            {budgetLimitsWithStatus.length > 0 ? (
              budgetLimitsWithStatus.slice(0, 4).map((b) => {
                const isOver = b.spent > b.limit;
                const statusColor = b.percent >= 100 
                  ? "bg-rose-500" 
                  : b.percent >= 75 
                    ? "bg-amber-500" 
                    : "bg-emerald-500";
                
                return (
                  <div key={b.id} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs font-bold text-(--sst-text)">
                      <div className="flex items-center gap-1.5">
                        <span>{b.icon}</span>
                        <span>{b.name}</span>
                      </div>
                      <div className="text-right">
                        <span className={isOver ? "text-rose-600 dark:text-rose-400" : "text-(--sst-text)"}>
                          {formatCurrency(b.spent)}
                        </span>
                        <span className="text-(--sst-text-muted) font-medium"> / {formatCurrency(b.limit)}</span>
                      </div>
                    </div>
                    {/* Progress Bar */}
                    <div className="relative w-full h-2.5 bg-(--sst-surface-2) rounded-full overflow-hidden border border-(--sst-border)">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${statusColor}`}
                        style={{ width: `${Math.min(b.percent, 100)}%` }}
                      ></div>
                    </div>
                    {/* Status badge & message */}
                    <div className="flex items-center justify-between text-[10px]">
                      <span className={`font-bold ${isOver ? "text-rose-500 dark:text-rose-400 font-extrabold animate-pulse" : "text-(--sst-text-muted)"}`}>
                        {isOver 
                          ? "⚠️ Vượt hạn mức chi tiêu!" 
                          : b.percent >= 75 
                            ? "🟡 Sắp chạm ngưỡng an toàn" 
                            : "🟢 Trong vùng chi tiêu an toàn"}
                      </span>
                      <span className="text-(--sst-text-secondary) font-bold">{Math.round(b.percent)}%</span>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center text-(--sst-text-muted) text-xs italic py-6 space-y-1.5">
                <ShieldAlert className="w-6 h-6 text-(--sst-text-faint)" />
                <span>Chưa có hạn mức ngân sách nào được thiết lập.</span>
                <button
                  onClick={() => setActiveTab("budgets")}
                  className="mt-2 px-3 py-1 bg-indigo-50 dark:bg-indigo-500/10 hover:bg-indigo-100 dark:hover:bg-indigo-500/20 text-indigo-600 dark:text-indigo-300 font-bold rounded-lg text-[10px] transition-all cursor-pointer"
                >
                  + Thiết lập ngay
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Family Savings Goals Summary (Mục tiêu tiết kiệm) */}
        <div className="bg-(--sst-surface) p-5 rounded-2xl border border-(--sst-border) shadow-sm space-y-4 flex flex-col justify-between">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <h3 className="font-bold text-(--sst-text) text-sm flex items-center gap-1.5">
                <PiggyBank className="w-4 h-4 text-indigo-500 dark:text-indigo-400" />
                Mục Tiêu Tích Lũy Gia Đình
              </h3>
              <p className="text-[11px] text-(--sst-text-muted) font-medium">Theo dõi tiến độ các khoản tiết kiệm lớn.</p>
            </div>
            <button
              onClick={() => setActiveTab("goals")}
              className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 hover:underline flex items-center gap-0.5"
            >
              Xem chi tiết <ArrowRight className="w-3 h-3" />
            </button>
          </div>

          <div className="space-y-3.5 flex-1 mt-2">
            {goals.length > 0 ? (
              goals.slice(0, 4).map((g) => {
                const target = g.targetAmount || 0;
                const pct = target > 0 ? (g.currentAmount / target) * 100 : 100;
                const isCompleted = g.currentAmount >= target && target > 0;
                
                return (
                  <div key={g.id} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs font-bold text-(--sst-text)">
                      <span className="truncate max-w-[50%]">{g.name}</span>
                      <div className="text-right">
                        <span className="text-emerald-600 dark:text-emerald-400">{formatCurrency(g.currentAmount)}</span>
                        {target > 0 && (
                          <span className="text-(--sst-text-muted) font-medium"> / {formatCurrency(target)}</span>
                        )}
                      </div>
                    </div>
                    {/* Progress Bar */}
                    <div className="relative w-full h-2.5 bg-(--sst-surface-2) rounded-full overflow-hidden border border-(--sst-border)">
                      <div
                        className={`h-full rounded-full transition-all duration-500 bg-gradient-to-r from-indigo-500 to-violet-500`}
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      ></div>
                    </div>
                    {/* Progress details */}
                    <div className="flex items-center justify-between text-[10px] text-(--sst-text-muted)">
                      <span className={isCompleted ? "text-emerald-600 dark:text-emerald-400 font-extrabold" : "font-bold"}>
                        {isCompleted ? "🎉 Đã hoàn thành mục tiêu!" : "💼 Đang tích lũy tích cực"}
                      </span>
                      <span className="text-(--sst-text) font-bold">{Math.round(pct)}%</span>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center text-(--sst-text-muted) text-xs italic py-6 space-y-1.5">
                <PiggyBank className="w-6 h-6 text-(--sst-text-faint)" />
                <span>Chưa lập mục tiêu tích lũy cụ thể nào.</span>
                <button
                  onClick={() => setActiveTab("goals")}
                  className="mt-2 px-3 py-1 bg-indigo-50 dark:bg-indigo-500/10 hover:bg-indigo-100 dark:hover:bg-indigo-500/20 text-indigo-600 dark:text-indigo-300 font-bold rounded-lg text-[10px] transition-all cursor-pointer"
                >
                  + Lập mục tiêu mới
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Secondary layout for Large Expenses & Recent Transactions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top 5 Large Expenses */}
        <div className="bg-(--sst-surface) p-5 rounded-2xl border border-(--sst-border) shadow-sm space-y-4">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <h3 className="font-bold text-(--sst-text) text-sm flex items-center gap-1.5">
                <TrendingDown className="w-4 h-4 text-rose-500 dark:text-rose-400" />
                Top 5 Khoản Chi Lớn Nhất
              </h3>
              <p className="text-[11px] text-(--sst-text-muted) font-medium">Những giao dịch tốn nhiều ngân sách nhất trong chu kỳ lọc.</p>
            </div>
            <span className="text-[10px] font-bold text-rose-500 dark:text-rose-300 bg-rose-50 dark:bg-rose-500/10 px-2.5 py-1 rounded-full">Cảnh báo chi lớn</span>
          </div>

          {topExpenses.length > 0 ? (
            <div className="space-y-2.5">
              {topExpenses.map((t) => {
                const catObj = categories.find((c) => c.name === t.category);
                return (
                  <div
                    key={t.id}
                    className="flex items-center justify-between p-3 bg-(--sst-surface-2) hover:bg-indigo-50/20 rounded-xl border border-(--sst-border) transition-all text-xs"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-lg bg-(--sst-surface) border border-(--sst-border-strong) p-1.5 rounded-lg shrink-0">
                        {catObj ? catObj.icon : "💵"}
                      </span>
                      <div className="min-w-0">
                        <div className="font-bold text-(--sst-text) truncate" title={t.description}>
                          {t.description}
                        </div>
                        <div className="text-[10px] text-(--sst-text-muted) font-medium mt-0.5">
                          {new Date(t.date).toLocaleDateString("vi-VN")} • {t.category} {t.member ? `• Chịu trách nhiệm: ${t.member}` : ""}
                        </div>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="font-bold text-rose-600 dark:text-rose-400">{formatCurrency(t.amount)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-8 text-(--sst-text-muted) text-xs italic">Không có dữ liệu chi tiêu phù hợp.</div>
          )}
        </div>

        {/* Recent Transactions (Một số giao dịch gần đây) */}
        <div className="bg-(--sst-surface) p-5 rounded-2xl border border-(--sst-border) shadow-sm space-y-4">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <h3 className="font-bold text-(--sst-text) text-sm flex items-center gap-1.5">
                <BookOpen className="w-4 h-4 text-emerald-500 dark:text-emerald-400" />
                Giao Dịch Gần Đây Nhất
              </h3>
              <p className="text-[11px] text-(--sst-text-muted) font-medium">5 giao dịch mới được ghi nhận gần đây nhất của gia đình.</p>
            </div>
            <button
              onClick={() => setActiveTab("transactions")}
              className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 hover:underline flex items-center gap-0.5"
            >
              Xem sổ giao dịch <ArrowRight className="w-3 h-3" />
            </button>
          </div>

          {recentTransactions.length > 0 ? (
            <div className="space-y-2.5">
              {recentTransactions.map((t) => {
                const catObj = categories.find((c) => c.name === t.category);
                const isIncome = isIncomeTx(t); // [T-S115, 19/08/2026] nguồn sự thật txClassify.ts — trước dùng OR tự viết so tên category, khiến widget này hiện SAI (xanh/+) trái ngược với "Top 5 Khoản Chi Lớn Nhất" (đỏ, dùng isExpenseTx đúng) cho CÙNG 1 giao dịch, phát hiện qua ảnh chụp UI người dùng gửi lúc test T-S112.
                return (
                  <div
                    key={t.id}
                    className="flex items-center justify-between p-3 bg-(--sst-surface-2) hover:bg-indigo-50/20 rounded-xl border border-(--sst-border) transition-all text-xs"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-lg bg-(--sst-surface) border border-(--sst-border-strong) p-1.5 rounded-lg shrink-0">
                        {catObj ? catObj.icon : isIncome ? "💰" : "🍔"}
                      </span>
                      <div className="min-w-0">
                        <div className="font-bold text-(--sst-text) truncate" title={t.description}>
                          {t.description}
                        </div>
                        <div className="text-[10px] text-(--sst-text-muted) font-medium mt-0.5">
                          {new Date(t.date).toLocaleDateString("vi-VN")} • {t.category} {t.member ? `• ${t.member}` : ""}
                        </div>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      {t.type === "transfer" && (
                        <span className="block text-[9px] font-bold text-indigo-500 dark:text-indigo-400 uppercase tracking-wide mb-0.5">
                          Chuyển khoản
                        </span>
                      )}
                      <span
                        className={`font-bold ${
                          t.type === "transfer" ? "text-indigo-600 dark:text-indigo-400" : isIncome ? "text-emerald-600 dark:text-emerald-400" : "text-(--sst-text)"
                        }`}
                      >
                        {t.type === "transfer"
                          ? formatCurrency(Math.abs(t.amount))
                          : isIncome
                          ? `+${formatCurrency(Math.abs(t.amount))}`
                          : formatCurrency(t.amount)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-8 text-(--sst-text-muted) text-xs italic">Chưa có giao dịch nào được ghi nhận.</div>
          )}
        </div>
      </div>
    </div>
  );
}