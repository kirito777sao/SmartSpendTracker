import { useEffect, useMemo, useState, FormEvent } from "react";
// T-S06e3: SavingGoals tự đọc VÀ tự ghi qua hook thật — không còn nhận
// onAddGoal/onUpdateGoalAmount/onDeleteGoal/onEditGoal qua props.
//
// QUAN TRỌNG (CONSTITUTION §2.6): `saving_goals.current_amount` KHÔNG được
// update tay từ client — trigger DB `trg_goal_contribution` tự cộng dồn khi
// có 1 dòng `transactions` mới gắn `goal_id` (chưa bị soft-delete). Vì vậy
// "Đóng góp quỹ" ở đây gọi `useCreateTransaction` (không phải `useUpdateGoal`),
// giống hệt cách SmartInput/AIAssistantBubble đã gắn goal_id khi tạo giao dịch.
// Hệ quả: `transactions.amount` có CHECK >= 0 (không cho số âm) → ô "Đóng góp
// quỹ" giờ CHỈ nhận số dương (góp thêm), bỏ hẳn khả năng "rút quỹ" bằng số âm
// mà bản UI cũ (state cục bộ, trước khi có Supabase) từng cho phép — rút quỹ
// đúng cách sẽ cần xoá/sửa transaction đã góp, không thuộc phạm vi task này.
//
// T-S14 (migration 0013, CONSTITUTION §1.9): giao dịch góp quỹ dùng
// `type: "transfer"` (không phải "expense") — chuyển khoản nội bộ, không
// tính vào tổng thu/chi thật (xem FinancialDashboard.tsx/TransactionHistory.tsx).
// `category_id` vẫn để `null` — góp quỹ không thuộc danh mục chi tiêu nào.
import { Award, Plus, Trash2, Edit2, Check, X, PiggyBank, Calendar, History, Flag, Eye, EyeOff, ChevronDown, Link2 } from "lucide-react";
import {
  useGoals,
  useCreateGoal,
  useUpdateGoal,
  useUpdateGoalLink,
  useSoftDeleteGoal,
  useWithdrawFromLinkedGoal,
  useWithdrawFromManualGoal,
  useCompleteGoalUnspent,
} from "../hooks/useGoals";
import { useCreateTransaction, useTransactions } from "../hooks/useTransactions";
import { useCategories } from "../hooks/useCategories";
import { useHousehold, useHouseholdMembers } from "../hooks/useHousehold";
import { useDataScope } from "../hooks/useDataScope";
import { useCurrentUserId } from "../hooks/useCurrentUserId";
import { rowToGoal, rowsToTransactions, rowToCategory, rowToTransaction } from "../lib/mapRows";
import { goalManualAvailable as sharedGoalManualAvailable } from "../lib/goalAvailability";
// T-S19 — dùng lại đúng 1 chỗ resolve category_id theo tên đã có sẵn (không
// viết lại logic tìm category lần 2). KHÔNG dùng `buildTransactionInsert`
// (xem chú thích ở `useCompleteGoal`, hooks/useGoals.ts) vì hàm đó ép
// `type='transfer'` khi có `goal_id` — sai cho giao dịch mua thật.
import { resolveCategoryId } from "../lib/toTransactionInsert";
import Pagination from "./Pagination";
import AutoContributionConfig from "./AutoContributionConfig";
import AutoContributionCategoryConfig from "./AutoContributionCategoryConfig";
import { SavingGoal, Transaction } from "../types";

// T-S53 — điều khiển phân trang dùng riêng cho khối "đang tiết kiệm" và
// khối "đã hoàn thành" (2 instance độc lập, không gộp chung 1 dãy số trang,
// đúng cùng pattern `CategoryPagination` đã thêm ở `BudgetLimits.tsx`/T-S52
// — không tách ra file dùng chung vì codebase hiện tại chưa có thư mục UI
// atom chia sẻ giữa component, tránh tạo cấu trúc mới ngoài phạm vi task).
// T-S133 — GoalPagination cũ đã xoá, thay bằng component dùng chung
// `Pagination.tsx` (T-S132) ở cả 3 nơi gọi bên dưới (đang hoạt động/đã
// hoàn thành/lịch sử giao dịch).

export default function SavingGoals() {
  const { data: goalRows = [], isLoading: isLoadingGoals } = useGoals();
  const goals = useMemo(() => goalRows.map(rowToGoal), [goalRows]);
  // T-S19 — tách active/đã hoàn thành bằng completedAt. Danh sách "đang
  // tiết kiệm" (activeGoals) giữ đúng thứ tự/hành vi cũ (không đổi gì cho
  // goal chưa hoàn thành); completedGoals render riêng, ẩn khỏi lưới chính
  // (§1.9 mục 3: "chuyển sang danh sách Đã hoàn thành").
  const activeGoals = useMemo(() => goals.filter((g) => !g.completedAt), [goals]);
  const completedGoals = useMemo(() => goals.filter((g) => g.completedAt), [goals]);

  // T-S53 — tìm kiếm theo tên (client-side, `useGoals` đã fetch toàn bộ 1
  // lần) áp cho CẢ 2 khối đồng thời + toggle "Ẩn mục đã hoàn thành" (mặc
  // định BẬT = ẩn, cùng tinh thần `showIncome` ở `BudgetLimits.tsx`/§1.5) +
  // phân trang 10 mục/trang riêng cho mỗi khối.
  const GOAL_PAGE_SIZE = 10;
  const [goalSearch, setGoalSearch] = useState("");
  const [hideCompleted, setHideCompleted] = useState(true);
  const [activeGoalsPage, setActiveGoalsPage] = useState(1);
  const [completedGoalsPage, setCompletedGoalsPage] = useState(1);

  const filteredActiveGoals = useMemo(() => {
    const q = goalSearch.trim().toLowerCase();
    return q ? activeGoals.filter((g) => g.name.toLowerCase().includes(q)) : activeGoals;
  }, [activeGoals, goalSearch]);
  const filteredCompletedGoals = useMemo(() => {
    const q = goalSearch.trim().toLowerCase();
    return q ? completedGoals.filter((g) => g.name.toLowerCase().includes(q)) : completedGoals;
  }, [completedGoals, goalSearch]);

  // Đổi từ khoá tìm kiếm → nhảy về trang 1 ở CẢ 2 khối cùng lúc (tránh trang
  // hiện tại rỗng vì danh sách sau lọc ngắn hơn).
  useEffect(() => {
    setActiveGoalsPage(1);
    setCompletedGoalsPage(1);
  }, [goalSearch]);

  // Bật/tắt "Ẩn mục đã hoàn thành" chỉ ảnh hưởng khối đã hoàn thành — nhảy
  // riêng trang khối đó về 1, không đụng trang khối đang tiết kiệm.
  useEffect(() => {
    setCompletedGoalsPage(1);
  }, [hideCompleted]);

  const activeGoalsTotalPages = Math.max(1, Math.ceil(filteredActiveGoals.length / GOAL_PAGE_SIZE));
  const completedGoalsTotalPages = Math.max(1, Math.ceil(filteredCompletedGoals.length / GOAL_PAGE_SIZE));

  // Danh sách co lại (vd sau khi xoá 1 goal ở đúng trang cuối) → kéo trang
  // hiện tại về trang cuối hợp lệ, không để trang rỗng treo.
  useEffect(() => {
    setActiveGoalsPage((p) => Math.min(p, activeGoalsTotalPages));
  }, [activeGoalsTotalPages]);
  useEffect(() => {
    setCompletedGoalsPage((p) => Math.min(p, completedGoalsTotalPages));
  }, [completedGoalsTotalPages]);

  const pagedActiveGoals = useMemo(
    () => filteredActiveGoals.slice((activeGoalsPage - 1) * GOAL_PAGE_SIZE, activeGoalsPage * GOAL_PAGE_SIZE),
    [filteredActiveGoals, activeGoalsPage]
  );
  const pagedCompletedGoals = useMemo(
    () => filteredCompletedGoals.slice((completedGoalsPage - 1) * GOAL_PAGE_SIZE, completedGoalsPage * GOAL_PAGE_SIZE),
    [filteredCompletedGoals, completedGoalsPage]
  );

  // [T-S26 09/08/2026] "Xem lịch sử góp quỹ" — dữ liệu đã có sẵn ở bảng
  // `transactions` (mỗi dòng góp quỹ là 1 transaction `type='transfer'` gắn
  // `goal_id`, xem `handleTopUp` bên dưới) — không cần bảng/RPC mới, chỉ đọc
  // qua đúng 1 cửa `useTransactions` + `rowsToTransactions` đã dùng ở
  // `TransactionHistory.tsx`, tránh viết lại logic map lần 2.
  const { data: transactionRows = [] } = useTransactions();
  const { data: categoryRows = [] } = useCategories();
  const { data: household } = useHousehold();
  const { data: memberRows = [] } = useHouseholdMembers(household?.id);
  const transactions = useMemo(
    () => rowsToTransactions(transactionRows, categoryRows, memberRows),
    [transactionRows, categoryRows, memberRows]
  );
  // T-S19 — categories dạng đã map (Category[], có .type/.name) cho dropdown
  // của form "Hoàn thành", cùng shape với TransactionHistory.tsx đang dùng.
  const categories = useMemo(() => categoryRows.map(rowToCategory), [categoryRows]);
  const expenseCategories = useMemo(() => categories.filter((c) => c.type === "expense"), [categories]);
  // [SỬA BUG do T-S19 gây ra — phát hiện qua test tay 09/08/2026, xem
  // CHANGELOG] Trước T-S19, MỌI transaction có goal_id chắc chắn là
  // type='transfer' (góp quỹ) — giả định ngầm này đúng lúc viết ban đầu.
  // T-S19 gắn thêm goal_id vào giao dịch MUA THẬT (type='expense') để tiện
  // tra lịch sử (CONSTITUTION §1.9 gap note), phá vỡ giả định đó: nếu không
  // lọc type, giao dịch mua thật bị tính LẪN vào "Lịch sử góp quỹ" như thể
  // là 1 khoản góp, khiến tổng hiển thị gần gấp đôi current_amount thật (đã
  // tái hiện đúng lỗi người dùng báo: goal chỉ có 200.000đ nhưng modal lịch
  // sử cộng ra 400.000đ = 200k góp + 200k giao dịch mua thật bị tính nhầm).
  // "Lịch sử góp quỹ" đúng nghĩa chỉ nên liệt kê CÁC KHOẢN GÓP
  // (type='transfer') — giao dịch mua thật đã có chỗ riêng ở "Sổ Giao
  // Dịch", không cần lặp lại ở đây với vai trò "khoản góp".
  // T-S62 (CONSTITUTION §1.20.2) — lookup goalId -> Set ID giao dịch đã
  // từng được đóng băng (carriedOverTransactionIds, map từ 0019). Dùng để
  // loại trừ khỏi MỌI phép tính "đang sống" bên dưới (contributionsByGoal,
  // linkedAmountByGoal/linkedHistoryByGoal) — nguyên tắc idempotency-key
  // đã chốt ở §1.20.1 cho phía RPC (đóng băng), giờ áp NGUYÊN VẸN cho phía
  // client (tính động): 1 giao dịch chỉ được tính đúng 1 lần trong toàn bộ
  // vòng đời goal, dù nó rơi vào carried_over_* hay phần đang sống.
  const carriedIdsByGoal = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const g of goals) map.set(g.id, new Set(g.carriedOverTransactionIds));
    return map;
  }, [goals]);

  const contributionsByGoal = useMemo(() => {
    const map = new Map<string, Transaction[]>();
    for (const t of transactions) {
      if (!t.goalId || t.type !== "transfer") continue;
      // T-S62 — bỏ qua giao dịch transfer đã đóng băng vào
      // carriedOverSavedAmount ở 1 lần link trước đó (case "thủ công ->
      // liên kết" của update_goal_link) — nếu không, khi goal quay lại
      // thủ công, giao dịch này bị cộng đúp: 1 lần trong
      // carriedOverSavedAmount, 1 lần ở đây.
      if (carriedIdsByGoal.get(t.goalId)?.has(t.id)) continue;
      const list = map.get(t.goalId) ?? [];
      list.push(t);
      map.set(t.goalId, list);
    }
    // Mới nhất trước — cùng quy ước sort mặc định "date_desc" của TransactionHistory.
    for (const list of map.values()) {
      list.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    }
    return map;
  }, [transactions, carriedIdsByGoal]);

  // T-S34 — "Đã chi tiêu thật" cho goal đã hoàn thành: mọi giao dịch
  // `type='expense'` có `goal_id` (gắn lúc bấm "Hoàn thành"/banner T-S20,
  // xem `handleSaveComplete` + `useCompleteGoal`) là khoản MUA THẬT, tách
  // hẳn khỏi `contributionsByGoal` (transfer, khoản góp) ở trên. Bình
  // thường mỗi goal chỉ có đúng 1 giao dịch dạng này (luồng hoàn thành chỉ
  // chạy 1 lần/goal), nhưng cộng dồn phòng trường hợp dữ liệu cũ/chỉnh tay
  // có nhiều dòng — không giả định cứng chỉ 1 dòng.
  const completionSpendByGoal = useMemo(() => {
    // [T-S65] Thêm `list` (các giao dịch gốc, không chỉ tổng/đếm) — cần
    // để hiện từng dòng "Đã rút" trong modal Lịch sử (trước T-S65, modal
    // chỉ đọc `contributionsByGoal`, hoàn toàn không biết các giao dịch
    // rút thủ công này tồn tại — xem CHANGELOG, ảnh 13).
    const map = new Map<string, { total: number; count: number; list: Transaction[] }>();
    for (const t of transactions) {
      if (!t.goalId || t.type !== "expense") continue;
      const cur = map.get(t.goalId) ?? { total: 0, count: 0, list: [] };
      cur.list.push(t);
      map.set(t.goalId, { total: cur.total + Math.abs(t.amount), count: cur.count + 1, list: cur.list });
    }
    return map;
  }, [transactions]);

  // T-S48 (CONSTITUTION §1.13 mục 2) — current_amount của goal LIÊN KẾT
  // category KHÔNG đọc từ DB (cột current_amount trên bảng không dùng cho
  // loại goal này) — luôn tự tính = SUM `transactionRows` (RAW row, dùng
  // `category_id` thật để so khớp, KHÔNG dùng `transactions` đã map tên —
  // mapRows chỉ resolve category_id -> TÊN, đổi tên category sau này sẽ
  // làm sai khớp nếu so theo tên), `type==='expense'`, `date` nằm trong
  // `[linked_start_date, linked_end_date]` của ĐÚNG goal đó. RLS select đã
  // tự lọc `deleted_at is null` (không lọc lại thủ công ở đây, đúng pattern
  // `contributionsByGoal`/`completionSpendByGoal` phía trên).
  // [T-S54, 10/08/2026 — bug thật người dùng phát hiện qua ảnh chụp UI]
  // "Lịch sử góp quỹ" ở goal LIÊN KẾT category luôn rỗng dù ngân sách/
  // progress bar cộng đúng số tiền: `contributionsByGoal` ở trên chỉ đọc
  // `transactions.type='transfer'` gắn `goal_id` — đúng cho goal THỦ CÔNG
  // (T-S14), nhưng goal LIÊN KẾT (T-S48) không bao giờ có transaction nào
  // gắn `goal_id` (đúng thiết kế §1.13 — 2 sổ độc lập, không tạo
  // transaction "góp quỹ" giả cho category liên kết); `current_amount`
  // loại này tự tính từ TỔNG giao dịch `type='expense'` của category đó
  // trong khoảng ngày, KHÔNG có khái niệm "1 khoản góp" rời rạc theo
  // `goal_id`. Nguồn sự thật cho "lịch sử" của loại goal này vì vậy PHẢI
  // là chính danh sách giao dịch chi tiêu đã cộng vào tổng đó — tức DÙNG
  // LẠI ĐÚNG điều kiện lọc của `linkedAmountByGoal` (category_id + khoảng
  // ngày + type='expense'), chỉ khác là giữ lại cả DÒNG thay vì chỉ cộng
  // dồn `amount`. Tính trong CÙNG 1 vòng lặp để không quét `transactionRows`
  // 2 lần cho cùng 1 tập điều kiện.
  // [T-S62, CONSTITUTION §1.20.2 — fix bug thật, người dùng phát hiện qua
  // ảnh chụp UI 12/08/2026] `migration 0019` (T-S61) làm bước ĐÓNG BĂNG
  // idempotent (dedup theo `carried_over_transaction_ids`) nhưng bỏ sót
  // đúng CHỖ NÀY — phép tính "đang sống" vẫn SUM lại MỌI giao dịch khớp
  // category+khoảng ngày, kể cả giao dịch ĐÃ được đóng băng ở 1 lần
  // link/unlink trước đó nếu nó tình cờ vẫn rơi vào category/khoảng ngày
  // hiện tại (đổi ngày chồng lấp, hoặc link lại đúng category cũ) => đếm
  // đúp: 1 lần trong `carriedOverSpentAmount`, 1 lần ở "đang sống" tại đây.
  // Bắt buộc loại trừ theo ID (`carriedIdsByGoal`, giống hệt cơ chế RPC).
  const { linkedAmountByGoal, linkedHistoryByGoal } = useMemo(() => {
    const amountMap = new Map<string, number>();
    const historyMap = new Map<string, Transaction[]>();
    for (const g of goals) {
      if (!g.linkedCategoryId || !g.linkedStartDate || !g.linkedEndDate) continue;
      const carriedIds = carriedIdsByGoal.get(g.id);
      let sum = 0;
      const matchedRows: typeof transactionRows = [];
      for (const row of transactionRows) {
        if (row.type !== "expense") continue;
        if (row.category_id !== g.linkedCategoryId) continue;
        if (row.date < g.linkedStartDate || row.date > g.linkedEndDate) continue;
        if (carriedIds?.has(row.id)) continue;
        // [T-S80, CONSTITUTION §1.22.5, SỬA LẠI T-S87 §1.22.7] Category
        // "chi tiêu thường" (isSavingsLink=false) → không hồi tố, chỉ tính
        // giao dịch từ linkedAt trở đi. [T-S87] So theo NGÀY (row.date vs
        // linkedAt.slice(0,10)) là BUG: transactions.date không có giờ, nên
        // giao dịch nhập CÙNG NGÀY với lúc bấm Liên kết luôn lọt qua dù
        // nhập TRƯỚC đó vài giờ. Sửa: so theo `row.created_at` (timestamptz,
        // thời điểm INSERT thật, không đổi khi user sửa lại `date`) vs
        // `linkedAt` (timestamptz) — khớp đúng điều kiện
        // `t.created_at >= v_goal.linked_at` ở RPC `update_goal_link`
        // (migration 0026).
        if (!g.isSavingsLink && row.created_at < g.linkedAt) continue;
        sum += row.amount;
        matchedRows.push(row);
      }
      amountMap.set(g.id, sum);
      // Map lại qua `rowToTransaction` (đã có sẵn, không viết logic map lần
      // 2) để có đúng shape hiển thị (description/date đã resolve) giống
      // hệt `contributionsByGoal`/`TransactionHistory`. Mới nhất trước.
      const history = matchedRows
        .map((row) => rowToTransaction(row, categoryRows, memberRows))
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
      historyMap.set(g.id, history);
    }
    return { linkedAmountByGoal: amountMap, linkedHistoryByGoal: historyMap };
  }, [goals, transactionRows, categoryRows, memberRows, carriedIdsByGoal]);

  /**
   * [T-S57, CONSTITUTION §1.20 — công thức "Tổng đã tích luỹ"] Số tiền
   * hiển thị đúng của 1 goal = carriedOverSavedAmount + carriedOverSpentAmount
   * (2 giai đoạn TRƯỚC ĐÓ đã "đóng băng" khi đổi liên kết/unlink/link, luôn
   * cộng vào bất kể loại hiện tại) + PHẦN ĐANG SỐNG (tính động theo category
   * nếu đang liên kết, hoặc currentAmount thủ công nếu đang thủ công). Trước
   * T-S57 chỉ có phần "đang sống" (bug tiềm ẩn: đổi liên kết sẽ làm tụt số
   * hiển thị nếu không cộng carried_over — đã tránh được nhờ thiết kế RPC
   * luôn cộng dồn trước khi đổi nguồn). Dùng hàm này ở MỌI chỗ hiển thị/tính
   * % thay vì đọc `goal.currentAmount` trực tiếp (CONSTITUTION §5).
   *
   * [T-S64] Goal KHÔNG liên kết (thủ công): `goal.currentAmount` (cột DB)
   * chỉ được trigger `apply_goal_contribution` CỘNG khi có dòng `transfer`
   * mới — trigger không có nhánh nào xử lý dòng rút (`type='expense'`+
   * `goal_id`, tạo bởi `useWithdrawFromManualGoal`/T-S60). Phải tự trừ ở
   * tầng client bằng `completionSpendByGoal` (đã có sẵn từ T-S34, cùng
   * nguồn dữ liệu `goalManualAvailable` dùng để validate form rút) —
   * KHÔNG trừ 2 lần cho goal liên kết (rút liên kết là ghi log, không tạo
   * giao dịch, không nằm trong `completionSpendByGoal`).
   *
   * [T-S64] Tách riêng `manualPortionAmount()` — đúng phần "thủ công"
   * (carried + current_amount thủ công − đã rút thật) của 1 goal, dùng
   * chung cho cả `goalCurrentAmount` (khi goal KHÔNG liên kết) lẫn
   * `goalManualAvailable` (form Rút quỹ, cần đúng số này bất kể goal có
   * đang liên kết hay không — case 2 nguồn song song, xem §1.20). Trước
   * T-S64, 2 nơi này tự tính riêng, lệch nhau khi có rút — đây là root
   * cause bug "form rút trừ đúng, card chính không trừ" (xem CHANGELOG).
   */
  // [T-S67 patch] Công thức chuyển hẳn sang `goalAvailability.ts` (dùng
  // chung với banner tự động ở SmartInput.tsx/AIAssistantBubble.tsx) — giữ
  // tên `manualPortionAmount` cục bộ để không phải sửa mọi nơi gọi nó bên
  // dưới, nhưng KHÔNG còn tự viết công thức riêng ở đây nữa (đúng quy tắc
  // "1 công thức, 1 nơi", CONSTITUTION, bug T-S64/64b). Vẫn dùng `transactions`
  // gốc (giống `completionSpendByGoal`) chứ không đọc lại `.total` đã memo,
  // vì hàm dùng chung nhận danh sách transaction thô để nơi khác gọi được.
  const manualPortionAmount = (goal: SavingGoal): number => sharedGoalManualAvailable(goal, transactions);

  // [T-S68, 12/08/2026 — thiết kế xác nhận: "rút phần liên kết" giờ có
  // giới hạn thật giống phần thủ công] Tổng đã rút LOG (type='withdrawal_log'
  // trong linked_history, ghi bởi `withdraw_from_linked_goal` RPC, 0021) —
  // KHÔNG cần migration mới, dữ liệu đã có sẵn từ T-S60, chỉ chưa được TRỪ
  // ở đâu cả (đây chính là root cause khiến "Đã có" không giảm + rút vô
  // hạn được, người dùng báo qua test tay 12/08/2026).
  const linkedWithdrawnTotal = (goal: SavingGoal): number =>
    goal.linkedHistory
      .filter((h) => h.type === "withdrawal_log")
      .reduce((sum, h) => sum + h.amount, 0);

  // [T-S72, 13/08/2026 — bug thật xác nhận qua ảnh 5/6/7: goal "gộp cả 2"
  // (mua xịt) ĐÃ UNLINK (goal.linkedCategoryId hiện null) nhưng còn mang
  // `carriedOverSpentAmount` đóng băng từ giai đoạn liên kết cũ — rơi vào
  // nhánh `else` bên dưới, nhánh này KHÔNG trừ `linkedWithdrawnTotal` (T-S70
  // chỉ sửa nhánh `if (goal.linkedCategoryId)`, bỏ sót đúng trường hợp này —
  // "Phần liên kết (còn X)" ở form Rút quỹ giảm đúng, nhưng "Đã có" trên
  // card thì không đổi). Chuyển phép trừ ra NGOÀI if/else — áp dụng cho CẢ
  // 2 nhánh, không phân biệt goal có đang liên kết hay không (goal thuần
  // thủ công chưa từng liên kết có `linkedWithdrawnTotal`=0 nên không ảnh
  // hưởng, an toàn).
  //
  // [BUGFIX T-S84, 14/08/2026 — bug thật người dùng phát hiện qua test tay
  // T-S83: goal GỘP CẢ 2 NGUỒN, ĐANG LIÊN KẾT category (linkedCategoryId
  // khác null) — rút từ PHẦN THỦ CÔNG tạo đúng giao dịch expense thật
  // (Sổ Giao Dịch đúng, `manualPortionAmount()`/form "Rút quỹ" cũng hiện
  // đúng số dư còn lại), NHƯNG "Đã có" trên card KHÔNG giảm]. Root cause:
  // nhánh `if (goal.linkedCategoryId)` ở trên dùng THẲNG
  // `goal.carriedOverSavedAmount` (cột đóng băng thô, KHÔNG trừ rút) thay
  // vì `manualPortionAmount(goal)` (đã trừ `manualWithdrawnTotal` — xem
  // `goalAvailability.ts`) — chỉ nhánh `else` (goal KHÔNG đang liên kết)
  // vô tình đi qua đúng công thức trừ rút vì nó gọi `manualPortionAmount`.
  // Đây đúng lớp bug đã cảnh báo ở CONSTITUTION (bug T-S64/64b: "1 công
  // thức, 1 nơi") — 2 nhánh tính riêng phần thủ công thay vì gọi chung 1
  // hàm. Sửa: CẢ 2 nhánh đều dùng `manualPortionAmount(goal)` thay cho
  // `goal.carriedOverSavedAmount` thô (khi ĐANG liên kết, `goal.currentAmount`
  // luôn = 0 do trigger `update_goal_link` reset lúc link — migration 0018 —
  // nên `manualPortionAmount(goal) = carriedOverSavedAmount + 0 -
  // manualWithdrawnTotal`, đúng NGUYÊN VẸN giá trị cũ CỘNG THÊM phần trừ
  // rút còn thiếu, không đổi hành vi khi chưa từng rút thủ công).
  const goalCurrentAmount = (goal: SavingGoal): number => {
    const gross =
      manualPortionAmount(goal) +
      goal.carriedOverSpentAmount +
      (goal.linkedCategoryId ? linkedAmountByGoal.get(goal.id) ?? 0 : 0);
    return gross - linkedWithdrawnTotal(goal);
  };

  /** [T-S64b] Tổng GỘP (gross, KHÔNG trừ rút) — khác `goalCurrentAmount`
   * (net, đã trừ rút thủ công, dùng cho "Đã có" ở card ĐANG active — số
   * còn thật sự dùng được tiếp). Card "Đã hoàn thành" (T-S34) cần khái
   * niệm KHÁC: "đã từng tích luỹ được bao nhiêu trong suốt vòng đời goal"
   * để đối chiếu với "đã chi tiêu thật" ra dư/thiếu — dùng bản net ở đây
   * sẽ trừ hụt 2 lần (1 lần do rút đã trừ vào net, 1 lần do `diff` trừ
   * tiếp cho `spendInfo.total`). Trước T-S64b, `goal.currentAmount` (cột
   * DB thô) bị dùng nhầm làm việc này — với goal LOẠI LIÊN KẾT category,
   * cột này ĐÚNG THIẾT KẾ luôn = 0 (không lưu cứng, xem §1.13) nên card
   * hoàn thành hiện sai "Đã tích lũy: 0đ" (xem CHANGELOG, ảnh 28/29). */
  const goalGrossAccumulated = (goal: SavingGoal): number => {
    const live = goal.linkedCategoryId ? linkedAmountByGoal.get(goal.id) ?? 0 : goal.currentAmount;
    return goal.carriedOverSavedAmount + goal.carriedOverSpentAmount + live;
  };

  /** [T-S54] "Lịch sử" đúng nguồn theo loại goal — thủ công đọc
   * `contributionsByGoal` (transfer gắn goal_id) như cũ; liên kết category
   * đọc `linkedHistoryByGoal` (expense trong category+khoảng ngày). Dùng
   * hàm này ở MỌI nơi hiển thị lịch sử thay vì đọc thẳng
   * `contributionsByGoal` — cùng nguyên tắc với `goalCurrentAmount` ở trên.
   *
   * [T-S84, 14/08/2026 — BUGFIX, thay thế hoàn toàn cách gộp của T-S65]
   * Trước T-S84, hàm này CHỈ gộp thêm các dòng rút thủ công
   * (`completionSpendByGoal.list`) khi goal KHÔNG đang liên kết
   * (`!goal.linkedCategoryId`) — goal GỘP CẢ 2 NGUỒN nhưng ĐANG liên kết
   * (`linkedCategoryId` khác null) rơi vào nhánh `if` sớm ở trên, hoàn
   * toàn KHÔNG BAO GIỜ thấy được các dòng rút thủ công dù đã ghi thật
   * trong Sổ Giao Dịch — bug thật người dùng phát hiện qua test tay T-S83
   * (modal "Lịch sử" không có bất kỳ dòng nào cho lần rút thủ công). Sửa
   * TRIỆT ĐỂ: KHÔNG còn gộp rút thủ công vào danh sách "đang sống" này ở
   * BẤT KỲ nhánh nào nữa (dù linked hay không) — MỌI khoản rút thủ công
   * giờ hiển thị THỐNG NHẤT ở khối "Đã rút quỹ" (`withdrawalGroupsFor()`,
   * T-S83/T-S84, đọc thẳng `completionSpendByGoal` không qua hàm này) —
   * tránh đúng lỗi gốc "goal liên kết suy luận sai `t.type==='expense'` là
   * GÓP thay vì RÚT" (T-S73) nếu gộp chung 1 danh sách rồi tự đoán dấu +/-
   * qua `linkedCategoryId`. Hàm này giờ CHỈ còn trả về các khoản GÓP thuần
   * (transfer thủ công hoặc expense trong category liên kết — cả 2 luôn
   * mang nghĩa "+"), không còn lẫn khoản RÚT nào — đúng đúng yêu cầu
   * "phân loại rõ ràng" của người dùng. */
  const goalHistoryFor = (goal: SavingGoal): Transaction[] => {
    if (goal.linkedCategoryId) return linkedHistoryByGoal.get(goal.id) ?? [];
    return contributionsByGoal.get(goal.id) ?? [];
  };

  /**
   * [T-S83, CONSTITUTION — "gom 2 phần cùng 1 lần rút thành 1 nhóm rõ ràng",
   * migration 0023] Trước T-S83, 1 lần "Rút quỹ" bị cascade qua CẢ 2 nguồn
   * (thủ công + liên kết) hiện ra thành 2 dòng HOÀN TOÀN rời rạc trong modal
   * "Lịch sử": 1 dòng trong danh sách "đang sống" (giao dịch expense thật,
   * phần thủ công) và 1 dòng trong khối rose "Đã rút từ phần liên kết"
   * (log-only, phần liên kết) — không có gì cho người dùng biết 2 dòng đó
   * là CÙNG 1 lần bấm "Rút quỹ". Hàm này gom lại theo `withdrawalGroupId`
   * (khớp `Transaction.withdrawalGroupId` <-> `LinkedHistoryEntry.withdrawalGroupId`,
   * cùng giá trị do `handleSaveWithdraw` sinh ra lúc cascade) thành 1 danh
   * sách phẳng, mới nhất trước, mỗi phần tử biết rõ:
   *   - `manualAmount`/`linkedAmount`: rút bao nhiêu ở TỪNG nguồn ("ví nào
   *     bao nhiêu" theo đúng yêu cầu người dùng).
   *   - `isGrouped`: true nếu là 1 lần cascade thật (cả 2 nguồn >0).
   * Rút chỉ 1 nguồn (đa số trường hợp, hành vi cũ) vẫn hiện đúng như cũ,
   * chỉ khác là đi qua CHUNG 1 danh sách này thay vì 2 khối tách rời trước
   * đây — dễ sắp xếp theo thời gian xuyên suốt cả 2 nguồn.
   */
  type WithdrawalGroupDisplay = {
    key: string;
    date: string;
    note: string;
    manualAmount: number;
    linkedAmount: number;
    isGrouped: boolean;
  };
  const withdrawalGroupsFor = (goal: SavingGoal): WithdrawalGroupDisplay[] => {
    const manualTxs = completionSpendByGoal.get(goal.id)?.list ?? [];
    const linkedLogs = goal.linkedHistory.filter((h) => h.type === "withdrawal_log");
    const groups = new Map<string, WithdrawalGroupDisplay>();
    const standalone: WithdrawalGroupDisplay[] = [];

    for (const tx of manualTxs) {
      if (tx.withdrawalGroupId) {
        const existing = groups.get(tx.withdrawalGroupId);
        groups.set(tx.withdrawalGroupId, {
          key: tx.withdrawalGroupId,
          date: tx.date,
          note: tx.description,
          manualAmount: (existing?.manualAmount ?? 0) + Math.abs(tx.amount),
          linkedAmount: existing?.linkedAmount ?? 0,
          isGrouped: true,
        });
      } else {
        standalone.push({
          key: `manual-${tx.id}`,
          date: tx.date,
          note: tx.description,
          manualAmount: Math.abs(tx.amount),
          linkedAmount: 0,
          isGrouped: false,
        });
      }
    }
    for (const log of linkedLogs) {
      if (log.withdrawalGroupId && groups.has(log.withdrawalGroupId)) {
        const existing = groups.get(log.withdrawalGroupId)!;
        groups.set(log.withdrawalGroupId, { ...existing, linkedAmount: existing.linkedAmount + log.amount });
      } else if (log.withdrawalGroupId) {
        // GroupId có nhưng chưa thấy dòng transactions phần thủ công tương
        // ứng (vd đang tải dữ liệu, hoặc phần thủ công lỗi/bị xoá sau đó) —
        // vẫn hiện đúng phần liên kết đã ghi, không chặn/ẩn.
        groups.set(log.withdrawalGroupId, {
          key: log.withdrawalGroupId,
          date: log.endedAt.slice(0, 10),
          note: log.note || "Rút quỹ",
          manualAmount: 0,
          linkedAmount: log.amount,
          isGrouped: true,
        });
      } else {
        standalone.push({
          key: `linked-${log.endedAt}-${log.amount}-${log.note ?? ""}`,
          date: log.endedAt.slice(0, 10),
          note: log.note || "Rút quỹ",
          manualAmount: 0,
          linkedAmount: log.amount,
          isGrouped: false,
        });
      }
    }
    return [...groups.values(), ...standalone].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  };

  // goal đang mở modal lịch sử đầy đủ (id, hoặc null = đóng)
  const [historyGoalId, setHistoryGoalId] = useState<string | null>(null);
  const historyGoal = goals.find((g) => g.id === historyGoalId) ?? null;
  const historyContributions = historyGoal ? goalHistoryFor(historyGoal) : [];
  // [T-S56 11/08/2026 — yêu cầu bổ sung] Phân trang 10/trang cho modal
  // "Lịch sử" — áp dụng CHUNG cho cả 2 loại (goal thủ công "Lịch sử góp
  // quỹ" lẫn goal liên kết category "Lịch sử chi tiêu", cùng 1 modal nên
  // dùng chung 1 state trang). Reset về trang 1 mỗi khi đổi goal đang xem
  // (mở modal cho goal khác hoặc đóng rồi mở lại).
  const [historyPage, setHistoryPage] = useState(1);
  // T-S61 — chỉ số (trong historyGoal.linkedHistory, đã reverse để hiện mới
  // nhất trước) của các giai đoạn đang mở rộng để xem chi tiết
  // transactionsSnapshot. Set rỗng = tất cả đang thu gọn (chỉ hiện dòng tổng).
  const [expandedHistoryIdx, setExpandedHistoryIdx] = useState<Set<number>>(new Set());
  useEffect(() => {
    setHistoryPage(1);
    setExpandedHistoryIdx(new Set());
  }, [historyGoalId]);
  const historyTotalPages = Math.max(1, Math.ceil(historyContributions.length / 10));
  const pagedHistoryContributions = historyContributions.slice((historyPage - 1) * 10, historyPage * 10);

  const { scopeMode, householdId } = useDataScope();
  const userId = useCurrentUserId();

  const createGoalMutation = useCreateGoal();
  const updateGoalMutation = useUpdateGoal();
  const updateGoalLinkMutation = useUpdateGoalLink();
  const softDeleteGoalMutation = useSoftDeleteGoal();
  const createTransactionMutation = useCreateTransaction();
  const withdrawLinkedMutation = useWithdrawFromLinkedGoal();
  const withdrawManualMutation = useWithdrawFromManualGoal();
  const completeUnspentMutation = useCompleteGoalUnspent();

  const [isAdding, setIsAdding] = useState(false);
  const [goalName, setGoalName] = useState("");
  const [goalTarget, setGoalTarget] = useState("");
  const [goalDate, setGoalDate] = useState("");
  // T-S48 (CONSTITUTION §1.13) — bật lên: goal thuộc loại "liên kết
  // category", ẩn ý nghĩa "Số tiền hiện có ban đầu" (form này vốn không có
  // ô đó — currentAmount luôn bắt đầu 0 do trigger, không cần ẩn gì thêm).
  const [isLinkedGoal, setIsLinkedGoal] = useState(false);
  const [linkedCategoryId, setLinkedCategoryId] = useState("");
  const [linkedStartDate, setLinkedStartDate] = useState("");
  const [linkedEndDate, setLinkedEndDate] = useState("");
  const [linkedDateError, setLinkedDateError] = useState<string | null>(null);
  // [T-S80/T-S81, CONSTITUTION §1.22.5] Bắt buộc chọn tường minh khi tạo
  // goal ĐÃ liên kết category ngay từ đầu — undefined = CHƯA chọn (chặn Lưu,
  // không mặc định), true = "tiết kiệm" (hồi tố đầy đủ), false = "chi tiêu
  // thường" (chỉ tính từ lúc tạo trở đi).
  const [newGoalIsSavingsLink, setNewGoalIsSavingsLink] = useState<boolean | undefined>(undefined);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [topUpAmount, setTopUpAmount] = useState("");
  const [topUpError, setTopUpError] = useState(false);

  // T-S60 (CONSTITUTION §1.21, thay hẳn nút "Hoàn thành" 1-lần T-S19) —
  // form "Rút quỹ": lặp lại được, goal sống tiếp trừ khi tick "Đóng mục
  // tiêu". `withdrawSource` bắt buộc chọn khi goal có CẢ 2 loại số dư
  // (không tự đoán hộ, đúng §5) — "linked" chỉ ghi log (không tạo giao
  // dịch, xem `useWithdrawFromLinkedGoal`), "manual" tạo giao dịch expense
  // thật (xem `useWithdrawFromManualGoal`, dùng lại đúng cách dựng object
  // thủ công của `useCompleteGoal` cũ).
  const [withdrawingId, setWithdrawingId] = useState<string | null>(null);
  const [withdrawSource, setWithdrawSource] = useState<"linked" | "manual" | "">("");
  const [withdrawNote, setWithdrawNote] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawCatName, setWithdrawCatName] = useState("");
  const [withdrawCloseGoal, setWithdrawCloseGoal] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  // Cùng pattern catMatched đã CHỐT §1.4 — bắt chọn 1 category thật có sẵn,
  // không cho trống/lệch nhóm đi qua. Chỉ áp dụng khi nguồn rút = "manual".
  const withdrawCatMatched = useMemo(
    () => expenseCategories.some((c) => c.name === withdrawCatName),
    [expenseCategories, withdrawCatName]
  );
  // [BUGFIX 08/08/2026] Xoá mục tiêu bị RPC delete_goal chặn khi không phải
  // chủ hộ / người tạo (CONSTITUTION §3), nhưng trước đây không có onError
  // -> lỗi im lặng. Sửa/tạo mục tiêu KHÔNG bị hạn chế theo role (đúng như
  // đã CHỐT — mọi thành viên đều sửa được), chỉ XOÁ mới cần báo lỗi quyền.
  const [writeError, setWriteError] = useState<string | null>(null);

  // Detailed editing state (name, target, date)
  const [editingDetailsId, setEditingDetailsId] = useState<string | null>(null);
  const [editGoalName, setEditGoalName] = useState("");
  const [editGoalTarget, setEditGoalTarget] = useState("");
  const [editGoalDate, setEditGoalDate] = useState("");

  const handleStartEditDetails = (goal: SavingGoal) => {
    setEditingDetailsId(goal.id);
    setEditGoalName(goal.name);
    setEditGoalTarget(goal.targetAmount ? goal.targetAmount.toString() : "");
    setEditGoalDate(goal.targetDate || "");
  };

  // [T-S57, CONSTITUTION §1.20] Form "Sửa liên kết" — TÁCH RIÊNG khỏi form
  // "Sửa mục tiêu" (name/target/date) ở trên, vì đây là hành động đổi ngữ
  // nghĩa dòng tiền (carry-over), cần bước xác nhận riêng hiện rõ số tiền
  // sẽ dồn sang trước khi lưu (bắt buộc theo thiết kế đã CHỐT) — gộp chung
  // 1 form với sửa tên/target sẽ làm mất bước xác nhận đó.
  const [editingLinkId, setEditingLinkId] = useState<string | null>(null);
  const [linkFormLinked, setLinkFormLinked] = useState(false);
  const [linkFormCategoryId, setLinkFormCategoryId] = useState("");
  const [linkFormStartDate, setLinkFormStartDate] = useState("");
  const [linkFormEndDate, setLinkFormEndDate] = useState("");
  // [T-S80/T-S81, CONSTITUTION §1.22.5] Cùng ý nghĩa `newGoalIsSavingsLink`
  // ở trên, áp dụng khi SỬA liên kết goal đã tồn tại (đổi category, hoặc
  // link 1 goal thủ công sẵn có sang category). Bắt buộc chọn lại MỖI LẦN
  // đổi sang category khác (không giữ lựa chọn cũ, vì category mới có thể
  // khác bản chất hoàn toàn) — reset về undefined mỗi khi mở form Sửa liên
  // kết (xem handleStartEditLink bên dưới).
  const [linkFormIsSavingsLink, setLinkFormIsSavingsLink] = useState<boolean | undefined>(undefined);
  const [linkFormError, setLinkFormError] = useState<string | null>(null);
  // true = đang ở bước xác nhận (đã bấm "Lưu" 1 lần, chờ bấm lại để confirm).
  const [linkFormConfirming, setLinkFormConfirming] = useState(false);

  const handleStartEditLink = (goal: SavingGoal) => {
    setEditingLinkId(goal.id);
    setLinkFormLinked(!!goal.linkedCategoryId);
    setLinkFormCategoryId(goal.linkedCategoryId ?? "");
    setLinkFormStartDate(goal.linkedStartDate ?? "");
    setLinkFormEndDate(goal.linkedEndDate ?? "");
    // [T-S80/T-S81] Prefill đúng lựa chọn hiện có nếu goal ĐANG liên kết
    // (mở form chỉ để sửa ngày, không đổi category — RPC nhánh đó không
    // đụng is_savings_link nên giữ nguyên giá trị cũ là đúng). Goal thủ
    // công/chưa liên kết → undefined (bắt buộc chọn mới).
    setLinkFormIsSavingsLink(goal.linkedCategoryId ? goal.isSavingsLink : undefined);
    setLinkFormError(null);
    setLinkFormConfirming(false);
  };

  const handleCancelEditLink = () => {
    setEditingLinkId(null);
    setLinkFormIsSavingsLink(undefined);
    setLinkFormError(null);
    setLinkFormConfirming(false);
  };

  /**
   * [T-S57] Số tiền sẽ "dồn sang" (carry-over) nếu xác nhận thay đổi này —
   * tính TRƯỚC ở client để hiện trong bước xác nhận (đúng số RPC sẽ tự tính
   * lại atomic ở server, chỉ khác là preview không cần atomic vì chưa ghi
   * gì). Trả về null nếu thay đổi này KHÔNG dồn gì (chỉ đổi ngày, giữ
   * nguyên category — §1.20 mục 2).
   */
  const previewCarryOverAmount = (goal: SavingGoal): number | null => {
    const targetCategoryId = linkFormLinked ? linkFormCategoryId : null;
    if (targetCategoryId === (goal.linkedCategoryId ?? null)) return null; // mục 2: không dồn
    if (goal.linkedCategoryId) return linkedAmountByGoal.get(goal.id) ?? 0; // mục 1/3: đóng băng dynamic cũ
    return goal.currentAmount; // mục 4: đóng băng current_amount thủ công cũ
  };

  const handleSubmitEditLink = (goal: SavingGoal) => {
    setLinkFormError(null);
    if (linkFormLinked) {
      if (!linkFormCategoryId || !linkFormStartDate || !linkFormEndDate) {
        setLinkFormError("Chọn đủ danh mục và khoảng ngày để liên kết.");
        return;
      }
      if (linkFormEndDate < linkFormStartDate) {
        setLinkFormError("Ngày kết thúc phải sau hoặc bằng ngày bắt đầu.");
        return;
      }
      // [T-S80/T-S81, CONSTITUTION §1.22.5] Bắt buộc chọn tường minh loại
      // ngân sách — không có giá trị mặc định, không suy luận qua từ khoá.
      if (linkFormIsSavingsLink === undefined) {
        setLinkFormError('Chọn "Ngân sách tiết kiệm" hoặc "Ngân sách chi tiêu thường" trước khi lưu.');
        return;
      }
    }
    // Bước 1 (chưa confirm): chỉ mở bước xác nhận, KHÔNG gọi RPC ngay — bắt
    // buộc theo thiết kế đã CHỐT (modal xác nhận hiện rõ số tiền sẽ dồn sang
    // trước khi lưu thật).
    if (!linkFormConfirming) {
      setLinkFormConfirming(true);
      return;
    }
    // Bước 2 (đã confirm): gọi RPC thật.
    updateGoalLinkMutation.mutate(
      {
        goalId: goal.id,
        link: linkFormLinked
          ? {
              linkedCategoryId: linkFormCategoryId,
              linkedStartDate: linkFormStartDate,
              linkedEndDate: linkFormEndDate,
              // Đã validate khác undefined ở trên khi linkFormLinked=true.
              isSavingsLink: linkFormIsSavingsLink === true,
            }
          : null,
      },
      {
        onError: (err: any) => {
          setLinkFormError(err.message || "Không thể lưu thay đổi liên kết.");
          setLinkFormConfirming(false);
        },
        onSuccess: () => {
          setEditingLinkId(null);
          setLinkFormConfirming(false);
        },
      }
    );
  };

  const handleSaveEditDetails = (goalId: string) => {
    if (!editGoalName.trim()) return;
    const targetNum = editGoalTarget ? Number(editGoalTarget) : undefined;
    setWriteError(null);
    updateGoalMutation.mutate(
      {
        id: goalId,
        patch: {
          name: editGoalName.trim(),
          target_amount: targetNum ?? null,
          target_date: editGoalDate || null,
        },
      },
      { onError: (err: any) => setWriteError(err.message || "Không thể lưu thay đổi mục tiêu.") }
    );
    setEditingDetailsId(null);
  };

  const handleSaveAdd = (e: FormEvent) => {
    e.preventDefault();
    if (!goalName.trim() || !userId) return;
    setLinkedDateError(null);
    // T-S48 — bật liên kết BẮT BUỘC đủ cả category + 2 ngày, end >= start
    // (khớp CHECK constraint DB — validate trước ở client để báo lỗi rõ
    // ràng thay vì để request thất bại rồi hiện lỗi Postgres khó hiểu).
    if (isLinkedGoal) {
      if (!linkedCategoryId || !linkedStartDate || !linkedEndDate) {
        setLinkedDateError("Chọn đủ danh mục và khoảng ngày để liên kết.");
        return;
      }
      if (linkedEndDate < linkedStartDate) {
        setLinkedDateError("Ngày kết thúc phải sau hoặc bằng ngày bắt đầu.");
        return;
      }
      // [T-S80/T-S81, CONSTITUTION §1.22.5] Bắt buộc chọn tường minh loại
      // ngân sách ngay lúc tạo — không mặc định, không suy luận qua từ khoá.
      if (newGoalIsSavingsLink === undefined) {
        setLinkedDateError('Chọn "Ngân sách tiết kiệm" hoặc "Ngân sách chi tiêu thường" trước khi lưu.');
        return;
      }
    }
    const targetNum = goalTarget ? Number(goalTarget) : undefined;
    createGoalMutation.mutate(
      {
        ...(scopeMode === "household" ? { household_id: householdId } : { owner_id: userId }),
        name: goalName.trim(),
        target_amount: targetNum ?? null,
        target_date: goalDate || null,
        created_by: userId,
        ...(isLinkedGoal
          ? {
              linked_category_id: linkedCategoryId,
              linked_start_date: linkedStartDate,
              linked_end_date: linkedEndDate,
              // Đã validate khác undefined ở trên khi isLinkedGoal=true.
              // linked_at KHÔNG truyền — dùng DEFAULT now() của cột (xem
              // migration 0022 + database.types.ts).
              is_savings_link: newGoalIsSavingsLink === true,
            }
          : {}),
      },
      {
        // [T-S63] CHỈ reset form + đóng modal khi tạo THÀNH CÔNG. Trước đây
        // reset/đóng vô điều kiện ngay sau .mutate() (không đợi kết quả) —
        // nếu request lỗi (VD vi phạm constraint chống chồng lấp category
        // vừa thêm ở 0020), người dùng mất trắng toàn bộ dữ liệu vừa nhập,
        // phải gõ lại từ đầu, đã bị chính người dùng phát hiện qua test tay.
        onSuccess: () => {
          setGoalName("");
          setGoalTarget("");
          setGoalDate("");
          setIsLinkedGoal(false);
          setLinkedCategoryId("");
          setLinkedStartDate("");
          setLinkedEndDate("");
          setNewGoalIsSavingsLink(undefined);
          setIsAdding(false);
        },
        onError: (err: any) => setWriteError(err.message || "Không thể tạo mục tiêu tiết kiệm."),
      }
    );
  };

  const handleDeleteGoal = (goalId: string) => {
    setWriteError(null);
    softDeleteGoalMutation.mutate(goalId, {
      onError: (err: any) =>
        setWriteError(
          err.message || "Không thể xoá mục tiêu này. Chỉ chủ hộ hoặc người tạo mục tiêu mới được xoá."
        ),
    });
  };

  const handleTopUp = (goal: SavingGoal) => {
    const val = Number(topUpAmount);
    if (!val || val <= 0 || !userId) {
      setTopUpError(true);
      return;
    }
    const base = {
      // T-S14 (migration 0013) — 'transfer' thay vì 'expense': đây là
      // chuyển khoản nội bộ, KHÔNG tính vào báo cáo chi tiêu thật.
      // CONSTITUTION §1.9.
      type: "transfer" as const,
      description: `Đóng góp quỹ: ${goal.name}`,
      amount: val,
      date: new Date().toISOString().slice(0, 10),
      category_id: null,
      goal_id: goal.id,
    };
    createTransactionMutation.mutate(
      scopeMode === "household"
        ? { ...base, household_id: householdId, member_id: userId }
        : { ...base, owner_id: userId }
    );
    setEditingId(null);
    setTopUpAmount("");
    setTopUpError(false);
  };

  // T-S60 (CONSTITUTION §1.21) — 2 loại số dư còn "rút được" của 1 goal:
  // "linked" = tiền ĐÃ CHI TIÊU THẬT ở category liên kết (đóng băng +
  // đang tính động, dùng đúng `linkedAmountByGoal` đã lọc dedup ở T-S62).
  // [T-S68, 12/08/2026 — SỬA LẠI thiết kế gốc] Trước đây rút khỏi đây
  // KHÔNG bao giờ trừ gì thêm (chỉ ghi log) — số này KHÔNG BAO GIỜ giảm dù
  // rút bao nhiêu lần → rút vô hạn được (bug thật, người dùng báo qua test
  // tay 12/08/2026). Nay TRỪ ĐI `linkedWithdrawnTotal` (tổng log rút, đã
  // có sẵn trong `linkedHistory` từ T-S60/migration 0021 — không cần
  // migration mới), có giới hạn thật giống phần thủ công.
  // "manual" = tiền `transfer` thủ công CHƯA từng là chi tiêu thật —
  // carriedOverSavedAmount + current_amount thủ công, TRỪ ĐI tổng đã rút
  // thật từ trước (mọi giao dịch expense+goal_id, tái dùng nguyên xi
  // `completionSpendByGoal` đã có từ T-S34 — trước đây chỉ 1 dòng/goal do
  // "Hoàn thành" chạy 1 lần, giờ có thể nhiều dòng do rút lặp lại được).
  const goalLinkedAvailable = (goal: SavingGoal) =>
    Math.max(0, (goal.carriedOverSpentAmount ?? 0) + (linkedAmountByGoal.get(goal.id) ?? 0) - linkedWithdrawnTotal(goal));
  // [T-S64] Dùng lại `manualPortionAmount()` (định nghĩa cạnh `goalCurrentAmount`
  // phía trên) — trước đây công thức này lặp lại độc lập ở đây, lệch dần với
  // `goalCurrentAmount` mỗi khi 1 trong 2 nơi được sửa mà quên sửa nơi kia.
  const goalManualAvailable = (goal: SavingGoal) => manualPortionAmount(goal);

  const handleStartWithdraw = (goal: SavingGoal) => {
    const linkedAvail = goalLinkedAvailable(goal);
    const manualAvail = goalManualAvailable(goal);
    // Chỉ 1 nguồn có tiền → tự chọn luôn (không bắt chọn radio vô ích);
    // cả 2 đều có → để trống, bắt người dùng tự chọn (§5, không đoán hộ).
    const autoSource: "linked" | "manual" | "" =
      linkedAvail > 0 && manualAvail <= 0 ? "linked" : manualAvail > 0 && linkedAvail <= 0 ? "manual" : "";
    setWithdrawingId(goal.id);
    setWithdrawSource(autoSource);
    setWithdrawNote(goal.name);
    setWithdrawAmount("");
    setWithdrawCatName("");
    setWithdrawCloseGoal(false);
    setWithdrawError(null);
  };

  const handleCancelWithdraw = () => {
    setWithdrawingId(null);
    setWithdrawSource("");
    setWithdrawNote("");
    setWithdrawAmount("");
    setWithdrawCatName("");
    setWithdrawCloseGoal(false);
    setWithdrawError(null);
  };

  const handleSaveWithdraw = (goal: SavingGoal) => {
    const linkedAvail = goalLinkedAvailable(goal);
    const manualAvail = goalManualAvailable(goal);
    const bothAvailable = linkedAvail > 0 && manualAvail > 0;
    const raw = withdrawAmount.trim();
    // Số tiền là TUỲ CHỌN (đúng §1.21: cho phép chỉ tick "Đóng mục tiêu"
    // mà không rút gì thêm) — nhưng nếu đã nhập, phải hợp lệ (>0).
    const val = raw ? Number(raw) : null;
    if (raw && (!val || val <= 0)) {
      setWithdrawError("Số tiền rút phải lớn hơn 0.");
      return;
    }
    if (!val && !withdrawCloseGoal) {
      setWithdrawError("Nhập số tiền muốn rút, hoặc tick Đóng mục tiêu.");
      return;
    }
    if (val && bothAvailable && !withdrawSource) {
      setWithdrawError("Mục tiêu này có cả 2 loại số dư — vui lòng chọn nguồn rút.");
      return;
    }
    const source = withdrawSource || (linkedAvail > 0 ? "linked" : "manual");
    const primaryAvail = source === "manual" ? manualAvail : linkedAvail;
    const secondaryAvail = source === "manual" ? linkedAvail : manualAvail;

    // [T-S69, 12/08/2026 — thiết kế xác nhận, thay hành vi chặn cứng đơn
    // nguồn của T-S66] Nguồn đã chọn không đủ → KHÔNG chặn ngay, cascade
    // rút nốt phần thiếu từ nguồn CÒN LẠI (rút hết phần có ở nguồn chính,
    // phần dư lấy từ nguồn phụ). CHỈ chặn khi CẢ 2 nguồn cộng lại vẫn
    // không đủ — báo rõ tổng khả dụng thật của cả 2 nguồn.
    let primaryAmount = val ?? 0;
    let cascadeAmount = 0;
    if (val && val > primaryAvail) {
      cascadeAmount = val - primaryAvail;
      if (cascadeAmount > secondaryAvail) {
        setWithdrawError(
          `Số tiền rút (${formatCurrency(val)}) vượt quá tổng số dư khả dụng của CẢ 2 nguồn (còn ${formatCurrency(primaryAvail + secondaryAvail)}).`
        );
        return;
      }
      primaryAmount = primaryAvail;
    }

    const manualAmount = source === "manual" ? primaryAmount : cascadeAmount;
    const linkedAmount = source === "manual" ? cascadeAmount : primaryAmount;

    // Phần "thủ công" (dù là nguồn chính hay cascade từ nguồn kia sang)
    // LUÔN bắt chọn riêng 1 category cho khoản đó — không tự suy/dùng lại
    // gì khác (đúng xác nhận thiết kế: "bắt người dùng chọn riêng 1
    // category khác cho phần này" — cả 2 chiều cascade linked→manual và
    // manual→linked đều áp dụng, chỉ chiều có phần manual mới cần category).
    if (manualAmount > 0) {
      if (!userId) return;
      if (!withdrawCatMatched) {
        setWithdrawError("Vui lòng chọn 1 danh mục chi tiêu có sẵn cho phần rút từ thủ công.");
        return;
      }
    }

    setWithdrawError(null);

    // [T-S83, migration 0023] Cascade thật (CẢ 2 nguồn cùng >0 trong đúng
    // lần rút này) -> sinh 1 groupId dùng chung cho dòng transactions phần
    // thủ công VÀ log withdrawal_log phần liên kết, để modal "Lịch sử" gom
    // lại thành 1 nhóm rõ ràng thay vì 2 dòng rời rạc không liên quan gì
    // nhau. Không sinh groupId khi chỉ rút 1 nguồn — giữ nguyên hành vi cũ,
    // tránh cột mới lộ ra "nhiễu" ở các lần rút đơn giản.
    const isCascade = manualAmount > 0 && linkedAmount > 0;
    const withdrawalGroupId = isCascade ? crypto.randomUUID() : undefined;

    // [T-S85, CONSTITUTION §1.22.3 REVERTED — xem CHANGELOG] T-S78 (rút đúng
    // khớp tổng số dư → tự động đóng mục tiêu) đã bị GỠ theo xác nhận của
    // người yêu cầu: "rút" và "hoàn thành" là 2 hành động độc lập — rút hết
    // tiền không có nghĩa là đã thực sự tiêu/hoàn thành mục đích, chỉ có 2
    // đường hợp lệ để đóng goal: (a) người dùng tự tick "Đóng mục tiêu sau
    // khi rút"/nút "Hoàn thành ngay, chưa dùng tiền" (T-S79), hoặc (b) ghi 1
    // giao dịch chi tiêu THẬT khớp tên goal qua SmartInput/Bubble/Sổ Giao
    // Dịch (T-S20/T-S74/T-S77). Rút quỹ chỉ còn tác dụng đưa "Đã có" về đúng
    // phần còn lại + ghi lịch sử — không tự suy ra "hoàn thành" từ số tiền.
    const effectiveCloseGoal = withdrawCloseGoal;

    const base =
      manualAmount > 0
        ? {
            type: "expense" as const,
            description: withdrawNote.trim() || goal.name,
            amount: manualAmount,
            date: new Date().toISOString().slice(0, 10),
            category_id: resolveCategoryId(withdrawCatName, categories),
            goal_id: goal.id,
            withdrawal_group_id: withdrawalGroupId ?? null,
          }
        : null;

    if (base) {
      withdrawManualMutation.mutate(
        {
          goalId: goal.id,
          transaction:
            scopeMode === "household"
              ? { ...base, household_id: householdId, member_id: userId }
              : { ...base, owner_id: userId },
          closeGoal: effectiveCloseGoal,
        },
        { onError: (err: any) => setWithdrawError(err.message || "Không thể rút quỹ.") }
      );
    }
    // Gọi CẢ 2 mutation khi cascade (linkedAmount>0 VÀ manualAmount>0) —
    // 2 RPC/hook đều idempotent ở bước đóng goal (`completed_at is null`),
    // an toàn khi cả 2 cùng nhận `closeGoal=true`. Trường hợp không nhập
    // số tiền (chỉ tick đóng) — giữ nguyên hành vi cũ: luôn đi qua nhánh
    // liên kết (amount=null) bất kể nguồn đang chọn là gì.
    if (linkedAmount > 0 || (!base && withdrawCloseGoal)) {
      withdrawLinkedMutation.mutate(
        {
          goalId: goal.id,
          amount: linkedAmount > 0 ? linkedAmount : null,
          note: withdrawNote.trim(),
          closeGoal: effectiveCloseGoal,
          withdrawalGroupId,
        },
        { onError: (err: any) => setWithdrawError(err.message || "Không thể rút quỹ.") }
      );
    }
    handleCancelWithdraw();
  };

  /**
   * [T-S79, CONSTITUTION §1.22.4] "Hoàn thành, chưa dùng tiền" — nhánh
   * TÁCH BIỆT hoàn toàn khỏi `handleSaveWithdraw` (không đọc/không phụ
   * thuộc ô nhập số tiền `withdrawAmount`) — đóng mục tiêu NGAY với số dư
   * khả dụng HIỆN TẠI, không tạo transaction, không gọi `withdraw_from_linked_goal`
   * (RPC đó luôn gắn nghĩa "đã rút/đã tiêu" dù chỉ ghi log — không đúng ngữ
   * nghĩa T-S79 là "CHƯA tiêu gì").
   */
  const handleCompleteUnspent = (goal: SavingGoal) => {
    const linkedAvail = goalLinkedAvailable(goal);
    const manualAvail = goalManualAvailable(goal);
    completeUnspentMutation.mutate(
      { goalId: goal.id, manualAmount: manualAvail, linkedAmount: linkedAvail, note: withdrawNote.trim() },
      { onError: (err: any) => setWithdrawError(err.message || "Không thể đánh dấu hoàn thành.") }
    );
    handleCancelWithdraw();
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(amount);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
  };

  return (
    <div className="bg-(--sst-surface) rounded-2xl shadow-sm border border-(--sst-border) p-4 sm:p-6 space-y-4 sm:space-y-6" id="saving-goals-section">
      {writeError && (
        <div className="flex items-start gap-2 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/25 text-rose-700 dark:text-rose-300 text-xs sm:text-sm font-semibold px-3.5 py-2.5 rounded-xl">
          <span className="flex-1">{writeError}</span>
          <button
            onClick={() => setWriteError(null)}
            className="text-rose-400 dark:text-rose-300 hover:text-rose-600 dark:hover:text-rose-300 cursor-pointer shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 rounded"
            title="Đóng thông báo"
            aria-label="Đóng thông báo"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-(--sst-text) flex items-center gap-2">
            <PiggyBank className="w-5 h-5 text-indigo-500 dark:text-indigo-300" />
            Mục Tiêu Tiết Kiệm
          </h2>
          <p className="text-xs text-(--sst-text-secondary) mt-1">
            Lập kế hoạch và tích lũy tiền cho các mục tiêu lớn trong cuộc sống.
          </p>
        </div>
        <button
          onClick={() => setIsAdding(!isAdding)}
          className="p-2 text-indigo-600 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 rounded-xl transition-all border border-indigo-100 dark:border-indigo-500/25 flex items-center gap-1 text-xs font-semibold cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Tạo Mục Tiêu</span>
        </button>
      </div>

      {isAdding && (
        <form onSubmit={handleSaveAdd} className="bg-(--sst-surface-2) border border-(--sst-border) rounded-xl p-4 space-y-3.5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-(--sst-text-secondary) mb-1">Tên mục tiêu</label>
              <input
                type="text"
                placeholder="Ví dụ: Mua laptop mới, Quỹ phòng hờ..."
                className="w-full text-sm bg-(--sst-surface) border border-(--sst-border-strong) focus:border-indigo-500 rounded-lg px-3 py-2 outline-none transition-all"
                value={goalName}
                onChange={(e) => setGoalName(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-(--sst-text-secondary) mb-1">Số tiền cần tiết kiệm</label>
              <input
                type="number"
                placeholder="Ví dụ: 15000000"
                className="w-full text-sm bg-(--sst-surface) border border-(--sst-border-strong) focus:border-indigo-500 rounded-lg px-3 py-2 outline-none transition-all"
                value={goalTarget}
                onChange={(e) => setGoalTarget(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-(--sst-text-secondary) mb-1">Hạn hoàn thành (Tùy chọn)</label>
              <input
                type="date"
                className="w-full text-sm bg-(--sst-surface) border border-(--sst-border-strong) focus:border-indigo-500 rounded-lg px-3 py-2 outline-none transition-all text-(--sst-text-secondary)"
                value={goalDate}
                onChange={(e) => setGoalDate(e.target.value)}
              />
            </div>
          </div>

          {/* T-S48 (CONSTITUTION §1.13) — liên kết goal với 1 danh mục ngân
              sách: current_amount tự tính từ giao dịch chi trong khoảng
              ngày, không cần "Đóng góp quỹ" thủ công. */}
          <label className="flex items-center gap-2 text-xs font-semibold text-(--sst-text-secondary) cursor-pointer">
            <input
              type="checkbox"
              checked={isLinkedGoal}
              onChange={(e) => {
                setIsLinkedGoal(e.target.checked);
                setLinkedDateError(null);
                setNewGoalIsSavingsLink(undefined);
              }}
              className="cursor-pointer"
            />
            Liên kết với 1 danh mục ngân sách (tự động cộng dồn, không góp quỹ thủ công)
          </label>

          {isLinkedGoal && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-(--sst-surface) border border-indigo-100 dark:border-indigo-500/25 rounded-lg p-3">
              <div>
                <label className="block text-xs font-semibold text-(--sst-text-secondary) mb-1">Danh mục ngân sách</label>
                <select
                  className="w-full text-sm bg-(--sst-surface) border border-(--sst-border-strong) focus:border-indigo-500 rounded-lg px-3 py-2 outline-none transition-all cursor-pointer"
                  value={linkedCategoryId}
                  onChange={(e) => {
                    setLinkedCategoryId(e.target.value);
                    setNewGoalIsSavingsLink(undefined);
                  }}
                >
                  <option value="">-- Chọn danh mục --</option>
                  {expenseCategories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.icon} {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-(--sst-text-secondary) mb-1">Từ ngày</label>
                <input
                  type="date"
                  className="w-full text-sm bg-(--sst-surface) border border-(--sst-border-strong) focus:border-indigo-500 rounded-lg px-3 py-2 outline-none transition-all text-(--sst-text-secondary)"
                  value={linkedStartDate}
                  onChange={(e) => setLinkedStartDate(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-(--sst-text-secondary) mb-1">Đến ngày</label>
                <input
                  type="date"
                  className="w-full text-sm bg-(--sst-surface) border border-(--sst-border-strong) focus:border-indigo-500 rounded-lg px-3 py-2 outline-none transition-all text-(--sst-text-secondary)"
                  value={linkedEndDate}
                  onChange={(e) => setLinkedEndDate(e.target.value)}
                />
              </div>
              {/* [T-S80/T-S81, CONSTITUTION §1.22.5] Bắt buộc chọn tường minh,
                  KHÔNG có lựa chọn nào được chọn sẵn — không tự nhận diện qua
                  từ khoá tên category. */}
              <div className="sm:col-span-3">
                <label className="block text-xs font-semibold text-(--sst-text-secondary) mb-1.5">
                  Loại ngân sách <span className="text-rose-500 dark:text-rose-300">*</span>
                </label>
                <div className="flex flex-col sm:flex-row gap-2 text-[11px]">
                  <label
                    className={`flex-1 flex items-start gap-1.5 border rounded-lg px-2.5 py-2 cursor-pointer transition-all ${
                      newGoalIsSavingsLink === true
                        ? "border-teal-400 bg-teal-50 dark:bg-teal-500/10"
                        : "border-(--sst-border-strong) hover:border-(--sst-border-strong)"
                    }`}
                  >
                    <input
                      type="radio"
                      name="newGoalIsSavingsLink"
                      className="mt-0.5 cursor-pointer"
                      checked={newGoalIsSavingsLink === true}
                      onChange={() => setNewGoalIsSavingsLink(true)}
                    />
                    <span>
                      <strong className="block text-(--sst-text)">Ngân sách tiết kiệm/theo dõi dòng tiền</strong>
                      Tính cả giao dịch trước ngày liên kết, trong khoảng ngày đã chọn ở trên.
                    </span>
                  </label>
                  <label
                    className={`flex-1 flex items-start gap-1.5 border rounded-lg px-2.5 py-2 cursor-pointer transition-all ${
                      newGoalIsSavingsLink === false
                        ? "border-teal-400 bg-teal-50 dark:bg-teal-500/10"
                        : "border-(--sst-border-strong) hover:border-(--sst-border-strong)"
                    }`}
                  >
                    <input
                      type="radio"
                      name="newGoalIsSavingsLink"
                      className="mt-0.5 cursor-pointer"
                      checked={newGoalIsSavingsLink === false}
                      onChange={() => setNewGoalIsSavingsLink(false)}
                    />
                    <span>
                      <strong className="block text-(--sst-text)">Ngân sách chi tiêu thường</strong>
                      Chỉ tính giao dịch từ lúc tạo mục tiêu này trở đi, không hồi tố.
                    </span>
                  </label>
                </div>
              </div>
              {linkedDateError && (
                <p className="sm:col-span-3 text-[11px] text-rose-500 dark:text-rose-300">{linkedDateError}</p>
              )}
              {/* [T-S63, CONSTITUTION §1.13.1] Cảnh báo MỀM, giống hệt form
                  "Sửa liên kết" — không suy luận hộ category nào là tiết
                  kiệm/đầu tư, chỉ nói rõ ý nghĩa số liệu. */}
              <p className="sm:col-span-3 text-[10px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/25 rounded px-2 py-1.5 leading-snug">
                ⚠️ Số tiền hiển thị sẽ là <strong>tổng đã CHI</strong> trong danh mục này,
                không phải tiền đang có sẵn để rút — chỉ nên liên kết với danh mục tiết
                kiệm/đầu tư, không dùng cho danh mục tiêu dùng thường (ăn uống, mua sắm...).
              </p>
            </div>
          )}

          <div className="flex justify-end gap-2 text-xs">
            <button
              type="button"
              className="px-3.5 py-2 bg-(--sst-surface-2) hover:bg-(--sst-surface-hover) rounded-lg font-medium text-(--sst-text) transition-all cursor-pointer"
              onClick={() => setIsAdding(false)}
            >
              Hủy
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg shadow-sm transition-all cursor-pointer"
            >
              Tạo
            </button>
          </div>
        </form>
      )}

      {/* T-S53 — ô tìm kiếm theo tên mục tiêu, lọc đồng thời cả 2 khối bên
          dưới (client-side, không query lại DB). */}
      <div className="relative">
        <input
          type="text"
          placeholder="Tìm kiếm mục tiêu..."
          className="w-full text-xs bg-(--sst-surface) border border-(--sst-border-strong) focus:border-indigo-500 rounded-lg pl-3 pr-3 py-2 outline-none transition-all"
          value={goalSearch}
          onChange={(e) => setGoalSearch(e.target.value)}
        />
      </div>

      {/* T-S19 — "trống" giờ nghĩa là không CÓ goal nào cả (kể cả đã hoàn
          thành), không chỉ đang tiết kiệm — 1 hộ chỉ toàn goal đã hoàn
          thành vẫn phải thấy list "Đã hoàn thành", không phải rơi vào
          nhánh rỗng này. */}
      {isLoadingGoals ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={`skeleton-goal-${i}`} className="animate-pulse bg-(--sst-surface-2) rounded-2xl h-40 w-full" />
          ))}
        </div>
      ) : activeGoals.length === 0 && completedGoals.length === 0 ? (
        <div className="text-center py-6 border border-dashed border-(--sst-border-strong) rounded-xl bg-(--sst-surface-2)/50">
          <PiggyBank className="w-8 h-8 text-(--sst-text-faint) mx-auto mb-2" />
          <p className="text-sm text-(--sst-text-secondary)">Chưa có mục tiêu tiết kiệm nào.</p>
          <button
            onClick={() => setIsAdding(true)}
            className="text-xs text-indigo-600 dark:text-indigo-300 font-semibold underline mt-1 block mx-auto hover:text-indigo-800 dark:hover:text-indigo-300"
          >
            Tạo mục tiêu ngay
          </button>
        </div>
      ) : filteredActiveGoals.length === 0 ? (
        <p className="text-xs text-(--sst-text-muted) italic text-center py-2">
          {activeGoals.length === 0
            ? 'Không còn mục tiêu nào đang tiết kiệm — xem danh sách "Đã hoàn thành" bên dưới.'
            : "Không có mục tiêu đang tiết kiệm nào khớp tìm kiếm."}
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {pagedActiveGoals.map((goal) => {
            // T-S48 — số tiền ĐÚNG của goal này bất kể loại thủ công/liên
            // kết category, xem `goalCurrentAmount` phía trên.
            const curAmount = goalCurrentAmount(goal);
            const hasTarget = goal.targetAmount !== undefined && goal.targetAmount > 0;
            const pct = hasTarget ? (curAmount / (goal.targetAmount || 1)) * 100 : 0;
            // T-S19: đổi tên từ `isCompleted` — biến này CHỈ là badge thụ
            // động "đạt/vượt target_amount", KHÔNG phải trạng thái
            // completed_at thật (CONSTITUTION §1.9 mục 2 vs mục 3, 2 khái
            // niệm tách biệt — trước T-S19 trùng tên gây hiểu nhầm).
            const reachedTarget = hasTarget && curAmount >= (goal.targetAmount || 0);

            if (editingDetailsId === goal.id) {
              return (
                <div
                  key={goal.id}
                  className="p-4 rounded-xl border border-indigo-200 dark:border-indigo-500/25 bg-indigo-50/20 dark:bg-indigo-500/10 flex flex-col gap-3 shadow-sm"
                >
                  <div className="space-y-2">
                    <h4 className="text-xs font-bold text-indigo-700 dark:text-indigo-300 uppercase tracking-wider">Chỉnh sửa mục tiêu</h4>
                    <div>
                      <label className="block text-[10px] font-bold text-(--sst-text-secondary) mb-0.5">Tên mục tiêu</label>
                      <input
                        type="text"
                        className="w-full text-xs bg-(--sst-surface) border border-(--sst-border-strong) focus:border-indigo-500 rounded px-2.5 py-1.5 outline-none"
                        value={editGoalName}
                        onChange={(e) => setEditGoalName(e.target.value)}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] font-bold text-(--sst-text-secondary) mb-0.5">Mục tiêu (VNĐ)</label>
                        <input
                          type="number"
                          className="w-full text-xs bg-(--sst-surface) border border-(--sst-border-strong) focus:border-indigo-500 rounded px-2.5 py-1.5 outline-none"
                          value={editGoalTarget}
                          onChange={(e) => setEditGoalTarget(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-(--sst-text-secondary) mb-0.5">Hạn tích lũy</label>
                        <input
                          type="date"
                          className="w-full text-xs bg-(--sst-surface) border border-(--sst-border-strong) focus:border-indigo-500 rounded px-2.5 py-1.5 outline-none"
                          value={editGoalDate}
                          onChange={(e) => setEditGoalDate(e.target.value)}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-2 border-t border-indigo-100/50 dark:border-indigo-500/25 pt-2.5">
                    <button
                      type="button"
                      onClick={() => setEditingDetailsId(null)}
                      className="px-2.5 py-1 text-xs font-semibold text-(--sst-text-secondary) hover:bg-(--sst-surface-hover) rounded border border-(--sst-border-strong) cursor-pointer"
                    >
                      Hủy
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSaveEditDetails(goal.id)}
                      className="px-3 py-1 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded cursor-pointer"
                    >
                      Lưu thay đổi
                    </button>
                  </div>
                </div>
              );
            }

            return (
              <div
                key={goal.id}
                className={`p-4 rounded-xl border flex flex-col justify-between gap-3 shadow-sm transition-all ${
                  reachedTarget
                    ? "bg-indigo-50/30 dark:bg-indigo-500/10 border-indigo-100 dark:border-indigo-500/25"
                    : "bg-(--sst-surface-2)/50 border-(--sst-border-strong)/60 hover:bg-(--sst-surface-hover)"
                }`}
              >
                <div>
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-(--sst-text) text-sm flex items-center gap-1.5">
                      {goal.name}
                      {/* T-S19 — badge THỤ ĐỘNG "đạt số tiền mục tiêu",
                          KHÁC hẳn nút "Hoàn thành" thật ở dưới (completed_at).
                          Đổi nhãn để không còn trùng chữ "Hoàn thành" với
                          trạng thái mới, tránh hiểu nhầm 2 khái niệm. */}
                      {reachedTarget && (
                        <span className="bg-indigo-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center gap-0.5 animate-pulse">
                          🎉 Đã đạt mục tiêu
                        </span>
                      )}
                    </h3>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => handleStartEditDetails(goal)}
                        className="text-(--sst-text-muted) hover:text-indigo-600 dark:hover:text-indigo-300 p-1 rounded transition-all cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                        title="Sửa mục tiêu"
                        aria-label="Sửa mục tiêu"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      {/* [T-S57] Sửa liên kết category (hoặc link 1 goal
                          thủ công sang category lần đầu) — hiện cho MỌI
                          goal, không chỉ goal đã liên kết. */}
                      <button
                        onClick={() => handleStartEditLink(goal)}
                        className="text-(--sst-text-muted) hover:text-indigo-600 dark:hover:text-indigo-300 p-1 rounded transition-all cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                        title={goal.linkedCategoryId ? "Sửa liên kết danh mục" : "Liên kết với danh mục"}
                        aria-label={goal.linkedCategoryId ? "Sửa liên kết danh mục" : "Liên kết với danh mục"}
                      >
                        <Link2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDeleteGoal(goal.id)}
                        className="text-(--sst-text-muted) hover:text-rose-600 dark:hover:text-rose-300 p-1 rounded transition-all cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
                        title="Xóa mục tiêu"
                        aria-label="Xóa mục tiêu"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="text-xs text-(--sst-text-secondary) mt-1 flex flex-wrap gap-x-3 gap-y-1">
                    <span>Đã có: <strong className="text-indigo-600 dark:text-indigo-300">{formatCurrency(curAmount)}</strong></span>
                    {hasTarget && (
                      <span>Mục tiêu: <strong className="text-(--sst-text)">{formatCurrency(goal.targetAmount || 0)}</strong></span>
                    )}
                  </div>

                  {/* T-S48 — nhãn thay cho nút "Đóng góp quỹ" ở goal liên
                      kết category (§1.13: "Tự động cập nhật theo danh mục
                      [tên], từ [ngày] đến [ngày]"). */}
                  {editingLinkId !== goal.id && goal.linkedCategoryId && (
                    <p className="text-[10px] text-indigo-500 dark:text-indigo-300 mt-1 font-medium">
                      🔗 Tự động cập nhật theo danh mục{" "}
                      {categories.find((c) => c.id === goal.linkedCategoryId)?.name ?? "đã liên kết"}, từ{" "}
                      {goal.linkedStartDate ? new Date(goal.linkedStartDate).toLocaleDateString("vi-VN") : "?"} đến{" "}
                      {goal.linkedEndDate ? new Date(goal.linkedEndDate).toLocaleDateString("vi-VN") : "?"}
                    </p>
                  )}

                  {/* [27/08/2026 — phản hồi người dùng: goal liên kết category
                      KHÔNG có chỗ nào cho thấy/điều khiển việc category đó
                      đang trích tự động, dù đã bật trích tự động sẵn ở
                      BudgetLimits.tsx trước/sau khi liên kết. Category đã
                      trích tự động sẽ tự động cộng vào goal này (goal tính
                      bằng SUM giao dịch trong category, không phân biệt tự
                      động hay tay) — hiện thẳng trạng thái + cho tắt/sửa
                      NGAY tại đây, không bắt người dùng phải nhớ ra tận
                      BudgetLimits.tsx mới tắt được. Tái dùng NGUYÊN component
                      T-S143 — cùng 1 nguồn dữ liệu, không tạo bản sao logic. */}
                  {editingLinkId !== goal.id && goal.linkedCategoryId && (
                    <AutoContributionCategoryConfig
                      categoryId={goal.linkedCategoryId}
                      transactions={transactions}
                      formatCurrency={formatCurrency}
                    />
                  )}

                  {/* [T-S57] Nếu goal có phần dồn từ giai đoạn cũ, hiện rõ
                      breakdown — tránh người dùng thắc mắc vì sao "Đã có"
                      cao hơn số đang tính động/current_amount hiện tại. */}
                  {editingLinkId !== goal.id &&
                    (goal.carriedOverSavedAmount > 0 || goal.carriedOverSpentAmount > 0) && (
                      <p className="text-[10px] text-(--sst-text-muted) mt-0.5">
                        Trong đó dồn từ giai đoạn trước:{" "}
                        {goal.carriedOverSavedAmount > 0 && (
                          <>góp thủ công {formatCurrency(goal.carriedOverSavedAmount)}</>
                        )}
                        {goal.carriedOverSavedAmount > 0 && goal.carriedOverSpentAmount > 0 && " · "}
                        {goal.carriedOverSpentAmount > 0 && (
                          <>đã chi qua liên kết {formatCurrency(goal.carriedOverSpentAmount)}</>
                        )}
                      </p>
                    )}

                  {/* [T-S57, CONSTITUTION §1.20] Form "Sửa liên kết" — 2
                      bước: bấm Lưu lần 1 mở bước xác nhận hiện rõ số tiền sẽ
                      dồn sang (bắt buộc theo thiết kế đã chốt), bấm lần 2 mới
                      thật sự gọi RPC `update_goal_link`. */}
                  {editingLinkId === goal.id && (
                    <div className="mt-2 p-2.5 bg-indigo-50/60 dark:bg-indigo-500/10 border border-indigo-100 dark:border-indigo-500/25 rounded-lg space-y-2">
                      {!linkFormConfirming ? (
                        <>
                          <label className="flex items-center gap-1.5 text-xs font-medium text-(--sst-text) cursor-pointer">
                            <input
                              type="checkbox"
                              checked={linkFormLinked}
                              onChange={(e) => setLinkFormLinked(e.target.checked)}
                              className="cursor-pointer"
                            />
                            🔗 Liên kết với 1 danh mục ngân sách
                          </label>
                          {linkFormLinked && (
                            <div className="space-y-1.5">
                              <select
                                className="w-full text-xs bg-(--sst-surface) border border-(--sst-border-strong) focus:border-indigo-500 rounded px-2 py-1.5 outline-none cursor-pointer"
                                value={linkFormCategoryId}
                                onChange={(e) => {
                                  setLinkFormCategoryId(e.target.value);
                                  setLinkFormIsSavingsLink(undefined);
                                }}
                              >
                                <option value="">-- Chọn danh mục --</option>
                                {expenseCategories.map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {c.icon} {c.name}
                                  </option>
                                ))}
                              </select>
                              <div className="flex items-center gap-1.5">
                                <input
                                  type="date"
                                  className="flex-1 text-xs bg-(--sst-surface) border border-(--sst-border-strong) focus:border-indigo-500 rounded px-2 py-1.5 outline-none"
                                  value={linkFormStartDate}
                                  onChange={(e) => setLinkFormStartDate(e.target.value)}
                                />
                                <span className="text-(--sst-text-muted) text-xs">đến</span>
                                <input
                                  type="date"
                                  className="flex-1 text-xs bg-(--sst-surface) border border-(--sst-border-strong) focus:border-indigo-500 rounded px-2 py-1.5 outline-none"
                                  value={linkFormEndDate}
                                  onChange={(e) => setLinkFormEndDate(e.target.value)}
                                />
                              </div>
                              {/* [T-S80/T-S81, CONSTITUTION §1.22.5] Bắt buộc
                                  chọn tường minh, KHÔNG mặc định — không tự
                                  nhận diện qua từ khoá tên category. */}
                              <div className="flex flex-col gap-1">
                                <label
                                  className={`flex items-start gap-1.5 text-[10px] border rounded px-2 py-1.5 cursor-pointer transition-all ${
                                    linkFormIsSavingsLink === true
                                      ? "border-teal-400 bg-teal-50 dark:bg-teal-500/10"
                                      : "border-(--sst-border-strong) hover:border-(--sst-border-strong)"
                                  }`}
                                >
                                  <input
                                    type="radio"
                                    name={`linkFormIsSavingsLink-${goal.id}`}
                                    className="mt-0.5 cursor-pointer"
                                    checked={linkFormIsSavingsLink === true}
                                    onChange={() => setLinkFormIsSavingsLink(true)}
                                  />
                                  <span>
                                    <strong className="text-(--sst-text)">Ngân sách tiết kiệm/theo dõi dòng tiền</strong>
                                    {" "}— tính cả giao dịch trước ngày liên kết.
                                  </span>
                                </label>
                                <label
                                  className={`flex items-start gap-1.5 text-[10px] border rounded px-2 py-1.5 cursor-pointer transition-all ${
                                    linkFormIsSavingsLink === false
                                      ? "border-teal-400 bg-teal-50 dark:bg-teal-500/10"
                                      : "border-(--sst-border-strong) hover:border-(--sst-border-strong)"
                                  }`}
                                >
                                  <input
                                    type="radio"
                                    name={`linkFormIsSavingsLink-${goal.id}`}
                                    className="mt-0.5 cursor-pointer"
                                    checked={linkFormIsSavingsLink === false}
                                    onChange={() => setLinkFormIsSavingsLink(false)}
                                  />
                                  <span>
                                    <strong className="text-(--sst-text)">Ngân sách chi tiêu thường</strong>
                                    {" "}— chỉ tính từ lúc bấm Lưu trở đi, không hồi tố.
                                  </span>
                                </label>
                              </div>
                              {/* [T-S63, CONSTITUTION §1.13.1] Cảnh báo MỀM, không
                                  chặn — hệ thống không có cách nào tự biết category
                                  người dùng chọn có thật sự là "tiết kiệm/đầu tư" hay
                                  chỉ là category tiêu dùng thường, nên KHÔNG suy luận
                                  hộ (đúng nguyên tắc §5), chỉ nói rõ ý nghĩa số liệu
                                  để người dùng tự quyết định đúng category. */}
                              <p className="text-[10px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/25 rounded px-2 py-1.5 leading-snug">
                                ⚠️ Số tiền hiển thị sẽ là <strong>tổng đã CHI</strong> trong
                                danh mục này, không phải tiền đang có sẵn để rút — chỉ nên
                                liên kết với danh mục tiết kiệm/đầu tư, không dùng cho danh
                                mục tiêu dùng thường (ăn uống, mua sắm...).
                              </p>
                            </div>
                          )}
                          {linkFormError && <p className="text-[10px] text-rose-500 dark:text-rose-300">{linkFormError}</p>}
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => handleSubmitEditLink(goal)}
                              className="text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 px-2.5 py-1 rounded cursor-pointer"
                            >
                              Lưu
                            </button>
                            <button
                              onClick={handleCancelEditLink}
                              className="text-xs font-semibold text-(--sst-text-secondary) hover:bg-(--sst-surface-hover) px-2.5 py-1 rounded cursor-pointer"
                            >
                              Hủy
                            </button>
                          </div>
                        </>
                      ) : (
                        (() => {
                          const carryOver = previewCarryOverAmount(goal);
                          return (
                            <>
                              <p className="text-xs font-semibold text-(--sst-text)">Xác nhận thay đổi liên kết?</p>
                              {carryOver !== null ? (
                                <p className="text-[11px] text-(--sst-text-secondary)">
                                  Số tiền <strong className="text-indigo-600 dark:text-indigo-300">{formatCurrency(carryOver)}</strong> từ
                                  giai đoạn hiện tại sẽ được <strong>dồn vào lịch sử</strong> (không mất, xem lại
                                  được ở mục "Lịch sử") — tiến độ tổng KHÔNG giảm.
                                </p>
                              ) : (
                                <p className="text-[11px] text-(--sst-text-secondary)">
                                  Chỉ đổi khoảng ngày, không dồn gì (cùng danh mục).
                                </p>
                              )}
                              <div className="flex items-center gap-1.5">
                                <button
                                  onClick={() => handleSubmitEditLink(goal)}
                                  disabled={updateGoalLinkMutation.isPending}
                                  className="text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 px-2.5 py-1 rounded cursor-pointer disabled:opacity-50"
                                >
                                  {updateGoalLinkMutation.isPending ? "Đang lưu..." : "Xác nhận lưu"}
                                </button>
                                <button
                                  onClick={() => setLinkFormConfirming(false)}
                                  className="text-xs font-semibold text-(--sst-text-secondary) hover:bg-(--sst-surface-hover) px-2.5 py-1 rounded cursor-pointer"
                                >
                                  Quay lại
                                </button>
                              </div>
                              {linkFormError && <p className="text-[10px] text-rose-500 dark:text-rose-300">{linkFormError}</p>}
                            </>
                          );
                        })()
                      )}
                    </div>
                  )}

                  {goal.targetDate && (
                    <div className="text-[10px] text-(--sst-text-muted) mt-1 flex items-center gap-1 font-medium">
                      <Calendar className="w-3 h-3" />
                      <span>Hạn hoàn thành: {new Date(goal.targetDate).toLocaleDateString("vi-VN")}</span>
                    </div>
                  )}

                  {/* [T-S139, CONSTITUTION §1.13 mục 3] Chỉ hiện cho goal
                      THỦ CÔNG (không có linked_category_id) — goal liên kết
                      category có current_amount tự tính từ SUM giao dịch,
                      không nhận góp quỹ qua transfer nên không áp dụng
                      khái niệm "trích tự động" kiểu này. */}
                  {editingLinkId !== goal.id && !goal.linkedCategoryId && (
                    <AutoContributionConfig goalId={goal.id} transactions={transactions} formatCurrency={formatCurrency} />
                  )}
                </div>

                {hasTarget && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[10px] font-bold text-(--sst-text-secondary)">
                      <span>Tiến độ</span>
                      <span>{Math.round(pct)}%</span>
                    </div>
                    <div className="w-full bg-(--sst-border-strong) rounded-full h-1.5 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-indigo-600 transition-all duration-500"
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      ></div>
                    </div>
                  </div>
                )}

                {/* [T-S26, sửa lần 2 — 10/08/2026 theo yêu cầu người dùng]
                    BỎ HẲN list preview inline (kể cả bản rút gọn 3 dòng) —
                    dù giảm 5→3 vẫn còn lệch chiều cao giữa các card trong
                    cùng 1 hàng grid (`md:grid-cols-2` dùng `items-stretch`
                    mặc định: card có N dòng luôn kéo card bên cạnh — có ít
                    hơn hoặc 0 dòng — giãn theo N dòng đó, N càng lớn chênh
                    lệch càng rõ, không có N nào triệt tiêu hẳn vấn đề trừ
                    N=0). Thay bằng ĐÚNG 1 dòng cố định chiều cao cho MỌI
                    goal (có hay chưa có khoản góp nào đều hiện, không còn
                    early-return khi rỗng) — bấm vào luôn mở modal "Xem tất
                    cả" (goal chưa có khoản góp nào → modal tự hiện đúng
                    empty state "Chưa có khoản góp quỹ nào." đã có sẵn, xem
                    khối modal bên dưới). Vì luôn đúng 1 dòng bất kể có bao
                    nhiêu khoản góp, chiều cao card không còn phụ thuộc vào
                    số lượng lịch sử → hết lệch layout giữa các card cùng
                    hàng. */}
                {(() => {
                  // [T-S54] Dùng goalHistoryFor thay vì đọc thẳng
                  // contributionsByGoal — goal liên kết category giờ đọc
                  // đúng nguồn (giao dịch chi tiêu trong category+khoảng
                  // ngày) thay vì luôn rỗng.
                  const contributions = goalHistoryFor(goal);
                  // [T-S65] `t.amount` luôn lưu DƯƠNG ở DB (xem
                  // `toTransactionInsert.ts`, `Math.abs` lúc ghi) — dấu +/-
                  // suy ra từ `t.type`, KHÔNG được cộng thẳng như cũ (trước
                  // T-S65 danh sách chỉ toàn transfer nên cộng thẳng vẫn
                  // đúng; nay đã gộp thêm dòng rút `expense`, cộng thẳng sẽ
                  // ra tổng sai/dương giả cho cả phần đã rút).
                  // [T-S73, 13/08/2026] Cùng lý do đã sửa ở modal Lịch sử
                  // (`isWithdrawal`) — với goal ĐANG liên kết, MỌI dòng ở
                  // đây là góp (không có dòng nào là rút thật, log rút thật
                  // nằm ở `linked_history` riêng) nên KHÔNG được trừ, dù
                  // `t.type` vẫn là "expense" ở tầng transaction gốc.
                  const total = contributions.reduce((sum, t) => {
                    const isWithdrawal = !goal.linkedCategoryId && t.type === "expense";
                    return sum + (isWithdrawal ? -Math.abs(t.amount) : Math.abs(t.amount));
                  }, 0);
                  const label = goal.linkedCategoryId ? "Lịch sử chi tiêu" : "Lịch sử góp quỹ";
                  const emptyLabel = goal.linkedCategoryId ? "Chưa có giao dịch" : "Chưa có khoản góp";
                  const unit = goal.linkedCategoryId ? "giao dịch" : "khoản";
                  return (
                    <button
                      onClick={() => setHistoryGoalId(goal.id)}
                      className="w-full border-t border-(--sst-border) pt-2.5 flex items-center justify-between gap-2 cursor-pointer group text-left"
                    >
                      <span className="text-[10px] font-bold text-(--sst-text-secondary) uppercase tracking-wider flex items-center gap-1 group-hover:text-indigo-600 dark:hover:text-indigo-300">
                        <History className="w-3 h-3" /> {label}
                      </span>
                      <span className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-300 group-hover:text-indigo-800 dark:hover:text-indigo-300 shrink-0">
                        {contributions.length === 0
                          ? emptyLabel
                          : `${contributions.length} ${unit} · ${total < 0 ? "−" : "+"}${formatCurrency(Math.abs(total))}`}
                      </span>
                    </button>
                  );
                })()}

                {/* Contribution Actions */}
                <div className="flex flex-col gap-1 border-t border-(--sst-border) pt-2.5 mt-1.5">
                  <div className="flex items-center justify-between gap-2">
                    {editingId === goal.id ? (
                      <div className="flex items-center gap-1.5 w-full">
                        <input
                          type="number"
                          min={1}
                          placeholder="Số tiền muốn góp thêm..."
                          className={`w-full text-xs bg-(--sst-surface) border rounded px-2.5 py-1.5 outline-none transition-all ${
                            topUpError ? "border-rose-400 focus:border-rose-500" : "border-(--sst-border-strong) focus:border-indigo-500"
                          }`}
                          value={topUpAmount}
                          onChange={(e) => {
                            setTopUpAmount(e.target.value);
                            setTopUpError(false);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleTopUp(goal);
                          }}
                          autoFocus
                        />
                        <button
                          className="p-1.5 text-emerald-600 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 rounded cursor-pointer shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                          onClick={() => handleTopUp(goal)}
                          title="Đồng ý"
                          aria-label="Đồng ý góp quỹ"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                        <button
                          className="p-1.5 text-(--sst-text-muted) hover:bg-(--sst-surface-hover) rounded cursor-pointer shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                          onClick={() => {
                            setEditingId(null);
                            setTopUpAmount("");
                            setTopUpError(false);
                          }}
                          title="Hủy"
                          aria-label="Hủy góp quỹ"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ) : withdrawingId === goal.id ? (
                      // T-S60 (CONSTITUTION §1.21) — form "Rút quỹ": ghi
                      // chú/mục đích, chọn nguồn (nếu có cả 2 loại số dư),
                      // số tiền (tuỳ chọn nếu chỉ muốn đóng mục tiêu),
                      // category (bắt buộc CHỈ khi nguồn = thủ công),
                      // checkbox đóng mục tiêu.
                      (() => {
                        const linkedAvail = goalLinkedAvailable(goal);
                        const manualAvail = goalManualAvailable(goal);
                        const bothAvailable = linkedAvail > 0 && manualAvail > 0;
                        const effectiveSource = withdrawSource || (linkedAvail > 0 ? "linked" : "manual");
                        // [T-S69] Xem trước cascade — CHỈ để hiện gợi ý,
                        // logic thật (block/split) nằm ở `handleSaveWithdraw`.
                        const rawPreviewVal = withdrawAmount.trim() ? Number(withdrawAmount.trim()) : null;
                        const previewPrimaryAvail = effectiveSource === "manual" ? manualAvail : linkedAvail;
                        const previewSecondaryAvail = effectiveSource === "manual" ? linkedAvail : manualAvail;
                        const willCascade =
                          !!rawPreviewVal && rawPreviewVal > previewPrimaryAvail && rawPreviewVal - previewPrimaryAvail <= previewSecondaryAvail;
                        const cascadePreviewAmount = willCascade ? rawPreviewVal! - previewPrimaryAvail : 0;
                        // Category thủ công cần hiện khi nguồn CHÍNH là thủ
                        // công, HOẶC khi cascade rơi vào phần thủ công (nguồn
                        // chính = liên kết nhưng không đủ, dư sang thủ công).
                        const needsManualCategory = effectiveSource === "manual" || (willCascade && effectiveSource === "linked");
                        return (
                          <div className="flex flex-col gap-1.5 w-full">
                            <input
                              type="text"
                              placeholder="Ghi chú / mục đích rút..."
                              className="w-full text-xs bg-(--sst-surface) border border-(--sst-border-strong) focus:border-indigo-500 rounded px-2.5 py-1.5 outline-none transition-all"
                              value={withdrawNote}
                              onChange={(e) => setWithdrawNote(e.target.value)}
                              autoFocus
                            />
                            {bothAvailable && (
                              <div className="flex items-center gap-3 text-[11px] text-(--sst-text-secondary)">
                                <label className="flex items-center gap-1 cursor-pointer">
                                  <input
                                    type="radio"
                                    checked={withdrawSource === "linked"}
                                    onChange={() => setWithdrawSource("linked")}
                                  />
                                  Phần liên kết (còn {formatCurrency(linkedAvail)})
                                </label>
                                <label className="flex items-center gap-1 cursor-pointer">
                                  <input
                                    type="radio"
                                    checked={withdrawSource === "manual"}
                                    onChange={() => setWithdrawSource("manual")}
                                  />
                                  Phần thủ công (còn {formatCurrency(manualAvail)})
                                </label>
                              </div>
                            )}
                            {willCascade && (
                              <p className="text-[10px] text-amber-600 dark:text-amber-300 font-medium">
                                Không đủ ở nguồn đã chọn — sẽ tự rút thêm {formatCurrency(cascadePreviewAmount)} từ{" "}
                                {effectiveSource === "manual" ? "phần liên kết (chỉ ghi log, không tạo giao dịch)" : "phần thủ công (tạo 1 giao dịch chi tiêu thật)"}.
                              </p>
                            )}
                            <div className="flex items-center gap-1.5">
                              <input
                                type="number"
                                min={1}
                                placeholder="Số tiền rút (để trống nếu chỉ đóng)..."
                                className="w-28 text-xs bg-(--sst-surface) border border-(--sst-border-strong) focus:border-indigo-500 rounded px-2.5 py-1.5 outline-none transition-all shrink-0"
                                value={withdrawAmount}
                                onChange={(e) => setWithdrawAmount(e.target.value)}
                              />
                              {needsManualCategory && (
                                <select
                                  className={`flex-1 min-w-0 text-xs bg-(--sst-surface) border rounded px-2 py-1.5 outline-none transition-all cursor-pointer ${
                                    withdrawCatMatched
                                      ? "text-(--sst-text) border-(--sst-border-strong) focus:border-indigo-500"
                                      : "text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-500/25 focus:border-amber-500"
                                  }`}
                                  value={withdrawCatName}
                                  onChange={(e) => setWithdrawCatName(e.target.value)}
                                >
                                  <option value="" disabled>
                                    -- Chọn danh mục chi --
                                  </option>
                                  {expenseCategories.map((c) => (
                                    <option key={c.id} value={c.name}>
                                      {c.icon} {c.name}
                                    </option>
                                  ))}
                                </select>
                              )}
                              <button
                                className="p-1.5 text-emerald-600 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 rounded cursor-pointer shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                                onClick={() => handleSaveWithdraw(goal)}
                                title="Xác nhận rút quỹ"
                                aria-label="Xác nhận rút quỹ"
                              >
                                <Check className="w-4 h-4" />
                              </button>
                              <button
                                className="p-1.5 text-(--sst-text-muted) hover:bg-(--sst-surface-hover) rounded cursor-pointer shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                                onClick={handleCancelWithdraw}
                                title="Hủy"
                                aria-label="Hủy rút quỹ"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                            <label className="flex items-center gap-1.5 text-[11px] text-(--sst-text-secondary) cursor-pointer">
                              <input
                                type="checkbox"
                                checked={withdrawCloseGoal}
                                onChange={(e) => setWithdrawCloseGoal(e.target.checked)}
                              />
                              Đóng mục tiêu sau khi rút
                            </label>
                            {/* [T-S79, CONSTITUTION §1.22.4] Nhánh tách biệt —
                                đóng mục tiêu NGAY với số dư hiện có, KHÔNG rút/
                                KHÔNG tạo giao dịch nào (dùng khi tiền phần liên
                                kết vẫn còn nguyên ở ví khác ngoài đời, chưa thật
                                sự tiêu). Chỉ hiện khi còn ít nhất 1 nguồn có số
                                dư — vô nghĩa khi cả 2 đều 0. */}
                            {linkedAvail + manualAvail > 0 && (
                              <button
                                type="button"
                                className="self-start -m-2 p-2 text-[10px] text-indigo-500 dark:text-indigo-300 hover:text-indigo-700 dark:hover:text-indigo-300 hover:underline cursor-pointer"
                                onClick={() => handleCompleteUnspent(goal)}
                              >
                                Hoàn thành ngay, chưa dùng tiền (
                                {manualAvail > 0 && `thủ công ${formatCurrency(manualAvail)}`}
                                {manualAvail > 0 && linkedAvail > 0 && " + "}
                                {linkedAvail > 0 && `liên kết ${formatCurrency(linkedAvail)}`})
                              </button>
                            )}
                            {withdrawError && <span className="text-[10px] text-rose-500 dark:text-rose-300">{withdrawError}</span>}
                          </div>
                        );
                      })()
                    ) : (
                      <>
                        <span className="text-[10px] text-(--sst-text-muted) italic">Nhấp đóng góp để tích lũy thêm</span>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => handleStartWithdraw(goal)}
                            className="text-xs font-semibold text-emerald-600 dark:text-emerald-300 hover:text-emerald-800 dark:hover:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/10 hover:bg-emerald-100 dark:hover:bg-emerald-500/10 px-2.5 py-1.5 rounded-lg border border-emerald-100 dark:border-emerald-500/25 transition-all cursor-pointer flex items-center gap-1"
                            title="Rút quỹ — lặp lại được, mục tiêu vẫn sống tiếp trừ khi tick Đóng mục tiêu"
                          >
                            <Flag className="w-3.5 h-3.5" /> Rút quỹ
                          </button>
                          {/* T-S48 (§1.13 mục 3) — goal liên kết category
                              KHÔNG nhận góp quỹ thủ công, không có nút này. */}
                          {!goal.linkedCategoryId && (
                            <button
                              onClick={() => {
                                setEditingId(goal.id);
                                setTopUpAmount("");
                                setTopUpError(false);
                              }}
                              className="text-xs font-semibold text-indigo-600 dark:text-indigo-300 hover:text-indigo-800 dark:hover:text-indigo-300 bg-indigo-50 dark:bg-indigo-500/10 hover:bg-indigo-100 dark:hover:bg-indigo-500/10 px-3 py-1.5 rounded-lg border border-indigo-100 dark:border-indigo-500/25 transition-all cursor-pointer flex items-center gap-1"
                            >
                              Đóng góp quỹ
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                  {editingId === goal.id && topUpError && (
                    <span className="text-[10px] text-rose-500 dark:text-rose-300">Nhập số tiền lớn hơn 0.</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {filteredActiveGoals.length > 0 && (
        <Pagination page={activeGoalsPage} totalPages={activeGoalsTotalPages} onChange={setActiveGoalsPage} />
      )}

      {/* T-S19 (CONSTITUTION §1.9 mục 3) — danh sách "Đã hoàn thành", tách
          hẳn khỏi lưới đang tiết kiệm ở trên. Chỉ hiện khi có ít nhất 1 goal
          completed. Đơn giản hơn card active có chủ đích: không còn hành
          động Đóng góp quỹ/Hoàn thành/Sửa target (goal đã chốt), chỉ giữ
          Xem lịch sử (dùng lại đúng modal đã có, T-S26) + Xoá (phòng trường
          hợp bấm nhầm goal — không giới hạn thêm gì ngoài RBAC delete_goal
          sẵn có). */}
      {completedGoals.length > 0 && (
        <div className="space-y-2.5">
          {/* T-S53 — toggle "Ẩn mục đã hoàn thành", mặc định BẬT (ẩn), cùng
              tinh thần `showIncome` ở BudgetLimits.tsx/§1.5. */}
          <button
            type="button"
            onClick={() => setHideCompleted((v) => !v)}
            className="flex items-center gap-1.5 text-xs font-bold text-(--sst-text-secondary) uppercase tracking-wider hover:text-(--sst-text) cursor-pointer"
          >
            {hideCompleted ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            <Award className="w-3.5 h-3.5 text-indigo-500 dark:text-indigo-300" />
            {hideCompleted ? "Hiện đã hoàn thành" : "Ẩn đã hoàn thành"} ({completedGoals.length})
          </button>
          {!hideCompleted && (
            <>
              {filteredCompletedGoals.length === 0 ? (
                <p className="text-xs text-(--sst-text-muted) italic text-center py-2">
                  Không có mục tiêu đã hoàn thành nào khớp tìm kiếm.
                </p>
              ) : (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {pagedCompletedGoals.map((goal) => {
              // Bổ sung 09/08/2026 theo yêu cầu — hiện thêm target + % hiệu
              // suất đạt được LÚC hoàn thành (currentAmount/targetAmount).
              // Goal có thể hoàn thành SỚM (chưa đủ target — CONSTITUTION
              // §1.9 mục 3 cho phép cố ý), nên < 100% là bình thường, không
              // phải lỗi — chỉ đổi màu để phân biệt trực quan, không cảnh
              // báo. Goal không đặt target (targetAmount undefined) thì
              // không có gì để tính %, giữ nguyên hiển thị tối giản như cũ.
              const hasTarget = goal.targetAmount !== undefined && goal.targetAmount > 0;
              // [T-S64b] `goalGrossAccumulated()` thay cho `goal.currentAmount`
              // thô — xem giải thích đầy đủ cạnh định nghĩa hàm phía trên.
              const grossAccumulated = goalGrossAccumulated(goal);
              const pct = hasTarget ? Math.round((grossAccumulated / (goal.targetAmount || 1)) * 100) : 0;
              // T-S34 — đối chiếu tiền ĐÃ GOM (nay dùng `grossAccumulated`,
              // T-S64b) với tiền ĐÃ CHI THẬT (completionSpendByGoal, giao
              // dịch expense gắn goal_id lúc hoàn thành). spendInfo.count
              // === 0 nghĩa là chưa có giao dịch mua thật nào tra được (dữ
              // liệu cũ trước T-S19, hoặc giao dịch mua đã bị xoá sau đó) —
              // không suy diễn dư/thiếu trong trường hợp này, tránh hiện số
              // sai lệch gây hiểu nhầm.
              const spendInfo = completionSpendByGoal.get(goal.id);
              // [T-S82, 14/08/2026 — bug thật xác nhận qua test tay: goal
              // "gộp 2 nguồn" (250k liên kết + 165k thủ công), rút 300k chọn
              // nguồn thủ công → cascade đúng (giao dịch chỉ ghi 165k, không
              // đúp — xem T-S71), NHƯNG card "Đã hoàn thành" chỉ đối chiếu
              // với `spendInfo.total` (CHỈ đọc `transactions`, không có
              // dòng nào cho phần liên kết vì đúng thiết kế T-S60/§1.21
              // không tạo giao dịch cho phần đó) → "Đã chi tiêu thật"/"Dư-
              // Thiếu" bị thiếu hẳn 135k đã rút từ liên kết, dù phần đó ĐÃ
              // được ghi log đúng ở `linkedWithdrawnTotal`/modal "Lịch sử"
              // (T-S68). Cộng thêm `linkedWithdrawnTotal` vào tổng chi thật
              // ở ĐÚNG chỗ đối chiếu này — tái dùng hàm đã có, không viết
              // công thức mới (CONSTITUTION §1.21 "1 công thức, 1 nơi").
              const spendManual = spendInfo?.total ?? 0;
              const spendLinked = linkedWithdrawnTotal(goal);
              const totalSpend = spendManual + spendLinked;
              const hasSpendRecord = (spendInfo?.count ?? 0) > 0 || spendLinked > 0;
              const diff = hasSpendRecord ? grossAccumulated - totalSpend : 0;
              return (
                <div
                  key={goal.id}
                  className="p-3.5 rounded-xl border border-indigo-100 dark:border-indigo-500/25 bg-indigo-50/20 dark:bg-indigo-500/10 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="text-sm font-semibold text-(--sst-text) truncate">{goal.name}</p>
                      {hasTarget && (
                        <span
                          className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${
                            pct >= 100 ? "bg-emerald-100 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-amber-100 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300"
                          }`}
                          title={pct >= 100 ? "Đạt/vượt mục tiêu lúc hoàn thành" : "Hoàn thành sớm — chưa đủ mục tiêu"}
                        >
                          {pct}%
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-(--sst-text-muted) mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
                      <span>
                        Đã tích lũy: <strong className="text-indigo-600 dark:text-indigo-300">{formatCurrency(grossAccumulated)}</strong>
                      </span>
                      {hasTarget && (
                        <span>
                          Mục tiêu: <strong className="text-(--sst-text-secondary)">{formatCurrency(goal.targetAmount || 0)}</strong>
                        </span>
                      )}
                      {goal.completedAt && <span>Hoàn thành {formatDate(goal.completedAt.slice(0, 10))}</span>}
                    </p>
                    {/* T-S34 — trạng thái đã sử dụng khoản tiết kiệm chưa +
                        dư/thiếu so với tiền đã gom. */}
                    <p className="text-[10px] mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
                      {hasSpendRecord ? (
                        <>
                          <span className="text-(--sst-text-muted)">
                            Đã chi tiêu thật: <strong className="text-(--sst-text-secondary)">{formatCurrency(totalSpend)}</strong>
                            {/* [T-S82] Breakdown rõ nguồn khi goal gộp cả 2 (thủ
                                công + liên kết) — người dùng yêu cầu tường minh,
                                tránh hiểu nhầm 1 con số tổng là chỉ 1 nguồn. */}
                            {spendManual > 0 && spendLinked > 0 && (
                              <span className="text-(--sst-text-muted) font-normal">
                                {" "}
                                (thủ công {formatCurrency(spendManual)} + liên kết {formatCurrency(spendLinked)})
                              </span>
                            )}
                          </span>
                          <span
                            className={`font-semibold px-1.5 py-0.5 rounded ${
                              diff > 0
                                ? "bg-emerald-100 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                                : diff < 0
                                ? "bg-rose-100 dark:bg-rose-500/10 text-rose-700 dark:text-rose-300"
                                : "bg-(--sst-surface-2) text-(--sst-text-secondary)"
                            }`}
                          >
                            {diff > 0
                              ? `Dư ${formatCurrency(diff)}`
                              : diff < 0
                              ? `Thiếu ${formatCurrency(Math.abs(diff))}`
                              : "Chi đúng số đã gom"}
                          </span>
                        </>
                      ) : (
                        <span className="text-(--sst-text-muted) italic">Chưa ghi nhận giao dịch mua thật cho mục tiêu này</span>
                      )}
                    </p>
                    {hasTarget && (
                      <div className="mt-1.5 h-1 bg-(--sst-border-strong) rounded-full overflow-hidden max-w-[220px]">
                        <div
                          className={`h-full rounded-full ${pct >= 100 ? "bg-emerald-500" : "bg-amber-400"}`}
                          style={{ width: `${Math.min(pct, 100)}%` }}
                        />
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => setHistoryGoalId(goal.id)}
                      className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-300 hover:text-indigo-800 dark:hover:text-indigo-300 px-2 py-1 rounded hover:bg-indigo-100/60 dark:hover:bg-indigo-500/10 cursor-pointer"
                    >
                      Lịch sử
                    </button>
                    <button
                      onClick={() => handleDeleteGoal(goal.id)}
                      className="text-(--sst-text-muted) hover:text-rose-600 dark:hover:text-rose-300 p-1 rounded transition-all cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
                      title="Xóa mục tiêu"
                      aria-label="Xóa mục tiêu"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
                  <Pagination
                    page={completedGoalsPage}
                    totalPages={completedGoalsTotalPages}
                    onChange={setCompletedGoalsPage}
                  />
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* [T-S26] Modal "Xem tất cả" lịch sử góp quỹ đầy đủ — chỉ render khi
          có goal đang chọn, đóng bằng nút X, click overlay, hoặc phím Esc. */}
      {historyGoal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4"
          onClick={() => setHistoryGoalId(null)}
        >
          <div
            className="bg-(--sst-surface) rounded-2xl shadow-2xl border border-(--sst-border) w-full max-w-md max-h-[80vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-(--sst-border) shrink-0">
              <div>
                <h3 className="text-sm font-bold text-(--sst-text) flex items-center gap-1.5">
                  <History className="w-4 h-4 text-indigo-500 dark:text-indigo-300" />
                  {historyGoal.linkedCategoryId ? "Lịch sử chi tiêu" : "Lịch sử góp quỹ"}
                </h3>
                <p className="text-xs text-(--sst-text-secondary) mt-0.5">{historyGoal.name}</p>
              </div>
              <button
                onClick={() => setHistoryGoalId(null)}
                className="text-(--sst-text-muted) hover:text-(--sst-text-secondary) p-1 rounded-full hover:bg-(--sst-surface-hover) cursor-pointer shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                title="Đóng"
                aria-label="Đóng lịch sử"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="overflow-y-auto px-5 py-3 flex-1">
              {/* [T-S57, CONSTITUTION §1.20/§1.21] Giai đoạn liên kết category
                  ĐÃ KẾT THÚC (đổi category khác hoặc unlink) — chỉ đọc, snapshot
                  từ linked_history, KHÔNG phải giao dịch thật. Hiện trước danh
                  sách giao dịch "đang sống" bên dưới, phân biệt rõ bằng nhãn +
                  màu khác. */}
              {(() => {
                // T-S60 — tách riêng "giai đoạn đã đóng băng" (linked/manual,
                // hành vi cũ giữ nguyên) khỏi "log rút quỹ" (withdrawal_log,
                // MỚI) — 2 khái niệm khác hẳn nhau, gộp chung 1 khối dễ gây
                // hiểu nhầm rút quỹ cũng là 1 "giai đoạn đã đóng băng".
                const frozenPeriods = historyGoal.linkedHistory.filter((h) => h.type !== "withdrawal_log");
                if (frozenPeriods.length === 0) return null;
                return (
                  <div className="mb-3 pb-3 border-b border-(--sst-border)">
                    <p className="text-[10px] font-bold text-(--sst-text-muted) uppercase tracking-wider mb-1.5">
                      Giai đoạn trước đó (đã đóng băng)
                    </p>
                    <ul className="space-y-1.5">
                      {frozenPeriods
                        .slice()
                        .reverse()
                        .map((h, idx) => {
                          const isExpanded = expandedHistoryIdx.has(idx);
                          const hasDetail = h.transactionsSnapshot.length > 0;
                          return (
                            <li key={idx} className="rounded-lg bg-(--sst-surface-2)/70">
                              <button
                                type="button"
                                onClick={() =>
                                  hasDetail &&
                                  setExpandedHistoryIdx((prev) => {
                                    const next = new Set(prev);
                                    next.has(idx) ? next.delete(idx) : next.add(idx);
                                    return next;
                                  })
                                }
                                className={`w-full flex items-center justify-between gap-3 text-xs px-2 py-1.5 ${
                                  hasDetail ? "cursor-pointer hover:bg-(--sst-surface-hover)/80 rounded-lg" : "cursor-default"
                                }`}
                              >
                                <div className="min-w-0 flex items-center gap-1.5">
                                  {hasDetail && (
                                    <ChevronDown
                                      className={`w-3 h-3 text-(--sst-text-muted) shrink-0 transition-transform ${
                                        isExpanded ? "rotate-180" : ""
                                      }`}
                                    />
                                  )}
                                  <div className="min-w-0 text-left">
                                    <p className="font-medium text-(--sst-text-secondary) truncate">
                                      {h.type === "manual" ? "💰 Góp thủ công (đã liên kết)" : `🔗 ${h.categoryName}`}
                                    </p>
                                    {h.type === "linked" && (
                                      <p className="text-[10px] text-(--sst-text-muted) mt-0.5">
                                        {formatDate(h.startDate!)} – {formatDate(h.endDate!)}
                                      </p>
                                    )}
                                  </div>
                                </div>
                                <span className="text-xs font-bold text-(--sst-text-secondary) shrink-0">
                                  {formatCurrency(h.amount)}
                                </span>
                              </button>
                              {isExpanded && hasDetail && (
                                <ul className="pl-6 pr-2 pb-2 space-y-1 divide-y divide-slate-100">
                                  {h.transactionsSnapshot.map((t) => (
                                    <li key={t.id} className="pt-1 first:pt-0 flex items-center justify-between gap-2 text-[11px]">
                                      <div className="min-w-0">
                                        <p className="text-(--sst-text-secondary) truncate">{t.description}</p>
                                        <p className="text-[10px] text-(--sst-text-muted)">{formatDate(t.date)}</p>
                                      </div>
                                      <span className="font-semibold text-(--sst-text-secondary) shrink-0">
                                        {formatCurrency(t.amount)}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </li>
                          );
                        })}
                    </ul>
                  </div>
                );
              })()}
              {/* [T-S60/T-S83, CONSTITUTION §1.21] "Đã rút quỹ" — log rút
                  từ phần liên kết (KHÔNG phải giao dịch thật, chỉ để theo
                  dõi dòng tiền quỹ "ngoài đời") + phần rút thủ công CÙNG 1
                  lần bấm "Rút quỹ" khi bị cascade (gộp theo `withdrawalGroupId`,
                  migration 0023) — hiện GỘP 1 dòng "rút ở nguồn nào bao
                  nhiêu" thay vì 2 dòng rời rạc không rõ liên quan. Tách
                  riêng khối, màu rose để phân biệt rõ với "đã đóng băng"
                  (slate) và "đang góp/đang sống" (bên dưới). Sắp xếp mới
                  nhất trước, xuyên suốt cả 2 nguồn. */}
              {(() => {
                // [T-S84 BUGFIX] Trước đây lọc `.filter((g) => g.linkedAmount > 0)`
                // — vô tình ẩn HOÀN TOÀN các khoản rút CHỈ từ phần thủ công
                // (linkedAmount=0) khỏi modal, đúng bug thứ 2 người dùng phát
                // hiện qua test T-S83 ("không có bất kỳ lịch sử nào được ghi
                // khi rút bằng khoản thủ công"). `withdrawalGroupsFor()` đã tự
                // gom đúng CẢ 2 nguồn (xem định nghĩa hàm) — hiện TOÀN BỘ, không
                // lọc theo nguồn nữa, đúng vai trò "Đã rút quỹ" là nơi DUY NHẤT
                // hiển thị mọi khoản rút (thay cho `goalHistoryFor`, T-S84).
                const withdrawalGroups = withdrawalGroupsFor(historyGoal);
                if (withdrawalGroups.length === 0) return null;
                return (
                  <div className="mb-3 pb-3 border-b border-(--sst-border)">
                    <p className="text-[10px] font-bold text-rose-400 dark:text-rose-300 uppercase tracking-wider mb-1.5">Đã rút quỹ</p>
                    <ul className="space-y-1.5">
                      {withdrawalGroups.map((g) => {
                        const total = g.manualAmount + g.linkedAmount;
                        return (
                          <li
                            key={g.key}
                            className="rounded-lg bg-rose-50/60 dark:bg-rose-500/10 px-2 py-1.5 flex items-center justify-between gap-3 text-xs"
                          >
                            <div className="min-w-0">
                              <p className="font-medium text-rose-700 dark:text-rose-300 truncate">
                                💸 {g.note || "Rút quỹ"}
                                {g.isGrouped && (
                                  <span className="ml-1.5 text-[9px] font-bold text-rose-400 dark:text-rose-300 bg-rose-100/80 dark:bg-rose-500/10 px-1 py-0.5 rounded align-middle">
                                    Gộp 2 nguồn
                                  </span>
                                )}
                              </p>
                              <p className="text-[10px] text-(--sst-text-muted) mt-0.5">
                                {formatDate(g.date)}
                                {g.isGrouped && (
                                  <>
                                    {" · "}
                                    liên kết {formatCurrency(g.linkedAmount)} + thủ công {formatCurrency(g.manualAmount)}
                                  </>
                                )}
                              </p>
                            </div>
                            <span className="text-xs font-bold text-rose-600 dark:text-rose-300 shrink-0">−{formatCurrency(total)}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })()}
              {/* [T-S79, CONSTITUTION §1.22.4] Khối RIÊNG cho log
                  `completed_unspent` — KHÁC hẳn "Đã rút quỹ" (rose, nghĩa
                  "đã tiêu/đã rút"): đây là "đã gom đủ NHƯNG CHƯA DÙNG",
                  màu indigo trung tính để không gây hiểu nhầm là đã trừ
                  tiền — thực tế các dòng này KHÔNG bị trừ vào
                  `goalCurrentAmount` (thuần thông tin snapshot). */}
              {(() => {
                const unspentEntries = historyGoal.linkedHistory.filter((h) => h.type === "completed_unspent");
                if (unspentEntries.length === 0) return null;
                return (
                  <div className="mb-3 pb-3 border-b border-(--sst-border)">
                    <p className="text-[10px] font-bold text-indigo-400 dark:text-indigo-300 uppercase tracking-wider mb-1.5">
                      Đã hoàn thành — chưa dùng
                    </p>
                    <ul className="space-y-1.5">
                      {unspentEntries
                        .slice()
                        .reverse()
                        .map((h, idx) => {
                          const manual = h.manualAmount ?? 0;
                          const linked = h.linkedAmount ?? 0;
                          return (
                            <li
                              key={idx}
                              className="rounded-lg bg-indigo-50/60 dark:bg-indigo-500/10 px-2 py-1.5 flex items-center justify-between gap-3 text-xs"
                            >
                              <div className="min-w-0">
                                <p className="font-medium text-indigo-700 dark:text-indigo-300 truncate">🏁 {h.note || "Hoàn thành, chưa dùng tiền"}</p>
                                <p className="text-[10px] text-(--sst-text-muted) mt-0.5">
                                  {formatDate(h.endedAt.slice(0, 10))}
                                  {manual > 0 && linked > 0
                                    ? ` · thủ công ${formatCurrency(manual)} + liên kết ${formatCurrency(linked)}`
                                    : manual > 0
                                      ? ` · thủ công ${formatCurrency(manual)}`
                                      : linked > 0
                                        ? ` · liên kết ${formatCurrency(linked)}`
                                        : ""}
                                </p>
                              </div>
                              <span className="text-xs font-bold text-indigo-600 dark:text-indigo-300 shrink-0">{formatCurrency(manual + linked)}</span>
                            </li>
                          );
                        })}
                    </ul>
                  </div>
                );
              })()}
              {historyContributions.length === 0 ? (
                <p className="text-xs text-(--sst-text-muted) text-center py-6">
                  {historyGoal.linkedCategoryId ? "Chưa có giao dịch nào trong khoảng ngày liên kết." : "Chưa có khoản góp quỹ nào."}
                </p>
              ) : (
                <>
                  <ul className="divide-y divide-slate-100">
                    {pagedHistoryContributions.map((t) => {
                      // [T-S73, 13/08/2026 — xác nhận qua trao đổi lại: giao
                      // dịch CHI trong category liên kết (vd "mua 40 VIN
                      // -50.000") về bản chất là tiền GÓP vào goal — ĐÚNG là
                      // chi tiêu thật trong Sổ Giao Dịch (không đổi ở đó),
                      // nhưng trong modal Lịch sử CỦA GOAL này thì phải hiện
                      // "+" để đúng ý nghĩa "đang tích luỹ", không phải
                      // "đang rút". Dòng RÚT THẬT (log rút quỹ) đã hiện ở
                      // khối rose "ĐÃ RÚT TỪ PHẦN LIÊN KẾT" riêng phía trên
                      // rồi (nguồn `linked_history`, KHÔNG phải danh sách
                      // này) — nên với goal ĐANG liên kết, MỌI dòng trong
                      // danh sách này chắc chắn là góp, không có dòng nào là
                      // rút thật. `t.type==='expense'` chỉ còn đúng nghĩa
                      // "rút thủ công" (T-S65) cho goal KHÔNG đang liên kết.
                      const isWithdrawal = !historyGoal.linkedCategoryId && t.type === "expense";
                      return (
                        <li key={t.id} className="py-2.5 flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-(--sst-text) truncate">
                              {isWithdrawal ? "💸 " : ""}
                              {t.description}
                            </p>
                            <p className="text-[10px] text-(--sst-text-muted) mt-0.5">{formatDate(t.date)}</p>
                          </div>
                          <span className={`text-xs font-bold shrink-0 ${isWithdrawal ? "text-rose-600 dark:text-rose-300" : "text-indigo-600 dark:text-indigo-300"}`}>
                            {isWithdrawal ? "−" : "+"}
                            {formatCurrency(Math.abs(t.amount))}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  <Pagination page={historyPage} totalPages={historyTotalPages} onChange={setHistoryPage} />
                </>
              )}
            </div>

            <div className="px-5 py-3 border-t border-(--sst-border) flex items-center justify-between shrink-0 bg-(--sst-surface-2)/50">
              <span className="text-[10px] text-(--sst-text-muted)">
                {/* [T-S84, thay cho ghi chú T-S65 cũ] Từ T-S84, `historyContributions`
                    chỉ còn khoản GÓP thuần (không lẫn rút nữa, xem `goalHistoryFor`)
                    — cộng thêm số nhóm ở khối "Đã rút quỹ" để "X khoản" phản ánh
                    ĐÚNG tổng số dòng thật sự hiện trong modal (góp + rút), không
                    chỉ đếm riêng phần góp. */}
                {historyContributions.length +
                  withdrawalGroupsFor(historyGoal).length +
                  historyGoal.linkedHistory.filter((h) => h.type === "completed_unspent").length}{" "}
                khoản
              </span>
              <span className="text-xs font-bold text-(--sst-text)">
                Tổng đã tích luỹ: {formatCurrency(goalCurrentAmount(historyGoal))}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}