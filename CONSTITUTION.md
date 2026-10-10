# CONSTITUTION.md — Smart Spend Tracker (Supabase Migration)

Tài liệu này là nguồn sự thật duy nhất về kiến trúc. Đọc lại toàn bộ file này ở đầu MỖI task, bất kể task đó là gì.

## 1. Stack đã chốt

- Frontend: React 19 + Vite (giữ nguyên), thêm `@supabase/supabase-js`, `@tanstack/react-query`.
- Backend "tự viết" (`server.ts`) → **loại bỏ hoàn toàn**, thay bằng:
  - Supabase Postgres (schema §2) + RLS (schema §3) làm nguồn sự thật duy nhất.
  - 2 Supabase Edge Functions: `parse-transaction` (giữ nguyên logic rule-first + Gemini fallback, chỉ đổi runtime), `telegram-webhook` (thiết kế lại theo §4).
- Auth: **Supabase Auth** — email/password + **Google OAuth** (`signInWithOAuth`, thêm 02/08/2026, xem PRD.md "Quyết định đã lock") cho định danh + session. Field nghiệp vụ nằm ở `public.profiles`. Cả 2 luồng đăng nhập PHẢI đi qua cùng 1 trigger tạo `profiles` row khi có `auth.users` insert — không viết đường tạo profile riêng cho OAuth.
- Đồng bộ realtime: **Supabase Realtime** (`postgres_changes`), thay hoàn toàn cơ chế poll 4 giây.
- Data fetching client: **TanStack Query** (`useQuery` + `useMutation` + optimistic `onMutate`), thay state thủ công + so sánh `JSON.stringify`.
- localStorage: hạ cấp thành cache đọc-thôi (tuỳ chọn, không phải nguồn sự thật). Không ghi state nghiệp vụ qua nó nữa.

### 1.1 Quy ước TanStack Query — CHỐT 05/08/2026 (quyết định khi lập kế hoạch T-S06)

- **Vị trí hook**: `src/hooks/{useTransactions,useCategories,useGoals,useHousehold}.ts` — mỗi file export 1 query hook (`useQuery`) + các mutation hook liên quan (`useMutation`) cho đúng service cùng tên ở `src/services/`. Không định nghĩa query/mutation rời rạc ngay trong component.
- **Gọi hook tại nơi dùng, không prop-drill**: mọi component cần dữ liệu tự `import` và gọi hook trực tiếp (giống chuẩn TanStack Query khuyến nghị), KHÔNG gọi hết ở `App.tsx` rồi truyền props xuống nhiều tầng. `App.tsx` sau T-S06 chỉ còn giữ: layout/tab navigation, `theme`, bootstrap session (`currentUser`/`isAuthLoading` — thuộc phạm vi Auth, không phải data hook). Lý do: file gốc 1521 dòng phần lớn phình ra vì prop-drilling; cách này dễ mở rộng khi thêm feature/component mới sau này, cache tự dedupe giữa các component cùng đọc 1 query key nên không lo gọi hook nhiều nơi bị fetch trùng.
- **`scopeMode` (`'personal' | 'household'`)**: là lựa chọn UI, không phải server state → giữ là React Context (`ScopeContext`, tạo ở T-S06a) thay vì prop-drill; mọi hook data đọc `scopeMode` từ context để dựng query key, không nhận qua tham số truyền tay.
- **Query key factory chuẩn** (tránh lệch key giữa các hook, key sai là nguyên nhân phổ biến nhất của cache stale):
  - `['transactions', scopeMode, scopeMode === 'household' ? householdId : userId]`
  - `['categories', scopeMode, ...]`, `['goals', scopeMode, ...]` theo đúng mẫu trên.
  - `['household', userId]` (không phụ thuộc scopeMode — luôn là hộ hiện tại của user).
  - Đổi `scopeMode` hoặc `householdId` (join/leave hộ) → key đổi tự nhiên → TanStack Query tự invalidate/refetch đúng, không cần code thủ công xoá cache theo tay như bản localStorage cũ.
- **Mutation**: base cho T-S06 chỉ cần `onSuccess: () => queryClient.invalidateQueries(...)`; optimistic `onMutate` + rollback là phạm vi RIÊNG của T-S07, KHÔNG làm sớm trong T-S06 (tránh 2 task chồng lấn khó verify độc lập).

### 1.2 "Thành viên thực hiện" khi ghi giao dịch hộ gia đình — CHỐT 06/08/2026 (quyết định khi làm T-S06e1)

- **Bối cảnh phát hiện**: `member_id` trong `transactions` bị RLS insert policy (§3) ép cứng = `auth.uid()` khi `household_id` có giá trị — không có cách nào set `member_id` thành 1 thành viên khác qua client. UI 3 component ghi (`SmartInput`, `AIAssistantBubble`, `TransactionHistory`) trước T-S06e1 có dropdown "Thành viên thực hiện" cho phép chọn TUỲ Ý thành viên — không còn khớp model DB thật.
- **Quyết định**: ở scope hộ gia đình, field này ẨN/KHOÁ hoàn toàn (không phải dropdown chọn được) — tự động gán `member_id = auth.uid()` (người đang đăng nhập), hiển thị 1 dòng thông tin read-only "Bạn: `<tên hiển thị>`". Ở scope cá nhân, ẨN hẳn field này (không có khái niệm thành viên, `member_id` luôn null theo `tx_scope_xor`).
- **Tên hiển thị dùng ở đây PHẢI là `profiles.name` (+ `profiles.personal_role`, format `"${personal_role} (${name})"` — khớp `authMapping.buildUserFromProfile`), KHÔNG BAO GIỜ dùng `profiles.email`** — lấy qua `useCurrentMember()` (hook mới, `src/hooks/useHousehold.ts`, tái dùng `useHouseholdMembers` đã có, không tạo query riêng).
- **Hệ quả cho sửa giao dịch**: `transactions` Update type (`database.types.ts`) vốn đã KHÔNG có `member_id` — người thực hiện cố định tại thời điểm tạo, không sửa được sau. Vì vậy form sửa giao dịch bỏ hẳn field "Thành viên" (chỉ hiển thị lại, không cho chỉnh), không phải chỉ khoá.
- **Gap liên quan phát hiện cùng lúc**: Update type cũng KHÔNG có `type` (income/expense) — nghĩa là cố định từ lúc tạo giống `member_id`, không đổi được qua sửa. Form sửa giao dịch phải bỏ option "Thu nhập" khỏi dropdown danh mục khi sửa (chỉ đổi được giữa các category chi tiêu thật với nhau); muốn đổi 1 giao dịch từ chi tiêu sang thu nhập (hoặc ngược lại) phải xoá rồi tạo lại — không nằm trong phạm vi sửa nhanh của T-S06e1, ghi nhận as-is theo đúng ràng buộc DB đã CHỐT ở §2, không tự ý mở rộng `Update` type để né.
- **Hệ quả kéo theo (bắt buộc để test được household scope)**: phát hiện gap — nút chuyển "Cá nhân/Hộ gia đình" ở header `App.tsx` chỉ đổi state `scopeMode` cục bộ cũ của `App.tsx`, KHÔNG đổi `ScopeContext` (T-S06a) mà mọi hook dữ liệu mới thực sự đọc — nghĩa là trước bản vá này, chuyển sang "Hộ gia đình" trên UI không hề đổi scope thật của các component đã migrate. Đã vá trong T-S06e1: nút bấm gọi đồng thời `setScopeMode` cũ (còn dùng bởi phần chưa migrate) và `useScope().setScopeMode` (context thật). Dọn hẳn state cũ là việc của T-S06e4/T-S06f.

### 1.3 `categories.type` ('income' | 'expense') — CHỐT 06/08/2026 (quyết định khi verify T-S06e1, thực thi ở T-S06e1b)

- **Bối cảnh phát hiện**: "Thu nhập" trước đây là 1 category ẢO hard-code ở 4 nơi (`SmartInput.tsx`, `AIAssistantBubble.tsx`, `TransactionHistory.tsx` ×2 chỗ) — không có row thật trong `categories`. Mọi giao dịch income đều `category_id = null`, gộp chung 1 rổ, không tách được nhiều nguồn thu (Lương/Thưởng/Bán đồ cũ...) để phân tích riêng. Mọi category thật trong DB ngầm định là category chi tiêu nhưng không có gì ép điều đó ở tầng schema.
- **Quyết định**: thêm cột `categories.type text not null default 'expense' check (type in ('income','expense'))` — xem migration `0009_categories_add_income_type.sql`. Đây là ngoại lệ CÓ REVIEW cho quy tắc "không ALTER thêm cột lớn sau này" ở §2 (đúng quy trình: đã hỏi trước, xác nhận với người yêu cầu trước khi chạy).
- **Hệ quả bắt buộc ở mọi nơi đọc/ghi category**:
  - `resolveCategoryId`/`resolveTransactionType` (`src/lib/toTransactionInsert.ts`) suy luận thu/chi từ `category.type` (nguồn DUY NHẤT đáng tin) — KHÔNG BAO GIỜ so tên chuỗi (`categoryName === "Thu nhập"`) nữa, đó chính là bug gốc.
  - Mọi dropdown chọn category khi TẠO MỚI giao dịch (`SmartInput`, `AIAssistantBubble`, form "Ghi chi tiêu" của `TransactionHistory`) gộp 2 `optgroup` (💵 Thu nhập / 🧾 Chi tiêu) lọc theo `category.type`, cho phép nhiều category ở mỗi phe.
  - Dropdown chọn category khi SỬA giao dịch: `type` giao dịch cố định từ lúc tạo (`Update` không có field `type`, xem §1.2) — dropdown chỉ hiện category CÙNG PHE với giao dịch đang sửa (`c.type === (isIncome ? "income" : "expense")`), không hiện lẫn.
  - `BudgetLimits`: hạn mức (`limit_amount`) chỉ có ý nghĩa cho category `type='expense'` — ẩn hoặc không cho đặt limit cho category income (thực thi ở T-S06e2, xem TASKS.md).
- **Migrate dữ liệu cũ**: giao dịch income có sẵn với `category_id is null` được gán vào 1 category "Thu nhập chung" (💵) tự tạo cho đúng scope của nó (cá nhân theo từng `owner_id`, hộ theo từng `household_id`) — chạy 1 lần trong chính migration `0009`, không phải thao tác thủ công.
- **KHÔNG đổi RLS**: không policy nào lọc theo cột này; INSERT/UPDATE backfill chạy trong migration (bypass RLS bằng quyền chạy migration), không đi qua client.

### 1.4 An toàn `<select>` bind theo tên chuỗi — CHỐT 07/08/2026 (gap phát hiện khi user test thủ công T-S06e1/e1b)

- **Bối cảnh phát hiện**: `SmartInput.tsx`/`AIAssistantBubble.tsx` bind `<select value={item.category}>` theo tên category do AI trả về (có thể là chuỗi fallback như "Khác" không đảm bảo tồn tại thật trong danh sách category của user, vd user chưa từng tạo category "Khác"). Khi `value` không khớp bất kỳ `<option>` nào, HTML `<select>` tự động fallback hiển thị **option đầu tiên trong DOM** một cách im lặng — không có exception, không có cảnh báo — trong khi biến state (`item.category`) vẫn giữ giá trị cũ không khớp. UI hiển thị SAI với dữ liệu sẽ thật sự được lưu (bug lệch UI-state, không phải lệch dữ liệu DB).
- **Quy tắc bắt buộc áp dụng cho MỌI `<select>` bind theo tên/chuỗi tự do (không phải id cố định từ 1 danh sách enum đóng) trong toàn bộ codebase**: PHẢI kiểm tra `value` hiện tại có khớp 1 `<option>` đang render hay không trước khi tin vào UI hiển thị; nếu không khớp, PHẢI tự thêm 1 `<option>` tường minh mang đúng giá trị đó kèm nhãn cảnh báo (vd `⚠️ "<giá trị>" — chưa xác định`), KHÔNG được để trình duyệt tự chọn hộ item đầu tiên trong im lặng.
- Áp dụng ngay ở T-S06e1c cho 2 dropdown category (`SmartInput`, `AIAssistantBubble`); khi thêm `<select>` mới bind theo tên chuỗi ở bất kỳ đâu sau này, kiểm tra chéo lại đúng pattern này ngay từ lần viết đầu.

### 1.5 UX chọn `category.type` — tách rõ 2 ngữ cảnh, CHỐT 07/08/2026 (đề xuất tham khảo YNAB/Money Lover/Spendee/Misa, quyết định phạm vi khi lập kế hoạch T-S06e2/T-S14)

- **Bối cảnh**: có đề xuất dùng segmented control 2 nút to ("💵 Khoản Thu"/"🧾 Khoản Chi") ở đầu form thay cho dropdown/optgroup ẩn. Đề xuất đúng nhưng gộp nhầm 2 ngữ cảnh UI khác bản chất — phải tách:
  - **(a) Form TẠO/SỬA CATEGORY** (`BudgetLimits`, T-S06e2): user thật sự CHỌN `type` cho 1 category mới/sửa → segmented control ở đầu form là đúng, ÁP DỤNG Ở ĐÂY, xem AC chi tiết T-S06e2.
  - **(b) Form NHẬP GIAO DỊCH** (`SmartInput`/`AIAssistantBubble`/`TransactionHistory`, đã 🔒 ở T-S06e1/e1b/e1c): user KHÔNG chọn `type` trực tiếp, mà chọn 1 category CÓ SẴN — `type` được suy ra từ category đã chọn. Thiết kế optgroup 2 nhóm hiện tại (§1.3) đã tương đương "nhóm theo Thu/Chi" nhưng gộp vào đúng 1 thao tác chọn category, không tách 2 bước riêng. **KHÔNG mở lại 3 task đã 🔒 để đổi sang segmented-control-trước** — đánh đổi thêm 1 bước UI cho mọi lần nhập giao dịch không đáng so với rủi ro regress 3 component đã verify, và đi ngược giá trị cốt lõi PRD "nhập nhanh". Nếu sau này muốn đổi (b), phải mở task mới qua đúng quy trình (PHASE 1 — PLAN), không tự ý.
- **Quyết định cho danh sách Ngân Sách** (`BudgetLimits`): mặc định ẨN nhóm category income, có toggle tường minh "Hiện nguồn thu" để bật xem — không trộn chung 1 danh sách với category chi tiêu (đúng nguyên tắc các app tham khảo: Money Lover tách tab "Nguồn thu nhập" riêng khỏi Budget).

### 1.6 Household soft-delete, hộ không chủ (ownerless), snapshot định danh người tạo — CHỐT 07/08/2026 (quyết định T-S15/T-S16, tham khảo Splitwise/GitHub/Google Workspace/Expensify)

- **Bối cảnh phát hiện (test T-S06e4 thật)**: hành vi cũ `leave_household()` khi owner là thành viên duy nhất → `delete from households` → cascade xoá cứng vĩnh viễn toàn bộ `categories`/`saving_goals`/`transactions`/`activity_log` của hộ đó. Người yêu cầu từ chối hành vi này (không muốn tự động giải tán), đồng thời muốn giữ định danh người tạo giao dịch/category/goal ngay cả sau khi họ đã rời hộ — 2 yêu cầu liên quan chặt: nếu chỉ sửa 1 trong 2, dữ liệu vẫn mất theo cách khác.
- **Tham khảo thị trường** (chốt hướng đi, không copy nguyên bản 1 app):
  - **Splitwise**: xoá 1 group hiện tại vẫn cascade xoá toàn bộ expense — đây là pain-point người dùng phàn nàn nhiều năm trên chính forum feedback chính thức của họ (yêu cầu "archive/soft-delete group", "export khi bị remove khỏi group" vẫn mở, chưa được làm). Cố tình **không đi theo hành vi này** — đây chính xác là lỗi mình đang chủ động tránh.
  - **GitHub/Google Workspace/Expensify/Smartsheet** (chuyển quyền owner tổ chức): mẫu chung là **transfer ownership đòi hỏi người nhận đã là thành viên sẵn có** — không có khái niệm "người lạ tự nhận quyền owner bằng cách gõ đúng 1 mã mời cũ". App này CHỦ ĐỘNG chọn khác mẫu enterprise (đơn giản hơn, đúng tinh thần "nhóm gia đình" hơn là tổ chức), theo đúng yêu cầu người dùng — nhưng phải tự bù lại rủi ro bảo mật mà mẫu enterprise tránh được (xem cảnh báo bảo mật bên dưới).
- **Quyết định (đã xác nhận 07/08/2026):**
  1. **`households` thêm `deleted_at timestamptz`** (soft-delete, đúng pattern §5 đã áp cho các bảng khác) — xoá hộ không còn là `DELETE` cứng.
  2. **`leave_household()` sửa lại**: bỏ hẳn nhánh `delete from households` khi owner đơn độc rời — chỉ gỡ `profiles.household_id/household_role/telegram_active_scope` của người rời về mặc định. Household **không bị xoá**, trở thành **"hộ không chủ" (ownerless)**: tồn tại, `invite_code` vẫn còn, nhưng không còn `profiles` nào có `household_role='owner'` trỏ tới nó.
  3. **RPC mới `delete_household()`** (SECURITY DEFINER) — hành động tường minh, TÁCH HẲN khỏi "Rời nhóm": chỉ gọi được bởi `household_role='owner'` hiện tại của đúng hộ đó, và (giữ nguyên tinh thần rule cũ) chỉ cho phép khi owner là thành viên duy nhất còn lại (nếu còn thành viên khác, phải `remove_member` hết trước — nhất quán với rule `leave_household` đã có). Set `households.deleted_at = now()`, KHÔNG đổi gì trên `categories`/`saving_goals`/`transactions`/`activity_log` (giữ nguyên 100%, đây chính là điểm mấu chốt thoả yêu cầu lưu vết).
  4. **`join_household_by_code()` sửa lại**: nếu hộ đang **ownerless** (không có `profiles` nào `household_role='owner'` cho hộ đó) VÀ chưa `deleted_at`, người join đầu tiên **tự động nhận `household_role='owner'`** (thay vì `'member'`), đồng thời cập nhật `households.owner_id` sang người này (giữ `owner_id` luôn phản ánh đúng chủ SỞ HỮU/người có quyền cao nhất hiện tại — không phải lịch sử tĩnh).
  5. **⚠️ Cảnh báo bảo mật cần xử lý cùng lúc (phát hiện khi đối chiếu mẫu enterprise ở trên)**: hộ ownerless vẫn giữ nguyên `invite_code` cũ — nếu mã này từng bị lộ/chia sẻ rộng (vd nhóm chat gia đình cũ), **bất kỳ ai còn giữ mã đều có thể tự phong mình làm chủ hộ mới**, có toàn quyền trên dữ liệu tài chính lịch sử của cả nhà. Bắt buộc: RPC `leave_household()` khi tạo trạng thái ownerless PHẢI tự động xoay `invite_code` sang mã mới (dùng đúng cơ chế sinh mã đã có ở `0003_rpc_household_partial.sql`) — vô hiệu hoá mã cũ ngay lập tức, để "join lại = trở thành chủ mới" chỉ xảy ra khi _chủ cũ chủ động gửi mã MỚI_ cho đúng người họ tin tưởng, không phải ai tình cờ còn giữ mã cũ.
  6. **RLS `households` SELECT policy sửa lại** (khớp thiết kế archive): bỏ vế `owner_id = auth.uid()` cũ (không còn đúng — owner đã rời thì phải mất quyền truy cập như member thường, nhất quán hành vi rời hộ), thay bằng: `id = my_household_id()` (thành viên đang hoạt động) **OR** `(deleted_at is not null and owner_id = auth.uid())` (chủ hộ ĐÃ XOÁ hộ đó — quyền xem lại/tra cứu archive, đúng ý "giữ lại để tra cứu sau"). Hộ ownerless (chưa xoá) KHÔNG ai xem được nữa qua policy này (đúng — không còn ai là member/owner hoạt động); chỉ join lại được qua RPC `join_household_by_code` (SECURITY DEFINER, bypass RLS, đã có cơ chế này từ T-S02).
  7. **RLS `categories`/`saving_goals`/`transactions` SELECT policy cần thêm đúng 1 nhánh tương tự**: cho phép đọc khi `is_archived_household_owner(household_id)` (helper mới: `households.deleted_at is not null and households.owner_id = auth.uid()`) — để chủ hộ cũ vẫn export/tra cứu được dữ liệu của hộ đã xoá, đúng mục đích T-S16.
- **T-S16 — snapshot định danh người tạo (áp dụng CẢ 3 bảng, theo xác nhận 07/08/2026, mở rộng so với đề xuất ban đầu chỉ có `transactions`)**:
  - Thêm cột text (không phải id) trên cả 3 bảng: `transactions.member_display_snapshot`, `categories.created_by_display_snapshot`, `saving_goals.created_by_display_snapshot` — format `"${personal_role} (${name})"` (khớp `authMapping.buildUserFromProfile`, đúng quy ước hiển thị đã dùng ở §1.2).
  - Ghi **1 lần duy nhất lúc INSERT** bằng trigger `BEFORE INSERT` (không phải app tự truyền tay — tự động, không thể quên, không thể giả mạo từ client) — đọc `profiles.name`/`personal_role` của đúng `member_id` (transactions) / `created_by` (categories, saving_goals) tại thời điểm insert.
  - **KHÔNG có mặt trong bất kỳ `Update` type nào** (đúng nguyên tắc bất biến đã áp dụng cho `member_id`/`type` ở §1.2) → tự động không ai sửa được, kể cả chủ hộ — thoả đúng yêu cầu "không ai được sửa định danh" mà không cần thêm rule RBAC riêng.
  - **Giới hạn đã xác nhận với người yêu cầu**: dữ liệu tạo TRƯỚC migration này, bởi người ĐÃ rời hộ trước đó, không backfill được tên (RLS đã chặn đọc `profiles` của họ từ trước, không còn cách nào lấy lại) — chỉ áp dụng cho giao dịch/category/goal tạo MỚI sau khi migration chạy, hoặc backfill được cho ai vẫn CÒN trong hộ tại thời điểm chạy migration.
- **Đề xuất bổ sung (chưa xác nhận, ghi backlog tham khảo)**: theo đúng pain-point Splitwise nêu trên ("muốn được export khi bị remove/khi group bị xoá"), cân nhắc thêm 1 bước UX: khi `remove_member`/`leave_household` thành công, tự động prompt người vừa rời "Tải file export lịch sử giao dịch của bạn trong hộ này trước khi rời?" — không bắt buộc, không thuộc AC bắt buộc của T-S15/T-S16, nêu ở đây để cân nhắc khi lập kế hoạch task UI.
- **✅ XÁC NHẬN PHẠM VI 07/08/2026**: người yêu cầu đã xác nhận đúng hướng (1)-(7) ở trên cho cả T-S15 lẫn T-S16 (áp snapshot cho cả 3 bảng `transactions.member_id`/`categories.created_by`/`saving_goals.created_by`, không chỉ riêng transactions như đề xuất ban đầu). AC chi tiết đã chuyển vào TASKS.md (T-S15, T-S16) — 2 task chuyển trạng thái sẵn sàng thực thi (⚪), còn CHỜ người yêu cầu bấm "bắt đầu code" theo đúng PHASE 2 (mỗi lần 1 task, không gộp) vì đây vẫn là thay đổi RPC/schema đã "Hỏi trước khi làm" ở §5.
- **Đối chiếu thêm 07/08/2026 (theo yêu cầu nghiên cứu thị trường mở rộng)** — không đổi quyết định đã CHỐT, chỉ ghi nhận để tham khảo khi lập kế hoạch task sau này:
  - **GitHub Organization** đi theo hướng NGƯỢC hẳn app này: không cho phép tổ chức rơi vào trạng thái 0-owner — muốn rời phải phong người khác làm owner TRƯỚC (`add new owner → remove yourself`), và GitHub còn khuyến nghị chủ động luôn giữ ≥2 owner song song để tránh rủi ro "owner độc nhất mất quyền truy cập/qua đời/nghỉ việc". App này CHỦ ĐỘNG không đi theo mẫu này (đã chọn cho phép ownerless + join lại bằng mã mới) vì đúng tinh thần "nhóm gia đình" đơn giản hơn "tổ chức doanh nghiệp" — nhưng đây là lý do nên cân nhắc backlog **"đồng-chủ-hộ" (co-owner, >1 `household_role='owner'` cùng lúc)** ở giai đoạn sau nếu người dùng thật gặp tình huống chủ hộ mất quyền truy cập đột ngột (mất điện thoại, mất tài khoản Google) mà hộ vẫn còn nhiều thành viên khác đang hoạt động — hiện tại tình huống này KHÔNG có lối thoát nào ngoài liên hệ hỗ trợ thủ công vì `transfer_ownership` (T-S03b) cũng cần owner cũ chủ động gọi. Chưa xác nhận, chưa mở task.
  - **Splitwise** (đã trích dẫn ở trên) xác nhận thêm: pain-point lớn thứ 2 sau "cascade xoá vĩnh viễn" là **không phục hồi được group xoá nhầm** trừ khi liên hệ support thủ công — app này đã tránh được vấn đề này nhờ chọn soft-delete (`deleted_at`) ngay từ đầu thay vì hard-delete rồi mới thêm "undo" sau, không cần thêm task riêng.
  - Cả 2 điểm trên chỉ nêu để tham khảo, KHÔNG mở task mới nếu chưa qua đúng PHASE 1 (PLAN) và xác nhận với người yêu cầu — tránh vi phạm "Never silently expand scope beyond the current task".

### 1.7 Đánh giá rủi ro "quyền chủ hộ" — CHỐT 07/08/2026 (yêu cầu rà soát trước khi thực thi T-S15, KHÔNG mở co-owner)

- **Bối cảnh**: trước khi code T-S15, người yêu cầu hỏi rà soát lại quyền chủ hộ có ảnh hưởng quá lớn tới thành viên không, và điều gì xảy ra nếu chủ hộ "mất quyền" — đặt trong bối cảnh app quy mô NHỎ (cá nhân/hộ gia đình, không phải doanh nghiệp).
- **Kiểm kê thật quyền CHỈ chủ hộ mới có** (đối chiếu §3 RLS + các RPC đã viết):
  1. Tạo/sửa `categories` ở scope hộ (kể cả `limit_amount` — hạn mức ngân sách) — member KHÔNG tự tạo được category riêng trong hộ.
  2. `remove_member()` — chỉ owner.
  3. `transfer_ownership()` — chỉ owner chủ động gọi.
  4. `delete_household()` (T-S15, mới) — chỉ owner, chỉ khi đơn độc.
  5. Override (sửa) giao dịch của BẤT KỲ thành viên nào (member chỉ sửa được giao dịch của chính mình) — đây là quyền THÊM của owner, không phải hạn chế thêm lên member.
  - **KHÔNG thuộc quyền riêng owner** (member làm được bình thường): tạo/sửa `saving_goals` (dùng chung cả hộ), tạo/sửa/xoá giao dịch của chính mình, rời hộ.
- **Rủi ro thật xác định**: nếu owner "biến mất" (ngừng dùng app, mất quyền truy cập tài khoản) trong khi hộ VẪN còn thành viên khác đang hoạt động — không ai trong hộ có cách nào tạo category mới, đổi hạn mức ngân sách, xoá 1 thành viên gây vấn đề, hay tự phong chủ hộ mới. Đường thoát DUY NHẤT là owner tự gọi `transfer_ownership` hoặc tự rời (remove hết member trước) — cả 2 đều cần owner CHỦ ĐỘNG, không có "lối thoát" nào cho member khi owner thực sự không phản hồi.
- **Đối chiếu quy mô thật của app** (khác GitHub Organization ở §1.6 — GitHub phục vụ tổ chức có billing/nhiều seat trả phí, mất quyền truy cập gây thiệt hại vận hành/tài chính lớn cho nhiều bên thứ 3): app này phục vụ 1 hộ gia đình vài người, dữ liệu là chi tiêu cá nhân, "mất quyền chủ hộ" gần như luôn quy về 1 trong 2 tình huống: (a) quên mật khẩu/mất quyền đăng nhập tạm thời — đã có lối thoát qua chính Supabase Auth (reset mật khẩu qua email, hoặc đăng nhập lại bằng Google OAuth cùng email) — KHÔNG cần cơ chế riêng ở tầng household; (b) owner cố ý ngừng dùng app / mất hẳn quyền truy cập email (hiếm, và nếu xảy ra thật thì đa phần household cũng chỉ còn vài người, có thể trao đổi ngoài app để owner cũ backup dữ liệu hoặc chấp nhận tạo hộ mới).
- **Quyết định (đã xác nhận 07/08/2026): KHÔNG mở task "đồng-chủ-hộ" (co-owner/multi-owner)** — lý do: (1) rủi ro thật thấp ở quy mô hộ gia đình so với tổ chức doanh nghiệp; (2) chi phí kỹ thuật cao — đổi `household_role` từ enum 2 giá trị sang cho phép nhiều `owner` cùng lúc kéo theo viết lại toàn bộ RLS/RPC đã CHỐT ở §3 (is_household_owner, remove_member, transfer_ownership, category/budget policies) — thuộc đúng mục "Đổi mô hình phân quyền §3" ở bảng ranh giới §5, rủi ro regress cao hơn lợi ích thực tế ở quy mô này; (3) không có yêu cầu thật nào từ người dùng hiện tại cần tính năng này.
- **Thay vào đó — 2 giảm nhẹ NHẸ, không đổi schema/RLS, ghi backlog (chưa xác nhận triển khai, cần PLAN riêng nếu muốn làm)**:
  1. UI làm nút "Chuyển quyền chủ hộ" (`transfer_ownership`, đã có RPC từ T-S03b) dễ thấy hơn trong `HouseholdManagement`, kèm gợi ý nhẹ (vd tooltip "Nên chuyển quyền cho người khác nếu bạn sẽ ngừng dùng app này") — giảm khả năng owner "biến mất" mà quên bàn giao.
  2. (Tuỳ chọn, giá trị thấp hơn) Banner nhắc nhẹ cho owner nếu hộ có ≥2 thành viên — không cần logic phức tạp đo "inactive", chỉ 1 dòng thông tin tĩnh trong màn hình quản lý hộ.
- **Kết luận cho T-S15**: giữ nguyên đúng scope đã viết ở migration `0010_household_ownerless_soft_delete.sql` (1 owner/hộ tại một thời điểm, không đổi thêm gì vì rà soát này) — chỉ ghi nhận đã CÂN NHẮC kỹ trước khi code, không phát hiện lý do đủ mạnh để mở rộng phạm vi.

### 1.8 Định danh giao dịch hộ gia đình bị mất khi thành viên rời hộ — CHỐT 08/08/2026 (bug thật phát hiện qua test thủ công, quyết định T-S17)

- **Bug**: `member_id -> tên hiển thị` được resolve bằng cách tra danh sách thành viên HIỆN TẠI (`listHouseholdMembers`, lọc `household_id = X`). Khi thành viên rời hộ (`leave_household`/`remove_member` đổi `household_id`), họ biến mất khỏi danh sách tra cứu → tên mất trên mọi giao dịch cũ, kể cả khi xuất Excel. RLS đọc `profiles` cũng chặn đọc lại hồ sơ người đã rời nên không sửa được chỉ bằng đổi query client.
- **2 phương án đã đề xuất**: (A) snapshot tên vào cột mới trên `transactions`, set 1 lần lúc tạo; (B) mở RLS cho phép đọc lịch sử profile người từng ở hộ.
- **Quyết định (đã xác nhận với người yêu cầu 08/08/2026): chọn phương án A.** Lý do ưu tiên hơn B: không đổi mô hình quyền đọc `profiles` đã CHỐT ở §3 (rủi ro rò rỉ thông tin thấp hơn), bền vững tuyệt đối theo thời gian (không phụ thuộc trạng thái thành viên sau này), và khớp đúng pattern "snapshot định danh" đã dùng cho household ownerless ở §1.6.
- **Triển khai**: `transactions.member_name_snapshot` (nullable text) — xem §2 (khai báo cột) và migration `0011_transactions_member_name_snapshot.sql` (trigger `BEFORE INSERT`, security definer, tự tra `profiles.name` theo `member_id`). Client (`rowToTransaction`) ưu tiên tra danh sách thành viên hiện tại trước (tên mới nhất nếu còn ở hộ), fallback cột snapshot nếu không resolve được.
- **Giới hạn đã biết (chấp nhận)**: giao dịch của người đã rời hộ TRƯỚC khi migration 0011 chạy không backfill lại được — tên đã mất thật ở nguồn tại thời điểm rời, không có cách khôi phục. Chỉ đảm bảo KHÔNG còn mất định danh cho mọi giao dịch tạo ra kể từ migration này trở đi.

### 1.9 "Hoàn thành mục tiêu tiết kiệm" — tách sự kiện đóng góp quỹ khỏi sự kiện mua sắm thật, luồng thủ công + tự động nhận diện qua giao dịch chi tiêu — CHỐT 08/08/2026 (thiết kế cho T-S19, T-S20 — CHƯA thực thi, chờ xác nhận theo §5)

- **Bối cảnh**: T-S14 (chưa chạy) đã xác định đóng góp quỹ tiết kiệm phải là `type='transfer'`, KHÔNG tính vào thu/chi thật. Câu hỏi phát sinh tiếp: khi tiền "đã gom đủ" và người dùng thực sự đi mua món đồ (vd Switch), tiền đó xử lý ra sao — có tự động trừ `current_amount` không, giá mua thật khác số đã gom thì bù thế nào.
- **Nghiên cứu thị trường**: BudgetBakers (Wallet) — app tập trung nhiều nhất vào tính năng Goals — nêu rõ nguyên tắc cốt lõi: số tiền "đã gom" trong 1 goal chỉ là **con số theo dõi (tracker)**, ứng dụng không có tài khoản ngân hàng thật tách biệt gắn với goal, và **không bao giờ tự động chuyển/trừ tiền** — luôn để người dùng tự thao tác tách bạch. YNAB/Money Lover/Spendee cùng chung nguyên tắc: không app nào tự động "bù trừ" phần chênh lệch giữa số đã gom và giá mua thật.
- **Insight áp dụng trực tiếp vào model hiện tại**: vì `type='transfer'` (T-S14) chưa từng làm tiền "rời khỏi" báo cáo thu/chi — nó luôn nằm sẵn trong dòng tiền chung — nên **không cần bất kỳ bước đối chiếu/bù trừ nào** khi ghi giao dịch mua thật, kể cả khi dư hay thiếu so với `current_amount` đã gom. Ghi đúng giá mua thật (`type='expense'` bình thường) là đủ; số dư/thiếu tự phản ánh đúng vào báo cáo tháng đó, không phát sinh "khoản nợ" hay phí bổ sung nào.
- **Quyết định thiết kế (CHỐT)**:
  1. **3 sự kiện tách biệt, không tự suy ra lẫn nhau**: (a) Đóng góp quỹ (`type='transfer'`, gắn `goal_id`, T-S14) — chỉ cộng `current_amount`, không tính thu/chi. (b) Mua món đồ thật (`type='expense'` bình thường, category thật do user chọn) — tính vào chi tiêu, đây mới là chỗ "tiền bị trừ" đúng nghĩa. (c) Đánh dấu "Hoàn thành" — chỉ đổi trạng thái goal, không tự tạo/tự trừ gì.
  2. **Đạt/vượt `target_amount` chỉ là badge thụ động** ("🎉 Đã đạt mục tiêu") — KHÔNG ép chuyển màn hình, KHÔNG khoá goal. Người dùng có thể tiếp tục góp quỹ qua SmartInput bình thường (vượt target vẫn cộng dồn), hoặc muốn kéo dài mục tiêu thì tự sửa `target_amount` qua form Sửa đã có sẵn — không cần tính năng mới cho việc này.
  3. **Nút "Hoàn thành" hoàn toàn thủ công**, bấm được bất kỳ lúc nào (không bắt buộc đủ target — cần cho goal không có target cụ thể). Bấm vào → mở form ghi giao dịch chi tiêu thật, pre-fill mô tả = tên goal + gợi ý số tiền = `current_amount` (cho sửa tự do thành giá thực mua), bắt chọn category thật (không đoán hộ). Lưu xong → `saving_goals.completed_at = now()`, `current_amount` **giữ nguyên làm lịch sử** (không reset/xoá), goal chuyển sang danh sách "Đã hoàn thành" (ẩn khỏi "đang tiết kiệm", vẫn xem lại được).
  4. **Không xử lý tự động chênh lệch dư/thiếu** — đúng insight ở trên, ghi đúng giá mua thật là đủ, không có bước reconciliation nào khác. Nếu sau này cần tính năng "gợi ý phân bổ phần dư sang goal khác", ghi backlog riêng, không làm ở T-S19.
  5. **Tự động nhận diện qua giao dịch chi tiêu bình thường (T-S20, mở rộng theo yêu cầu 08/08/2026)**: người dùng không bắt buộc phải vào `SavingGoals` bấm "Hoàn thành" trước. Nếu họ nhập thẳng 1 giao dịch chi tiêu bình thường qua SmartInput/AIAssistantBubble (vd "mua switch 2.3tr") mà mô tả khớp tên với 1 **goal đang active** (`completed_at is null`) của đúng scope (cá nhân/hộ đang nhập), hệ thống hiện **banner xác nhận** (không tự động âm thầm): "Giao dịch này có vẻ là mua sắm cho mục tiêu tiết kiệm '<tên goal>' — Đánh dấu hoàn thành mục tiêu này?". Đồng ý → gọi đúng 1 hành động dùng chung với luồng (3) (không viết 2 lần logic) → `completed_at = now()`, giao dịch lưu như expense bình thường. Từ chối/bỏ qua → lưu giao dịch expense bình thường, không đụng gì đến goal.
  6. **Bắt buộc luôn xác nhận, không bao giờ tự động âm thầm đổi trạng thái goal** — rủi ro sai (trùng tên nhưng không liên quan, nhiều goal cùng tên gần giống, số tiền không khớp) cao hơn lợi ích tiện lợi. Nếu khớp nhiều hơn 1 goal active cùng lúc, KHÔNG tự chọn đại 1 cái — hoặc bỏ qua gợi ý, hoặc cho chọn (quyết định UI cụ thể để lại lúc thực thi T-S20, không chốt cứng ở đây).
  7. **Phạm vi nhận diện tự động ở T-S20 lần đầu**: chỉ áp cho SmartInput/AIAssistantBubble (nơi đã có sẵn hạ tầng parse mô tả + match tên goal cho luồng `isSavingsContribution`/`assignSavingGoal`, xem `src/components/SmartInput.tsx`). Form "Thêm giao dịch" thủ công (không qua parse ngôn ngữ tự nhiên) KHÔNG match tự động ở lần này — ghi backlog riêng nếu cần sau, tránh mở rộng phạm vi ngoài yêu cầu.
- **Gap kỹ thuật phát hiện, thuộc phạm vi T-S14 (không phải T-S19/T-S20)**: trigger `apply_goal_contribution` (§2.6) hiện cộng `current_amount` cho MỌI dòng `transactions` có `goal_id`, không phân biệt `type`. Nếu giao dịch mua thật (bước 3/5, `type='expense'`) được gắn `goal_id` để tiện tra cứu lịch sử sau này, trigger sẽ vô tình cộng thêm lần nữa (sai). **Bắt buộc sửa trigger chỉ cộng/trừ khi `new.type = 'transfer'`** trước khi T-S19/T-S20 được phép chạy — sửa này gộp vào đúng migration T-S14 (nơi đưa `type='transfer'` vào hệ thống), T-S19/T-S20 phụ thuộc cứng vào T-S14 vì lý do này.
- **Cột schema mới cần cho T-S19**: `saving_goals.completed_at timestamptz` (nullable) — xem §2. Thuộc diện "đổi cấu trúc bảng đã chốt" → **Hỏi trước khi làm** theo §5, CHƯA được phép chạy.

### 1.10 Cho phép sửa `type` (income ↔ expense) của giao dịch đã tạo — CHỐT 08/08/2026 (quyết định T-S23, thay thế nguyên tắc "xoá-tạo-lại" ở §1.2)

- **Bối cảnh phát hiện**: người dùng test thật gặp giao dịch "Lương 15.000.000" bị AI fallback category "Khác" (chưa tồn tại thật) → `resolveTransactionType` (`toTransactionInsert.ts`) mặc định im lặng `'expense'` (xem gap T-S22) → không có cách nào sửa lại type đã sai ngoài xoá và tạo lại (mất `created_at`/audit gốc, lằng nhằng). Người yêu cầu xác nhận mở khoá sửa thay vì giữ nguyên §1.2.
- **Quyết định (đánh đổi rủi ro đã cân nhắc)**: mở khoá **CÓ KIỂM SOÁT**, không mở toàn bộ:
  1. Chỉ cho đổi 2 chiều **income ↔ expense**. KHÔNG cho đổi sang/khỏi `'transfer'` qua đường sửa nhanh này — `'transfer'` gắn chặt với trigger `apply_goal_contribution` (§2.6/migration `0013`), rủi ro sai `current_amount` cao hơn lợi ích.
  2. **Chặn cứng khi `goal_id is not null`** (cả 2 chiều) — cả ở FE lẫn tầng DB (RPC hoặc CHECK trong policy UPDATE, không chỉ tin FE). Muốn sửa 1 giao dịch có gắn goal, bắt buộc gỡ `goal_id` trước (thao tác tách riêng, hiện cảnh báo rõ "sẽ trừ khỏi số đã góp của mục tiêu"), rồi mới được đổi `type`.
  3. Đổi `type` xong **bắt buộc chọn lại category** thuộc đúng nhóm mới — không giữ category cũ khác nhóm (đúng nguyên tắc §1.4, tránh lệch UI-state y hệt bug đã sửa ở đó).
  4. `Update` type (`database.types.ts`) mở thêm field `type`, nhưng validate ở tầng service/RPC: từ chối nếu `new.type === 'transfer'` hoặc `old.goal_id is not null`.
- **Không nằm trong phạm vi T-S23 lần này**: đổi `member_id` (vẫn khoá theo §1.2, không liên quan), audit log riêng cho hành động đổi type (để backlog, không bắt buộc ngay).

### 1.11 Hệ thống thông báo — MỞ RỘNG `activity_log` có sẵn (không tạo bảng mới), sinh bởi DB trigger — CHỐT 08/08/2026, SỬA LẠI cùng ngày (thiết kế cho T-S27, chỉ implement kênh in-app trước, chừa chỗ Telegram sau)

- **Bối cảnh**: chuông 🔔 hiện có UI (đọc `activity_log`) nhưng không có sự kiện nào được ghi cho vượt ngân sách/hoàn thành mục tiêu/có giao dịch mới trong hộ — luôn hiện "Không có hoạt động mới". Người yêu cầu chỉ cần kênh in-app ở bản này, nhưng muốn có đường mở rộng sang Telegram sau (bot hiện tại chỉ dùng để nhập liệu, chưa gửi tin).
- **⚠️ Tự sửa lỗi thiết kế cùng ngày**: bản CHỐT đầu tiên của mục này đề xuất bảng mới `notification_events`, **mâu thuẫn trực tiếp** với quyết định Phase 1 gốc đã có sẵn ở §2 mục 4 (`activity_log`) — bảng đó vốn đã được thiết kế "vừa là audit trail, vừa là NGUỒN cho chuông thông báo... không cần bảng notifications riêng", và cột `message` đã có comment sẵn "dùng chung cho bell + Telegram push". Tạo bảng mới sẽ đi ngược đúng nguyên tắc đã áp dụng nhất quán trong dự án này (gộp `household_members` vào `profiles`, xem CHANGELOG Phase 1) — vi phạm ngay chính tinh thần "không tạo 2 cơ chế song song cho cùng 1 mục đích". Sửa lại như dưới đây.
- **Quyết định kiến trúc (bản sửa)**: MỞ RỘNG `activity_log`, không tạo bảng mới:
  1. Thêm 2 cột: `owner_id uuid references auth.users(id)` (nullable — hỗ trợ sự kiện ở scope CÁ NHÂN, hiện bảng chỉ có `household_id`; ràng buộc `activity_log_scope_xor` giống pattern `categories`/`saving_goals`: đúng 1 trong 2 có giá trị, trừ trường hợp `action` hệ thống thuần không gắn scope cụ thể — xem xét kỹ khi viết migration, không nới lỏng tuỳ tiện) và `read_at timestamptz` (null = chưa đọc).
  2. Thêm `action` mới vào tập giá trị hiện có (đã là `text`, không phải enum cứng — không cần ALTER CHECK): `'budget.exceeded'`, `'goal.completed'`, `'transaction.create'` (khi actor khác người xem, dùng đúng field `actor_id` sẵn có để lọc `actor_id <> auth.uid()` như query mẫu đã viết ở §2 mục 4 — KHÔNG cần thêm `target_user_id` mới).
  3. `source='system'` (giá trị đã có sẵn trong CHECK constraint) cho `budget.exceeded`/`goal.completed` — không phải hành động của 1 người dùng cụ thể.
  4. **Sự kiện PHẢI sinh bởi DB trigger (AFTER INSERT trên `transactions`, sau khi T-S25 ổn định)**, không phải tính ở client — lý do bắt buộc: giao dịch nhập qua Telegram bot (đã có sẵn) cũng phải tự kích hoạt thông báo; nếu tính ở React component, đường Telegram sẽ bị bỏ sót vĩnh viễn.
  5. **`budget.exceeded` PHẢI edge-triggered** (chỉ insert 1 dòng `activity_log` đúng 1 lần tại thời điểm tổng chi tháng của category CHUYỂN từ chưa-vượt sang vượt — so tổng TRƯỚC/SAU trong cùng trigger), không phải mọi giao dịch sau đó đều bắn lại — tránh spam.
  6. **Đường mở rộng Telegram (không code ở T-S27)**: đúng như comment gốc đã có sẵn ở §2 mục 4 — cột `message` (text tiếng Việt) đã "dùng chung cho bell + Telegram push", sau này chỉ cần 1 worker đọc `activity_log where source='system' and ...` rồi gửi `message` qua `profiles.telegram_chat_id` — không cần đổi lại tầng sinh sự kiện.
  7. Kênh hiển thị: bell dropdown đã có UI sẵn — chỉ cần nới điều kiện query (hiện thêm scope cá nhân qua `owner_id`, không chỉ `household_id`) + thêm hành động đánh dấu đã đọc (`read_at = now()`).
- **Không nằm trong phạm vi T-S27 lần này**: gửi qua Telegram thật (backlog riêng khi cần), thông báo qua email/push.
- **[Mở rộng CHỐT 09/08/2026 — bổ sung sau khi test T-S36, xem CHANGELOG]** Thêm `action='transaction.delete_by_member'`: khi 1 thành viên (KHÔNG phải chủ hộ tự xoá giao dịch của chính họ với vai trò chủ hộ — chỉ tính khi `actor_id <> household.owner_id` tại thời điểm xoá) soft-delete 1 giao dịch của chính họ trong hộ gia đình → sinh 1 dòng `activity_log`. **Phạm vi đã xác nhận**:
  - Áp dụng cho **MỌI giao dịch bị xoá** (không phân biệt số tiền, không có ngưỡng).
  - Chỉ **chủ hộ hiện tại** nhận được thông báo này (không phải mọi thành viên khác).
  - Nguồn sinh: cùng cơ chế DB trigger `AFTER UPDATE` trên `transactions` (nhánh `deleted_at` chuyển từ null sang có giá trị), `source='system'`, đặt `owner_id`/`household_id` trỏ đúng chủ hộ hiện tại (không phải người xoá) để bell dropdown của CHỦ HỘ đọc được qua đúng query mẫu đã có.
  - **CHƯA code** — thuộc "Hỏi trước khi làm" §5 (thêm nhánh trigger DB mới trên bảng `activity_log`/`transactions`), chờ người yêu cầu xác nhận "bắt đầu code" theo đúng PHASE 2 trước khi viết migration, cùng đợt với phần còn lại của T-S27 (mục 1.11 gốc, cũng đang ⚪).
- **[Mở rộng CHỐT lần 2, 18/08/2026 — bổ sung sau khi người yêu cầu test tay bản 0030, xem CHANGELOG "T-S27 — mở rộng lần 2"]** Sau khi 0030 chạy thật, người yêu cầu phát hiện còn thiếu 3 việc, đã xác nhận rõ qua 3 câu hỏi trực tiếp (không tự suy đoán) — thêm vào migration `0031`:
  1. `action='transaction.update'` — MỌI lần sửa 1 giao dịch hộ gia đình (không phân biệt sửa trường nào) đều báo cho thành viên còn lại, cùng cơ chế `AFTER UPDATE` trên `transactions`. Chỉ hộ gia đình (giống `transaction.create`). Loại trừ đúng 2 nhánh `deleted_at` đã có trigger riêng (soft-delete/phục hồi) để không bắn trùng.
  2. `action='category.budget_created'` — khi 1 category LẦN ĐẦU có `limit_amount` (tạo mới có sẵn hạn mức, hoặc sửa category cũ để lần đầu gắn hạn mức) → báo cho thành viên hộ. Edge-triggered giống `budget.exceeded` (không bắn lại mỗi lần chỉnh sửa số tiền hạn mức sau đó). Chỉ hộ gia đình.
  3. `action='goal.contribution'` — mỗi lần góp quỹ tiết kiệm (`type='transfer'` + `goal_id`) đều có thông báo riêng (khác `goal.completed` — đây là MỖI LẦN nạp, không chỉ lúc hoàn thành), THAY THẾ `transaction.create` chung chung cho đúng giao dịch góp quỹ đó (tránh bắn trùng 2 thông báo/1 hành động). Áp dụng **CẢ 2 SCOPE** (cá nhân lẫn hộ gia đình) — khác 2 mục trên, vì đây là xác nhận lại hành động của chính mình, có giá trị ngay cả khi không có ai khác xem.
  - **Không nằm trong phạm vi lần mở rộng này** (chưa hỏi/chưa xác nhận): thông báo khi TẠO category (không kèm hạn mức); thông báo khi XOÁ/SỬA category; thông báo khi RÚT tiền khỏi mục tiêu tiết kiệm (khác góp quỹ).

## 2. Schema Postgres (CHỐT — không ALTER thêm cột lớn sau này, mọi mở rộng đi qua migration mới có review)

```sql
-- =========================================================
-- 0. Tiện ích
-- =========================================================
create extension if not exists pgcrypto;

-- =========================================================
-- 1. profiles — định danh + hồ sơ. 1-1 với auth.users.
--    Gộp luôn "household member" vào đây vì 1 user chỉ ở
--    tối đa 1 household tại một thời điểm (đúng nghiệp vụ gốc).
-- =========================================================
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text not null,
  personal_role text not null default 'Cá nhân', -- vd: Chồng/Vợ/Con... hiển thị cá nhân

  household_id uuid, -- FK tới households gắn sau (xem mục 2) — households chưa tồn tại tại điểm này
  household_role text check (household_role in ('owner','member')), -- null nếu chưa join hộ nào

  telegram_chat_id text unique,
  telegram_username text,
  telegram_link_token text, -- mã 6 số, quay vòng sau mỗi lần link thành công
  telegram_active_scope text not null default 'personal'
    check (telegram_active_scope in ('personal','household')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint household_role_requires_household
    check ((household_id is null) = (household_role is null))
);

-- =========================================================
-- 2. households
-- =========================================================
create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text unique not null,
  owner_id uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.profiles
  add constraint profiles_household_fk
  foreign key (household_id) references public.households(id) on delete set null;

-- =========================================================
-- 3. categories / transactions / saving_goals
--    Sở hữu thuộc ĐÚNG 1 trong 2 phạm vi: cá nhân (owner_id) hoặc hộ (household_id).
--    member_id: ai trong hộ là người thực hiện (chỉ có ý nghĩa khi household_id set).
--    deleted_at: soft delete — mọi SELECT policy phải lọc deleted_at is null.
-- =========================================================
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id),
  household_id uuid references public.households(id) on delete cascade,
  name text not null,
  icon text not null,
  limit_amount numeric check (limit_amount is null or limit_amount >= 0),
  is_recurring boolean not null default false,
  created_by uuid not null references auth.users(id),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint categories_scope_xor check (
    (owner_id is not null and household_id is null) or
    (owner_id is null and household_id is not null)
  )
);

create table public.saving_goals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id),
  household_id uuid references public.households(id) on delete cascade,
  name text not null,
  target_amount numeric check (target_amount is null or target_amount >= 0),
  current_amount numeric not null default 0,
  target_date date,
  created_by uuid not null references auth.users(id),
  -- completed_at timestamptz — THIẾT KẾ ĐÃ CHỐT (§1.9), CHƯA CHẠY MIGRATION.
  -- null = goal đang active; not null = đã đánh dấu "Hoàn thành" thủ công
  -- hoặc qua nhận diện tự động (T-S20). current_amount KHÔNG reset khi
  -- hoàn thành (giữ nguyên làm lịch sử). Thuộc "Hỏi trước khi làm" §5.
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint goals_scope_xor check (
    (owner_id is not null and household_id is null) or
    (owner_id is null and household_id is not null)
  )
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id),
  household_id uuid references public.households(id) on delete cascade,
  member_id uuid references auth.users(id), -- ai trong hộ đã tạo giao dịch này
  -- [CHỐT 08/08/2026 — T-S17, migration 0011] snapshot TÊN thành viên tại
  -- thời điểm TẠO giao dịch, set 1 LẦN bởi trigger DB (set_transaction_
  -- member_snapshot, BEFORE INSERT), KHÔNG bao giờ set/sửa từ client (không
  -- có trong Insert/Update type ở database.types.ts). Lý do tồn tại: tra
  -- "member_id -> tên" qua danh sách thành viên HIỆN TẠI sẽ mất khi thành
  -- viên rời hộ (RLS profiles chặn đọc lại hồ sơ người đã rời) — cột này là
  -- fallback bất biến để chủ hộ vẫn xem/xuất Excel biết đúng ai đã tạo giao
  -- dịch dù người đó đã rời hộ từ lâu. rowToTransaction() ưu tiên tra danh
  -- sách hiện tại trước (tên mới nhất nếu còn là thành viên), fallback cột
  -- này nếu không resolve được.
  member_name_snapshot text,

  type text not null check (type in ('income','expense')), -- thay quy ước "amount âm"
  description text not null,
  amount numeric not null check (amount >= 0),
  date date not null,
  note text,
  category_id uuid references public.categories(id) on delete set null,
  goal_id uuid references public.saving_goals(id) on delete set null,

  source text not null default 'web' check (source in ('web','telegram')),
  telegram_batch_id uuid, -- nhóm các dòng cùng sinh ra từ 1 tin nhắn Telegram, phục vụ đổi scope cả batch bằng 1 lần bấm
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint tx_scope_xor check (
    (owner_id is not null and household_id is null and member_id is null) or
    (owner_id is null and household_id is not null and member_id is not null)
  )
);

-- =========================================================
-- 4. activity_log — vừa là audit trail, vừa là NGUỒN cho
--    "chuông thông báo" trong app (không cần bảng notifications
--    riêng: bell = activity_log where household_id=... and
--    actor_id <> auth.uid() order by created_at desc limit 50).
-- =========================================================
create table public.activity_log (
  id uuid primary key default gen_random_uuid(),
  household_id uuid references public.households(id) on delete cascade,
  actor_id uuid not null references auth.users(id),
  action text not null,           -- 'transaction.create' | 'transaction.delete' | 'category.update' | 'member.remove' | ...
  entity_type text not null,      -- 'transaction' | 'category' | 'saving_goal' | 'member'
  entity_id uuid,
  message text not null,          -- câu tiếng Việt hiển thị trực tiếp (dùng chung cho bell + Telegram push)
  source text not null default 'web' check (source in ('web','telegram','system')),
  created_at timestamptz not null default now()
);

-- =========================================================
-- 5. Trigger: tự tạo profile khi có user mới đăng ký
-- =========================================================
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'name', new.email));
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- =========================================================
-- 6. Trigger: tự cập nhật saving_goals.current_amount
--    Nguồn sự thật nằm ở DB — không tính tay ở client.
-- =========================================================
create or replace function public.apply_goal_contribution()
returns trigger as $$
begin
  -- Insert: cộng dồn nếu gán goal_id và chưa bị soft-delete
  if (tg_op = 'INSERT') then
    if new.goal_id is not null and new.deleted_at is null then
      update public.saving_goals set current_amount = current_amount + new.amount
      where id = new.goal_id;
    end if;
  end if;

  -- Soft delete (update deleted_at từ null -> not null): trừ lại
  if (tg_op = 'UPDATE') then
    if new.goal_id is not null and old.deleted_at is null and new.deleted_at is not null then
      update public.saving_goals set current_amount = current_amount - new.amount
      where id = new.goal_id;
    end if;
    -- Khôi phục (undo soft delete): cộng lại
    if new.goal_id is not null and old.deleted_at is not null and new.deleted_at is null then
      update public.saving_goals set current_amount = current_amount + new.amount
      where id = new.goal_id;
    end if;
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger trg_goal_contribution
after insert or update on public.transactions
for each row execute function public.apply_goal_contribution();

-- =========================================================
-- 7. updated_at tự động (dùng chung 1 hàm cho mọi bảng)
-- =========================================================
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_categories_updated_at before update on public.categories
  for each row execute function public.set_updated_at();
create trigger trg_goals_updated_at before update on public.saving_goals
  for each row execute function public.set_updated_at();
create trigger trg_tx_updated_at before update on public.transactions
  for each row execute function public.set_updated_at();
```

## 3. RLS — helper function + policy chuẩn (RBAC chủ hộ/thành viên)

```sql
alter table public.profiles enable row level security;
alter table public.households enable row level security;
alter table public.categories enable row level security;
alter table public.saving_goals enable row level security;
alter table public.transactions enable row level security;
alter table public.activity_log enable row level security;

create or replace function public.my_household_id()
returns uuid language sql stable security definer set search_path = public as $$
  select household_id from public.profiles where id = auth.uid();
$$;

create or replace function public.is_household_owner(hh uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.households where id = hh and owner_id = auth.uid());
$$;

create or replace function public.is_household_member(hh uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.my_household_id() = hh;
$$;

-- profiles: tự đọc/sửa hồ sơ mình + đọc hồ sơ thành viên cùng hộ
create policy "read own or same-household profile"
on public.profiles for select using (
  id = auth.uid() or household_id = public.my_household_id()
);
create policy "update own profile fields"
on public.profiles for update using (id = auth.uid());
-- household_id / household_role KHÔNG được sửa trực tiếp qua UPDATE thường,
-- chỉ qua các RPC SECURITY DEFINER (create_household / join_household /
-- leave_household / remove_member) — xem §4 TASKS. ĐÃ ENFORCE THẬT ở tầng DB
-- từ migration 0033 (REVOKE UPDATE trên toàn bảng khỏi `authenticated`, chỉ
-- GRANT lại đúng các cột được phép) — xem CHANGELOG "T-S12 — VERIFY THẬT" và
-- "T-S12 — vá lỗ hổng đã CONFIRM". KHÔNG còn chỉ dựa vào Update type ở
-- database.types.ts (đó từng là lỗ hổng thật, đã vá).

-- categories & saving_goals: đọc chung, GHI khác nhau theo bảng
-- LƯU Ý QUAN TRỌNG: không dùng "for all" cho policy ghi — "for all" cấp quyền
-- cho cả SELECT, và Postgres ghép nhiều permissive policy bằng OR, nên 1 policy
-- ghi không lọc deleted_at sẽ vô tình mở rộng quyền đọc, đè lên bộ lọc
-- deleted_at is null của policy đọc chính (bug thật gặp ở T-S02, xem CHANGELOG).
-- Luôn tách riêng "for insert" / "for update"; KHÔNG có "for delete" ở đâu cả
-- — xoá luôn là soft delete qua UPDATE deleted_at, hard delete bị từ chối mặc định.
create policy "read own or household categories" on public.categories for select using (
  deleted_at is null and (owner_id = auth.uid() or is_household_member(household_id))
);
create policy "insert personal or owned household categories" on public.categories
for insert with check (
  (owner_id = auth.uid() and household_id is null) or
  (household_id is not null and is_household_owner(household_id))
);
create policy "update personal or owned household categories" on public.categories
for update using (
  (owner_id = auth.uid()) or (household_id is not null and is_household_owner(household_id))
) with check (
  (owner_id = auth.uid()) or (household_id is not null and is_household_owner(household_id))
);

create policy "read own or household goals" on public.saving_goals for select using (
  deleted_at is null and (owner_id = auth.uid() or is_household_member(household_id))
);
create policy "insert personal or household goals" on public.saving_goals
for insert with check (
  (owner_id = auth.uid() and household_id is null) or
  (household_id is not null and is_household_member(household_id))
);
create policy "update personal or household goals" on public.saving_goals
for update using (
  (owner_id = auth.uid()) or (household_id is not null and is_household_member(household_id))
) with check (
  (owner_id = auth.uid()) or (household_id is not null and is_household_member(household_id))
);
-- Xoá goal hộ (soft delete): RLS ở trên cho phép mọi thành viên UPDATE (kể cả set
-- deleted_at). Ràng buộc chặt hơn "chỉ chủ hộ hoặc created_by được xoá" cố ý ĐẨY
-- xuống tầng RPC (delete_goal, T-S03/T-S10) thay vì nhồi vào RLS — vì RLS không
-- phân biệt gọn "update field nào" so với "update để xoá"; RPC kiểm tra rõ ràng hơn
-- và ghi activity_log cùng lúc.

-- transactions
create policy "read own or household transactions" on public.transactions for select using (
  deleted_at is null and (owner_id = auth.uid() or is_household_member(household_id))
);
create policy "insert own personal or household transactions" on public.transactions
for insert with check (
  (owner_id = auth.uid() and household_id is null and member_id is null) or
  (household_id is not null and member_id = auth.uid()) or
  (household_id is not null and is_household_owner(household_id))
);
create policy "update own personal or household transactions" on public.transactions
for update using (
  (owner_id = auth.uid()) or
  (household_id is not null and member_id = auth.uid()) or
  (household_id is not null and is_household_owner(household_id))
) with check (
  (owner_id = auth.uid()) or
  (household_id is not null and member_id = auth.uid()) or
  (household_id is not null and is_household_owner(household_id))
);

-- activity_log: chỉ đọc, ghi qua RPC (security definer) chứ không INSERT trực tiếp từ client
create policy "read household activity" on public.activity_log for select using (
  is_household_member(household_id)
);

-- households: gap phát hiện khi viết migration T-S02, không có ở bản CONSTITUTION đầu tiên.
-- insert/join đi qua RPC SECURITY DEFINER (T-S03), chỉ cần policy đọc ở đây.
create policy "read own household" on public.households for select using (
  id = public.my_household_id() or owner_id = auth.uid()
);
```

## 4. Thiết kế lại Telegram (thay `server.ts` §Telegram) — LOCKED

- **Chẩn đoán vì sao "chưa kết nối được" hiện tại**: webhook Telegram cần URL HTTPS public ổn định. Chạy local/ngrok tạm là nguyên nhân hàng đầu, không phải lỗi logic parse. Edge Function có URL cố định ngay khi deploy → hết vấn đề này.
- **Quyết định (đã xác nhận)**: 1 bot Telegram DÙNG CHUNG cho toàn hệ thống, KHÔNG có bot token theo từng người/hộ. Bot token là bí mật của hệ thống (định danh con bot), không dùng để phân biệt người gửi. Người gửi được phân biệt bằng `profiles.telegram_chat_id` — mỗi Telegram account chỉ liên kết được với đúng 1 profile tại một thời điểm (unique constraint), giống hệt cơ chế "1 email = 1 tài khoản đăng nhập".
- **Edge case bắt buộc xử lý trong RPC link (không được bỏ qua)**: nếu `chat_id` đang gửi `/link <mã>` đã có liên kết với 1 profile khác (A), RPC phải tự gỡ liên kết cũ (`telegram_chat_id = null` ở A) trước khi gán cho profile mới (B) — tránh vi phạm unique constraint và tránh A bị ghi đè liên kết một cách âm thầm.
- Luồng mới (đã xác nhận — ghi trước, sửa scope sau bằng inline button; 1 scope áp dụng cho cả batch trong 1 tin nhắn):
  1. Web hiển thị mã `telegram_link_token` (6 số, tạo/xoay bằng RPC `refresh_telegram_link_token`).
  2. User nhắn `/link 123456` tới bot chung → Edge Function `telegram-webhook` gọi RPC `link_telegram_account`: nếu `chat_id` đang gán ở profile khác, gỡ trước rồi mới gán cho profile hiện tại; set `telegram_chat_id`, `telegram_username`; xoá token cũ.
  3. Lệnh `/ca_nhan` và `/ho_gia_dinh` đổi `profiles.telegram_active_scope` (mặc định `'personal'`, khớp default `scopeMode` trên web). Khi `leave_household`, RPC tự reset `telegram_active_scope` về `'personal'`.
  4. Nhắn tin thường (vd "cá 20k, rau 10k, thịt 50k") → Edge Function tra `chat_id` → lấy `profile` (bao gồm `telegram_active_scope`) → gọi RPC `add_transactions_via_bot(p_actor uuid, p_text text)` (SECURITY DEFINER):
     - Parse toàn bộ các khoản trong tin nhắn (rule-first + Gemini fallback, cùng logic `parse-transaction`).
     - Sinh 1 `telegram_batch_id` dùng chung cho mọi dòng transaction từ tin nhắn này.
     - Ghi ngay theo `telegram_active_scope` hiện tại: `'personal'` → `owner_id = p_actor`; `'household'` → `household_id = profile.household_id, member_id = p_actor` (nếu `telegram_active_scope='household'` nhưng `household_id` null do race condition rời hộ, tự fallback về `personal` và báo rõ trong tin xác nhận).
     - Insert `activity_log` (source='telegram').
  5. Web nhận ngay qua Realtime subscription.
  6. Bot trả lời xác nhận, nêu rõ đã ghi vào sổ nào ("👤 Đã ghi vào sổ CÁ NHÂN" / "🏡 Đã ghi vào sổ HỘ GIA ĐÌNH"), kèm **inline button đổi scope cho cả batch** — chỉ hiển thị nếu `profile.household_id is not null`:
     - Nút `[🔁 Chuyển sang HỘ GIA ĐÌNH]` hoặc `[🔁 Chuyển sang CÁ NHÂN]` (tuỳ scope vừa ghi).
     - Bấm → gọi RPC `reassign_transaction_scope(p_batch_id uuid, p_actor uuid, p_new_scope text)`: cập nhật toàn bộ dòng cùng `telegram_batch_id` sang scope mới trong 1 transaction SQL, đồng thời cập nhật `telegram_active_scope = p_new_scope` để tin nhắn tiếp theo mặc định đúng luôn (không cần vào web bấm toggle). Idempotent: nếu bấm lại khi đã đúng scope, no-op, không lỗi.
     - RPC tự chèn `activity_log` ghi lại việc đổi scope (source='telegram', action='transaction.reassign_scope').

**Quy tắc bắt buộc (thêm 31/08/2026, sau khi T-S147 phát hiện drift thật giữa 3 bản file — xem CHANGELOG "T-S147")**: thư mục `telegram-webhook/` có 3 bản file gần trùng lặp do giới hạn Dashboard Editor không cho import tương đối: `telegram-webhook-merged.ts` (self-contained, ĐANG CHẠY PRODUCTION THẬT), `telegram-webhook-index.ts` + `index.ts` (import `_shared/`, dùng cho CLI-deploy). Bất kỳ thay đổi logic nào trong `handleMessage`/`fetchCategoryNames`/hàm dùng chung khác PHẢI áp đồng bộ ở CẢ 3 file trong CÙNG 1 task — không sửa 1 file rồi để lại việc "đồng bộ sau" (đúng lớp bug đã xảy ra: `index.ts`/`telegram-webhook-index.ts` từng thiếu fix T-S90 suốt từ 17/08 tới 31/08 mà không ai phát hiện vì không có gì bắt buộc đối chiếu 3 file này với nhau). Trước khi bắt đầu sửa, luôn `diff` nhanh 3 file để biết baseline có đang lệch sẵn hay không (nếu lệch, phải quyết định đồng bộ baseline trước khi chồng thêm thay đổi mới, tránh khuếch đại lệch).

### 4.1 "Chế độ Hỏi-Đáp qua Telegram" — CHỐT 31/08/2026, xem PRD.md "Chốt 31/08/2026", chưa code (T-S147→T-S155)

**Điểm chèn vào luồng hiện có (KHÔNG đổi `handleExpenseText`)**: trong `handleMessage` (§4 mục 4), ngay TRƯỚC dòng gọi `handleExpenseText(chatId, profile, text)`, chèn bước phân loại:

```
const hasAmount = AMOUNT_REGEX.test(text);       // regex số tiền đã có sẵn (parseWithRules)
const intent = detectQueryIntent(text, categoriesList, goalsList); // rule-based, xem dưới
if (intent && !(hasAmount && !isStrongQueryPhrase(intent))) {
  await handleQuery(chatId, profile, intent);
  return;
}
if (!intent && !hasAmount) {
  await handleFreeformQuery(chatId, profile, text);  // AI fallback có grounding, xem dưới
  return;
}
// hasAmount=true, không khớp intent mạnh -> giữ nguyên hành vi cũ, KHÔNG đổi gì
await handleExpenseText(chatId, profile, text);
```
Nguyên tắc: 1 tin nhắn có số tiền (`AMOUNT_REGEX` — pattern đã dùng ở `parseWithRules`) và KHÔNG khớp cụm hỏi mạnh ("tổng", "còn bao nhiêu", "bao nhiêu tiền", "số dư", "so sánh"...) → LUÔN đi qua đường khai báo giao dịch cũ, không bao giờ bị nuốt bởi nhánh hỏi-đáp mới — bảo toàn 100% hành vi hiện có, tránh regression trên tính năng chính.

**Nguồn sự thật DUY NHẤT cho scope (bắt buộc dùng ở MỌI hàm truy vấn mới, không viết lại)**:
```ts
function getEffectiveScope(profile: ProfileRow): { scope: "personal" | "household"; ownerId?: string; householdId?: string } {
  const isHousehold = profile.telegram_active_scope === "household" && !!profile.household_id;
  return isHousehold
    ? { scope: "household", householdId: profile.household_id! }
    : { scope: "personal", ownerId: profile.id };
}
```
— refactor `fetchCategoryNames` (đã có logic tương đương từ T-S90) để gọi lại hàm này thay vì tự tính riêng, tránh có 2 bản sao cùng 1 công thức (đúng bài học §5). MỌI hàm truy vấn mới (`.from("transactions")`, `.from("categories")`, `.from("saving_goals")`, `.from("auto_contribution_configs")`) PHẢI filter `.eq("owner_id", ownerId)` HOẶC `.eq("household_id", householdId)` theo kết quả hàm này + luôn `.is("deleted_at", null)` — vì Edge Function dùng `SERVICE_ROLE_KEY` (bypass RLS), đây là hàng rào DUY NHẤT chống lộ dữ liệu người dùng khác.

**Múi giờ VN cho mọi mốc thời gian tương đối**:
```ts
function todayVN(): string { // "YYYY-MM-DD" theo giờ VN, không phụ thuộc múi giờ server Deno (UTC)
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());
}
```
`parseVietnameseDateRange(text): { start: string; end: string; label: string } | null` — nhận diện "hôm nay"/"hôm qua"/"tuần này"/"tháng này"/"tháng trước"/"tháng M"/"tháng M/YYYY"/"năm nay"/"DD/MM/YYYY" (ngày cụ thể). Không khớp gì → mặc định "tháng này" cho các intent cần kỳ (khớp quy ước "luôn tháng hiện tại" đã dùng cho hạn mức ngân sách, §1.15/T-S112).

**9 intent (T-S148→T-S153, mỗi task 1-3 intent liên quan cùng vùng dữ liệu)**:
1. `total_spending_income` — SUM `amount` theo `type` trong khoảng `[start,end]`.
2. `cumulative_balance` — gọi lại chính xác công thức `getCumulativeBalance`/§1.15 (port sang SQL/JS thuần, KHÔNG viết công thức khác).
3. `category_spending` — cần khớp tên category trong câu hỏi với `categoriesList` thật (fuzzy, tái dùng kiểu so khớp đã có ở `assignSavingGoal`/T-S20, KHÔNG tạo thuật toán so khớp thứ 2) + SUM theo `category_id` trong kỳ.
4. `budget_remaining` — tái dùng ĐÚNG NGHĨA `getCurrentMonthCategorySpending`/§1.15 (luôn tháng hiện tại, không nhận kỳ tuỳ ý từ câu hỏi).
5. `goal_progress` — khớp tên trong `saving_goals` đang active (tương tự #3), trả `current_amount`/`target_amount`/%.
6. `recent_transactions` — `order by date desc, created_at desc limit N` (mặc định 10, hoặc theo kỳ nếu có).
7. `top_expense` — `type='expense' order by amount desc limit 1` trong kỳ.
8. `compare_months` — 2 lần gọi #1 (tháng này, tháng trước) rồi tính chênh lệch.
9. `auto_contribution_status` — `.from("auto_contribution_configs")` + `.from("auto_contribution_log")` join gọn, đọc thẳng qua PostgREST (đúng RLS SELECT policy sẵn có từ 0037, filter thêm scope thủ công như trên).

**AI fallback có grounding (T-S154, làm SAU CÙNG — để rule-based phủ hết case phổ biến trước, giảm phụ thuộc AI đúng tinh thần "rule-first" toàn dự án)**:
- Chỉ kích hoạt khi KHÔNG khớp intent nào (mục trên) VÀ văn bản KHÔNG chứa số tiền (`AMOUNT_REGEX` âm tính) — tránh nuốt nhầm câu khai báo giao dịch lạ.
- Truy vấn sẵn 1 gói JSON snapshot (đã scoped đúng theo `getEffectiveScope`): tổng thu/chi tháng này, breakdown theo category, trạng thái hạn mức ngân sách, số dư luỹ kế, danh sách goal + tiến độ, 10 giao dịch gần nhất, danh sách cấu hình trích tự động.
- Gọi AI (provider mặc định hệ thống hiện dùng cho parse-transaction, KHÔNG thêm provider/key mới) với system prompt ép buộc: "CHỈ được dùng số liệu trong JSON dưới đây để trả lời. KHÔNG được suy đoán/bịa thêm số liệu nào ngoài JSON. Nếu JSON không đủ để trả lời, nói rõ không có dữ liệu và gợi ý mở web app xem chi tiết. Trả lời ngắn gọn bằng tiếng Việt."
- **NEVER DO**: không gửi dữ liệu của người dùng khác/hộ khác vào prompt (chỉ gói JSON đã scope đúng); không để AI tự ý gọi thêm truy vấn nào khác ngoài gói JSON đã chuẩn bị sẵn (không dùng tool-calling/text-to-SQL mở — tránh rủi ro injection và bịa số).

**Nhắc `WELCOME_MESSAGE`/tin `/help`** (T-S155): bổ sung ví dụ câu hỏi mẫu ("tổng chi tiêu tháng này", "còn bao nhiêu ngân sách ăn uống", "mục tiêu tiết kiệm của tôi tới đâu rồi"...) để người dùng biết tính năng mới tồn tại — không đổi cấu trúc tin chào cũ, chỉ thêm đoạn.

#### 4.1.1 Override scope theo từ khoá trong câu hỏi — CHỐT 01/09/2026 (T-S156, phát hiện qua test tay thật T-S149)

- **Bối cảnh phát hiện**: `getEffectiveScope(profile)` (§4.1 trên) chỉ đọc `profile.telegram_active_scope` — cờ lưu DB, CHỈ đổi được qua lệnh `/ca_nhan`/`/ho_gia_dinh`. Test tay T-S149 cho thấy gõ chữ "hộ gia đình" NGAY TRONG câu hỏi tự do (vd "tổng chi tiêu ngày 30/8 **hộ gia đình**") hoàn toàn bị bot bỏ qua — mọi câu trả lời vẫn theo scope active cũ (thường là "Cá nhân" mặc định), gây hiểu nhầm bot bị lỗi dù đây là đúng thiết kế ban đầu (AC gốc T-S148 đã ghi rõ "đổi qua `/ca_nhan`/`/ho_gia_dinh`", không phải qua từ khoá trong câu).
- **Quyết định**: thêm khả năng override scope CHO ĐÚNG 1 CÂU HỎI, KHÔNG đổi `telegram_active_scope` lưu DB (khác lệnh `/ca_nhan`/`/ho_gia_dinh` — những lệnh đó vẫn giữ nguyên, đổi vĩnh viễn cho tới khi đổi lại). Chỉ áp dụng cho **nhánh hỏi-đáp** (`handleQuery`, 9 intent §4.1) — **KHÔNG áp dụng cho `handleExpenseText`** (khai báo giao dịch tự do vẫn 100% dùng `getEffectiveScope(profile)` như cũ, không đổi) — tránh mở rộng phạm vi ngoài đúng bug đang sửa (thay đổi ngữ nghĩa ghi sổ giao dịch là quyết định lớn hơn, cần bàn riêng nếu có nhu cầu thật).
- **Cách nhận diện** (`detectScopeOverride(text)`): chỉ khớp CHÍNH XÁC 2 cụm đã dùng làm nhãn/lệnh sẵn có của bot — `"hộ gia đình"`, `"cá nhân"` (so khớp `includes()` trên chuỗi đã lowercase, không đoán các biến thể khác như "gia đình"/"của tôi" — đúng tinh thần rule-first "không bịa" toàn khối §4.1). Câu có CẢ 2 cụm cùng lúc (mơ hồ) → không override, fallback về scope active như cũ.
- **Case tài khoản chưa có hộ**: câu hỏi khớp override `"household"` nhưng `profile.household_id` rỗng → bot PHẢI trả lời rõ "chưa tham gia hộ gia đình nào", **KHÔNG được âm thầm rơi về cá nhân** — đây chính là hành vi gây hiểu nhầm ban đầu (bot có vẻ "hiểu" household nhưng thực ra bỏ qua), không lặp lại lỗi đó dưới dạng khác.
- **Hệ quả bắt buộc ở code**: `fetchCategoriesFull`/`fetchCategoryNames` đổi nhận tham số `EffectiveScope` đã tính sẵn thay vì tự gọi `getEffectiveScope(profile)` bên trong — để nhánh hỏi-đáp (scope có override, tính qua `resolveQueryScope(profile, text)`) và nhánh khai báo giao dịch (scope không override, qua `getEffectiveScope(profile)` như cũ) dùng CHUNG 1 hàm fetch mà không lẫn 2 công thức khác nhau (đúng bài học §5 "1 công thức, 1 hàm dùng chung"). `handleQuery` nhận `effective` làm tham số thay vì tự tính lại — tránh lệch giữa label hiển thị (`scopeLabel`) và scope thật dùng để truy vấn dữ liệu.
- **Điểm tính SỚM bắt buộc**: `resolveQueryScope(profile, text)` phải tính TRƯỚC bước fetch `categoriesList` dùng cho `detectQueryIntent` (không phải chỉ trước `handleQuery`) — vì fuzzy-match tên category (`category_spending`/`budget_remaining`, §mục 3-4 trên) phải khớp đúng category của HỘ hay CÁ NHÂN theo override, nếu không câu hỏi về 1 category chỉ tồn tại ở sổ kia sẽ không nhận diện được intent, rơi nhầm về `handleExpenseText`.
- Áp dụng đồng bộ ở `telegram-webhook-merged.ts` + `telegram-webhook-index.ts` (2 file đang có hạ tầng hỏi-đáp T-S147→T-S149). **KHÔNG áp vào `index.ts`** — file đó vẫn là nợ kỹ thuật riêng đã ghi nhận (thiếu toàn bộ hạ tầng §4.1), ASK FIRST trước khi động vào theo đúng CHANGELOG "NỢ KỸ THUẬT — CHƯA XỬ LÝ" đã ghi khi bắt đầu T-S149.

### 1.12 Bắt buộc gắn `goal_id` khi tạo giao dịch thuộc/liên quan Tiết kiệm/Tích lũy — CHỐT 09/08/2026 (thiết kế cho T-S45)

- **Vấn đề**: trước T-S45, category/mô tả/ghi chú gợi ý rõ ràng đây là 1 khoản góp quỹ tiết kiệm (`isSavingsRelated`, cùng điều kiện suy luận đã CHỐT ở §1.9/`isSavingsContribution`) nhưng người dùng KHÔNG chọn goal nào ở dropdown "Gắn vào" (`SmartInput`/`AIAssistantBubble`/`TransactionHistory`) vẫn ghi sổ được bình thường như 1 khoản thu/chi thường — tiền "biến mất" khỏi theo dõi mục tiêu dù rõ ràng có ý định tích luỹ.
- **[Nới 10/08/2026 — T-S47, xem PRD.md "Chốt 10/08/2026"]** `isSavingsRelated` KHÔNG còn suy luận theo TÊN CATEGORY — chỉ còn goal đã chọn (`goalId`) hoặc mô tả/ghi chú chứa từ khoá góp quỹ rõ ràng. Lý do: Smart Advisor (T-S38/39) tạo category ngân sách định kỳ tên gợi tiết kiệm ("Tiết kiệm & Đầu tư") không gắn với goal cụ thể nào — suy luận theo tên category cũ khiến MỌI khoản chi vào category đó đều bị chặn cứng dù không có ý định góp quỹ thật, sai với model đã đối chiếu (YNAB: category không chỉ dành cho chi tiêu, không bắt buộc gắn goal theo tên).
- **Quyết định**: MỌI dòng giao dịch khớp `isSavingsRelated` (`src/lib/savingsDetect.ts`, hàm dùng chung — không viết lại điều kiện suy luận riêng ở từng component/nơi gọi) BẮT BUỘC có `goalId` trước khi được phép ghi sổ ở CẢ 3 nơi tạo giao dịch thủ công/AI (`SmartInput.tsx`, `AIAssistantBubble.tsx`, `TransactionHistory.tsx` form thêm mới). 2 tầng phòng thủ bắt buộc, không được chỉ làm 1 tầng:
  1. **Tầng 1 (UI)**: banner đỏ (rose, không phải amber — đây là chặn cứng, không phải gợi ý) + khoá nút Lưu/Ghi Sổ/Xác nhận khi còn dòng thiếu goal. Bao gồm cả trường hợp KHÔNG có goal active nào tồn tại (không chỉ ẩn form đi — phải hiện rõ lý do + hướng dẫn tạo goal trước).
  2. **Tầng 2 (logic dùng chung)**: `buildTransactionInsert` (`toTransactionInsert.ts`) throw nếu thiếu goal cho input liên quan tiết kiệm — chặn cả đường gọi tắt bỏ qua UI (vd gọi trực tiếp từ nơi khác sau này).
- **Không áp dụng cho sửa giao dịch đã tạo**: `goal_id` bất biến sau khi tạo (đã CHỐT §1.9 mục 2 — chặn cứng 2 chiều cả FE lẫn DB). Đổi category của 1 giao dịch expense/income thường SANG tên trùng nhóm Tiết kiệm lúc sửa (`TransactionHistory` form sửa) hiện KHÔNG bị chặn/cảnh báo bởi quy tắc này — đây là khoảng trống đã biết (ghi nhận ở T-S45, chưa xử lý), không tự ý mở rộng phạm vi để vá khi làm task khác chưa xác nhận.
- **Không tự động gán/suy luận goal thay người dùng** — đúng nguyên tắc chung ở bảng ranh giới §5 ("mọi suy luận tự động BẮT BUỘC dừng ở mức gợi ý/banner"): việc BẮT BUỘC chọn 1 goal là chặn hành động (block), không phải TỰ CHỌN hộ 1 goal cụ thể nào.

### 1.13 "Goal liên kết Danh mục Ngân sách" — CHỐT 10/08/2026 (thiết kế cho T-S48, chưa code)

- **Vấn đề**: sau khi nới §1.12 (T-S47), category ngân sách định kỳ kiểu "Tiết kiệm & Đầu tư" không còn bị chặn, nhưng cũng mất luôn khả năng xem TỔNG đã "để dành" qua các tháng — người dùng phải tự cộng tay.
- **Quyết định**: thêm khái niệm goal thứ 2, SONG SONG với goal thủ công hiện có (T-S14/T-S19/T-S20, góp quỹ qua `type='transfer'` + `goal_id`), KHÔNG thay thế:
  1. `saving_goals` thêm `linked_category_id` (nullable FK → categories, `on delete set null`) + `linked_start_date`/`linked_end_date` (khoảng ngày TUỲ Ý người dùng chọn lúc tạo goal — đã hỏi, KHÔNG mặc định "từ ngày tạo" hay "reset theo tháng").
  2. `current_amount` của goal liên kết category **luôn tự TÍNH** (SUM giao dịch `type='expense'`, `category_id` khớp, `deleted_at is null`, `transaction_date` trong khoảng đã chọn) — KHÔNG lưu cứng, KHÔNG có API/RPC nào ghi tay vào `current_amount` của loại goal này. Đây là nguồn sự thật DUY NHẤT (sổ giao dịch thật), đổi hẳn nguyên tắc "lưu số dư rồi cộng dồn bằng trigger" đang dùng cho goal thủ công (§1.9) — 2 loại goal có 2 cơ chế tính khác nhau, phải phân biệt rõ ở code (không dùng chung 1 hàm tính `current_amount`).
  3. **1 goal chỉ thuộc ĐÚNG 1 trong 2 loại — không trộn**: goal có `linked_category_id` KHÔNG xuất hiện trong dropdown "Gắn vào mục tiêu" ở `SmartInput`/`AIAssistantBubble`/`TransactionHistory` (không nhận góp quỹ thủ công qua transfer), không có nút "Đóng góp quỹ". Lý do: trộn 2 cơ chế tính (tự động từ category + cộng tay qua transfer) trên cùng 1 goal dễ gây hiểu sai/sai số, giữ đơn giản cho v1 — có thể mở rộng sau nếu có nhu cầu thật.
  4. Giao dịch ghi vào category đang liên kết vẫn là khoản chi bình thường (`type='expense'`, không có `goal_id`) — không đổi gì so với T-S47, không tạo `type='transfer'` nào.
- **[CHỐT 10/08/2026 (tiếp) — làm rõ ranh giới giữa 2 loại goal, người yêu cầu xác nhận hướng A]**: category liên kết goal (khoản "tiết kiệm & đầu tư chung", `type='expense'`) và goal thủ công (khoản tiết kiệm nhỏ lẻ cụ thể, `type='transfer'`) là **2 SỔ ĐỘC LẬP, KHÔNG LIÊN THÔNG** — tuyệt đối không tạo bất kỳ giao dịch/thao tác nào mang ý nghĩa "rút từ category liên kết sang góp cho 1 goal thủ công". Lý do: category liên kết dùng `expense` (đã trừ Số dư luỹ kế 1 lần khi tiền vào), goal thủ công dùng `transfer` (không trừ) rồi mới trừ đúng 1 lần ở bước "mua thật" (§1.9b) — nếu để tiền "chảy" từ sổ này sang sổ kia mà không xử lý gì thêm, cùng 1 khoản tiền sẽ bị tính là "chi tiêu" 2 lần độc lập (1 lần lúc vào category liên kết, 1 lần lúc mua thật ở goal thủ công) → sai lệch Số dư luỹ kế thật. Muốn góp cho 1 goal thủ công, luôn góp từ dòng tiền hiện tại (transfer bình thường), KHÔNG coi đó là "rút ra" từ category liên kết dù về ý nghĩa tài chính ngoài đời 2 khoản này có thể cùng nằm trong 1 tài khoản tiết kiệm thật.
- **[Backlog, KHÔNG lên lịch, ghi dự phòng cho tương lai nếu thực sự cần]**: nếu sau này cần mô hình "quỹ chung → chia nhỏ cho từng goal cụ thể → tiêu thì chỉ trừ đúng 1 lần" (kiểu envelope/phân bổ nội bộ thật của YNAB), đây là 1 tính năng lớn, KHÔNG làm bằng cách nối 2 cơ chế hiện có — cần 1 khái niệm "hành động phân bổ nội bộ" tách biệt hẳn khỏi transaction (không sinh dòng `transfer`/`expense` nào khi "gán" tiền cho goal con), và khi ghi nhận "mua thật" ở goal con phải có cách đánh dấu khoản đó dùng tiền ĐÃ tính vào category liên kết trước đó để loại trừ khỏi Số dư luỹ kế lần 2. Ảnh hưởng tới `txClassify.ts` (nguồn sự thật thu/chi dùng khắp nơi) và phá vỡ ranh giới "1 goal chỉ 1 loại, không trộn" đã chốt ở mục 3 — phải thiết kế lại từ đầu, không tận dụng được code T-S48 hiện có. Chưa có task ID, chưa vào TASKS.md chính thức — chỉ mở khi có nhu cầu thật.

#### 1.13.1 Tu chỉnh T-S63 — chặn 2 goal khác nhau cùng liên kết 1 category chồng lấp ngày + cảnh báo mềm sai ngữ nghĩa category — CHỐT 12/08/2026

- **Bối cảnh**: người dùng test tay 12/08/2026 (tạo nhiều goal MỚI, cùng liên kết 1 category, khoảng ngày chồng lấp nhau) phát hiện 2 vấn đề khác lớp bug T-S61/T-S62 (T-S61/62 dedup theo THỜI GIAN trong lịch sử của 1 goal; đây là thiếu dedup theo GOAL — nhiều goal khác nhau cùng nhận 1 khoản tiền):
  1. **Bug tài chính thật (bắt buộc sửa)**: không có ràng buộc nào (DB lẫn code) chặn 2 goal KHÁC NHAU cùng `linked_category_id` với khoảng ngày chồng lấp — mỗi goal độc lập tự `SUM` lại toàn bộ giao dịch expense của category đó trong khoảng ngày, không biết gì về goal khác cũng đang liên kết cùng category cùng khoảng ngày → cùng 1 khoản tiền bị NHIỀU goal khác nhau cùng tính là "đã để dành" một lúc. Xảy ra ở CẢ 2 đường ghi `linked_category_id`: tạo goal mới (`createGoal()` — insert thẳng, không qua RPC nào) VÀ sửa liên kết (`update_goal_link` — RPC không biết gì về goal khác).
  2. **Vấn đề ngữ nghĩa sản phẩm (không phải bug logic, nhưng gây hiểu nhầm số liệu tài chính thật)**: thiết kế gốc §1.13 giả định category liên kết LUÔN là loại "tiết kiệm & đầu tư" (tiền `expense` nhưng bản chất là chuyển sang 1 "ví" khác, không tiêu mất) — nhưng code không hề kiểm tra category được chọn có đúng bản chất này hay không. Liên kết 1 category tiêu dùng thường (VD "quần áo") vào goal tiết kiệm khiến tiền ĐÃ TIÊU MẤT hiển thị như tiền "đã tích luỹ" — sai theo đúng nghĩa tài chính ngoài đời. Schema `categories` hiện chỉ có `type: 'expense'|'income'`, không có khái niệm phân loại "tiết kiệm/đầu tư" vs "tiêu dùng thường" để hệ thống tự phân biệt.
- **Giải pháp CHỐT cho mục 1 (bug tài chính, migration `0020`)**: 1 ràng buộc **EXCLUSION ở cấp database** (`saving_goals_linked_category_no_overlap`, dùng extension `btree_gist`) — `exclude using gist (linked_category_id with =, daterange(linked_start_date, linked_end_date, '[]') with &&) where (linked_category_id is not null and deleted_at is null)`. Chặn TẠI NGUỒN, không phụ thuộc code phía trên có nhớ check ở từng entry point hay không — đúng bài học rút ra từ chính bug này (chỉ check ở RPC là không đủ, đường INSERT trực tiếp lúc tạo goal mới bị bỏ sót). Vi phạm raise lỗi Postgres `23P01` (exclusion_violation), `services/goals.ts` (`createGoal`/`updateGoalLink`) bắt lỗi này qua helper `rethrowFriendlyLinkOverlapError`, dịch sang thông báo tiếng Việt dễ hiểu.
- **Giải pháp CHỐT cho mục 2 (ngữ nghĩa, KHÔNG chặn cứng)**: đúng nguyên tắc §5 ("mọi suy luận tự động BẮT BUỘC dừng ở mức gợi ý/banner") — hệ thống không có cách nào tự biết category nào là "tiết kiệm" nên KHÔNG suy luận hộ/chặn hộ. Thêm 1 banner cảnh báo MỀM (không chặn submit) ở CẢ 2 nơi chọn category liên kết (form tạo goal mới + form sửa liên kết, `SavingGoals.tsx`), luôn hiện khi bật liên kết, nói rõ: "Số tiền hiển thị sẽ là tổng đã CHI trong danh mục này, không phải tiền đang có sẵn để rút — chỉ nên liên kết với danh mục tiết kiệm/đầu tư, không dùng cho danh mục tiêu dùng thường".
- **[Backlog, KHÔNG lên lịch — phương án B dự phòng nếu banner cảnh báo mềm không đủ ngăn nhầm lẫn thật]**: thêm cột `categories.is_savings_kind boolean default false` (người dùng tự khai báo lúc tạo/sửa category, VD toggle "Đây là danh mục tiết kiệm/đầu tư"), sau đó CHẶN CỨNG dropdown chọn category liên kết goal chỉ hiện category có cờ này = true (thay vì mọi category `type='expense'` như hiện tại). Chi phí: thêm cột + migrate dữ liệu category cũ (mặc định false, không đoán hộ category nào cũ là tiết kiệm) + sửa UI form tạo/sửa category (`BudgetLimits.tsx`) thêm toggle này + sửa dropdown ở `SavingGoals.tsx` lọc theo cờ. Ảnh hưởng UX: category cũ đang được liên kết goal (trước khi có cờ) sẽ mặc định `is_savings_kind=false` — cần quyết định có tự bật cờ cho các category ĐANG có `linked_category_id` trỏ tới hay không (tránh phá goal đang chạy). Chỉ làm khi có bằng chứng người dùng vẫn liên kết nhầm category tiêu dùng dù đã có banner cảnh báo — chưa có task ID.

### 1.14 Gợi ý mềm góp quỹ theo TÊN goal thật (thay "chặn cứng theo từ khoá") — CHỐT 10/08/2026 (thiết kế cho T-S49, chưa code, THAY THẾ T-S47)

- **Vấn đề**: sau 2 lần nới §1.12 (T-S45 → T-S47), isSavingsRelated vẫn dựa trên khớp TỪ KHOÁ tự do trong mô tả/ghi chú để quyết định CHẶN CỨNG. Người dùng chỉ đúng lỗi gốc: text tự do không bao giờ khớp hết bằng 1 danh sách từ khoá tĩnh — vá thêm từ khoá chỉ dời bug, không sửa gốc. Banner cũ cũng không có lối tắt tạo goal mới.
- **Quyết định — bỏ hẳn khớp từ khoá + chặn cứng cho category CHƯA liên kết goal (T-S48/§1.13)**, thay bằng khớp TÊN 1 goal THỦ CÔNG thật đang active + gợi ý MỀM, không chặn:
  1. Category ĐÃ liên kết 1 goal qua linked_category_id (§1.13) → không đoán gì cả, không dính banner này.
  2. Category CHƯA liên kết: isSavingsRelated đổi hẳn cách suy luận — khớp mô tả/ghi chú với TÊN từng goal THỦ CÔNG đang active (completedAt chưa set, loại goal có linked_category_id ra khỏi so khớp), tái dùng đúng cơ chế fuzzy includes() 2 chiều đã có ở assignSavingGoal/T-S20. Khớp được ≥1 goal → banner MÀU VÀNG (amber, không phải đỏ/rose), KHÔNG khoá nút Lưu/Ghi Sổ/Xác nhận, dropdown "Gắn vào" hiện sẵn goal khớp để chọn nhanh. Không khớp goal nào → không hiện banner nào, không chặn gì.
  3. Thêm nút "+ Tạo mục tiêu mới" ngay trong banner gợi ý (cả 3 nơi SmartInput/AIAssistantBubble/TransactionHistory) — bấm mở 1 form rút gọn tạo goal mới, tự động gắn vào dropdown "Gắn vào".
- **Ảnh hưởng lên bảng §5**: hàng "Chặn cứng" (viết cho T-S45/T-S47) coi như bị THAY THẾ cho trường hợp category chưa liên kết goal — xem hàng mới thêm cho T-S49, hàng cũ giữ lại làm lịch sử.
- buildTransactionInsert/toTransactionInsert.ts không còn throw khi thiếu goal cho trường hợp khớp-theo-tên-goal.
- **T-S47 (đang 🟡, xem TASKS.md) bị T-S49 THAY THẾ** — không cần tiếp tục verify bản vá từ khoá cũ, gộp thẳng vào T-S49 khi code.

### 1.15 "Số dư luỹ kế" (Cumulative Balance) — CHỐT 10/08/2026 (thiết kế cho T-S50/T-S51, chưa code)

- **Vấn đề**: limit_amount reset ý nghĩa mỗi tháng (app không dùng mô hình "phong bì" per-category như YNAB) — phần chưa tiêu hết của 1 category tháng này không có chỗ nào thể hiện là vẫn "còn của người dùng" khi bước sang tháng sau.
- **Đối chiếu YNAB**: số dư category chưa tiêu hết tích luỹ tự động — nhưng YNAB dùng mô hình "phong bì" đúng nghĩa, khác app hiện tại. Chỉ mượn Ý TƯỞNG "tiền dư không biến mất", áp vào đúng model đang có (tính trên toàn bộ sổ giao dịch thật, không theo category).
- **Quyết định**:
  1. KHÔNG tạo giao dịch/bản ghi nào để "chuyển số dư" giữa các tháng. Số dư luỹ kế CHỈ là 1 con số TÍNH RA: = tổng tất cả giao dịch isIncomeTx() trừ tổng tất cả giao dịch isExpenseTx() (dùng chung txClassify.ts), deleted_at is null, tính từ 1 mốc bắt đầu tới hiện tại — không giới hạn theo tháng.
  2. Hiển thị như 1 KPI mới ở FinancialDashboard.tsx — thêm mới, không thay thế 4 thẻ hiện có.
  3. Ở SmartAllocator.tsx: thêm checkbox tuỳ chọn (mặc định TẮT) "+ Gộp cả số dư luỹ kế vào tổng để phân bổ" cạnh ô thu nhập tháng này (T-S41). Bật → tổng phân bổ = thu nhập tháng này + số dư luỹ kế; tắt → về đúng tổng gốc.
- **[XÁC NHẬN 10/08/2026, gỡ chặn code T-S50]**: mốc bắt đầu tính luỹ kế = **toàn bộ lịch sử giao dịch** (không giới hạn, không cấu hình thêm) — người yêu cầu đã xác nhận. Xem PRD.md "Rủi ro" (đã cập nhật, không còn là rủi ro).
- **Không double-count với §1.13/T-S48**: giao dịch expense trong category đã liên kết goal vẫn bị trừ vào số dư luỹ kế như mọi khoản chi khác — không xung đột.

### 1.16 T-S49 bugfix + amendment (đợt test tay 1) — CHỐT 11/08/2026

- **Bugfix (không phải quyết định mới, chỉ sửa đúng thiết kế đã CHỐT §1.14 mục 1)**: `isSavingsSuggested`/`findMatchingActiveGoalsByName` (`savingsDetect.ts`) từ lúc viết ban đầu (T-S49) CHƯA BAO GIỜ thật sự kiểm tra "category đang chọn có phải category liên kết goal (§1.13) hay không" — dù CONSTITUTION đã chốt rõ "không đoán gì cả, không dính banner này". Người dùng phát hiện qua test tay + ảnh chụp UI (`TransactionHistory.tsx`, category "Tiết kiệm & Đầu tư" liên kết, mô tả "laptop" khớp tên 1 goal thủ công khác → banner vẫn hiện sai). Đã sửa: `isSavingsSuggested` nhận thêm `linkedCategoryIds` (Set category id đang bị liên kết, tính từ TOÀN BỘ `goalRows` chưa lọc) + `item.categoryId` — khớp category liên kết → LUÔN `false`, ưu tiên cao nhất, thắng mọi tín hiệu khác (kể cả từ khoá ý định ở mục dưới).
- **Amendment (quyết định mới, người dùng xác nhận)**: nút "+ Tạo mục tiêu mới" trước đó CHỈ hiện khi mô tả/ghi chú khớp ĐÚNG TÊN 1 goal có sẵn (đúng thiết kế gốc §1.14) — không có cách tạo goal MỚI khi CHƯA từng có goal nào tên khớp. Người dùng xác nhận **KHÔNG** để nút này luôn hiện bất kể nội dung giao dịch (dễ gây rối với giao dịch không liên quan), mà thêm 1 tín hiệu ĐỘC LẬP thứ 2: category đang chọn HOẶC mô tả/ghi chú chứa từ khoá ý định tiết kiệm/góp quỹ rõ ràng (danh sách: "tiết kiệm", "tích lũy"/"tích luỹ", "tích góp", "góp", "hùn vốn", "đầu tư", "heo đất", "bỏ ống").
  - Khác hẳn lớp bug T-S47 cũ (dùng từ khoá để **CHẶN CỨNG**, bị thay thế vì không đủ tin cậy để chặn): ở đây từ khoá chỉ dùng để **HIỆN 1 gợi ý/lối tắt**, không khoá nút Lưu/Ghi Sổ/Xác nhận, không tự chọn goal — đúng nguyên tắc §5 (suy luận tự động chỉ dừng ở gợi ý). Sai/thiếu vài trường hợp không gây hại dữ liệu tài chính nên chấp nhận được, khác với dùng để chặn (khi đó sai sẽ chặn nhầm người dùng).
  - Câu chữ banner phân biệt 2 trường hợp: khớp TÊN goal cụ thể → nêu đúng tên goal khớp (giữ nguyên câu cũ); chỉ khớp từ khoá ý định (chưa khớp tên goal nào) → câu chung "Giao dịch này có vẻ liên quan tiết kiệm/góp quỹ — gắn vào 1 mục tiêu có sẵn hoặc tạo mới?".
  - Danh sách từ khoá có thể mở rộng sau nếu phát hiện thiếu — không cần CHỐT lại cứng, chỉ cần sửa mảng `SAVINGS_INTENT_KEYWORDS` (`savingsDetect.ts`).

### 1.17 T-S49 bugfix (đợt test tay 2) — auto-gán `goalId` lúc parse, không qua xác nhận — CHỐT 11/08/2026

- **Bug thật, người dùng phát hiện qua test tay ở cả `SmartInput.tsx` ("Nhập Liệu AI") lẫn `AIAssistantBubble.tsx` ("bubble"), KHÔNG xảy ra ở `TransactionHistory.tsx` (nhập thủ công)**: gõ 1 câu có từ khoá khớp tên 1 goal, sau đó đổi category sang 1 category ĐÃ LIÊN KẾT goal khác (§1.13) — banner "Gắn vào mục tiêu" (T-S49) ẩn đi đúng thiết kế, nhưng khi bấm Lưu, hệ thống vẫn tự tạo goal mới + ghi `type='transfer'` dù người dùng CHƯA từng chạm vào banner/dropdown đó.
- **Gốc rễ**: cả 2 file còn sót lại hàm `assignSavingGoal()` (thời T-S14/T-S20, TRƯỚC khi T-S49 chốt lại thiết kế) — tự gán `item.goalId` (goal có sẵn hoặc token `"new_goal_<tên>"` chờ tạo) NGAY LÚC PARSE, dựa vào cờ `isSavingsContribution`/`savingsGoalName` do backend (`server.ts`) tự suy luận qua khớp từ khoá trong câu nhập gốc — cơ chế này KHÔNG hề qua bất kỳ cú bấm xác nhận nào của người dùng, vi phạm thẳng §5 ("Tự động chọn hộ 1 goal cụ thể... người dùng luôn phải tự chọn"; "tự động tạo goal mới mà không qua xác nhận bấm nút"). T-S49 (§1.14) khi thiết kế lại đã thay cơ chế GỢI Ý (banner + dropdown, người dùng tự bấm), nhưng quên xoá hẳn đường auto-gán CŨ này — 2 cơ chế tồn tại song song, cơ chế cũ âm thầm thắng vì chạy trước, ở tầng data chứ không phải UI nên không hiện ra banner nào để người dùng biết mà gỡ.
- **Sửa (2 tầng, đúng nguyên tắc "rà soát toàn bộ nhánh" đã ghi ở bảng §5)**:
  1. **Xoá hẳn** `assignSavingGoal()` ở cả `SmartInput.tsx`/`AIAssistantBubble.tsx` — mọi item parse xong luôn có `goalId: undefined`; không còn đọc `t.isSavingsContribution`/`t.savingsGoalName` ở tầng frontend nữa (backend `server.ts` vẫn tính 2 field này nhưng nay không ai tiêu thụ — không sửa `server.ts`, giữ nguyên vì đây là backend Express đang chờ thay bằng Edge Function ở T-S09, không mở rộng phạm vi task này).
  2. **`handleUpdateItem`** (cả 2 file): khi đổi `category` sang 1 category nằm trong `linkedCategoryIds` mà dòng đó đang có `goalId` sẵn (dù do người dùng tự chọn ở category cũ, hay do bug #1 sót lại) → tự động gỡ `goalId` (set `undefined`) ngay lúc đổi, không đợi tới lúc Lưu mới phát hiện.
  3. **`buildTransactionInserts`** (`toTransactionInsert.ts`, hàm DÙNG CHUNG cho cả 2 nơi) — thêm tham số `linkedCategoryIds` (optional), chặn cứng ở tầng này: category đã resolve của item nằm trong `linkedCategoryIds` → LUÔN ép `resolvedGoalId = null`, bất kể `item.goalId` là gì. Đây là hàng rào phòng thủ tầng 2 (không tin ngầm tầng gọi/UI đã dọn đúng, đúng nguyên tắc defense-in-depth đã áp dụng nhất quán trong dự án — vd `resolveTransactionType` throw ở §1.4/T-S22).
- **Không đổi**: form "Thêm giao dịch thủ công" (`TransactionHistory.tsx`) không có cơ chế `assignSavingGoal`/auto-gán nào từ trước — không có bug này, không cần sửa.

### 1.18 T-S58 — banner T-S20 ("đánh dấu hoàn thành mục tiêu") không loại trừ category đã liên kết goal (§1.13) — CHỐT 11/08/2026

- **Bug thật, người dùng phát hiện qua test tay + ảnh chụp UI** (`SmartInput.tsx` "Nhập Liệu AI"): chọn category ĐÃ liên kết 1 goal (vd "Tiết kiệm & Đầu tư"), gõ mô tả khớp TÊN 1 goal thủ công KHÁC đang active (vd "Mua laptop" khớp goal "Mua laptop (B)", mới đạt 36%) → banner teal T-S20 ("Giao dịch này có vẻ là mua sắm cho mục tiêu... — đánh dấu hoàn thành?") vẫn hiện sai, dù mục tiêu còn cách xa target. Người dùng đúng khi phân biệt: nút "Hoàn thành" được phép bấm bất kỳ lúc nào dù chưa đủ target (đúng thiết kế, không phải bug — §1.9 mục 3/5, dành cho goal không đặt target cụ thể) — nhưng việc banner XUẤT HIỆN trong tình huống category đã liên kết mới là bug thật.
- **Khác lớp với §1.16 (cùng đợt test tay nhưng khác banner)**: §1.16 sửa banner AMBER (T-S49, "Gắn vào mục tiêu" — góp quỹ) qua `isSavingsSuggested`. Đây là banner TEAL (T-S20, "đánh dấu hoàn thành" — mua thật), dùng hàm hoàn toàn khác (`findMatchingActiveGoals` cục bộ trong từng component, KHÔNG phải `findMatchingActiveGoalsByName` ở `savingsDetect.ts`) — hàm này chỉ lọc `g.completedAt`, chưa bao giờ biết đến khái niệm category đang chọn/`linkedCategoryIds`.
- **Vì sao điều kiện loại trừ có sẵn (`if (isSavingsCategory) return null`) không chặn được**: `isSavingsCategory` = kết quả `isSavingsSuggested`, mà theo đúng bugfix §1.16 hàm này TRẢ VỀ `false` khi category đang chọn nằm trong `linkedCategoryIds` (đúng thiết kế cho banner amber — "không đoán gì cả"). Banner teal lại dùng NGƯỢC giá trị đó để quyết định ẩn/hiện chính mình (`if (isSavingsCategory) return null`) — `isSavingsCategory === false` ở đúng tình huống category liên kết khiến điều kiện này KHÔNG kích hoạt, banner teal vẫn hiện. 2 banner có logic loại trừ lẫn nhau đúng (không cùng hiện 1 lúc) nhưng cả 2 đều thiếu 1 điều kiện loại trừ ĐỘC LẬP riêng cho trường hợp category liên kết.
- **Rủi ro thật nếu bấm nhầm (dù lần test tay này chưa bấm nên chưa gây hại)**: bấm "Đánh dấu hoàn thành" ở banner teal trong tình huống này vừa ghi giao dịch expense vào category liên kết (quỹ A, §1.13) vừa set `completed_at` cho 1 goal thủ công khác (quỹ B) — không tạo `goal_id`/`transfer` sai (khác lỗi §1.17) nhưng đóng nhầm 1 goal không liên quan gì tới khoản chi thật, đi ngược nguyên tắc "2 SỔ ĐỘC LẬP" (§1.13) ở mức UX (nhầm lẫn số liệu 2 mục tiêu độc lập), không phải sai dữ liệu tài chính.
- **Sửa (đồng bộ `SmartInput.tsx`/`AIAssistantBubble.tsx`, KHÔNG động vào `savingsDetect.ts`/`isSavingsSuggested` vì hàm đó đang đúng cho mục đích amber banner)**: thêm biến độc lập `isLinkedCategory = !!(itemCategoryId && linkedCategoryIds?.has(itemCategoryId))` tại đúng nơi đã tính `isSavingsCategory` (tái dùng `itemCategoryId` đã tra `categories.find()`, tránh gọi lại), rồi đổi điều kiện chặn banner teal thành `if (isSavingsCategory || isLinkedCategory) return null`. `TransactionHistory.tsx` không có banner T-S20 (§1.9 mục 7 — phạm vi chỉ SmartInput/AIAssistantBubble) nên không cần sửa.
- **Verify tĩnh**: `npx tsc --noEmit`: 29 lỗi, khớp baseline, 0 lỗi mới, không lỗi nào trong 2 file đã sửa. **CHƯA test runtime thật với Supabase** (sandbox không có mạng ra Supabase) — cần người yêu cầu tự test lại đúng kịch bản đã chụp ảnh: chọn category liên kết goal, gõ mô tả khớp tên 1 goal thủ công khác → banner teal KHÔNG được hiện nữa (chỉ còn banner amber nếu có, hoặc không banner nào); đổi lại category KHÔNG liên kết, giữ mô tả khớp tên goal active → banner teal PHẢI hiện lại đúng như cũ (không regress hành vi hợp lệ).
- **[SỬA LẠI 11/08/2026 (tiếp), xem §1.19 — điều kiện `isLinkedCategory` ở mục trên đã bị GỠ, tiền đề sai]**: sau khi người yêu cầu phản hồi "category chỉ là phân loại, không liên quan" (xem CHANGELOG "T-S59"), trace lại `handleConfirmAll` mới phát hiện tiền đề "category liên kết → có nguy cơ liên thông 2 sổ" ở mục trên là suy diễn SAI — hành động "Hoàn thành" (teal) build transaction với `goal_id=null` để type suy đúng ra `'expense'` theo category thật, KHÔNG hề ép `type='transfer'` như hành động "Góp quỹ" (amber) — `goal_id` gắn sau đó thuần là metadata tra cứu lịch sử, không đụng gì đến cách tính `current_amount` của category liên kết. §1.13 ("2 sổ độc lập") nói về DÒNG TIỀN, không áp dụng cho việc gắn nhãn tra cứu này. Xem §1.19 để biết điều kiện loại trừ ĐÚNG.

### 1.19 T-S59 — điều kiện loại trừ ĐÚNG giữa banner amber (góp quỹ)/teal (hoàn thành) — CHỐT 11/08/2026 (sửa lại §1.18)

- **Bối cảnh**: người yêu cầu chỉ ra §1.18 sai tiền đề — category chỉ là phân loại chi tiêu bình thường, hoàn toàn độc lập với việc "giao dịch này có hoàn thành 1 goal thủ công hay không". Kế hoạch gốc T-S20 (§1.9 mục 5) chưa từng gắn điều kiện category vào đây.
- **Ràng buộc THẬT cần loại trừ lẫn nhau**: không phải category, mà là **kiểu giao dịch** — 1 dòng không thể vừa là góp quỹ (`type='transfer'`, amber) vừa là mua thật/hoàn thành (`type='expense'` + `goal_id` gắn sau, teal) cùng lúc (§1.9 mục 1). Tín hiệu đúng để biết dòng nào đã "thành" góp quỹ là **`item.goalId` đã được CHỌN qua dropdown amber hay chưa** — tín hiệu ĐỘNG theo lựa chọn thật của người dùng tại thời điểm đó (dropdown mặc định "-- Không tích lũy --" = `goalId` rỗng), không phải suy đoán TĨNH từ khớp tên/category (`isSavingsCategory`).
- **Hệ quả của việc dùng sai tín hiệu (`isSavingsCategory`) ở §1.18**: vì banner amber (T-S49, §1.14) và banner teal (T-S20) dùng CHUNG 1 kiểu khớp tên goal (`findMatchingActiveGoalsByName` vs `findMatchingActiveGoals` cục bộ — logic gần như trùng cho goal thủ công), bất cứ khi nào description khớp tên 1 goal thủ công, CẢ HAI đều "muốn" hiện — dùng `isSavingsCategory` (tĩnh, = amber có nên hiện không) để chặn teal khiến amber LUÔN thắng, teal gần như chết hẳn cho đúng use-case chính của nó (mua thật cho goal thủ công bằng category chi tiêu bình thường) — đây là bug T-S59 người yêu cầu phát hiện qua test tay.
- **Sửa (đồng bộ `SmartInput.tsx`/`AIAssistantBubble.tsx`)**: điều kiện chặn banner teal đổi thành `if (item.goalId) return null` — bỏ hẳn `isSavingsCategory`/`isLinkedCategory` khỏi điều kiện này (isSavingsCategory vẫn giữ nguyên, dùng riêng để quyết định hiện banner amber, không đụng gì). Category liên kết hay không không còn ảnh hưởng gì đến banner teal — đúng ý định gốc §1.9 mục 5.
- **Verify tĩnh**: `npx tsc --noEmit`: 29 lỗi, khớp baseline, 0 lỗi mới, không lỗi nào trong 2 file đã sửa. **CHƯA test runtime thật với Supabase** (sandbox không có mạng ra Supabase) — cần người yêu cầu tự test:
  1. Category liên kết goal Y, mô tả khớp tên 1 goal thủ công X khác đang active, KHÔNG chọn gì ở dropdown amber → banner teal PHẢI hiện, gợi ý hoàn thành X (khác hẳn kỳ vọng sai ở §1.18).
  2. Cùng dòng trên, nếu CHỌN 1 goal ở dropdown amber (kể cả chọn chính X hoặc goal khác Z) → banner teal PHẢI ẩn ngay (đã "thành" góp quỹ, loại trừ đúng).
  3. Bỏ chọn lại dropdown amber (về "-- Không tích lũy --") → banner teal PHẢI hiện lại.
  4. Bấm "Đánh dấu hoàn thành" ở banner teal → lưu → giao dịch vào sổ chi tiêu bình thường theo ĐÚNG category đã chọn (không bị ép thành transfer), goal X chuyển `completed_at`, vào danh sách "Đã hoàn thành".
  5. Test cả 2 nơi `SmartInput`/`AIAssistantBubble`.

### 1.20 T-S57 — Cho phép sửa liên kết category + khoảng ngày của goal đã liên kết (kể cả đổi loại liên kết ↔ thủ công) — CHỐT 11/08/2026 (thiết kế cho T-S57, chưa code)

- **Bối cảnh**: T-S48 (§1.13) chỉ cho TẠO goal liên kết 1 lần, không cho SỬA lại category/khoảng ngày đang liên kết, cũng không cho đổi qua lại giữa liên kết ↔ thủ công. Người dùng cần: (1) đổi sang category/ngân sách khác mà vẫn giữ tiến độ đã tích luỹ trước đó ("dồn tiếp"), (2) unlink về thủ công, (3) link 1 goal thủ công sẵn có sang category. Yêu cầu bắt buộc xuyên suốt: **không bao giờ mất trắng tiến độ**, **không bao giờ trừ tiền thật đúp lần 2**.
- **Vấn đề gốc phải giải quyết trước khi code (đã thảo luận kỹ với người yêu cầu)**: goal liên kết category CHI TIÊU và goal thủ công KHÔNG cùng bản chất dòng tiền — liên kết = tiền đã trừ thật rồi (category gốc đã ghi `type='expense'` thật), thủ công = tiền `transfer` nội bộ, CHƯA tiêu thật. Gộp chung 1 con số "dồn tiếp" duy nhất sẽ dẫn tới trừ tiền thật đúp lần 2 khi rút/hoàn thành. Phải tách riêng theo nguồn.
- **Schema mới (`saving_goals`, migration mới, KHÔNG ALTER ngầm)**:
  - `carried_over_saved_amount numeric not null default 0` — tổng dồn từ (các) giai đoạn TRƯỚC ĐÓ goal ở trạng thái THỦ CÔNG (tiền `transfer`, chưa tiêu thật, sau này rút được thật).
  - `carried_over_spent_amount numeric not null default 0` — tổng dồn từ (các) giai đoạn TRƯỚC ĐÓ goal đang LIÊN KẾT category (tiền đã là chi tiêu thật rồi, không rút được thật nữa, chỉ để theo dõi).
  - `linked_history jsonb not null default '[]'` — mảng snapshot từng giai đoạn liên kết đã KẾT THÚC (do đổi category khác hoặc unlink), mỗi phần tử: `{category_name, start_date, end_date, amount, ended_at}` — dùng để hiện lại chi tiết giai đoạn cũ trong modal "Lịch sử" (không chỉ 1 con số trần trụi), vì người dùng cần theo dõi lại đúng category/khoảng ngày nào đã đóng góp bao nhiêu, dù tiền đã trừ ở nơi khác.
- **Quy tắc chuyển đổi (áp dụng mọi lần sửa `linked_category_id`/`linked_start_date`/`linked_end_date` trên 1 goal ĐÃ TỒN TẠI, không áp cho lúc tạo mới)**:
  1. **Đổi sang category khác** (kể cả category mới tạo) trong khi đang liên kết: đóng băng tổng đang tính động từ category/khoảng ngày CŨ → cộng vào `carried_over_spent_amount` + append 1 snapshot vào `linked_history`. Áp category/khoảng ngày MỚI, từ đó tính động tiếp trên nguồn mới.
  2. **Chỉ đổi khoảng ngày, GIỮ NGUYÊN category**: KHÔNG dồn gì — tính lại toàn bộ theo khoảng ngày mới của đúng category đó (không có khái niệm "quỹ cũ/mới" vì cùng 1 nguồn, không mơ hồ).
  3. **Unlink (liên kết → thủ công)**: đóng băng tổng đang tính động → cộng vào `carried_over_spent_amount` + append snapshot vào `linked_history` (coi như 1 giai đoạn liên kết vừa kết thúc). `linked_category_id`/2 cột ngày về `null`. Nút "Đóng góp quỹ" (ẩn từ T-S48) hiện lại.
  4. **Link (thủ công → liên kết)**, kể cả lần link đầu hoặc re-link sau khi đã unlink: đóng băng `current_amount` thủ công đang có (xây từ các khoản `transfer` đã góp) → cộng vào `carried_over_saved_amount` (KHÔNG phải `carried_over_spent_amount`, vì đây là tiền CHƯA từng tiêu thật). Bắt buộc modal xác nhận trước khi lưu, hiện rõ số tiền sẽ dồn sang.
- **Công thức hiển thị "Tổng đã tích luỹ" (progress bar, badge)** — LUÔN đầy đủ, không phân biệt nguồn: `carried_over_saved_amount + carried_over_spent_amount + (tính động category hiện tại nếu đang liên kết, hoặc current_amount thủ công hiện tại nếu đang thủ công)`.
- **Công thức "Số dư khả dụng để rút thật"** (dùng ở T-S60, §1.21): `carried_over_saved_amount + current_amount thủ công hiện tại − tổng đã rút thật trước đó`. **KHÔNG bao gồm** `carried_over_spent_amount` và phần đang tính động khi đang liên kết (2 phần này đã là chi tiêu thật, không có gì để trừ thêm — xem §1.21 cách "rút" xử lý riêng 2 loại này).
- **KHÔNG đổi**: goal liên kết vẫn KHÔNG xuất hiện ở dropdown "Gắn vào mục tiêu" của 3 nơi nhập giao dịch (giữ nguyên §1.13); RLS/policy `saving_goals` không đổi (chỉ thêm cột).

#### 1.20.1 Tu chỉnh T-S61 — fix bug idempotency `update_goal_link` — CHỐT 11/08/2026

- **Bối cảnh**: test tay sau khi 0018 (T-S57) code xong phát hiện 3 bug cùng gốc rễ nằm trong chính thiết kế §1.20 gốc (không phải lỗi code lặt vặt): (1) **nhân tiền** — mỗi lần đổi liên kết/unlink, RPC luôn SUM lại TOÀN BỘ giao dịch khớp category+khoảng ngày rồi cộng thẳng vào `carried_over_spent_amount`, không kiểm tra đã từng cộng ở lần đóng băng trước hay chưa → link/unlink lặp lại cùng category ra số tiền nhân đôi/nhân ba dù không có giao dịch mới; (2) `linked_history` chỉ lưu 1 số tổng/giai đoạn, không lưu giao dịch gốc → modal "Lịch sử" không tách được dòng chi tiết; (3) giai đoạn "thủ công → liên kết" đóng băng `current_amount` vào `carried_over_saved_amount` nhưng không ghi snapshot gì → lịch sử góp thủ công cũ biến mất trắng khỏi modal dù giao dịch gốc còn nguyên trong DB.
- **Đối chiếu thị trường**: YNAB dùng nguyên tắc "mỗi khoản tiền chỉ tính đúng 1 lần trong toàn bộ vòng đời", tránh đếm lại refund khi tính target — đúng pattern "period close" chuẩn trong kế toán/ledger (sổ đã chốt kỳ chỉ cộng phát sinh mới) mà thiết kế §1.20 gốc đang vi phạm.
- **Giải pháp CHỐT (1 cơ chế chung cho cả 3 bug)** — nguồn sự thật chống đếm đúp là **ID giao dịch cụ thể**, không phải tổng tiền theo category/khoảng ngày:
  1. Thêm cột `saving_goals.carried_over_transaction_ids uuid[] not null default '{}'` — lưu ID mọi giao dịch gốc (expense category liên kết HOẶC transfer thủ công) đã từng được cộng vào `carried_over_saved_amount`/`carried_over_spent_amount` ở BẤT KỲ lần đóng băng nào trước đó của goal này.
  2. Mỗi lần đóng băng (đổi category / unlink / thủ công → liên kết): chỉ `SUM` những giao dịch **CHƯA có ID** trong `carried_over_transaction_ids`, rồi mới nối thêm ID chúng vào mảng đó. Nếu không có giao dịch mới nào (mọi ID đã có sẵn) → **không** tạo dòng `linked_history` rác mới, không cộng thêm gì.
  3. `linked_history` mỗi phần tử mở rộng thêm `type: "linked" | "manual"` + `transactions_snapshot: [{id, description, date, amount}]` — snapshot BẤT BIẾN tại thời điểm đóng băng, dùng để modal "Lịch sử" hiện lại chi tiết từng giao dịch của giai đoạn cũ (không chỉ 1 con số trần trụi như thiết kế gốc §1.20 đã định nhưng bị bỏ sót lúc code 0018). Case "manual" (thủ công → liên kết) giờ cũng snapshot đúng các giao dịch transfer đã góp, cùng cơ chế dedup ID.
  4. Phần tử `linked_history` ghi TRƯỚC T-S61 (bởi RPC 0018) thiếu `type`/`transactions_snapshot` — client (`mapRows.ts`) mặc định `type: "linked"`, `transactionsSnapshot: []` khi đọc, không migrate dữ liệu cũ.
- **Sửa hiển thị đi kèm (không đổi schema)**: dòng "Tổng" ở chân modal "Lịch sử" trước đây tính bằng `historyContributions.reduce(...)` (chỉ cộng phần "đang sống"), luôn lệch với "Đã có" ở thẻ ngoài — đổi sang gọi thẳng `goalCurrentAmount()` (hàm đã có sẵn, đúng công thức §1.20).
- **Việc còn treo (KHÔNG tự ý làm — ASK FIRST)**: dữ liệu goal đã bị nhân tiền THẬT SỰ trên project (RPC 0018 chạy trước khi có fix T-S61) cần 1 script rà soát/sửa riêng (`fix_and_audit_goal_link_duplication.sql`, tương tự mẫu `fix_and_audit_goal_drift.sql` đã có) — CHƯA viết, chờ người yêu cầu xác nhận có muốn chạy hay để nguyên và chỉ chặn bug từ nay về sau.
- **Quy tắc bắt buộc rút ra (áp dụng cho MỌI thiết kế "đóng băng số dư/cộng dồn" tương lai, không riêng goal)**: bất kỳ cơ chế nào cộng dồn 1 tổng bằng cách `SUM` lại theo điều kiện có thể lặp lại (category, khoảng ngày, trạng thái...) — thay vì theo 1 tập ID cụ thể đã xử lý — đều tiềm ẩn đếm đúp khi hành động có thể lặp lại (link/unlink, undo/redo, retry...). Bắt buộc thiết kế theo "idempotency key"/ID tập giao dịch đã xử lý ngay từ đầu, không chờ bug thật mới thêm.

#### 1.20.2 Tu chỉnh T-S62 — dedup theo ID chưa áp cho phần "đang sống" (chỉ mới áp cho phần "đóng băng") — CHỐT 12/08/2026

- **Bối cảnh**: sau khi chạy migration `0019` (T-S61) trên project thật, người yêu cầu test tay qua 8 ảnh chụp UI (link → unlink → link lại cùng category "test nè") phát hiện: bước ĐÓNG BĂNG đã idempotent đúng (unlink lặp lại không cộng đúp `carried_over_spent_amount` nữa), NHƯNG số hiển thị vẫn nhảy lên gấp đôi (23.000đ → 46.000đ) mỗi khi LINK LẠI. Trace ra: `linkedAmountByGoal`/`linkedHistoryByGoal` (phần "đang sống", `SavingGoals.tsx`) và `contributionsByGoal` (phần "đang sống" của goal thủ công) vẫn `SUM` lại MỌI giao dịch khớp category+khoảng ngày (hoặc `goal_id`+`type='transfer'`) như cũ, KHÔNG loại trừ giao dịch đã có ID trong `carried_over_transaction_ids` — quy tắc idempotency-key đã chốt ở §1.20.1 mới chỉ áp dụng cho phía RPC (đóng băng), bị bỏ sót ở phía client (tính động). Khi 1 giao dịch cũ (đã đóng băng ở lần trước) vẫn rơi vào category/khoảng ngày hiện tại (đổi ngày chồng lấp, hoặc link lại đúng category cũ) → bị cộng đúp: 1 lần trong `carried_over_spent_amount`/`carried_over_saved_amount`, 1 lần ở phần "đang sống". Modal "Lịch sử" cũng lộ đúng bug này — cùng 1 giao dịch hiện ra 2 lần (1 lần trong snapshot đã đóng băng, 1 lần trong danh sách đang sống).
- **Giải pháp CHỐT (thuần client, không đổi schema/RPC — `carried_over_transaction_ids` đã có sẵn từ 0019, chỉ cần map + lọc)**:
  1. Map `row.carried_over_transaction_ids` sang `SavingGoal.carriedOverTransactionIds` (`types.ts`, `mapRows.ts`) — trước đây cột này tồn tại ở DB nhưng CHƯA hề được đưa sang client.
  2. Mọi phép tính "đang sống" (`linkedAmountByGoal`/`linkedHistoryByGoal` cho goal liên kết, `contributionsByGoal` cho goal thủ công) loại trừ giao dịch có ID nằm trong `carriedOverTransactionIds` của ĐÚNG goal đó trước khi cộng/hiện.
- **Quy tắc bắt buộc rút ra (bổ sung cho quy tắc ở §1.20.1)**: nguyên tắc "idempotency key/ID tập giao dịch đã xử lý" phải áp dụng ĐỒNG BỘ ở MỌI nơi tính tổng liên quan đến cùng 1 luồng tiền — không chỉ ở bước ghi (đóng băng), mà cả ở bước đọc/tính động (đang sống). Sửa 1 phía mà bỏ sót phía kia vẫn cho ra bug đếm đúp y hệt, chỉ khác biểu hiện bề mặt (bug cũ: cộng đúp lúc đóng băng; bug T-S62: cộng đúp lúc link lại).

### 1.21 T-S60 — "Rút quỹ" nhiều lần thay cho "Hoàn thành" 1 lần duy nhất — CHỐT 11/08/2026 (thiết kế cho T-S60, phụ thuộc T-S57, chưa code)

- **Bối cảnh**: nút "Hoàn thành" gốc (T-S19, §1.9) là hành động ĐÓNG 1 LẦN DUY NHẤT, không cho rút từng phần, không cho ghi chú mục đích từng lần rút, không phù hợp use-case theo dõi 1 quỹ tích luỹ nhiều tháng rồi rút dần. Thay bằng "Rút quỹ" — hành động lặp lại được, goal vẫn sống tiếp sau khi rút (trừ khi người dùng chủ động tick đóng).
- **Form "Rút quỹ"**: số tiền rút (mặc định gợi ý = toàn bộ, tự sửa được), **bắt buộc chọn nguồn rút nếu goal có cả 2 loại số dư** (phương án A đã chốt — không tự đoán hộ):
  - **"Rút từ phần liên kết"** (áp dụng cho `carried_over_spent_amount` VÀ phần đang tính động nếu đang liên kết — cả 2 đều là tiền đã chi tiêu thật rồi): **KHÔNG tạo giao dịch `transactions` mới** (tránh trừ đúp) — chỉ ghi **1 dòng log vào lịch sử của goal** (số tiền, ghi chú mục đích, thời điểm) để người dùng theo dõi lại dòng tiền của quỹ "ngoài đời" (ví dụ ví tiết kiệm riêng ngoài hệ thống) dù bản thân hệ thống không di chuyển tiền gì thêm.
  - **"Rút từ phần thủ công"** (áp dụng cho `carried_over_saved_amount` + `current_amount` thủ công — tiền `transfer`, CHƯA từng là chi tiêu thật): tạo **1 giao dịch `expense` thật** (trừ tiền thật lần đầu tiên, gắn `goal_id` làm metadata tra cứu, bắt chọn category thật + ghi chú mục đích).
  - Checkbox **"Đóng mục tiêu sau khi rút"** — tick tự do, không bắt buộc rút hết mới đóng được và ngược lại.
- **Trường hợp KHÔNG còn phần thủ công để rút** (đã rút hết, hoặc goal thuần liên kết không có tí thủ công nào): form "Rút quỹ" khi chọn nguồn liên kết vẫn hoạt động như trên (ghi log, không giao dịch); nếu người dùng chỉ muốn đóng mà không ghi thêm gì, cho phép tick "Đóng mục tiêu" mà không bắt buộc nhập số tiền rút.
- **Modal "Lịch sử" (T-S56) hiện đủ 3 loại dòng theo mốc thời gian, có nhãn phân biệt rõ**:
  1. Giai đoạn liên kết đã kết thúc (từ `linked_history`, §1.20) — chỉ đọc.
  2. Góp quỹ thủ công (`transfer`, +) — như cũ.
  3. Rút quỹ — cả loại "ghi log" (nguồn liên kết) và loại "giao dịch thật" (nguồn thủ công), đều hiện ghi chú mục đích.
- **Lưu trữ log rút nguồn liên kết**: KHÔNG cần bảng mới — thêm vào cùng cơ chế `linked_history` (§1.20) 1 loại phần tử riêng (`type: "withdrawal_log"`) hoặc 1 cột jsonb riêng `linked_withdrawal_log` (quyết định cụ thể lúc code, ưu tiên đơn giản nhất, không thêm bảng).

#### 1.21.2 T-S74 — GỠ chặn cứng T-S67b khỏi luồng "hoàn thành qua giao dịch mua thật" — CHỐT 13/08/2026 (sửa lại T-S67b, phân biệt rạch ròi với T-S66)

- **Bối cảnh**: T-S67b (§1.21.1 patch trước) áp `goalManualAvailable()` làm điều kiện CHẶN CỨNG cho banner tự động hoàn thành goal ở `SmartInput.tsx`/`AIAssistantBubble.tsx`. Test tay 13/08/2026 (9 ảnh) phát hiện: goal "mua xịt" đã đạt 100% mục tiêu (150.000/150.000đ) vẫn bị chặn không cho ghi giao dịch chi 150.000đ, báo sai "vượt quá số dư khả dụng (còn 145.000đ)" — so sánh nhầm với số dư THỦ CÔNG còn lại (đã trừ phần liên kết 5.000đ) thay vì TỔNG đã tích luỹ.
- **Phân biệt bản chất tài chính 2 luồng** (nhầm lẫn gốc rễ của T-S67b):
  1. **"Rút quỹ"** (T-S60/T-S66, `SavingGoals.tsx`) = rút tiền ĐÃ ĐỂ DÀNH ra khỏi 1 số dư app đang tự theo dõi → đúng đắn PHẢI chặn cứng không cho rút quá số dư có thật (giống nghiệp vụ rút tiền chuẩn mọi app tài chính). **KHÔNG đổi** ở patch này.
  2. **"Hoàn thành qua giao dịch mua thật"** (SmartInput/Bubble tự phát hiện tên khớp goal, gốc T-S34) = ghi lại 1 khoản ĐÃ CHI THẬT ngoài đời, số tiền độc lập hoàn toàn với số đã để dành trong app — không "rút" từ đâu cả. Ứng dụng tài chính không được từ chối ghi nhận 1 khoản chi đã xảy ra thật chỉ vì "chưa để dành đủ" — đó chính xác là lý do badge "Dư/Thiếu" (T-S64b) tồn tại. Chặn cứng ở đây triệt tiêu ý nghĩa của chính badge đó, và đi ngược hành vi gốc T-S34 (chưa từng chặn).
- **Không có rủi ro double-count**: `manualWithdrawnTotal`/`goalManualAvailable` chỉ cộng dồn giao dịch `type=expense`+`goal_id` do CHÍNH luồng completion tạo — tách biệt hoàn toàn với `carried_over_spent_amount`/`linked_history` (dữ liệu phần liên kết, đã tính 1 lần lúc phát sinh). Ghi thêm 1 giao dịch mua thật hôm nay không đụng phần liên kết đã ghi trước đó — 2 sự kiện chi tiêu thật độc lập, cộng dồn đúng.
- **Sửa (`SmartInput.tsx` dòng ~368-391, `AIAssistantBubble.tsx` dòng ~446-465)**: bỏ `return` sớm/khoá nút khi `amount > goalManualAvailable(...)` — luôn cho lưu đúng số tiền nhập, đóng goal qua `performGoalPurchaseTransaction` (không cắt bớt, không cộng thêm phần liên kết vì phần đó đã tính là chi thật riêng). Thay bằng CẢNH BÁO MỀM không chặn: banner amber ở `SmartInput.tsx` (không gate theo `isReviewMode` — vẫn hiện sau khi lưu xong vì là thông tin kết quả, không phải lỗi cần sửa trước khi lưu), tin nhắn bot ở `AIAssistantBubble.tsx`.
- **KHÔNG thêm ngưỡng chặn mới nào khác** (đã cân nhắc và loại bỏ ở vòng thảo luận trước): không chặn theo `goalCurrentAmount < targetAmount` (goal chưa đạt mục tiêu) — đời thực người dùng hoàn toàn có thể mua trước khi để dành đủ, đó là trường hợp "Thiếu" hợp lệ theo đúng thiết kế gốc T-S34, không phải lỗi cần ngăn.
- **Không đổi**: chặn cứng T-S66 ở form "Rút quỹ" (`SavingGoals.tsx`) — đúng ngữ cảnh, giữ nguyên.
- **Khoảng trống đã biết, CHƯA thuộc phạm vi T-S74**: tab "Sổ Giao Dịch" (`TransactionHistory.tsx`) hiện KHÔNG có cơ chế tự phát hiện tên khớp goal + banner hoàn thành như SmartInput/Bubble — chọn goal ở đó chỉ tạo giao dịch góp quỹ (`transfer`) bình thường, không phải luồng "mua thật". Xác nhận qua trao đổi 13/08/2026: đây là gap tính năng riêng (chưa có task ID), không phải 1 trong 3 luồng bị ảnh hưởng bởi bug T-S67b/T-S74.

#### 1.21.1 T-S68/T-S69 — SỬA LẠI §1.21 gốc: "rút liên kết" có giới hạn thật + cascade sang nguồn còn lại — CHỐT 12/08/2026 (người yêu cầu xác nhận qua test tay sau T-S67b)

- **Bối cảnh**: test tay xác nhận 2 khoảng trống thật trong chính thiết kế §1.21 gốc (không phải lỗi code lặt vặt): (1) "rút từ phần liên kết" chỉ ghi log, KHÔNG trừ gì ở bất kỳ đâu → `goalLinkedAvailable()` không bao giờ giảm, `goalCurrentAmount()` không bao giờ đổi dù rút bao nhiêu lần — **rút vô hạn được**; (2) form rút ở goal gộp 2 nguồn (T-S66) chặn cứng ngay khi nguồn ĐÃ CHỌN không đủ, dù nguồn còn lại vẫn còn dư — trải nghiệm không đúng ý người dùng (goal gộp chỉ khác nhau ở "dòng tiền" — linked đã tiêu thật ở ngoài/manual còn nằm trong hệ thống — không phải 2 quỹ tách biệt).
- **Sửa §1.21 mục "Rút từ phần liên kết"**: KHÔNG còn "không bao giờ trừ gì thêm" — nay TRỪ vào `linkedWithdrawnTotal` (tổng các phần tử `type: "withdrawal_log"` trong `linked_history`, dữ liệu đã có sẵn từ T-S60/migration 0021, KHÔNG cần migration mới) ở CẢ 2 nơi: `goalCurrentAmount()` (hiển thị "Đã có") và `goalLinkedAvailable()` (số dư khả dụng để validate) — đối xứng hoàn toàn với cách phần thủ công đã hoạt động. Rút hết → không rút thêm được nữa (giống manual).
- **Sửa T-S66 (chặn cứng đơn nguồn) → cascade**: khi số tiền rút vượt số dư của nguồn ĐÃ CHỌN, KHÔNG chặn ngay — rút hết phần có ở nguồn chính, phần thiếu tự động lấy tiếp từ nguồn còn lại (kèm dòng xem trước "sẽ tự rút thêm X từ nguồn Y" trong form trước khi xác nhận). **CHỈ chặn khi CẢ 2 nguồn cộng lại vẫn không đủ** — báo rõ tổng khả dụng thật của cả 2 nguồn.
- **Category cho phần cascade**: khi phần "thủ công" xuất hiện trong giao dịch rút — dù là nguồn CHÍNH người dùng tự chọn, hay là nguồn PHỤ do cascade từ liên kết tràn sang — form BẮT BUỘC hiện ô chọn category riêng cho khoản đó (dùng chung 1 ô `withdrawCatName` có sẵn, chỉ đổi điều kiện hiện ra). Phần "liên kết" (dù chính hay cascade) không cần category (chỉ ghi log).
- **Không đổi schema**: cả 2 sửa trên đọc/ghi đúng cột `linked_history` đã có sẵn từ 0018/0019/0021 — không thêm migration.

### 1.26 Hệ thống thiết kế Dark Mode — token ngữ nghĩa dùng chung — CHỐT 18/08/2026 (T-S99, thay thế cách làm ad-hoc trước đó)

- **Vấn đề gốc (người dùng phản ánh trực tiếp)**: dark mode trước T-S99 chỉ toggle class `.dark` trên `<html>` + đúng 2 file (`App.tsx`, `NotificationBell.tsx`) có vài class `dark:` rải rác cho nền/viền ngoài cùng — **9/11 component nghiệp vụ còn lại (`BudgetLimits`, `FinancialDashboard`, `SmartInput`, `TransactionHistory`, `SavingGoals`, `SmartAllocator`, `HouseholdManagement`, `AuthAndTelegram`, `AIAssistantBubble`, `IconPicker`) có ĐÚNG 0 (không) class `dark:` nào` (xác nhận qua `grep -c "dark:"` từng file = 0). Hệ quả: bật dark mode → nền ngoài cùng chuyển đen nhưng mọi card/input/badge/chữ bên trong các tab (Ngân Sách, Sổ Giao Dịch, Tích Lũy, Nhập Liệu AI, Hộ Gia Đình, Smart Advisor...) vẫn giữ nguyên nền trắng/chữ tối màu light-mode — đúng hiện tượng "chỉ chuyển xung quanh thành đen, các thông số/thành phần khó nhìn, gần như không phải dark mode" người dùng mô tả.
- **Nghiên cứu tham khảo phối màu** (không copy nguyên xi 1 app, chọn lọc nguyên tắc phù hợp quy mô ứng dụng cá nhân/hộ gia đình):
  - **GitHub Dark Dimmed**: nền canvas `#0d1117` — KHÔNG dùng đen tuyệt đối (`#000`) hay `slate-950` mặc định Tailwind (quá gắt, gây chói/mỏi mắt khi nhìn lâu, đặc biệt màn OLED). Chữ chính dùng xám rất sáng (`#e6edf3`), không phải trắng tuyệt đối — giảm độ tương phản gắt.
  - **Linear**: phân lớp bề mặt (canvas → surface → surface nâng cao) bằng ĐỘ SÁNG tăng dần thay vì đổ bóng đậm, viền mảnh 1px màu trung tính thay cho shadow nặng nề — tạo cảm giác "phẳng, hiện đại" thay vì "hộp nổi" kiểu Bootstrap cũ.
  - **Vercel**: bảng màu trung tính gần như không sắc (near-neutral gray, không ngả xanh/tím quá đậm như nhiều app khác), accent màu chỉ xuất hiện đúng ở điểm cần nhấn (nút hành động, badge trạng thái).
  - **Discord**: khẳng định lại nguyên tắc "không dùng trắng/đen tuyệt đối cho text/bg chính" — đúng khuyến nghị WCAG cho nền tối (tương phản quá cao gây mỏi mắt ngang với tương phản quá thấp).
  - **Money Lover/Spendee** (app tài chính cá nhân cùng phân khúc, đã tham khảo trước đó ở §1.5/§1.9): không có gợi ý riêng gì thêm cho dark mode ngoài nguyên tắc chung ở trên — 2 app này chủ yếu dùng light mode làm mặc định, dark mode chỉ đổi nền/chữ mà giữ nguyên hệ màu accent bán chi tiêu/thu nhập (đỏ/xanh lá) — khớp đúng hướng "giữ nguyên màu accent bão hoà cao, chỉ đổi nền/viền/chữ trung tính" đã chọn ở đây.
- **Quyết định kiến trúc (khác hẳn cách làm cũ)**: thay vì viết `dark:bg-slate-900 dark:text-slate-100` lặp lại thủ công ở từng chỗ trong từng component (tốn công, dễ sót, không nhất quán giữa các file — đúng nguyên nhân gốc của vấn đề), định nghĩa **1 bộ CSS custom properties (token ngữ nghĩa)** trong `src/index.css` (`:root` cho light, `.dark` cho dark — đã có sẵn cơ chế `@custom-variant dark` từ trước, không đổi). Component dùng token qua cú pháp Tailwind v4 `bg-(--sst-surface)` thay vì literal `bg-white` — đổi `.dark` trên `<html>` tự động đổi GIÁ TRỊ token, không cần viết cặp light/dark riêng ở từng nơi.
- **Bảng token đầy đủ** (giá trị chính xác + comment hướng dẫn dùng ở đâu — xem trực tiếp `src/index.css`, không chép lại số hex ở đây để tránh 2 nguồn dễ lệch nhau khi chỉnh sau này): `--sst-canvas`, `--sst-surface`, `--sst-surface-2`, `--sst-surface-hover`, `--sst-border`, `--sst-border-strong`, `--sst-text`, `--sst-text-secondary`, `--sst-text-muted`, `--sst-text-faint`, `--sst-shadow`.
- **Badge/banner màu (accent tint — bg-amber-50 text-amber-700 kiểu cũ) KHÔNG dùng token trên** (cố tình, không phải thiếu sót) — vì cần giữ đúng sắc thái ngữ nghĩa theo từng ngữ cảnh (amber=cảnh báo, rose=nguy hiểm/xoá, emerald=thành công, indigo=thông tin/nhấn mạnh...). Áp dụng 1 "công thức" cố định thay vào đó, LUÔN đi kèm nhau: `dark:bg-{color}-500/10 dark:text-{color}-300 dark:border-{color}-500/25` (nền accent rất mờ 10% opacity, chữ accent sáng vừa đủ tương phản, viền accent mờ 25%) — KHÔNG dùng `{color}-50/-700/-200` nguyên xi của light mode cho dark (quá chói/thiếu tương phản trên nền tối). Nút solid accent (`bg-indigo-600` kiểu cũ) giữ nguyên không cần biến thể riêng — màu bão hoà cao đọc tốt trên cả 2 nền.
- **Đã áp dụng xong (T-S99)**: `src/index.css` (định nghĩa token + comment hướng dẫn đầy đủ), `App.tsx` (toàn bộ header/nav/dropdown/footer/màn hình đăng nhập — 49 điểm sửa), `NotificationBell.tsx` (nút chuông + toàn bộ panel dropdown — 12 điểm sửa, trước đó panel bên trong 100% chưa có dark mode dù nút toggle đã có). `npx tsc --noEmit`: không phát sinh lỗi mới ở 2 file này (38 lỗi hiện tại đều thuộc baseline RPC-typing đã ghi nhận nhiều lần, không liên quan thay đổi này).
- **CHƯA áp dụng — 9 component còn lại, tách thành các task riêng T-S100 trở đi (xem TASKS.md)**: mỗi component 1 task độc lập (đúng nguyên tắc "1 task = 1 context window", các file này 567-2353 dòng, gộp chung sẽ quá lớn để verify chắc chắn trong 1 lượt). Mỗi task PHẢI tuân đúng "12 quy tắc bắt buộc" đã ghi chi tiết trong comment đầu `src/index.css` (bảng ánh xạ token cho từng loại phần tử UI) — không tự nghĩ ra cách phối màu riêng cho từng component, tránh lặp lại đúng vấn đề gốc (không nhất quán giữa các phần của app).
- **CHƯA test UI thật với trình duyệt** (sandbox không có UI runtime) — cần người yêu cầu tự chạy `npm run dev`, bật dark mode, xác nhận: header/nav/dropdown tài khoản/chuông thông báo/màn hình đăng nhập đọc được rõ ràng, tương phản đủ, không còn mảng trắng/đen chói; các tab CHƯA làm (Ngân Sách, Sổ Giao Dịch...) vẫn hiển thị y hệt light mode kể cả khi bật dark (đúng kỳ vọng — chưa migrate, KHÔNG phải bug) cho tới khi từng task T-S100+ hoàn tất.
- **[Bổ sung 19/08/2026, sau bug thật ở T-S102, xem CHANGELOG "hàng đang chọn/đang sửa chói mắt"]** Khi ghép `dark:` vào 1 class ĐÃ có sẵn opacity suffix riêng (`bg-indigo-50/40`, `border-indigo-100/60`...), PHẢI chèn class `dark:` MỚI vào SAU toàn bộ token gốc (kể cả `/NN` đã có) — không chèn ngay sau số shade (`bg-indigo-50` + `dark:...` + `/40` còn sót lại) vì Tailwind KHÔNG hỗ trợ 2 modifier `/NN` trên cùng 1 utility (`dark:bg-indigo-500/10/40` bị bỏ qua hoàn toàn khi biên dịch — không lỗi build, không cảnh báo, chỉ lặng lẽ mất tác dụng, đúng dạng bug khó phát hiện qua `tsc`/`vite build`, chỉ lộ ra khi nhìn UI thật). Trước khi thêm `dark:` cho bất kỳ class nào (thủ công hay qua script) ở các task T-S103 trở đi, PHẢI kiểm tra class gốc có `/NN` sẵn hay không; nếu có, đặt `dark:` là 1 token riêng biệt đặt SAU class gốc đầy đủ (gồm cả `/NN`), ví dụ đúng: `bg-indigo-50/40 dark:bg-indigo-500/10`; sai: `bg-indigo-50 dark:bg-indigo-500/10/40`.

## 5. Ranh giới hành động (bảng 3 tầng)

| Luôn được làm (không cần hỏi)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Hỏi trước khi làm                                                                                                                            | Không bao giờ làm                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Viết/sửa RPC, RLS policy đúng mẫu §3                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Đổi cấu trúc bảng đã chốt ở §2 (thêm cột lớn, đổi kiểu dữ liệu)                                                                              | Lưu mật khẩu ngoài Supabase Auth                                                                                                                                                                                                                                                                                            |
| Thêm index, viết test cho RPC                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | —                                                                                                                                            | Cho phép UPDATE trực tiếp `household_id`/`household_role` từ client                                                                                                                                                                                                                                                         |
| **Quy tắc bắt buộc (thêm 18/08/2026, sau khi T-S12 phát hiện + vá lỗ hổng thật — xem CHANGELOG "T-S12 — VERIFY THẬT")**: bất kỳ cột nào trên bất kỳ bảng nào được coi là "bất biến từ client" (chỉ đổi qua RPC `security definer`) PHẢI được enforce bằng `REVOKE UPDATE(...)`/`GRANT UPDATE(...)` theo cột ở tầng DB THẬT SỰ (không chỉ dựa vào việc loại field đó khỏi `Update` type trong `database.types.ts`) — comment TypeScript không chặn được request raw/client bị sửa dùng cùng anon key. Khi thêm 1 cột "bất biến" mới (theo đúng tinh thần §1.2/§1.8/§1.10 đã áp dụng cho `member_id`/`type`/snapshot fields), PHẢI tự hỏi: cột này đã có GRANT/REVOKE hay trigger canh giữ thật ở DB chưa, hay mới chỉ có ở TS type — nếu chỉ có ở TS, đó là 1 lỗ hổng tiềm ẩn giống hệt T-S12, cần vá ngay khi phát hiện, không đợi review cuối kỳ.                                                                              | —                                                                                                                                            | Chỉ dựa vào `Update` type (TypeScript) làm hàng rào bảo vệ DUY NHẤT cho 1 cột được coi là "bất biến từ client" — phải luôn có GRANT/REVOKE hoặc trigger THẬT ở tầng DB đi kèm                                                                                                                                                         |
| Implement RPC link/unlink Telegram theo mẫu §4 (đã locked)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | —                                                                                                                                            | Gán `telegram_chat_id` cho 2 profile khác nhau cùng lúc (bỏ qua bước gỡ liên kết cũ)                                                                                                                                                                                                                                        |
| **Quy tắc bắt buộc**: mọi helper function RLS truy vấn ngược lại chính bảng đang áp policy (vd `profiles` tự query `profiles`) PHẢI khai báo `security definer set search_path = public` để bypass RLS nội bộ, tránh đệ quy vô hạn (bug thật gặp ở T-S02, xem CHANGELOG)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | —                                                                                                                                            | Viết policy có subquery trực tiếp vào bảng đang tự áp policy đó mà không qua hàm `security definer`                                                                                                                                                                                                                         |
| **Quy tắc bắt buộc**: không dùng `for all` cho policy ghi khi bảng có policy đọc riêng lọc theo điều kiện (vd `deleted_at is null`) — `for all` cấp quyền SELECT ngầm, permissive policies ghép bằng OR sẽ đè lên bộ lọc của policy đọc chính (bug thật gặp ở T-S02: chủ hộ nhìn thấy giao dịch đã soft-delete qua policy `for all` không lọc `deleted_at`). Luôn tách `for insert` / `for update` riêng                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | —                                                                                                                                            | Dùng `for all` cho bất kỳ policy ghi nào trên bảng có cột `deleted_at`                                                                                                                                                                                                                                                      |
| Refactor component gọi thẳng `fetch`/`localStorage` sang service layer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Xoá bất kỳ tính năng hiện có mà chưa xác nhận không có giải pháp Supabase free thay thế                                                      | Bật RLS `using (true)` "tạm thời" rồi quên siết lại                                                                                                                                                                                                                                                                         |
| **[Mới — §1.26/T-S99, 18/08/2026]** Thêm dark mode cho 1 component: dùng ĐÚNG token `--sst-*` (`src/index.css`) theo bảng 12 quy tắc đã ghi trong comment đầu file đó cho nền/viền/chữ trung tính, dùng công thức `dark:bg-{color}-500/10 dark:text-{color}-300 dark:border-{color}-500/25` cho MỌI badge/banner màu (amber/rose/emerald/indigo/purple/cyan/blue) — không tự sáng tạo cách phối màu riêng, không dùng lại `dark:bg-slate-800/900` literal như cách làm cũ trước T-S99 (đã bị thay thế)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Rải `dark:bg-slate-900`/`dark:text-slate-100`/... literal lặp lại thủ công thay vì dùng token `--sst-*` đã có sẵn — vừa không nhất quán giữa các component, vừa khó chỉnh sửa hệ màu sau này (phải sửa từng chỗ thay vì sửa 1 nơi ở `index.css`)                                                                                                                                                                                         |
| Viết migration SQL cho 1 task cụ thể trong TASKS.md                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Đổi mô hình phân quyền §3 (ai được sửa gì)                                                                                                   | Tự ý xoá `deleted_at` filter khỏi SELECT policy                                                                                                                                                                                                                                                                             |
| Hiện banner gợi ý/xác nhận dựa trên suy luận tên gọi, keyword (đúng mẫu đã có ở `isSavingsContribution`/§1.9 T-S20)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | —                                                                                                                                            | Tự động đổi trạng thái/dữ liệu tài chính đã có (khoá goal, gắn `goal_id`, set `completed_at`, cộng/trừ tiền) chỉ dựa trên suy luận (keyword/tên trùng) mà KHÔNG qua xác nhận rõ ràng của người dùng — mọi suy luận tự động BẮT BUỘC dừng ở mức gợi ý/banner, hành động thật chỉ chạy sau khi người dùng bấm xác nhận (§1.9) |
| **[Mới — §1.27, 22/08/2026, CHỐT sau audit UI/UX toàn hệ thống]** Điều hướng giữa 7 tab (`App.tsx`, `activeTab: AppTab`) trước giờ CHỈ là state nội bộ (`useState`), KHÔNG đồng bộ với URL — không router, F5 luôn về Dashboard, back/forward trình duyệt không hoạt động, không chia sẻ/bookmark được link tới 1 tab. **QUYẾT ĐỊNH (Phương án B, đã xác nhận với người yêu cầu)**: đồng bộ 1 chiều `activeTab` ↔ `URLSearchParams` bằng API trình duyệt có sẵn (`history.pushState`/`popstate`), KHÔNG cài `react-router-dom` — lý do đã chốt: quy mô 3–10 người dùng thật, dự án được xem là giai đoạn kiểm chứng logic tài chính trước khi làm lại 1 dự án khác chuẩn chỉnh hơn, nên KHÔNG đầu tư refactor kiến trúc lớn (route-based code-splitting, nested routes) cho bản này — chỉ vá đúng nỗi đau thật (mất tab khi F5). Xem TASKS.md T-S123. Cùng đợt, ghi nhận danh sách vấn đề UI/UX audit toàn hệ thống (T-S124 đến T-S130) — TẤT CẢ đều ⚪ chưa code, chờ người yêu cầu chọn ưu tiên trước khi bắt đầu Phase 2 cho từng task, đúng quy trình 1 task/1 context. | Nâng cấp sau này lên `react-router-dom` full (route-based code-splitting, nested routes, deep-link chuẩn) — ĐÃ CÂN NHẮC, chủ động KHÔNG chọn cho bản hiện tại, chỉ áp dụng nếu/khi dự án chuyển sang giai đoạn "làm lại chuẩn chỉnh" như người yêu cầu đã nêu | Coi việc thêm `URLSearchParams` sync là lý do để bắt đầu refactor kiến trúc điều hướng rộng hơn phạm vi task T-S123 (vd tách route component, đổi cấu trúc `App.tsx`) mà chưa hỏi lại |
| Chặn cứng (banner đỏ + khoá nút Lưu) khi tạo giao dịch mới khớp `isSavingsRelated` (§1.12) mà thiếu `goalId`, ở cả tầng UI lẫn `buildTransactionInsert` — **[LỊCH SỬ, xem §1.14/T-S49: cơ chế này bị THAY THẾ bằng gợi ý mềm cho category chưa liên kết goal T-S48, hàng giữ lại làm lịch sử quyết định T-S45/T-S47]**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Mở rộng quy tắc §1.12 sang chặn/cảnh báo ở form SỬA giao dịch (đổi category sang nhóm Tiết kiệm lúc sửa) — khoảng trống đã biết, ghi ở T-S45 | Tự ý CHỌN HỘ 1 goal cụ thể cho dòng thiếu goal (khác với việc chặn không cho lưu) — người dùng luôn phải tự chọn                                                                                                                                                                                                            |
| **[Mới — §1.14/T-S49]** Hiện banner MỀM (amber, không khoá nút) khi mô tả/ghi chú khớp TÊN 1 goal thủ công đang active (không phải category đã liên kết §1.13, không phải từ khoá chung); có nút "+ Tạo mục tiêu mới" ngay trong banner                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | —                                                                                                                                            | Tự động chọn hộ 1 goal cụ thể cho dòng khớp tên (khác GỢI Ý — người dùng luôn tự bấm chọn); tự động tạo goal mới mà không qua xác nhận bấm nút của người dùng                                                                                                                                                               |
| **[Mới — §1.15/T-S50]** Tính hiển thị "Số dư luỹ kế" bằng tổng hợp client-side từ transactions qua txClassify.ts, không lưu cứng                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Xác nhận mốc bắt đầu tính (toàn bộ lịch sử hay mốc khác) trước khi code T-S50 — xem PRD.md "Rủi ro"                                          | Tạo bất kỳ giao dịch/bản ghi nào để "chuyển số dư" giữa các tháng                                                                                                                                                                                                                                                           |
| **Quy tắc bắt buộc** (bug thật gặp 2 lần — categories ở `0005`, transactions ở `0006`, xem CHANGELOG): mọi RPC UPDATE 1 cột nằm trong chính SELECT policy của bảng đó (điển hình: soft-delete đổi `deleted_at` khi SELECT policy lọc `deleted_at is null`) BẮT BUỘC dùng `security definer` + tự kiểm tra quyền thủ công (lặp lại đúng điều kiện policy UPDATE đã CHỐT ở §3, không nới thêm quyền) — Postgres luôn yêu cầu dòng kết quả UPDATE thoả SELECT policy cả trước lẫn sau, không có cách tắt ở tầng policy thường, và `security invoker` (dù không RETURNING) KHÔNG tránh được lỗi này. Áp dụng cho MỌI bảng có `deleted_at` — khi thêm bảng mới hoặc RPC soft-delete mới (vd `delete_goal` ở T-S05b), kiểm tra chéo lại đúng pattern này ngay từ lần viết đầu, không chờ test fail mới sửa                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | —                                                                                                                                            | Viết RPC soft-delete/restore mới bằng `security invoker` cho bảng có `deleted_at` trong SELECT policy                                                                                                                                                                                                                       |
| **Quy tắc bắt buộc** (bug thật báo qua ảnh chụp UI 08/08/2026, T-S21, xem CHANGELOG): mọi phép tính "đây có phải chi tiêu thật không" (ngân sách/hạn mức, pie chart phân bổ, biểu đồ xu hướng, top chi tiêu, hoặc bất kỳ tổng hợp mới nào sau này) BẮT BUỘC dùng `isExpenseTx()`/`isIncomeTx()`/`isTransferTx()` ở `src/lib/txClassify.ts` (nguồn sự thật `t.type`), KHÔNG được so `t.category`/tên chuỗi ("Thu nhập", "Lương", hay bất kỳ tên category nào) để suy luận thu/chi — category chỉ là nhãn hiển thị, KHÔNG phải nguồn xác định loại giao dịch, đặc biệt từ khi `type='transfer'` (T-S14) vẫn giữ `category_id` cho mục đích lịch sử. Thêm 1 điểm tính tổng mới ở component nào cũng phải import từ `txClassify.ts`, không tự viết lại điều kiện lọc                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | —                                                                                                                                            | Tự viết điều kiện lọc `t.category !== "Thu nhập"`/so tên category để xác định thu/chi/chuyển khoản ở bất kỳ phép tính tổng hợp mới nào                                                                                                                                                                                      |
| **Quy tắc bắt buộc** (bug thật gặp T-S44, người dùng báo qua test tay 09/08/2026, xem CHANGELOG): khi thêm 1 field TUỲ CHỌN mới vào luồng "tạo mới HOẶC cập nhật cái có sẵn" (điển hình: `SmartAllocator.applySuggestions` — field `item.icon` chỉ được thêm vào nhánh TẠO MỚI category, quên thêm vào CẢ 2 nhánh CẬP NHẬT category có sẵn — theo `categoryId` lẫn theo tên trùng — khiến số tiền/tên cập nhật đúng nhưng icon vẫn giữ giá trị cũ) BẮT BUỘC rà lại TẤT CẢ nhánh rẽ nhóm cùng luồng (tạo mới / cập nhật theo id / cập nhật theo tên trùng / bất kỳ nhánh nào khác ghi cùng 1 bảng), không chỉ nhánh đầu tiên viết tới. Nếu luồng đó có `snapshot`/`undo` đi kèm (như `handleUndoApply`), field mới cũng phải được lưu vào snapshot (`prevIcon`) và khôi phục lại đúng khi hoàn tác — thêm field mới mà quên cập nhật undo là bug tái diễn ngay lập tức ở lượt hoàn tác kế tiếp                                                                                                                                                                                                                                                                                                                                                                          | —                                                                                                                                            | Thêm 1 field tuỳ chọn mới chỉ vào nhánh tạo mới của 1 luồng tạo/cập nhật gộp chung, không rà lại toàn bộ nhánh cập nhật + snapshot/undo liên quan                                                                                                                                                                           |
| **Quy tắc bắt buộc** (bug thật gặp T-S46, nối tiếp T-S44, người dùng báo qua ảnh chụp UI 10/08/2026, xem CHANGELOG): khi 1 field TUỲ CHỌN (như `AllocationItem.icon`) được dùng ở CẢ 2 đầu 1 luồng — đầu ĐỌC/khởi tạo state từ dữ liệu có sẵn (vd `useEffect` dựng `customSuggestions` từ `categories`) và đầu GHI/áp dụng (vd `applySuggestions`) — rà soát chỉ ở đầu GHI (như quy tắc T-S44 ở trên) là CHƯA ĐỦ. BẮT BUỘC kiểm tra thêm mọi điểm KHỞI TẠO/dựng object nguồn cho field đó — nếu đầu ĐỌC quên gán field từ dữ liệu thật, giá trị "tuỳ chọn" đó coi như đã bị điền sai/rỗng ngay từ đầu, khiến logic "chỉ ghi khi có giá trị" ở đầu GHI tưởng đúng nhưng thực chất ghi nhầm giá trị đoán/mặc định — bug dạng này im lặng hoàn toàn ở kịch bản "không đổi gì rồi Áp Dụng" (no-op), chỉ lộ ra khi so sánh giá trị hiển thị trước/sau bằng mắt, không phải qua log lỗi hay test tự động thông thường                                                                                                                                                                                                                                                                                                                                                        | —                                                                                                                                            | Chỉ audit nhánh ghi/áp dụng khi thêm 1 field tuỳ chọn mới vào 1 luồng có cả đọc lẫn ghi — bỏ qua điểm khởi tạo state ban đầu từ dữ liệu nguồn                                                                                                                                                                               |
| **Quy tắc bắt buộc** (bug thật gặp T-S64/T-S64b, người dùng báo qua 29 ảnh chụp UI test T-S60 12/08/2026, xem CHANGELOG): khi 1 đại lượng tài chính hiển thị (vd "tổng đã tích luỹ của 1 goal") có NHIỀU HƠN 1 nơi trong code tự tính lại — dù ban đầu 2 công thức cho ra cùng kết quả — CẤM viết công thức trùng lặp độc lập ở từng nơi (kể cả khi "sao chép rồi sửa nhỏ" trông tiện hơn lúc đó). BẮT BUỘC: (1) mọi công thức tính TỔNG HIỂN THỊ CHÍNH của 1 khái niệm phải nằm trong ĐÚNG 1 hàm dùng chung (như `goalCurrentAmount`/`manualPortionAmount`); (2) khi thêm 1 nguồn cộng/trừ MỚI vào khái niệm đó (vd thêm khả năng "rút tiền" vào 1 model trước giờ chỉ có "góp tiền"), phải tự hỏi VÀ LIỆT KÊ HẾT mọi hàm/component đang đọc field DB liên quan trực tiếp (`grep` tên field) trước khi coi task xong — không chỉ sửa nơi đầu tiên nghĩ tới; (3) đặc biệt cấm 1 màn hình/card phụ (vd card "Đã hoàn thành", 1 badge phụ) đọc THẲNG cột DB thô (`goal.currentAmount`) thay vì gọi hàm tổng hợp đã có — cột DB thô chỉ là 1 THÀNH PHẦN của công thức đầy đủ, không phải bản thân con số cần hiển thị, đặc biệt sai với các loại record có nhiều biến thể (vd goal liên kết category vs goal thủ công) mà cột đó có ý nghĩa khác nhau/luôn=0 ở 1 biến thể | —                                                                                                                                            | Viết lại 1 công thức tính tổng tài chính đã có sẵn ở nơi khác thay vì import/gọi lại hàm gốc; đọc thẳng cột DB thô ở bất kỳ nơi hiển thị/so sánh tài chính nào khi đã có sẵn hàm tổng hợp đúng cho khái niệm đó                                                                                                             |


### §1.23 — T-S83: Gom lịch sử "Rút quỹ" bị cascade cả 2 nguồn thành 1 nhóm — CHỐT 14/08/2026

- **Vấn đề**: 1 lần "Rút quỹ" (§1.21) bị cascade qua cả 2 nguồn sinh ra 2 bản ghi độc lập, không có liên kết: dòng `transactions` (thủ công) và phần tử `withdrawal_log` trong `linked_history` (liên kết).
- **Quyết định (xác nhận qua thảo luận)**: thêm cột mới `transactions.withdrawal_group_id` (migration `0023`) + tham số cùng tên trong jsonb `withdrawal_log` — CHỈ có giá trị khi thật sự cascade (cả 2 nguồn >0 trong cùng 1 lần bấm "Rút quỹ"). Rút 1 nguồn (đa số trường hợp) giữ `null`, không đổi hành vi/hiển thị cũ.
- **Không** suy luận gộp theo ngày/số tiền trùng khớp — không đủ tin cậy (2 lần rút khác nhau có thể trùng ngày/số tiền).
- **Hiển thị**: modal "Lịch sử" (`SavingGoals.tsx`) gom theo `withdrawalGroupId` thành 1 dòng/lần rút, hiện rõ badge "Gộp 2 nguồn" + breakdown "liên kết X + thủ công Y" khi bị cascade — implementation đầy đủ ở `withdrawalGroupsFor()`, xem CHANGELOG T-S83.
- **Không đổi** bất kỳ công thức tài chính nào (`goalCurrentAmount`, `linkedWithdrawnTotal`, `manualPortionAmount`) — T-S83 thuần là 1 lớp GOM HIỂN THỊ trên dữ liệu đã có, đúng nguyên tắc §5 (không đổi ngữ nghĩa dòng tiền khi chỉ cải thiện UX).

**[Bổ sung T-S84, cùng ngày — bugfix phát hiện qua test tay T-S83]**: quá trình test T-S83 lộ ra 2 bug THẬT có sẵn từ trước (không phải do T-S83 gây ra, chỉ vô tình bị lộ rõ hơn khi test kỹ phần lịch sử):
1. `goalCurrentAmount()` không trừ đúng phần rút THỦ CÔNG khi goal đang liên kết (nhánh `if` dùng cột thô `carriedOverSavedAmount` thay vì hàm dùng chung `manualPortionAmount`) — vi phạm đúng quy tắc "1 công thức, 1 nơi" đã ghi ở bảng ALWAYS/ASK/NEVER cuối §1.
2. `goalHistoryFor()` không bao giờ gộp rút thủ công vào lịch sử khi goal đang liên kết (điều kiện nhánh sai phạm vi).
Đã sửa cả 2 + đồng thời sửa 1 filter sai vừa thêm ở T-S83 (`withdrawalGroupsFor(...).filter(g => g.linkedAmount > 0)` từng ẩn mất khoản rút thuần thủ công khỏi khối "Đã rút quỹ"). Xem CHANGELOG [T-S84] để biết chi tiết đầy đủ.

### §1.22 — Gói tính năng "Hoàn thiện Rút/Hoàn thành Goal kết hợp + phân biệt Ngân sách tiết kiệm khi liên kết" — CHỐT 14/08/2026

Chốt sau nhiều vòng thảo luận (bắt nguồn từ bug T-S74 đang treo). Gồm 6 task mới: T-S76, T-S77, T-S78, T-S79, T-S80, T-S81. Toàn bộ **CHƯA CODE** — chỉ mới chốt thiết kế, chờ xác nhận thứ tự thực thi ở TASKS.md trước khi bắt đầu.

#### 1.22.1 T-S76 — Banner tự động khớp goal chỉ hiện khi goal đã ≥100%

**Đảo ngược có chủ đích 1 quyết định trước đó**: T-S20/T-S74 (đã lock) quy định banner tự động (SmartInput/Bubble) hiện bất kể goal đã gom bao nhiêu %, không có ngưỡng. Người yêu cầu XÁC NHẬN đổi lại: banner CHỈ hiện khi `goalCurrentAmount(goal) >= goal.targetAmount` (đã gom đủ 100%). Áp dụng đồng bộ cho cả 3 nơi nhập liệu — SmartInput, AIAssistantBubble, và bổ sung mới ở Sổ Giao Dịch (TransactionHistory.tsx, hiện hoàn toàn chưa có cơ chế khớp tên goal để hiện banner hoàn thành — xác nhận là gap có thật, không phải bug T-S74).

#### 1.22.2 T-S77 — Phân bổ chi tiêu thật cho goal kết hợp (linked + manual), 3 dải theo giá trị chi tiêu

Áp dụng khi 1 goal có CẢ 2 nguồn (`carried_over_saved_amount`/manual pool VÀ carried_over_spent_amount + linkedAmountByGoal/linked pool). Gọi `spend` = giá mua thật, `manual_pool`/`linked_pool` = số dư khả dụng hiện tại của từng nguồn (đã trừ phần đã rút trước đó, dùng đúng công thức có sẵn `goalManualAvailable`/tương đương cho linked).

- **Dải 1** — `spend <= manual_pool`: chỉ trừ manual. Ghi Sổ Giao Dịch = đúng `spend`. Linked không đụng tới.
- **Dải 2** — `manual_pool < spend <= manual_pool + linked_pool`: ưu tiên trừ HẾT `manual_pool` trước, phần dư bù sang linked (chỉ ghi log lịch sử goal, không tạo giao dịch). Ghi Sổ Giao Dịch = `manual_pool` (cap tối đa, không vượt).
- **Dải 3** — `spend > manual_pool + linked_pool` (vượt cả tổng đã gom): **đảo thứ tự ưu tiên** — trừ HẾT `linked_pool` trước (log-only, vì tiền đó vốn đã là chi tiêu thật trong quá khứ), phần còn thiếu = `spend - linked_pool` ghi thành **giao dịch chi tiêu thật mới, KHÔNG cap theo `manual_pool`** (được phép vượt quá manual_pool danh nghĩa, vì đây là tiền thật phát sinh ngay bây giờ, `manual_pool` chỉ là con số tiến độ tiết kiệm chứ không phải một quỹ tiền mặt có hạn). Kích hoạt banner "Thiếu Xđ" hiện có (khái niệm từ T-S74/`goalManualAvailable`) khi phần vượt này > 0.

**Lý do bất đối xứng thứ tự ưu tiên giữa dải 2 và dải 3 (manual-first vs linked-first)**: đã xác nhận đúng ý người yêu cầu qua ví dụ cụ thể (200k = 100k manual + 100k linked, chi 170k → ghi Sổ Giao Dịch 100k, dư 30k, breakdown manual 100k/linked 70k; chi 250k → linked hết 100k trước, ghi Sổ Giao Dịch 150k phần bù thủ công). Không phải lỗi đánh máy — ghi rõ ở đây để tránh người đọc sau hiểu nhầm là mâu thuẫn logic.

**Lịch sử goal** (không phải Sổ Giao Dịch) BẮT BUỘC ghi đầy đủ ở cả 3 dải: tổng chi thật, dư/thiếu, breakdown chính xác số tiền từng nguồn (manual/linked) đã dùng — không được rút gọn chỉ ghi 1 số tổng. Thẻ goal hiển thị cũng phải phản ánh đúng breakdown này.

Tái dùng phần lớn cơ chế cascade đã có ở T-S70/T-S71 (`withdrawManualMutation`/`withdrawLinkedMutation`), chỉ đảo thứ tự ưu tiên mặc định theo dải — không viết logic mới từ đầu.

#### 1.22.3 T-S78 — [ĐÃ GỠ, xem T-S85 bên dưới] Rút/hoàn thành đúng bằng đúng số dư hiện có → tự động chuyển trạng thái hoàn thành

~~Phụ thuộc T-S77. Khi rút hoặc chi tiêu thật đúng bằng chính xác tổng số dư khả dụng hiện có (`manual_pool + linked_pool`, không thiếu không dư) → tự động set trạng thái hoàn thành, không cần thao tác bấm thêm nút riêng.~~ Giữ nguyên văn làm lịch sử quyết định — xem lý do đảo ngược ở T-S85.

##### T-S85 — GỠ T-S78, tách rạch ròi "rút quỹ" khỏi "hoàn thành" — CHỐT 15/08/2026 (test tay, sửa lại §1.22.3)

- **Bối cảnh**: người yêu cầu test tay T-S78 (rút đúng bằng chính xác tổng số dư → tự động đóng), xác nhận đây là hành vi SAI ý định gốc — không phải bug implementation, mà sai ngay từ thiết kế T-S78.
- **Lý do sai (đối chiếu lại đúng insight gốc §1.9)**: "rút quỹ" chỉ là hành động dịch chuyển/ghi nhận số dư đang theo dõi (đúng bản chất `apply_goal_contribution`/`withdraw_from_linked_goal` — thuần kế toán nội bộ, không có ý nghĩa "đã hoàn thành mục đích"). "Hoàn thành" là 1 xác nhận Ý ĐỊNH của người dùng, PHẢI đến từ 1 trong 2 nguồn: (a) người dùng CHỦ ĐỘNG xác nhận qua checkbox "Đóng mục tiêu"/nút "Hoàn thành ngay, chưa dùng tiền" (T-S79), hoặc (b) người dùng ghi 1 khoản CHI TIÊU THẬT khớp tên goal (SmartInput/Bubble/Sổ Giao Dịch, T-S20/T-S74/T-S77) — đây mới là sự kiện "mua thật" đúng nghĩa §1.9. Rút đúng 100% số dư không chứng minh được người dùng đã thực sự dùng tiền cho đúng mục đích goal (có thể rút để chuyển sang mục đích khác, hoặc rút thử/rút nhầm) — suy luận "rút hết = xong việc" từ 1 con số khớp là suy luận tự động thay người dùng quyết định, đúng loại vi phạm §5 (\"mọi suy luận tự động BẮT BUỘC dừng ở mức gợi ý, KHÔNG tự đổi trạng thái tài chính đã có\") mà chính bảng §5 đã liệt kê ở cột \"Không bao giờ làm\", chỉ là T-S78 lúc thiết kế đã không nhận ra đây cũng thuộc đúng lớp vi phạm đó.
- **Quyết định (đã xác nhận 15/08/2026)**: gỡ hoàn toàn nhánh so khớp `val === linkedAvail + manualAvail` khỏi `effectiveCloseGoal` — `effectiveCloseGoal` quay lại đúng bằng `withdrawCloseGoal` (checkbox thô, không suy luận gì thêm). Rút quỹ (đúng/thiếu/dư số dư) chỉ còn 2 việc: (1) trừ đúng số dư theo cascade đã có (T-S69/T-S70/T-S71 — KHÔNG đổi), (2) ghi lịch sử. Cảnh báo rút quá/không đủ (T-S69 cascade, chặn khi cả 2 nguồn cộng lại vẫn không đủ) giữ nguyên 100%, không liên quan tới quyết định này.
- **Không đổi**: T-S79 (\"Hoàn thành ngay, chưa dùng tiền\", checkbox thủ công) và T-S77 (banner tự động qua giao dịch chi tiêu thật) — đây vẫn là 2 con đường HỢP LỆ DUY NHẤT để 1 goal chuyển hoàn thành, đúng như thiết kế gốc §1.9/§1.21.
- **File sửa**: `src/components/SavingGoals.tsx` — `handleSaveWithdraw` (bỏ nhánh so khớp), xoá khối thông báo inline emerald \"Khớp đúng toàn bộ số dư còn lại — mục tiêu sẽ tự động chuyển Hoàn thành\". Không đổi schema/RPC (T-S78 chưa từng cần migration riêng).
- **Verify tĩnh**: `npx tsc --noEmit`: 32 lỗi, khớp baseline, không lỗi mới trong `SavingGoals.tsx`. **CHƯA test runtime thật** — cần người yêu cầu tự test: rút đúng bằng chính xác tổng số dư khả dụng → "Đã có" về đúng phần còn lại, lịch sử ghi đúng, checkbox "Đóng mục tiêu" vẫn ở trạng thái CHƯA tick và goal vẫn "Đang tiết kiệm" (không tự nhảy "Đã hoàn thành").

#### 1.22.4 T-S79 — "Hoàn thành" với số tiền = 0 (không ghi giao dịch nào)

Phụ thuộc T-S77. Nhánh hoàn toàn mới trong `useGoals.ts` (khác `useCompleteGoal`/`useWithdrawFromManualGoal` hiện tại luôn bắt buộc có 1 `transaction`): cho phép đánh dấu hoàn thành mà KHÔNG ghi bất kỳ giao dịch chi tiêu nào (vì chưa thật sự tiêu gì — tiền phần liên kết vẫn còn ở ví khác ngoài đời, chưa đụng tới thật). Chỉ ghi log lịch sử goal: "đã gom đủ nhưng chưa dùng", phân tách rõ số tiền phần liên kết/phần thủ công.

#### 1.22.5 T-S80/T-S81 — Phân biệt "Ngân sách tiết kiệm" vs "Ngân sách chi tiêu thường" khi liên kết category, chặn cộng hồi tố sai

**Bối cảnh**: khi liên kết 1 category vào goal với khoảng ngày (`linked_start_date`/`linked_end_date`), công thức hiện tại (`linkedAmountByGoal`, `SavingGoals.tsx` + `v_old_dynamic` trong RPC `update_goal_link`, migration `0018`) cộng MỌI giao dịch expense của category đó trong khoảng ngày, không phân biệt giao dịch phát sinh TRƯỚC hay SAU thời điểm bấm liên kết. Đúng với category có bản chất "theo dõi dòng tiền tiết kiệm/đầu tư ở ví khác ngoài đời" (hồi tố hợp lý), nhưng SAI với category chi tiêu thường (chi tiêu đã phát sinh trước khi liên kết là tiền đã tiêu cho mục đích khác, không thể hồi tố gán ngược thành tiến độ goal).

**Đã cân nhắc và LOẠI BỎ phương án tự nhận diện qua từ khóa tên category** (tái dùng `SAVINGS_INTENT_KEYWORDS` có sẵn) — lý do: (1) docstring gốc của `matchesSavingsIntentKeyword` ghi rõ chỉ dùng cho gợi ý UI mềm, không dùng quyết định logic tài chính cứng; (2) rủi ro lặp lại đúng lớp lỗi khởi nguồn toàn bộ chuỗi thảo luận này (nhận diện tự động qua từ khóa sai lệch, category "mua Wukong" từng bị nhận nhầm "Du lịch"); (3) danh sách từ khóa tự thừa nhận "không thể đầy đủ tuyệt đối".

**Giải pháp CHỐT: người dùng tự chọn tường minh, không suy luận tự động** — khi liên kết category (link lần đầu hoặc đổi category), form bắt buộc chọn 1 trong 2 (không có giá trị mặc định, không cho Lưu nếu chưa chọn):
- **"Ngân sách tiết kiệm/theo dõi dòng tiền"** (`is_savings_link = true`) → tính cả giao dịch TRƯỚC thời điểm liên kết (giữ nguyên hành vi hiện tại, không đổi).
- **"Ngân sách chi tiêu thường"** (`is_savings_link = false`) → chỉ tính giao dịch từ **thời điểm bấm liên kết trở đi** (`date >= linked_at`), dù `linked_start_date` cấu hình sớm hơn.

**T-S80 (migration mới, số `0022` — KHÔNG sửa `0018`/`0019`/`0020`/`0021` đã chạy trên Supabase thật)**:
1. Thêm `saving_goals.is_savings_link boolean not null default false`.
2. Thêm `saving_goals.linked_at timestamptz` — ghi tự động server-side trong RPC `update_goal_link` (`now()`), mỗi lần link/relink, KHÔNG cho client ghi trực tiếp (cùng pattern các cột `carried_over_*` hiện có).
3. Sửa `update_goal_link`: nhận thêm tham số `p_is_savings_link boolean`, lưu vào cột mới; khi tính `v_old_dynamic` (đóng băng lúc unlink/đổi category) — nếu `is_savings_link = false` của goal đang xử lý, thêm điều kiện `and date >= v_goal.linked_at` vào câu SUM.
4. **Phải tích hợp đúng với cơ chế idempotency-key đã chốt ở §1.20.1/§1.20.2** (`carried_over_transaction_ids`) — không được quay lại kiểu `SUM` mù theo điều kiện ngày như lỗi gốc đã sửa; điều kiện `is_savings_link`/`linked_at` mới này là 1 bộ LỌC BỔ SUNG trước khi đưa vào tập ứng viên dedup-theo-ID, không thay thế cơ chế dedup.

**T-S81 (UI)**: `SavingGoals.tsx` — form Link/Đổi liên kết thêm nhóm radio bắt buộc chọn ("Ngân sách tiết kiệm..." / "Ngân sách chi tiêu thường"), validate không cho Lưu nếu chưa chọn; sửa `linkedAmountByGoal` (client, dòng lọc theo `linkedStartDate`/`linkedEndDate` hiện tại) thêm đúng điều kiện `is_savings_link`/`linked_at` y hệt phía SQL.

#### 1.22.6 T-S86 — [BUG THẬT 15/08/2026] 2 overload `update_goal_link` tồn tại song song, khả năng khớp nhầm bản CŨ bỏ qua `is_savings_link`

**Bối cảnh phát hiện**: sau khi T-S80/T-S81 được xác nhận PASS, người dùng test lại kịch bản "link 1 category chi tiêu thường vào 1 goal thủ công có sẵn" (không phải tạo goal-liên-kết-ngay-từ-đầu) — chọn rõ "Ngân sách chi tiêu thường" — nhưng khoản chi PHÁT SINH TRƯỚC thời điểm bấm liên kết (3.500.000đ, category "thuê nhà") vẫn bị cộng vào `carried_over_spent_amount`, đúng ra phải bị loại theo §1.22.5. Đọc lại SQL của 0022 (dòng 142) không thấy sai logic.

**Root cause xác nhận qua `select oid::regprocedure from pg_proc where proname = 'update_goal_link'`** (chạy trực tiếp trên Supabase thật): trả về **2 dòng** — `update_goal_link(uuid,uuid,date,date)` (bản 4 tham số của 0018/0019) và `update_goal_link(uuid,uuid,date,date,boolean)` (bản 5 tham số đúng của 0022/T-S80). `create or replace function` chỉ ghi đè hàm CÙNG signature (danh sách kiểu tham số) — 0022 thêm tham số mới `p_is_savings_link` (dù có `default false`) nên Postgres coi là 1 overload MỚI, không hề xoá bản cũ. Bản cũ hoàn toàn không biết `is_savings_link`/`linked_at` — bất kỳ lời gọi nào khớp vào nó (schema cache PostgREST cũ, hay bất kỳ đường gọi RPC nào không gửi đủ `p_is_savings_link`) sẽ quay lại đúng hành vi hồi tố vô điều kiện của 0018/0019, im lặng vô hiệu hoá toàn bộ tính năng T-S80/T-S81 mà không báo lỗi gì.

**Giải pháp CHỐT (đã có migration, xem `0025_saving_goals_drop_stale_update_goal_link_overload.sql`)**: `DROP FUNCTION` bản 4 tham số cũ — chỉ giữ lại đúng 1 hàm `update_goal_link` (5 tham số) trong DB. Đã xác nhận `src/services/goals.ts updateGoalLink()` LUÔN gửi đủ 5 tham số ở mọi lời gọi hiện tại trong code (không có đường gọi nào chỉ gửi 4), nên xoá bản cũ không phá bất kỳ luồng client hợp lệ nào. Kèm theo: bước thủ công "Reload schema cache" trên Supabase Dashboard (hoặc `NOTIFY pgrst, 'reload schema';`) sau khi chạy migration, để loại trừ khả năng PostgREST vẫn giữ cache cũ.

**Không thuộc phạm vi migration 0025 (CHỜ xác nhận riêng theo §5 "Hỏi trước khi làm" — sửa dữ liệu sản xuất)**: khoản 3.500.000đ đã bị cộng sai vào goal "thuê nhà" (và khả năng còn goal khác dính cùng lỗi nếu đã từng relink category chi tiêu thường vào goal có sẵn) — migration này chỉ CHẶN lỗi phát sinh thêm, không tự động sửa số liệu lịch sử đã ghi sai. Đã kèm script thuần đọc `diagnose_T-S86_stale_overload_impact.sql` để khoanh vùng ứng viên; script sửa dữ liệu thật (nếu cần) sẽ viết riêng sau khi người dùng xác nhận đúng (các) goal bị ảnh hưởng.

**Bài học bổ sung cho quy tắc bắt buộc ở bảng ranh giới §5**: khi 1 migration `create or replace function` một hàm SECURITY DEFINER đã có sẵn và cần THÊM tham số mới, BẮT BUỘC hoặc (a) giữ đúng số lượng/thứ tự tham số cũ và chỉ thêm tham số MỚI vào cuối kèm `default`, sau đó **DROP FUNCTION bản chữ ký cũ ngay trong CÙNG migration** để tránh 2 overload sống song song dù chỉ trong 1 khoảng thời gian ngắn, hoặc (b) nếu cố tình muốn giữ cả 2 bản song song (hiếm khi cần), phải ghi rõ lý do + kế hoạch dọn dẹp. Không được mặc định `create or replace` sẽ "tự ghi đè" khi đổi signature — đây chính là bug T-S86.

#### 1.22.7 T-S87 — [BUG THẬT 15/08/2026] So sánh backdating theo `date` (không giờ) thay vì `created_at` — giao dịch cùng ngày với lúc bấm Liên kết vẫn lọt qua bộ lọc "chi tiêu thường"

**Bối cảnh phát hiện**: sau khi T-S86 được xác nhận PASS (chỉ còn đúng 1 overload `update_goal_link`), người dùng test lại kịch bản mới — "goal thủ công có sẵn (225.000đ) -> tạo category mới -> chi tiêu 872.000đ -> link category đó vào goal, chọn 'Ngân sách chi tiêu thường'" — dù tất cả 872.000đ phát sinh TRƯỚC thời điểm bấm Liên kết, kết quả sau khi liên kết vẫn cộng đủ 872.000đ (tổng 1.097.000đ), đúng ra phải bị loại theo §1.22.5.

**Root cause xác nhận qua đọc code**: điều kiện lọc `is_savings_link=false` ở cả 2 nơi — RPC `update_goal_link` (`t.date >= v_goal.linked_at::date`, migration 0022) và client `linkedAmountByGoal` (`row.date < g.linkedAt.slice(0, 10)`, `SavingGoals.tsx`) — đều so sánh theo **NGÀY**, trong khi `transactions.date` là cột `date` KHÔNG có giờ và `linked_at` là `timestamptz` đầy đủ. Khi giao dịch nhập và hành động bấm Liên kết xảy ra CÙNG 1 ngày lịch (trường hợp phổ biến nhất, không phải edge case), phần ngày luôn bằng nhau → điều kiện `>=` luôn đúng → không loại được giao dịch nào, bất kể nó phát sinh trước hay sau lúc bấm Liên kết trong ngày đó.

**Phân biệt với kết luận trước đó (§1.22.6, đoạn "chưa đủ căn cứ")**: nhận định trước đây cho rằng độ chính xác theo-ngày "không đủ căn cứ để khẳng định bug" — nhận định đó CHỈ áp dụng cho DỮ LIỆU LỊCH SỬ đã đóng băng (không thể hỏi lại chính xác thứ tự nhập liệu). Ca T-S87 là **live-link tại chỗ**, thứ tự trước/sau hoàn toàn xác định được qua test tay có kiểm soát — chứng minh đây là bug thật, không phải giới hạn chấp nhận được.

**Giải pháp CHỐT (migration `0026_saving_goals_fix_backdating_created_at.sql`)**: bảng `transactions` đã sẵn có cột `created_at timestamptz` (ghi tại thời điểm INSERT thật, không đổi khi user sửa lại `date`, không cho client ghi trực tiếp — chỉ DB default `now()`) — đổi điều kiện lọc từ so theo `date`/`::date` sang so theo `created_at >= linked_at` (cả 2 timestamptz, chính xác đến giây) ở CẢ 2 nơi: RPC (nhánh "đang liên kết, đổi category") và client (`linkedAmountByGoal`). KHÔNG thêm cột mới, KHÔNG đổi chữ ký hàm RPC (giữ đúng bài học T-S86 — tránh tạo overload mới), KHÔNG đụng điều kiện khoảng ngày `linked_start_date`/`linked_end_date` hay cơ chế dedup `carried_over_transaction_ids`, KHÔNG đụng nhánh "thủ công -> link category lần đầu" (không có điều kiện backdating, đã có comment riêng từ 0022).

**Trạng thái dữ liệu đã bị ảnh hưởng bởi bug này** (goal test trong ca phát hiện, 872.000đ): người yêu cầu xác nhận đây là dữ liệu TEST, không cần viết script sửa lại — chỉ chặn lỗi phát sinh thêm từ nay, không hồi tố sửa số liệu cũ (khác T-S86, ca đó có ảnh hưởng dữ liệu thật "mua nhà" nên có script riêng).

### 1.23 Chuông thông báo (`notifications`) khi di trú `household` khỏi `App.tsx` — CHỐT 15/08/2026 (quyết định phạm vi cho T-S06f-b3)

- **Bối cảnh**: T-S06f-b3 di trú `household`/`syncWithServer`/polling khỏi `App.tsx` sang `useHousehold()` (Supabase thật). State `notifications` (chuông 🔔) hiện đọc dữ liệu GIẢ — field `notifications` do chính `server.ts` tự chế trong response `/api/household/sync`, không phải Supabase thật. Không có hook Supabase nào thay thế được ngay: nguồn thật (`activity_log` với `owner_id`/`read_at`) thuộc thiết kế §1.11, task T-S27, **CHƯA CODE**. Đặt câu hỏi 2 lựa chọn: (a) xoá hẳn state/UI chuông cũ ngay trong T-S06f-b3, tạm mất tính năng cho tới khi T-S27 code xong; (b) giữ UI chuông nhưng ẩn/rỗng tạm, chờ T-S27 nối dây.
- **Quyết định (đã xác nhận 15/08/2026, người yêu cầu chọn giải pháp lâu dài, tối ưu, tránh phải dọn lại 2 lần)**: chọn **(a) — XOÁ HẲN**, không giữ tạm dạng ẩn/rỗng. Lý do: phương án (b) để lại code chết (state rỗng, UI ẩn, mọi type/prop liên quan `InAppNotification` cũ) mà chắc chắn phải động vào lại nguyên vẹn khi T-S27 code — đúng 2 lần dọn cho cùng 1 chỗ, đi ngược tinh thần "làm 1 lần, không sửa lại 2 lần" đã áp dụng xuyên suốt lộ trình 15/08/2026 (xem note đầu TASKS.md). Xoá sạch ngay bây giờ giúp T-S27 sau này viết state/hook/UI chuông HOÀN TOÀN MỚI dựa thẳng trên `activity_log` + Realtime (đã có kênh từ T-S08), không kế thừa bất kỳ phần code/type cũ nào của cơ chế `server.ts`.
- **Phạm vi cụ thể áp dụng trong T-S06f-b3**:
  1. Xoá state `notifications` (`useState<InAppNotification[]>`) khỏi `App.tsx`.
  2. Xoá toàn bộ UI chuông hiện tại (icon 🔔, dropdown, badge số lượng chưa đọc, nếu đang nằm trực tiếp trong `App.tsx`/component con chỉ phục vụ chuông cũ) — không ẩn bằng CSS/điều kiện render, xoá hẳn khỏi cây component.
  3. Xoá type `InAppNotification` (`types.ts`) nếu không còn nơi nào khác dùng tới (`grep` xác nhận trước khi xoá).
  4. Không tạo lại bất kỳ hook/component placeholder nào cho chuông trong T-S06f-b3 — việc dựng UI/hook chuông MỚI thuộc đúng phạm vi T-S27 (viết từ đầu, đọc `activity_log` qua `useQuery` + Realtime, không phải sửa lại code cũ).
  5. Người dùng chấp nhận việc tạm thời KHÔNG có tính năng thông báo trong khoảng thời gian giữa lúc T-S06f-b3 đóng và T-S27 code xong — đánh đổi có chủ đích, đã xác nhận.
### 1.24 T-S08 — Realtime thay polling: 2 kênh song song (cá nhân + hộ), filter chỉ để tối ưu — CHỐT 17/08/2026

- **Vị trí**: `src/hooks/useRealtimeSync.ts` — gọi ĐÚNG 1 LẦN ở gốc (`App.tsx`), không gọi lại ở component con nào khác (tránh mở trùng subscription cho cùng 1 user).
- **Quyết định (khác với đọc literal AC gốc của T-S08 chỉ nhắc `household_id`)**: mở đồng thời **CẢ 2 kênh** — cá nhân (`owner_id=eq.<userId>`) và hộ (`household_id=eq.<householdId>`, chỉ khi user đang thuộc 1 hộ) — cho cả 3 bảng `transactions`/`categories`/`saving_goals`, KHÔNG chỉ theo `scopeMode` đang xem. Lý do: `scopeMode` là lựa chọn UI đổi liên tục (nút Cá nhân/Hộ gia đình), nếu chỉ subscribe theo scope hiện tại sẽ phải resubscribe mỗi lần đổi tab — vừa thêm độ trễ, vừa dễ bỏ sót nếu đổi tab nhanh. Mở sẵn cả 2, invalidate theo key RỘNG (`["transactions"]`, không kèm scope) — đúng pattern đã có sẵn ở mọi mutation hook T-S06c — TanStack Query tự chỉ refetch query nào đang có observer thật, không tốn network thừa cho scope không ai xem.
- **`filter` trong `postgres_changes` KHÔNG phải cơ chế bảo mật** — RLS (§3) vẫn là lớp chặn thật, Realtime tự áp SELECT policy cho từng row trước khi bắn event. `filter` ở đây thuần tối ưu giảm nhiễu event không liên quan.
- **Hạ tầng DB bắt buộc đi kèm** (migration `0029_enable_realtime_publication.sql`): bật `supabase_realtime` publication cho 3 bảng trên + `REPLICA IDENTITY FULL` (đảm bảo payload sự kiện UPDATE/DELETE có đủ cột `household_id`/`owner_id` để client filter đúng, đặc biệt quan trọng cho DELETE — mặc định Postgres chỉ gửi kèm primary key). Không đổi RLS, không đổi cấu trúc cột — chỉ bật replication, đúng phạm vi ALWAYS DO §5 ("Viết migration SQL cho 1 task cụ thể trong TASKS.md").
- **Invalidate, không optimistic**: mọi event Realtime chỉ gọi `queryClient.invalidateQueries` (đúng key rộng, không kèm scope) — KHÔNG tự ý ghi thẳng cache bằng payload event (`setQueryData`), tránh lệch dữ liệu nếu payload không đủ field so với `rowToX()` mong đợi. Đánh đổi: có 1 round-trip refetch nhỏ sau mỗi event thay vì cập nhật tức thời — chấp nhận được vì mục tiêu T-S08 là "thay polling" (đã có độ trễ round-trip từ trước), tối ưu tức thời (0 round-trip) thuộc đúng phạm vi T-S07 (optimistic UI, đặt SAU T-S08 theo đúng lộ trình đã chốt 15/08/2026 để tránh 2 nguồn cập nhật cache xung đột).
- **Transaction insert cũng invalidate `["goals"]`** (không chỉ `["transactions"]`) — giữ đúng lý do đã có ở T-S06c: trigger DB `apply_goal_contribution` (§2.6) có thể cộng/trừ `saving_goals.current_amount` khi transaction có `goal_id`, UI mục tiêu phải refetch theo.

### 1.25 `networkMode: "always"` bắt buộc cho mọi mutation có `AbortSignal.timeout`/optimistic rollback — CHỐT 18/08/2026 (bug thật T-S98, phát hiện khi verify T-S96)

- **Bug gốc**: T-S96 thêm `AbortSignal.timeout(10_000)` vào `services/transactions.ts` để ép `onError` (T-S07) có cái rollback khi mất mạng thật. Verify tay (mất mạng thật + restart dev server) vẫn treo vĩnh viễn, KHÔNG timeout, và khi có mạng lại thì request "tự chạy" và ghi thành công vào DB — chứng tỏ code service không sai, mà `mutationFn` (chứa timeout đó) **chưa từng được gọi** trong lúc mất mạng.
- **Nguyên nhân thật (đã trace source `@tanstack/query-core`)**: `QueryClient` mặc định `networkMode: "online"` cho MỌI mutation. Khi `navigator.onLine === false` (DevTools "Offline" lẫn tắt mạng thật đều kích hoạt), `retryer.start()` gọi `pause()` thay vì `run()` — `mutationFn` bị treo, KHÔNG được gọi, chỉ chạy khi có event `online`. `onMutate` (chèn dòng optimistic) vẫn chạy ngay vì nó không đi qua retryer — đây là lý do dòng optimistic hiện lên bình thường nhưng không bao giờ rollback: timeout đặt bên trong `mutationFn` chưa từng bắt đầu đếm.
- **Quy tắc bắt buộc từ nay**: BẤT KỲ `useMutation` nào có (a) `AbortSignal.timeout`/timeout thủ công ở service layer để đảm bảo lỗi xảy ra trong X giây, HOẶC (b) `onMutate` chèn optimistic + `onError` rollback dựa vào mutation thất bại — PHẢI set `networkMode: "always"` ngay trong options của `useMutation`. Thiếu dòng này, cả 2 cơ chế trên đều là dead code khi mất mạng thật (đúng bug lớp này), dù test bằng DevTools throttle (Slow 3G...) KHÔNG lộ ra (throttle vẫn giữ `navigator.onLine = true`, chỉ riêng "Offline"/mất mạng thật mới kích hoạt pause).
- **Áp dụng ngay**: `useCreateTransaction`, `useUpdateTransaction`, `useSoftDeleteTransaction`, `useRestoreTransaction` (`src/hooks/useTransactions.ts`) — cả 4, kể cả 2 hook không optimistic, để lỗi thân thiện hiện ra thay vì mutation kẹt "pending" vô thời hạn.
- **Việc còn treo (chưa rà — ASK FIRST khi làm)**: các mutation khác trong `useGoals.ts`/`useCategories.ts`/`useHousehold.ts`/`useActivityLog.ts` CHƯA được rà lại theo quy tắc này (ngoài phạm vi T-S98, task này chỉ sửa `transactions`) — nếu hook nào trong số đó cũng có `onMutate`+`onError` optimistic, khả năng cao dính đúng lớp bug này, cần task riêng.

## X. Quy trình đặt mã task (T-Sxx) — CHỐT 17/08/2026 (sự cố thật gặp khi tạo T-S92 trùng ID)

- **Sự cố**: khi tạo 1 task mới (bugfix Groq deprecated model), đặt mã `T-S92` mà KHÔNG grep lại `TASKS.md` để tìm ID lớn nhất đang tồn tại trước — trùng với 1 `T-S92` khác đã có sẵn (nội dung hoàn toàn khác: cảnh báo `rule-based-fallback` trong tin Telegram). Phát hiện muộn sau khi đã ghi cả vào `TASKS.md`, `CHANGELOG.md`, và comment code — phải sửa lại toàn bộ (đổi thành `T-S95`).
- **Quy tắc bắt buộc từ nay**: TRƯỚC KHI gán 1 mã `T-Sxx` mới cho bất kỳ task nào (kể cả bugfix nhỏ phát sinh ngay trong phiên, không qua PHASE 1 — PLAN chính thức), PHẢI chạy `grep -oE "T-S[0-9]+[a-z]?" TASKS.md | sort -V | tail -1` (hoặc tương đương) để lấy ID lớn nhất đang có, rồi dùng ID kế tiếp — không tự đoán/nhớ từ ngữ cảnh hội thoại trước đó (context có thể đã bị cắt/tóm tắt, không đáng tin bằng chính file).
- Áp dụng cho MỌI task mới, kể cả task phát sinh giữa phiên do người dùng báo bug trực tiếp (không đi qua PHASE 1 chính thức) — loại task này vẫn cần soi lại `TASKS.md` thật trước khi đặt tên, không chỉ những task lập kế hoạch từ đầu.

### §1.28 — Trích ngân sách tự động (auto-contribution) — CHỐT 25/08/2026, xem PRD.md "Chốt 25/08/2026" + AUDIT_PRODUCTION_READINESS_SmartSpendTracker.md mục 9

**Nguyên tắc bắt buộc** (kế thừa §1.13/§1.14/§5 — không tạo cơ chế song song, không tự động âm thầm, không suy luận thay người dùng):
- Bản chất dòng tiền: `type='transfer'` (giống góp quỹ thủ công T-S14), KHÔNG BAO GIỜ là `expense`/`income` ảo.
- Tái dùng ĐÚNG goal thủ công đã có (`saving_goals` không `linked_category_id`) — không tạo "quỹ vô danh", không tạo bảng/mối quan hệ mới cho đích trích tiền.
- `default = TẮT`. Bật/tắt là hành động tường minh của người dùng, luôn xem trước số tiền dự kiến trước khi bật.
- Tắt giữa chừng: các khoản đã trích trước đó giữ nguyên lịch sử (không rollback), chỉ dừng trích lần sau — copy UI phải nói rõ "tắt = dừng trích các lần sau, KHÔNG hoàn lại các lần đã trích".

**Schema mới (bảng riêng, KHÔNG thêm cột lên `profiles`/`saving_goals` — 1 người/1 hộ có thể có nhiều cấu hình trích tự động tới nhiều goal khác nhau trong tương lai, dù v1 chỉ cho 1 cấu hình active tại 1 thời điểm để đơn giản)**:

```sql
create table public.auto_contribution_configs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references public.profiles(id),        -- scope cá nhân
  household_id uuid references public.households(id),  -- scope hộ (XOR với owner_id, giống transactions)
  goal_id uuid not null references public.saving_goals(id),
  trigger_type text not null check (trigger_type in ('on_income', 'monthly_schedule')),
  amount_type text not null check (amount_type in ('fixed', 'percent')),
  amount_value numeric not null check (amount_value > 0), -- VNĐ nếu fixed, 0-100 nếu percent (thêm CHECK riêng khi amount_type='percent')
  day_of_month int check (day_of_month between 1 and 31), -- CHỈ dùng khi trigger_type='monthly_schedule'
  enabled boolean not null default false,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- ràng buộc: percent phải có giá trị hợp lý
  constraint chk_percent_range check (amount_type <> 'percent' or (amount_value > 0 and amount_value <= 100)),
  constraint chk_schedule_needs_day check (trigger_type <> 'monthly_schedule' or day_of_month is not null),
  constraint chk_scope_xor check ((owner_id is not null) <> (household_id is not null))
);
-- RLS: bật, policy y hệt pattern saving_goals (owner_id = auth.uid() hoặc household_id khớp profile của auth.uid()).
-- Ghi/sửa/xoá đi qua RPC SECURITY DEFINER (create_auto_contribution_config / update / delete), không UPDATE/INSERT thẳng qua PostgREST — đúng pattern đã áp dụng nhất quán cho mọi bảng tài chính nhạy cảm khác trong dự án (vd §1.20).

create table public.auto_contribution_log (
  id uuid primary key default gen_random_uuid(),
  config_id uuid not null references public.auto_contribution_configs(id),
  triggered_by_transaction_id uuid references public.transactions(id), -- null nếu trigger_type='monthly_schedule'
  contribution_transaction_id uuid references public.transactions(id), -- null nếu bị bỏ qua (không đủ điều kiện)
  computed_amount numeric not null,
  status text not null check (status in ('applied', 'skipped_insufficient', 'skipped_other')),
  skip_reason text,
  created_at timestamptz not null default now()
);
-- Mục đích: audit trail riêng cho tính năng này (KHÔNG thay activity_log chung — vẫn insert 1 dòng activity_log mỗi lần áp dụng thành công, để không tạo nguồn thông báo thứ 2 song song NotificationBell theo đúng nguyên tắc 9.1 mục 7 — auto_contribution_log chỉ để debug/hiển thị lịch sử chi tiết riêng cho tính năng, không phải nguồn notification).
```

**Trigger cho (a) — `on_income`, làm TRƯỚC** (tái dùng đúng pattern `saving_goals.current_amount` trigger đã có):
```sql
create or replace function public.apply_auto_contributions_on_income()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_config record;
  v_income_amount numeric := new.amount;
  v_contribution numeric;
  v_new_tx_id uuid;
begin
  if new.type <> 'income' then
    return new;
  end if;

  for v_config in
    select * from public.auto_contribution_configs
    where trigger_type = 'on_income' and enabled = true
      and (
        (new.owner_id is not null and owner_id = new.owner_id)
        or (new.household_id is not null and household_id = new.household_id)
      )
  loop
    v_contribution := case
      when v_config.amount_type = 'fixed' then v_config.amount_value
      else round(v_income_amount * v_config.amount_value / 100)
    end;

    -- Quy tắc "không đủ số dư" (giả định CHƯA lock cứng, xem PRD "Chốt
    -- 25/08/2026" — v1: chỉ so với chính khoản thu vừa vào, KHÔNG cộng dồn số
    -- dư luỹ kế toàn hệ thống §1.15, để tránh 1 trigger đọc bảng tổng hợp
    -- nặng mỗi lần insert giao dịch, đúng tinh thần "trigger insert phải rẻ").
    if v_contribution > v_income_amount then
      insert into public.auto_contribution_log (config_id, triggered_by_transaction_id, computed_amount, status, skip_reason)
      values (v_config.id, new.id, v_contribution, 'skipped_insufficient',
        'Khoản trích cấu hình (' || v_contribution || 'đ) lớn hơn khoản thu vừa ghi nhận (' || v_income_amount || 'đ)');
      continue;
    end if;

    insert into public.transactions (
      owner_id, household_id, member_id, type, description, amount, date,
      note, goal_id, source
    ) values (
      new.owner_id, new.household_id, new.member_id, 'transfer',
      'Trích tự động vào mục tiêu tiết kiệm', v_contribution, new.date,
      'Tự động trích từ khoản thu #' || new.id, v_config.goal_id, 'auto_contribution'
    ) returning id into v_new_tx_id;

    insert into public.auto_contribution_log (config_id, triggered_by_transaction_id, contribution_transaction_id, computed_amount, status)
    values (v_config.id, new.id, v_new_tx_id, v_contribution, 'applied');

    insert into public.activity_log (owner_id, household_id, actor_id, action, entity_type, entity_id, message, source)
    values (new.owner_id, new.household_id, coalesce(new.member_id, new.owner_id),
      'goal.auto_contribution', 'transaction', v_new_tx_id,
      'Đã tự động trích ' || v_contribution || 'đ vào mục tiêu tiết kiệm', 'system');
  end loop;

  return new;
end;
$$;

create trigger trg_apply_auto_contributions_on_income
after insert on public.transactions
for each row execute function public.apply_auto_contributions_on_income();
```
- Chạy `AFTER INSERT` (không phải `BEFORE`) vì cần `new.id` đã tồn tại thật để tham chiếu `triggered_by_transaction_id`/note — giống lý do các trigger `current_amount` khác trong dự án đã chọn `AFTER`.
- Trigger tự chèn thêm `transactions` mới (`type='transfer'`) → **tự kích hoạt lại trigger `current_amount` của `saving_goals`** (đã có sẵn, không cần sửa) — đúng chuỗi nhân quả 1 chiều, không có vòng lặp (điều kiện `if new.type <> 'income'` chặn transaction `transfer` vừa tạo không tự gọi lại chính nó).
- **Race condition cần verify ở test (T-S142)**: 2 khoản thu ghi gần như đồng thời cho cùng 1 config — mỗi insert chạy trigger độc lập trong transaction ngầm định của chính câu INSERT đó, Postgres tự serialize theo row lock của `auto_contribution_configs` SELECT (không có UPDATE nào trên bảng configs ở đây nên không có contention thật — 2 trigger có thể chạy song song an toàn, mỗi cái tính trên đúng khoản thu của chính nó, không đọc/ghi chung 1 số dư nào cần lock).

**Cho (b) — `monthly_schedule`, làm SAU (T-S140), cần `pg_cron`** — thiết kế đầy đủ xem PRD.md "Chốt 25/08/2026" mục "Quyết định phái sinh cho kiểu (b)".

**Không thêm cơ chế thông báo mới** — mọi lần áp dụng thành công đã có 1 dòng `activity_log` (action `goal.auto_contribution`) nên tự động xuất hiện ở `NotificationBell.tsx` hiện có, đúng nguyên tắc 9.1 mục 7 (không tạo bảng notification thứ 2).

**[CẬP NHẬT 25/08/2026 — xác nhận trực tiếp với người yêu cầu, ASK FIRST đã hỏi trước khi code]**: case `skipped_insufficient` KHÔNG còn "câm lặng" như bản CHỐT gốc phía trên — người yêu cầu xác nhận rõ đây là một cảnh báo phải thực sự hiện ra, không chỉ nằm trong bảng audit. Bổ sung đúng 1 điểm vào trigger `apply_auto_contributions_on_income` (không đổi gì khác so với thiết kế gốc): khi rơi vào nhánh `skipped_insufficient`, ngoài dòng `auto_contribution_log` đã có, insert thêm đúng 1 dòng `activity_log` (action mới `goal.auto_contribution_skipped`, message nói rõ số tiền cấu hình vs số tiền thu được) — vẫn dùng ĐÚNG bảng `activity_log` sẵn có (không tạo nguồn thông báo thứ 2), nên không vi phạm câu "Không thêm cơ chế thông báo mới" ở trên (câu đó chặn việc tạo BẢNG/kênh mới, không chặn việc bảng đã có ghi thêm 1 loại action mới — đúng tinh thần đã áp dụng nhất quán cho `budget.exceeded`/`goal.completed`/... ở migration 0030/0031). Hai nơi hiển thị: (a) tự động nổi lên `NotificationBell.tsx` qua đúng cơ chế sẵn có (không cần code UI thêm), (b) khối lịch sử riêng của tính năng ở `SavingGoals.tsx` (T-S139) đọc trực tiếp `auto_contribution_log` (cần RLS SELECT policy cho bảng này, xem migration 0037) để liệt kê đầy đủ các lần applied/skipped, không chỉ 1 dòng thông báo thoáng qua.

**NEVER DO bổ sung cho mục này**: không tính `v_contribution` dựa trên số dư luỹ kế (§1.15) hoặc bất kỳ số liệu tổng hợp nào ngoài chính khoản thu vừa insert — giữ trigger rẻ, tránh full-table scan mỗi lần ghi giao dịch.

**[SỬA LỖI phát hiện khi code T-S138, 25/08/2026]**: câu `insert into activity_log` cho nhánh `applied` ở bản văn gốc phía trên chỉ truyền `(household_id, actor_id)` — với giao dịch thu nhập CÁ NHÂN (`owner_id` not null, `household_id`/`member_id` null theo `tx_scope_xor`), câu này insert `actor_id=null` (vi phạm `activity_log.actor_id NOT NULL`, migration 0001) và `household_id=null` với `owner_id` mặc định null (vi phạm `activity_log_scope_xor`, migration 0030) → insert `activity_log` FAIL → theo đúng cơ chế transaction của trigger, cả câu INSERT `income` gốc bị rollback theo → người dùng dùng auto-contribution ở SCOPE CÁ NHÂN sẽ không ghi được thu nhập nào cả (lỗi nghiêm trọng, chỉ lộ ra khi test scope cá nhân, không lộ ở scope hộ gia đình vì `household_id`/`member_id` luôn có giá trị ở đó). **Đã sửa**: cấp đúng `owner_id=new.owner_id` cho scope cá nhân, `actor_id` fallback `coalesce(new.member_id, new.owner_id)`. Quy tắc rút ra cho MỌI trigger insert `activity_log` từ giao dịch `transactions` sau này: luôn insert đủ cả `owner_id` lẫn `household_id` từ đúng `new.owner_id`/`new.household_id` (không chỉ 1 trong 2), và `actor_id` luôn `coalesce(new.member_id, new.owner_id)` — không giả định `member_id` luôn có giá trị.

**[SỬA LỖI THỨ 2 phát hiện khi code T-S138, 25/08/2026]**: câu `insert into transactions` cho giao dịch `transfer` tự sinh ở bản văn gốc phía trên dùng `source = 'auto_contribution'` — nhưng constraint `transactions.source` (migration 0001) chỉ cho phép `check (source in ('web','telegram'))`, KHÔNG có `'auto_contribution'` lẫn `'system'` (khác với `activity_log.source` — bảng đó mới có thêm `'system'` từ migration 0030, hai cột `source` này KHÔNG dùng chung tập giá trị dù trùng tên cột, dễ nhầm). Insert sẽ FAIL với lỗi check constraint → rollback toàn bộ income gốc, giống hệt cơ chế lỗi ở mục trên. **Đã sửa**: đổi thành `source = 'web'` (transaction tự sinh vẫn tính là phát sinh từ hành động trên web, không có nguồn nào khác hợp lệ cho trường hợp này). Quy tắc rút ra: KHÔNG giả định `activity_log.source` và `transactions.source` chấp nhận cùng 1 tập giá trị dù tên cột giống nhau — luôn tra lại đúng `check` constraint của TỪNG bảng trước khi chọn giá trị literal, kể cả khi 2 cột trông "hiển nhiên" giống nhau.

**[XÁC NHẬN CHỜ NGƯỜI YÊU CẦU — chưa lock]**: FK `auto_contribution_log.config_id` trong migration `0037` dùng `on delete set null` (không phải mặc định RESTRICT) để `delete_auto_contribution_config` (hard delete, bảng configs không có `deleted_at`) không bị chặn bởi log đã phát sinh, đồng thời không xoá mất lịch sử audit. Đây là quyết định của Claude khi code, KHÔNG có trong bản CHỐT gốc — xem chi tiết + lý do trong comment đầu bảng `auto_contribution_log` ở migration `0037_auto_contribution_schema.sql`. Giữ nguyên cho tới khi người yêu cầu xác nhận hoặc yêu cầu đổi khác.

### §1.28.2 — Mở rộng target `category_id` cho `monthly_schedule` (T-S140 mở rộng) — CHỐT 25/08/2026 qua hỏi-đáp trực tiếp sau khi T-S138 đóng 🔒

Xem PRD.md "Chốt 25/08/2026 (tiếp) — Mở rộng T-S140" cho bối cảnh đầy đủ. Tóm tắt kỹ thuật:

**Schema — ALTER bảng đã tồn tại (KHÔNG sửa lại migration `0037` đã apply — thêm migration mới `0038`)**:
```sql
alter table public.auto_contribution_configs
  add column category_id uuid references public.categories(id);

alter table public.auto_contribution_configs
  drop constraint chk_scope_xor; -- ràng buộc owner/household XOR, GIỮ NGUYÊN, chỉ tách riêng câu dưới
-- (giữ nguyên chk_scope_xor cho owner_id/household_id — KHÔNG đụng)

alter table public.auto_contribution_configs
  add constraint chk_target_xor check ((goal_id is not null) <> (category_id is not null));

alter table public.auto_contribution_configs
  alter column goal_id drop not null; -- trước đây not null, giờ 1 trong 2 (goal_id/category_id)
```
- `trigger_type` cho config có `category_id` **CHỈ được phép `'monthly_schedule'`** — thêm 1 CHECK constraint riêng: `check (category_id is null or trigger_type = 'monthly_schedule')` (không có `on_income` cho category, đúng xác nhận trực tiếp).
- `create_auto_contribution_config` (RPC, migration 0037) cần sửa: nhận thêm `p_category_id` (nullable), validate XOR với `p_goal_id`, validate quyền sở hữu category giống hệt cách đang làm với goal (`owner_id`/`is_household_member`).

**RPC `run_monthly_auto_contributions()` — SECURITY DEFINER, gọi bởi `pg_cron` 1 lần/ngày 00:05 giờ VN (người yêu cầu tự bật extension `pg_cron` qua Supabase Dashboard — không phải thao tác migration SQL thường)**:
- Quét `auto_contribution_configs where trigger_type='monthly_schedule' and enabled=true and (day_of_month = ngày hôm nay HOẶC (ngày hôm nay là ngày cuối tháng VÀ day_of_month > số ngày của tháng này))` — đúng fallback cuối tháng đã phác ở PRD.
- Với MỖI config quét được, theo đúng target:
  - **`goal_id` not null**: tính `v_contribution` (fixed hoặc percent trên tổng thu nhập THẬT của tháng vừa hoàn tất) → nếu đủ số dư luỹ kế (xem công thức dưới) → insert `transactions` (`type='transfer'`, `goal_id`) — ĐÚNG NGUYÊN VĂN nhánh `applied` của trigger `apply_auto_contributions_on_income` (T-S138), chỉ khác nguồn gọi (cron thay vì AFTER INSERT income).
  - **`category_id` not null**: tính `v_contribution` tương tự → nếu đủ → insert `transactions` (`type='expense'`, `category_id`, KHÔNG có `goal_id`) — tự động tính vào `limit_amount` của category (không cần code riêng, đúng cơ chế `getCurrentMonthCategorySpending` sẵn có) và nếu category đang có `linked_category_id` trỏ từ 1 `saving_goals` (§1.13), khoản chi này tự nằm trong `SUM` tính `current_amount` của goal đó (không cần code riêng, đúng cơ chế §1.13 mục 2 sẵn có).
  - CẢ 2 nhánh: nếu KHÔNG đủ → insert `auto_contribution_log` (`status='skipped_insufficient'`) + `activity_log` (action `goal.auto_contribution_skipped` hoặc `category.auto_contribution_skipped` tương ứng) — đúng nguyên tắc cảnh báo hiện thật đã chốt ở T-S138, KHÔNG tạo giao dịch nào.

**Công thức "đủ/không đủ số dư" cho `monthly_schedule` (áp dụng CẢ 2 target, xác nhận trực tiếp 25/08/2026 — KHÁC hẳn T-S138 vốn chỉ so với 1 khoản thu cụ thể)**: dùng **Số dư luỹ kế** (§1.15), tương đương SQL của hàm `getCumulativeBalance` (`incomeStats.ts`):
```sql
select coalesce(sum(amount) filter (where type = 'income'), 0)
     - coalesce(sum(amount) filter (where type = 'expense'), 0)
  from public.transactions
  where deleted_at is null
    and ( (v_owner_id is not null and owner_id = v_owner_id)
       or (v_household_id is not null and household_id = v_household_id) );
```
`v_contribution > số_dư_luỹ_kế_vừa_tính` → `skipped_insufficient`. Lý do dùng cumulative thay vì net-riêng-tháng: tiền đã tiết kiệm/chi các tháng trước đã trừ khỏi số dư luỹ kế và đang được theo dõi riêng, không thể tính lại — đúng lập luận người yêu cầu tự đối chiếu qua 2 lượt hỏi-đáp.

**Số tiền dự kiến trích (kiểu percent, không đổi so với derived-decision gốc)**: `round(tổng thu nhập THẬT của tháng vừa hoàn tất × amount_value / 100)` — SUM `transactions.type='income'` trong khoảng tháng trước, KHÔNG phải tháng đang chạy dở.

**Chưa code** — đây là bản CHỐT thiết kế (Phase 1), TASKS.md sẽ ghi task cụ thể trước khi viết migration `0038` thật.

### §1.28.3 — Bất biến: goal LIÊN KẾT category không bao giờ được có config cấp-goal `enabled=true` — CHỐT 27/08/2026, phát hiện qua hỏi-đáp trực tiếp khi test tay T-S143, sửa ở migration `0039`

**Bối cảnh**: `create_auto_contribution_config` (0037/0038) đã chặn TẠO config cấp-goal (`p_goal_id`) cho goal ĐANG liên kết category — nhưng ban đầu KHÔNG có gì xử lý ca goal ĐÃ có config cấp-goal `enabled=true` từ lúc còn thủ công, RỒI MỚI liên kết category sau — dẫn tới config cấp-goal cũ "mồ côi" (orphan), vẫn `enabled=true`, và 2 hàm trích tiền (`apply_auto_contributions_on_income`/`run_monthly_auto_contributions`) không re-check `linked_category_id`, nên vẫn âm thầm trích — cộng với T-S143 cho phép trích cấp-category trên chính category đó → trích CHỒNG 2 lần/kỳ vào cùng 1 goal.

**Bất biến PHẢI giữ từ nay** (bất kỳ ai/AI nào sửa code trong khu vực `auto_contribution_configs`/`saving_goals` liên kết sau này PHẢI tuân theo, không chỉ đọc rồi bỏ qua):
1. Tại thời điểm 1 goal chuyển từ thủ công → liên kết category (`update_goal_link`, nhánh "đang thủ công, link sang category" — KHÔNG phải nhánh đổi category/unlink), RPC phải tự `update auto_contribution_configs set enabled=false where goal_id=<goal đó> and enabled=true` — KHÔNG xoá (giữ lịch sử/audit qua `auto_contribution_log`).
2. CẢ 2 hàm trích tiền (`apply_auto_contributions_on_income`, `run_monthly_auto_contributions`) BẮT BUỘC có điều kiện loại trừ trong `WHERE`/vòng lặp: `acc.goal_id is null or not exists (select 1 from saving_goals g where g.id=acc.goal_id and g.linked_category_id is not null)` (`acc` = alias của `auto_contribution_configs` trong câu SELECT nạp vòng lặp — xem SỬA LỖI 31/08/2026 ngay dưới đây, KHÔNG được viết `v_config.goal_id` ở đây) — phòng thủ kép, không phụ thuộc hoàn toàn vào bước 1 (an toàn 2 tầng, đúng nguyên tắc chung §5).
3. Bất kỳ RPC/luồng MỚI nào sau này có khả năng khiến 1 goal chuyển từ "không liên kết" sang "có liên kết" (không chỉ `update_goal_link`) đều phải lặp lại bước 1 — đây là bất biến ở CẤP DỮ LIỆU (`saving_goals.linked_category_id is not null` ⇒ không tồn tại `auto_contribution_configs` nào với `goal_id` đó VÀ `enabled=true`), không phải đặc thù của 1 hàm cụ thể.

**[SỬA LỖI 31/08/2026, phát hiện qua chẩn đoán `npx vitest run` — T-S144, xem CHANGELOG "31/08/2026 — Chẩn đoán..."]** Đoạn SQL ở mục 2 phía trên BẢN GỐC (và bản đã chạy thật trong migration `0039`) viết `v_config.goal_id is null or not exists (... where g.id = v_config.goal_id ...)` — đây là BUG, không phải quy tắc đúng cần theo: `v_config` là biến `record` của vòng lặp, chỉ có giá trị SAU khi 1 dòng được gán trong `loop`, nhưng đoạn trên lại dùng nó để LỌC CHÍNH câu SELECT sẽ gán ra nó (tự tham chiếu trước khi gán) → Postgres raise `record "v_config" is not assigned yet` mỗi lần trigger `apply_auto_contributions_on_income` chạy (tức là **mỗi giao dịch thu nhập của MỌI user**, không chỉ trường hợp goal liên kết category) → INSERT giao dịch gốc bị rollback toàn bộ. Đã vá bằng migration `0040_fix_v_config_self_reference_bug.sql` (đặt alias `acc` cho bảng, dùng `acc.goal_id` trong điều kiện lọc trước `loop`, giữ nguyên mọi `v_config.xxx` bên TRONG thân vòng lặp vì ở đó `v_config` đã được gán, tham chiếu đúng). **Quy tắc rút ra cho MỌI `for <biến> in select ... loop` từ nay**: KHÔNG BAO GIỜ tham chiếu biến vòng lặp trong chính câu SELECT dùng để gán nó — luôn đặt alias cho bảng nguồn và dùng alias đó ở mọi điều kiện lọc nằm trước `loop`.

Xem chi tiết đầy đủ (bối cảnh phát hiện, SQL, test) ở `supabase/migration/0039_fix_orphaned_goal_auto_contribution_on_link.sql`, `supabase/migration/0040_fix_v_config_self_reference_bug.sql` và `CHANGELOG.md` mục "27/08/2026 — Migration mới 0039" + "31/08/2026 — Chẩn đoán...".
