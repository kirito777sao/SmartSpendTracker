// [T-S49 — CHỐT 10/08/2026, xem PRD.md "Chốt 10/08/2026 (tiếp)" +
// CONSTITUTION §1.14] Thay THẲNG cơ chế cũ của T-S45/T-S47 (khớp từ khoá
// "tiết kiệm"/"tích lũy"/tên category trong description/note, kèm CHẶN
// CỨNG bắt buộc chọn goal trước khi lưu — `isMissingRequiredSavingsGoal`,
// `isSavingsRelated`, `isSavingsCategoryName`, nay xoá hẳn, xem CHANGELOG).
//
// Lý do: category ngân sách định kỳ do Smart Advisor tạo (vd "Tiết kiệm &
// Đầu tư", T-S38/39) là 1 khoản CHI bình thường trong model YNAB — không
// phải mọi giao dịch rơi vào category đó đều là góp quỹ cho 1 goal cụ thể.
// Suy luận theo TÊN category/từ khoá tự do trong mô tả không bao giờ đủ
// đáng tin để CHẶN người dùng lưu giao dịch (CONSTITUTION §5: mọi suy luận
// tài chính tự động chỉ được dừng ở mức GỢI Ý).
//
// Cơ chế mới: chỉ còn 1 tín hiệu — mô tả HOẶC ghi chú của giao dịch khớp
// TÊN 1 mục tiêu tiết kiệm THỦ CÔNG đang ACTIVE (chưa `completedAt`, chưa
// liên kết category theo §1.13/T-S48 — goal liên kết không nhận góp quỹ
// thủ công) — dùng đúng kiểu match 2 chiều `includes()` đã có sẵn ở
// `assignSavingGoal`/`findMatchingActiveGoals` (T-S20, SmartInput.tsx).
// Khớp được → hiện banner MỀM (màu hổ phách, không khoá nút Lưu) gợi ý gắn
// vào goal đó, kèm nút "+ Tạo mục tiêu mới" ngay trong banner. Không khớp
// → không hiện gì, lưu bình thường như mọi giao dịch khác.
//
// [BUGFIX 11/08/2026, người dùng phát hiện qua test tay T-S49, xem
// CHANGELOG "T-S49 — sửa thiếu điều kiện loại trừ category đã liên kết
// goal"] CONSTITUTION §1.14 mục 1 CHỐT rõ: "Category ĐÃ liên kết 1 goal qua
// linked_category_id (§1.13) → không đoán gì cả, không dính banner này" —
// nhưng bản code gốc CHƯA BAO GIỜ thật sự kiểm tra điều kiện này (field
// `category` có khai báo trong `SavingsDetectInput` nhưng không được dùng ở
// đâu cả trong `findMatchingActiveGoalsByName`/`isSavingsSuggested`). Hệ
// quả: chọn ĐÚNG category đang liên kết 1 goal (T-S48), gõ mô tả trùng tên
// 1 goal THỦ CÔNG khác (không liên quan) → banner T-S49 vẫn hiện sai, lẽ ra
// phải im lặng hoàn toàn theo đúng chốt §1.13. Bug này nằm ở hàm DÙNG
// CHUNG nên ảnh hưởng cả 3 nơi gọi (SmartInput/AIAssistantBubble/
// TransactionHistory), dù chỉ bị phát hiện qua test tay ở TransactionHistory.
// Sửa: thêm `categoryId` vào `SavingsDetectInput` (optional — tầng gọi nào
// chưa truyền vẫn chạy bình thường, chỉ mất khả năng loại trừ này) +
// `linkedCategoryIds` (Set các category id đang bị 1 goal nào đó liên kết,
// tầng gọi tự tính từ TOÀN BỘ `goalRows` CHƯA lọc `linkedCategoryId`, khác
// với biến `goals` truyền vào hàm match — biến đó đã lọc bỏ goal liên kết
// từ trước, không còn giữ thông tin category nào đang bị liên kết nữa).

export interface SavingsDetectInput {
  category: string;
  /** [BUGFIX 11/08/2026] id thật của category đang chọn (không phải tên) —
   * dùng để đối chiếu với `linkedCategoryIds`. Optional để không phá vỡ
   * chữ ký hàm ở nơi gọi cũ nào chưa kịp cập nhật (dù hiện tại cả 3 nơi gọi
   * đều đã truyền). */
  categoryId?: string | null;
  description: string;
  note?: string;
  goalId?: string;
}

/** Shape tối thiểu cần có để so khớp tên — `rowToGoal()` (mapRows.ts) trả
 * về đầy đủ hơn (SavingGoal), nhưng hàm ở đây chỉ cần đúng 3 field này nên
 * khai báo interface riêng, tránh phụ thuộc ngược vào types.ts. */
export interface SavingsGoalNameCandidate {
  id: string;
  name: string;
  completedAt?: string;
  linkedCategoryId?: string;
}

/**
 * Trả về danh sách goal thủ công đang ACTIVE (chưa hoàn thành, chưa liên
 * kết category) khớp TÊN với mô tả hoặc ghi chú của giao dịch (includes 2
 * chiều, không phân biệt hoa/thường). Tầng gọi thường đã lọc sẵn
 * `linkedCategoryId` khỏi mảng `goals` truyền vào (xem SmartInput.tsx/
 * AIAssistantBubble.tsx/TransactionHistory.tsx) — hàm này lọc lại 1 lần
 * nữa cho chắc (defense-in-depth), không tin ngầm tầng gọi.
 */
export function findMatchingActiveGoalsByName<T extends SavingsGoalNameCandidate>(
  item: Pick<SavingsDetectInput, "description" | "note">,
  goals: T[]
): T[] {
  const descLower = (item.description || "").trim().toLowerCase();
  const noteLower = (item.note || "").trim().toLowerCase();
  if (!descLower && !noteLower) return [];
  return goals.filter((g) => {
    if (g.completedAt || g.linkedCategoryId) return false;
    const gName = g.name.trim().toLowerCase();
    if (!gName) return false;
    const matchesDesc = descLower.length > 0 && (descLower.includes(gName) || gName.includes(descLower));
    const matchesNote = noteLower.length > 0 && (noteLower.includes(gName) || gName.includes(noteLower));
    return matchesDesc || matchesNote;
  });
}

/**
 * [T-S49 amendment 11/08/2026 — CONSTITUTION §1.16, xem CHANGELOG "T-S49 —
 * bổ sung tín hiệu từ khoá ý định tiết kiệm"] Người yêu cầu test tay thấy
 * banner/"+ Tạo mục tiêu mới" chỉ hiện khi mô tả khớp ĐÚNG TÊN 1 goal có
 * sẵn — không có cách nào tạo goal MỚI cho 1 khoản rõ ràng là góp quỹ/tiết
 * kiệm nhưng CHƯA có goal nào tên khớp trước đó (vd lần đầu góp cho 1 mục
 * tiêu chưa từng tạo). Bổ sung tín hiệu thứ 2, ĐỘC LẬP với khớp tên goal:
 * category ĐANG CHỌN hoặc mô tả/ghi chú chứa từ khoá ý định tiết kiệm/góp
 * quỹ rõ ràng — chỉ dùng để quyết định có hiện banner/"+ Tạo mục tiêu mới"
 * hay không, KHÔNG dùng để tự chọn goal, KHÔNG khoá nút Lưu/Ghi Sổ/Xác
 * nhận (giữ đúng nguyên tắc §5 — suy luận tự động chỉ dừng ở mức gợi ý).
 * Khác lớp bug của T-S47 cũ (khớp từ khoá để CHẶN CỨNG, không đáng tin để
 * chặn) — ở đây chỉ dùng để HIỆN 1 lối tắt tiện lợi, sai/thiếu 1 vài
 * trường hợp không gây hại gì (không lưu sai dữ liệu tài chính), nên chấp
 * nhận được dù danh sách từ khoá không thể đầy đủ tuyệt đối.
 */
const SAVINGS_INTENT_KEYWORDS = [
  "tiết kiệm",
  "tích lũy",
  "tích luỹ",
  "tích góp",
  "góp",
  "hùn vốn",
  "đầu tư",
  "heo đất",
  "bỏ ống",
];

/**
 * True nếu category ĐANG CHỌN hoặc mô tả/ghi chú chứa ≥1 từ khoá ý định
 * tiết kiệm/góp quỹ (`SAVINGS_INTENT_KEYWORDS`, không phân biệt hoa/thường).
 * Chỉ dùng làm tín hiệu HIỆN gợi ý (banner/"+ Tạo mục tiêu mới") — xem
 * `isSavingsSuggested`, KHÔNG dùng ở bất kỳ chỗ nào quyết định chặn lưu.
 */
export function matchesSavingsIntentKeyword(
  category: string,
  description: string,
  note?: string
): boolean {
  const haystack = `${category || ""} ${description || ""} ${note || ""}`.toLowerCase();
  return SAVINGS_INTENT_KEYWORDS.some((kw) => haystack.includes(kw));
}

/**
 * Có nên hiện banner "Gắn vào mục tiêu" (dropdown góp quỹ) hay không: đã có
 * `goalId` gắn sẵn (kể cả token "new_goal_..." đang chờ tạo), HOẶC mô
 * tả/ghi chú khớp tên ≥1 goal active, HOẶC [11/08/2026] category/mô
 * tả/ghi chú chứa từ khoá ý định tiết kiệm rõ ràng
 * (`matchesSavingsIntentKeyword`) dù chưa khớp tên goal cụ thể nào — trường
 * hợp này banner vẫn hiện để mở lối tạo goal mới, nhưng KHÔNG có gợi ý tên
 * cụ thể nào (xem `matchedContributionGoals` ở tầng gọi để phân biệt 2
 * trường hợp khi hiển thị câu chữ).
 *
 * [BUGFIX 11/08/2026, CONSTITUTION §1.14 mục 1] Ngoại lệ tuyệt đối: nếu
 * category ĐANG CHỌN (`item.categoryId`) là 1 category đã liên kết goal
 * (§1.13, `linkedCategoryIds` chứa id đó) → LUÔN false, không đoán gì cả,
 * bất kể mô tả/ghi chú/`goalId`/từ khoá là gì — đúng nguyên văn chốt "không
 * dính banner này".
 */
export function isSavingsSuggested<T extends SavingsGoalNameCandidate>(
  item: SavingsDetectInput,
  goals: T[],
  linkedCategoryIds?: ReadonlySet<string>
): boolean {
  if (item.categoryId && linkedCategoryIds?.has(item.categoryId)) return false;
  if (item.goalId) return true;
  if (findMatchingActiveGoalsByName(item, goals).length > 0) return true;
  return matchesSavingsIntentKeyword(item.category, item.description, item.note);
}