/**
 * T-S06e1 — Chuyển 1 item ở shape cũ (`Omit<Transaction, "id"|"createdAt">`,
 * dùng bởi SmartInput/AIAssistantBubble/TransactionHistory form) sang
 * `TransactionInsert` thật (snake_case, đúng DB — CONSTITUTION §2).
 *
 * KHÔNG dùng cho luồng đọc (xem `mapRows.ts`, chiều ngược lại).
 *
 * Quy tắc `member_id`/`owner_id`/`household_id` áp đúng CONSTITUTION §1.2 +
 * `tx_scope_xor`: hàm này là nơi DUY NHẤT quyết định owner/household/member
 * — 3 component gọi hàm này không tự set 3 field đó, tránh lệch giữa các
 * nơi gọi (bug tương tự sẽ vi phạm RLS insert policy §3 ngay lập tức nếu
 * lệch, nên gom về 1 chỗ để dễ audit).
 */
import type { Database } from "./database.types";
import type { Category, Transaction } from "../types";
import type { ScopeMode } from "../context/ScopeContext";

type TransactionInsert = Database["public"]["Tables"]["transactions"]["Insert"];
type GoalInsert = Database["public"]["Tables"]["saving_goals"]["Insert"];

export interface WriteScope {
  scopeMode: ScopeMode;
  userId: string | undefined;
  householdId: string | undefined;
}

export type ParsedItem = Omit<Transaction, "id" | "createdAt">;

/**
 * T-S06e1b — trước đây `categoryName === "Thu nhập"` là 1 danh mục ẢO,
 * không có row thật (return null cứng). Từ khi có `categories.type`
 * (0009_categories_add_income_type.sql), "Thu nhập" không còn là trường
 * hợp đặc biệt — mọi category (thu hoặc chi) đều là row thật, resolve theo
 * tên như nhau. Không tìm thấy (category đổi tên/xoá giữa chừng) fallback
 * `category_id: null`, đúng tinh thần "Khác" ở `mapRows.ts`.
 */
export function resolveCategoryId(categoryName: string, categories: Category[]): string | null {
  return categories.find((c) => c.name === categoryName)?.id ?? null;
}

/**
 * T-S06e1b — nguồn sự thật DUY NHẤT cho "giao dịch này là thu hay chi":
 * `category.type` (DB thật). Thay hẳn heuristic so tên cũ
 * (`item.category === "Thu nhập"`), vốn là nguồn gốc bug thật đã ghi trong
 * CHANGELOG (không tách được nhiều danh mục thu nhập).
 *
 * [BUGFIX T-S22 09/08/2026, CONSTITUTION §1.4] Trước đây không tìm thấy
 * category (tên đã đổi/xoá giữa chừng) fallback im lặng `'expense'` — đây
 * chính là gốc rễ thật của T-S21/T-S21b: 1 khoản THU bị AI gán category
 * fallback không tồn tại thật (vd "Khác") thì bị ghi cứng vĩnh viễn thành
 * `type='expense'` ngay từ lúc tạo (giao dịch không sửa được `type` sau khi
 * tạo, xem §1.2, tới khi T-S23 mở khoá). Giờ THROW rõ ràng thay vì suy đoán
 * — đây là hàng rào phòng thủ tầng 2 (defense-in-depth): tầng 1 đã chặn ở
 * UI (`SmartInput`/`AIAssistantBubble`/form thủ công `TransactionHistory`
 * đều disable nút Lưu + không gọi hàm này khi category chưa khớp, T-S22b),
 * nhưng nếu có nơi gọi mới sau này quên chặn, hàm này PHẢI fail rõ ràng
 * (lỗi hiện ra, người dùng thấy) thay vì âm thầm ghi sai dữ liệu tài chính
 * không sửa lại được.
 */
export function resolveTransactionType(
  categoryName: string,
  categories: Category[]
): "income" | "expense" {
  const type = categories.find((c) => c.name === categoryName)?.type;
  if (!type) {
    throw new Error(
      `Không xác định được loại giao dịch (thu/chi) vì danh mục "${categoryName}" không tồn tại trong danh sách hiện tại. Vui lòng chọn 1 danh mục có sẵn trước khi lưu.`
    );
  }
  return type;
}

/**
 * `item.goalId` có 3 dạng: uuid thật (goal có sẵn), `"new_goal_<tên>"` (cần
 * tạo mới on-the-fly — xem `assignSavingGoal` ở SmartInput/AIAssistantBubble),
 * hoặc undefined. Hàm này CHỈ resolve uuid có sẵn; token "new_goal_" phải
 * được tạo TRƯỚC (qua `useCreateGoal`) ở tầng gọi rồi truyền uuid thật vào
 * `buildTransactionInsert` — tách riêng vì tạo goal là side-effect async,
 * không hợp để giấu trong 1 hàm map thuần.
 */
export function isNewGoalToken(goalId: string | undefined): goalId is string {
  return !!goalId && goalId.startsWith("new_goal_");
}

export function extractNewGoalName(token: string): string {
  return token.replace("new_goal_", "");
}

export function buildTransactionInsert(
  item: ParsedItem,
  categories: Category[],
  scope: WriteScope,
  /** uuid thật đã resolve (nếu item.goalId là token "new_goal_" đã tạo xong ở tầng gọi) */
  resolvedGoalId?: string | null
): TransactionInsert {
  // [T-S49 10/08/2026 — CONSTITUTION §1.14] Tầng phòng thủ 2 cũ (T-S45)
  // từng throw ở đây khi thiếu goal cho category/mô tả "liên quan tiết
  // kiệm" — ĐÃ BỎ cùng lúc với việc bỏ chặn cứng ở tầng 1 (UI). Gợi ý gắn
  // goal giờ CHỈ còn là banner mềm dựa trên khớp TÊN goal active
  // (`isSavingsSuggested`, savingsDetect.ts) — người dùng không chọn vẫn
  // lưu bình thường như mọi giao dịch khác, không có gì để chặn ở đây nữa.
  const goal_id = resolvedGoalId !== undefined ? resolvedGoalId : isNewGoalToken(item.goalId) ? null : item.goalId ?? null;

  // T-S14 (migration 0013, CONSTITUTION §1.9): hiện tại `goal_id` chỉ được
  // gán khi SmartInput/AIAssistantBubble phát hiện đây là góp quỹ tiết kiệm
  // (`assignSavingGoal`, chạy khi `isSavingsContribution` true) — chưa có
  // đường nào khác gán `goal_id`. Vì vậy có `goal_id` (không null) ĐỒNG
  // NGHĨA với "đây là chuyển khoản góp quỹ" ở trạng thái code hiện tại →
  // ép `type = 'transfer'`, bỏ qua kết quả `resolveTransactionType()` (vốn
  // suy ra từ category, không phân biệt được góp quỹ với chi tiêu thường).
  // ⚠️ Giả định này sẽ KHÔNG còn đúng khi T-S20 chạy (nhận diện tự động sẽ
  // gắn `goal_id` cho cả giao dịch MUA THẬT `type='expense'` để tiện tra
  // lịch sử) — lúc đó phải thay điều kiện dưới đây bằng 1 cờ tường minh
  // (vd `item.isSavingsContribution`) thay vì suy luận qua `goal_id`.
  const type: TransactionInsert["type"] =
    goal_id !== null ? "transfer" : resolveTransactionType(item.category, categories);

  const base = {
    type,
    description: item.description,
    amount: Math.abs(item.amount),
    date: item.date,
    note: item.note || null,
    category_id: resolveCategoryId(item.category, categories),
    goal_id,
  };

  if (scope.scopeMode === "household") {
    // CONSTITUTION §1.2 — member_id LUÔN = người đang đăng nhập, không cho
    // chọn thành viên khác (RLS insert policy §3 sẽ raise nếu lệch).
    return { ...base, household_id: scope.householdId, member_id: scope.userId };
  }
  return { ...base, owner_id: scope.userId };
}

/**
 * Batch version — dùng bởi SmartInput/AIAssistantBubble (xác nhận nhiều
 * dòng AI bóc tách cùng lúc). Tự tạo goal mới cho từng token
 * `"new_goal_<tên>"` qua `createGoalAsync` (truyền thẳng
 * `useCreateGoal().mutateAsync`), có cache theo tên trong CÙNG 1 batch để
 * 2 dòng cùng nhắc tới 1 mục tiêu tiết kiệm mới không tạo trùng 2 row.
 * Tuần tự (không Promise.all) để cache hoạt động đúng và giữ đúng thứ tự
 * lỗi nếu 1 dòng insert goal thất bại giữa chừng.
 *
 * [T-S122, 20/08/2026 — bugfix, xem TASKS.md/CHANGELOG.md] Trả thêm
 * `newGoalIds` (key = tên goal đã lowercase, value = uuid thật vừa tạo) —
 * BẮT BUỘC tầng gọi phải ghi map này ngược lại vào state (`item.goalId`)
 * NGAY SAU KHI hàm này resolve thành công, TRƯỚC KHI chạy vòng lặp insert
 * transaction thật (vốn có thể lỗi giữa chừng). Nếu không, khi vòng lặp
 * insert transaction lỗi giữa batch và người dùng bấm lưu lại, hàm này sẽ
 * chạy lại từ đầu, thấy lại token `"new_goal_<tên>"` CHƯA được thay bằng
 * uuid thật trong state → tạo THÊM 1 goal trùng tên (goal ở lượt trước đã
 * tạo thành công thật trong DB, không mất, nhưng bị nhân đôi).
 */
export async function buildTransactionInserts(
  items: ParsedItem[],
  categories: Category[],
  scope: WriteScope,
  createGoalAsync: (input: GoalInsert) => Promise<{ id: string }>,
  /**
   * [BUGFIX 11/08/2026, CONSTITUTION §1.13/§1.14] Set category id đang bị 1
   * goal nào đó liên kết (`linked_category_id`) — category liên kết KHÔNG
   * BAO GIỜ được nhận `goal_id` thủ công (transfer), dù `item.goalId` có
   * giá trị gì. Chặn ở đây (tầng dùng chung) thay vì chỉ tin tầng gọi
   * (UI) — phòng đúng trường hợp bug thật đã gặp: banner đã ẩn khi đổi
   * sang category liên kết, nhưng `item.goalId` cũ (do người dùng đã chọn
   * trước đó, hoặc do AI tự gán qua `isSavingsContribution`) vẫn còn sót
   * lại trong state, âm thầm lọt qua tới lúc lưu nếu không chặn tại đây.
   */
  linkedCategoryIds?: ReadonlySet<string>
): Promise<{ inserts: TransactionInsert[]; newGoalIds: Map<string, string> }> {
  const newGoalCache = new Map<string, string>();
  const result: TransactionInsert[] = [];

  for (const item of items) {
    let resolvedGoalId: string | null | undefined;
    const categoryId = resolveCategoryId(item.category, categories);
    const isLinkedCategory = !!categoryId && !!linkedCategoryIds?.has(categoryId);

    if (isLinkedCategory) {
      resolvedGoalId = null;
    } else if (isNewGoalToken(item.goalId)) {
      const name = extractNewGoalName(item.goalId);
      const cacheKey = name.toLowerCase();
      const cached = newGoalCache.get(cacheKey);
      if (cached) {
        resolvedGoalId = cached;
      } else {
        const goalInsert: GoalInsert = {
          name,
          created_by: scope.userId as string,
          ...(scope.scopeMode === "household"
            ? { household_id: scope.householdId }
            : { owner_id: scope.userId }),
        };
        const created = await createGoalAsync(goalInsert);
        newGoalCache.set(cacheKey, created.id);
        resolvedGoalId = created.id;
      }
    }

    result.push(buildTransactionInsert(item, categories, scope, resolvedGoalId));
  }

  return { inserts: result, newGoalIds: newGoalCache };
}

type TransactionUpdate = Database["public"]["Tables"]["transactions"]["Update"];

/**
 * TransactionHistory — form sửa giao dịch.
 *
 * [T-S23, CONSTITUTION §1.10 — thay thế nguyên tắc bất biến cũ ở §1.2]
 * `type` giờ ĐỔI ĐƯỢC 2 chiều income <-> expense qua `edit.type` (tuỳ chọn).
 * KHÔNG cho truyền `'transfer'` — bị chặn ngay ở type-level TypeScript
 * (`database.types.ts` Update.type chỉ nhận "income"|"expense"). Việc chặn
 * "không cho đổi type khi giao dịch đang `transfer` hoặc có `goal_id`" là
 * trách nhiệm của TẦNG GỌI (component chỉ hiện toggle đổi loại khi
 * `t.type !== 'transfer' && !t.goalId`, xem TransactionHistory.tsx) — hàm
 * này không có quyền truy cập state đó nên không tự kiểm tra lại, chỉ có
 * hàng rào phòng thủ tầng 2 THẬT SỰ nằm ở trigger DB
 * `guard_transaction_type_change` (migration 0014).
 *
 * Việc hàm NÀY tự làm (tầng 1, trước khi gửi lên DB): nếu có `edit.type`,
 * bắt buộc category vừa chọn (`edit.category`) phải thuộc ĐÚNG NHÓM
 * `edit.type` — không tin dropdown ở tầng gọi đã lọc đúng (đúng bài học
 * T-S22: không suy đoán/tin ngầm, throw rõ ràng nếu lệch), tránh gửi lên
 * DB 1 patch chắc chắn bị trigger 0014 từ chối mà không có thông điệp lỗi
 * thân thiện tại chỗ.
 */
export function buildTransactionUpdate(
  edit: {
    description: string;
    amount: number;
    category: string;
    date: string;
    note?: string;
    type?: "income" | "expense";
  },
  categories: Category[]
): TransactionUpdate {
  const patch: TransactionUpdate = {
    description: edit.description,
    amount: Math.abs(edit.amount),
    date: edit.date,
    note: edit.note || null,
    category_id: resolveCategoryId(edit.category, categories),
  };

  if (edit.type) {
    const chosenCategory = categories.find((c) => c.name === edit.category);
    if (!chosenCategory || chosenCategory.type !== edit.type) {
      throw new Error(
        `Danh mục "${edit.category}" không thuộc nhóm "${
          edit.type === "income" ? "Thu nhập" : "Chi tiêu"
        }" — vui lòng chọn lại danh mục đúng nhóm sau khi đổi loại giao dịch.`
      );
    }
    patch.type = edit.type;
  }

  return patch;
}