# PRD.md — Smart Spend Tracker: Migration Supabase + RBAC + Telegram + UX nâng cao

## Mục tiêu
Chuyển toàn bộ nguồn dữ liệu từ localStorage + file JSON server-side sang Supabase (Postgres + Auth + Realtime + Edge Functions), đồng thời bổ sung phân quyền chủ hộ/thành viên rõ ràng, sửa luồng Telegram để nhắn tin tự động đẩy giao dịch vào web như thao tác tay, và nâng cấp cảm giác dùng (optimistic UI, hoàn tác xoá, lịch sử thao tác) — **không bớt tính năng hiện có**, chỉ bớt nếu không có cách làm tương đương miễn phí trên Supabase.

## Người dùng mục tiêu
Cá nhân/hộ gia đình Việt Nam quản lý chi tiêu, có nhu cầu nhập liệu nhanh qua chat tự nhiên (web hoặc Telegram) và cộng tác nhiều thành viên với phân quyền.

## Phạm vi tính năng (giữ nguyên + bổ sung)

**Giữ nguyên 100%:**
- Nhập nhanh ngôn ngữ tự nhiên (rule-based + AI fallback Gemini).
- 2 chế độ tách biệt: Cá nhân / Hộ gia đình (không merge dữ liệu).
- Quản lý danh mục + hạn mức ngân sách, mục tiêu tiết kiệm, dashboard, lịch sử giao dịch.
- Tạo/tham gia hộ gia đình bằng mã mời.
- Liên kết & nhận đẩy dữ liệu qua Telegram bot.

**Bổ sung mới (theo yêu cầu):**
1. RBAC rõ ràng trong hộ gia đình:
   - Chủ hộ: toàn quyền — cài hạn mức ngân sách/danh mục, thêm/sửa/xoá thành viên, override mọi giao dịch.
   - Thành viên: sửa hồ sơ cá nhân trong hộ, tạo/sửa mục tiêu tiết kiệm chung, tạo/sửa/xoá **giao dịch của chính mình**.
2. Telegram chat → tự nhận diện, phân loại, đẩy giao dịch vào web tức thời (qua Realtime, không polling), có thông báo xác nhận trong Telegram — giống hệt luồng "Nhập nhanh" trên web.
3. Optimistic UI cho thêm giao dịch (TanStack Query `onMutate`).
4. Soft delete (`deleted_at`) + khả năng hoàn tác xoá.
5. `activity_log` thống nhất — vừa là audit trail vừa là nguồn cho chuông thông báo (loại bỏ trùng lặp giữa "notifications" và "actionDescription" hiện tại).
6. `saving_goals.current_amount` tự cập nhật bằng trigger DB khi có giao dịch gắn `goal_id` — không tính tay ở client.

## Kiến trúc
Xem CONSTITUTION.md §1–§4 (đã chốt).

## Quyết định đã lock
- **Telegram: 1 bot dùng chung cho toàn hệ thống**, định danh người gửi qua `telegram_chat_id ↔ profiles`, không dùng bot token riêng từng người/hộ (xem CONSTITUTION §4). Đã xác nhận với người yêu cầu.
- **RBAC**: thành viên chỉ sửa/xoá **giao dịch của chính mình** (chủ hộ override được mọi giao dịch); **mục tiêu tiết kiệm** dùng chung cả hộ, mọi thành viên sửa được nhưng chỉ chủ hộ hoặc người tạo mới xoá được. Đã xác nhận với người yêu cầu.
- **Chủ hộ rời hộ**: chặn hẳn nếu còn thành viên khác (phải remove hết trước). Nếu owner là thành viên duy nhất còn lại, cho rời và giải tán luôn household (suy luận hệ quả, không phải quyết định riêng). Đã xác nhận với người yêu cầu.
- **[Điều chỉnh phạm vi 02/08/2026]**: Đăng nhập **Google OAuth** được đưa VÀO phạm vi giai đoạn này (trước đó nằm ở mục "Ngoài phạm vi"). Zalo OAuth vẫn ngoài phạm vi. Yêu cầu kỹ thuật: dùng `supabase.auth.signInWithOAuth({ provider: 'google' })`, redirect callback do Supabase xử lý (`https://<project-ref>.supabase.co/auth/v1/callback`), không tự parse token ở client. Không tạo user/profile row riêng cho OAuth — vẫn đi qua cùng bảng `profiles` + trigger hiện có ở CONSTITUTION §2 (cần xác nhận trigger `handle_new_user` hiện tại có bắt được sự kiện `auth.users` insert từ OAuth provider, không chỉ từ email/password). Đã xác nhận với người yêu cầu.

- **[Chốt 09/08/2026 — mở rộng "Phân Bổ Ngân Sách Thông Minh" (`SmartAllocator.tsx`), xem TASKS.md T-S37→T-S41 + CHANGELOG]** Sau khi test tay T-S35 phát hiện bug thật (nút "Hoàn tác" mất khi đổi tab do component unmount, snapshot chỉ chụp lệch-của-lần-áp-dụng-gần-nhất) và người yêu cầu nêu 4 bất cập UX, đã thảo luận + CHỐT các hướng sau — **CHƯA CODE**, chỉ mới lên kế hoạch atomic task:
  1. **Hoàn tác phải sống qua đổi tab**: nâng state snapshot lên `App.tsx` (không dùng localStorage/sessionStorage — đây là dữ liệu tạm phiên làm việc, không phải nguồn sự thật tài chính). Snapshot đại diện cho mốc TRƯỚC lần Áp Dụng ĐẦU TIÊN của 1 phiên "sạch" (không bị các lần Áp Dụng sau ghi đè), chỉ xoá khi Hoàn tác chạy xong.
  2. **Mẫu danh mục khi Ngân Sách đang trống**: khi chưa có category chi tiêu nào, mỗi công thức phân bổ tự đề xuất 1 bộ danh mục mẫu phổ biến (theo bối cảnh chi tiêu VN) để người mới dùng không cần tự nghĩ ra category trước — chỉ áp dụng khi rỗng, không đổi hành vi khi đã có category thật.
  3. **Mở rộng từ 3 lên 6 công thức phân bổ + Tự chọn** (tổng 7 lựa chọn trong dropdown): giữ 50/30/20, 6 chiếc lọ, Zero-based; thêm **"Trả Bản Thân Trước"** (Pay Yourself First — trích tiết kiệm trước, phần còn lại mới chia Thiết yếu/Mong muốn) và **"Kakeibo"** (kế toán chi tiêu Nhật Bản, 4 nhóm: Thiết yếu/Văn hoá/Mong muốn/Phát sinh bất thường); thêm **"Ngân sách Tối giản/Khẩn cấp"** (Bare-bones — cho tình huống mất/giảm mạnh nguồn thu, gần như 100% dồn Thiết yếu, không trích tiết kiệm mới). Lý do chọn đúng 2+1 công thức này thay vì các phương pháp khác (vd envelope): đã tham khảo các phương pháp phân bổ dòng tiền phổ biến, envelope về bản chất trùng cơ chế `limit_amount` per-category sẵn có nên không tạo giá trị khác biệt; 2 công thức mới + bare-bones bổ khuyết đúng góc còn thiếu (ưu tiên tiết kiệm chủ động; tư duy tự vấn/phản tỉnh chi tiêu; tình huống thu nhập bất thường/khẩn cấp).
  4. **Thẻ giải thích ngắn cho mỗi công thức** (Ý tưởng cốt lõi / Vì sao chia vậy / Phù hợp ai / Gợi ý tuỳ biến) hiện ngay khi chọn, giúp người dùng tự hiểu và tự tuỳ biến theo hoàn cảnh riêng thay vì áp dụng máy móc.
  5. **Thu nhập nhiều nguồn (lương cố định + freelance/thu nhập thụ động không cố định)**: KHÔNG thêm ô nhập cố định (không scale được với số nguồn thu tuỳ ý mỗi người) — thay vào đó ô "Tổng thu nhập tháng này" tự động điền = tổng thật các giao dịch `type='income'` trong tháng hiện tại (tái dùng đúng cách tính đã có ở `FinancialDashboard.tsx`, tránh tạo nguồn số liệu thu nhập thứ 2 lệch khỏi dữ liệu giao dịch thật — đúng lớp bug từng gặp ở T-S06f-b2), kèm breakdown theo từng category thu nhập; người dùng vẫn sửa tay được để lập kế hoạch giả định.
  6. **Mất/giảm mạnh nguồn thu**: KHÔNG để hệ thống tự động phát hiện rồi tự đổi công thức (vi phạm CONSTITUTION §5 — suy luận tài chính tự động chỉ được dừng ở mức gợi ý). Chỉ hiện banner gợi ý đổi sang "Tối giản/Khẩn cấp" khi thu nhập tháng hiện tại thấp bất thường so với các tháng gần nhất, có nút bấm xác nhận đổi, không tự động đổi.

- **[Chốt 10/08/2026 — nới lỏng §1.12/T-S45, thêm "Goal liên kết Danh mục Ngân sách", xem TASKS.md T-S47/T-S48 + CHANGELOG]** Sau khi Smart Advisor (T-S38/T-S39) tạo category ngân sách ĐỊNH KỲ tên "Tiết kiệm & Đầu tư" (1 "hũ" ngân sách hàng tháng, không gắn goal cụ thể), người yêu cầu phát hiện bug thật qua ảnh chụp UI: ghi giao dịch vào category này bị chặn cứng bởi §1.12/T-S45 (bắt buộc chọn 1 goal, không chọn thì không lưu được) — vì `isSavingsRelated` suy luận cả theo TÊN CATEGORY, không riêng mô tả/ghi chú. Đã thảo luận + đối chiếu YNAB (category không chỉ dùng cho chi tiêu, "assign" tiền vào category là hành động lập ngân sách, Target chỉ là lớp theo dõi tuỳ chọn — không bắt buộc mọi khoản tiền vào category phải gắn 1 goal cụ thể) và Money Lover/Spendee/BudgetBakers Wallet (góp quỹ luôn là hành động transfer riêng, chủ động, tách biệt khỏi category ngân sách thường). **CHỐT 2 quyết định, làm tuần tự 2 task**:
  1. **T-S47 (gấp, sửa lỗi chặn)**: nới `isSavingsRelated` (`savingsDetect.ts`) — **BỎ suy luận theo tên category**, chỉ còn suy luận theo mô tả/ghi chú (khớp từ khoá góp quỹ rõ ràng hoặc khớp tên 1 goal đang active, đúng cơ chế `isSavingsContribution`/T-S20 đã có). Chọn category "Tiết kiệm & Đầu tư" (hay bất kỳ category nào tên gợi tiết kiệm) mà mô tả bình thường → lưu ngay như 1 khoản chi thường, KHÔNG còn bị banner đỏ chặn. Mô tả rõ ý góp quỹ ("bỏ ống heo mua switch"...) → vẫn hiện banner bắt gắn goal như cũ — không đổi mục đích gốc của §1.12, chỉ thu hẹp điều kiện kích hoạt.
  2. **T-S48 (tính năng mới, sau T-S47)**: **"Goal liên kết Danh mục Ngân sách"** — thêm `saving_goals.linked_category_id` (nullable, FK → categories) + `linked_start_date`/`linked_end_date` (khoảng ngày TUỲ Ý do người dùng chọn LÚC TẠO goal, không mặc định "từ ngày tạo" hay "theo tháng" — đã hỏi và người yêu cầu chọn phương án tự chọn khoảng ngày). Khi 1 goal được liên kết 1 category: `current_amount` KHÔNG lưu tay, KHÔNG cần transaction nào gắn `goal_id` — **tự TÍNH** = tổng các giao dịch `type='expense'` của category đó, `transaction_date` nằm trong `[linked_start_date, linked_end_date]` (nguồn sự thật duy nhất là sổ giao dịch thật, tránh double bookkeeping/lệch số liệu — bug lớp đã từng gặp khi 2 nơi tự giữ 1 con số). Ghi giao dịch vào category liên kết vẫn là khoản chi bình thường (không đổi gì so với T-S47, không có `goal_id` trên transaction). UI Tích Lũy hiển thị progress bar như goal thường, nhãn khác biệt kiểu "Tự động cập nhật theo danh mục [tên category], từ [ngày] đến [ngày]" thay vì nút "Đóng góp quỹ" thủ công. Cơ chế goal thủ công hiện có (T-S14/T-S19/T-S20, góp quỹ qua `type='transfer'` + `goal_id`) **giữ nguyên không đổi** — 2 cơ chế song song, độc lập, 1 goal chỉ thuộc ĐÚNG 1 trong 2 loại (có `linked_category_id` XOR nhận góp quỹ thủ công qua transfer, không trộn — tránh vừa tính tự động vừa cộng thêm tay gây sai số/khó hiểu, giữ đơn giản cho v1).

- **[Chốt 10/08/2026 (tiếp) — bỏ hẳn "khớp từ khoá + chặn cứng", thêm "Số dư luỹ kế", xem TASKS.md T-S49/T-S50/T-S51 + CONSTITUTION §1.14/§1.15]** Sau khi T-S47 vẫn bị chặn lại lần 2 dù đã vá thêm từ khoá (xem TASKS.md), người yêu cầu chỉ đúng lỗi gốc: đoán ý định từ text tự do bằng danh sách từ khoá tĩnh không bao giờ đáng tin cậy (đặc biệt tiếng Việt nhiều biến thể). **CHỐT 3 quyết định bổ sung**:
  1. **T-S49 (thay thế T-S47)**: bỏ hẳn khớp từ khoá cho trường hợp category CHƯA liên kết goal (T-S48) — đổi `isSavingsRelated` sang khớp mô tả/ghi chú với TÊN từng goal thủ công đang active (chính xác hơn vì là tên người dùng tự đặt, tái dùng đúng cơ chế fuzzy match đã có ở `assignSavingGoal`/T-S20). Khớp → banner MỀM (amber, không khoá nút, khác hẳn banner đỏ/rose cũ), có sẵn nút chọn nhanh goal khớp. Không khớp → không hiện gì, không chặn gì. Thêm nút "+ Tạo mục tiêu mới" ngay trong banner (tạo goal mới tại chỗ, không cần rời màn hình). Chi tiết đầy đủ ở CONSTITUTION §1.14. T-S47 (đang 🟡) coi như bị task này thay thế — không cần tiếp tục verify bản vá từ khoá cũ.
  2. **T-S50**: thêm KPI "Số dư luỹ kế" ở `FinancialDashboard.tsx` — CHỈ TÍNH HIỂN THỊ (tổng thu thật trừ tổng chi thật, cộng dồn từ trước tới giờ, dùng `txClassify.ts`), KHÔNG tạo giao dịch/bản ghi nào để "chuyển số dư" giữa các tháng. Chi tiết ở CONSTITUTION §1.15. **Còn 1 giả định CHƯA xác nhận** (mốc bắt đầu tính — xem mục "Rủi ro" dưới).
  3. **T-S51 (phụ thuộc T-S50, T-S41)**: Smart Advisor thêm checkbox tuỳ chọn (mặc định TẮT) "+ Gộp cả số dư luỹ kế vào tổng để phân bổ" cạnh ô thu nhập tháng này đã tự điền (T-S41) — bật lên thì tổng phân bổ = thu nhập tháng này + số dư luỹ kế.
  Cả 3 task **CHƯA CODE**, chỉ mới chốt thiết kế + ghi vào TASKS.md theo đúng thứ tự phụ thuộc T-S49 → (T-S50 → T-S51, độc lập với T-S49).

## Chốt 10/08/2026 (tiếp, lần 2) — làm rõ ranh giới "Tiết kiệm & Đầu tư chung" (T-S48) vs goal thủ công (T-S14), backlog B

Người yêu cầu nêu đúng 1 rủi ro thật: category liên kết goal (T-S48, `type='expense'`, coi như 1 "quỹ chung") và goal thủ công (T-S14, `type='transfer'`) nếu bị coi là 1 mối quan hệ "quỹ tổng → rút ra chia goal con" thì tiền sẽ bị tính là chi tiêu 2 lần (1 lần lúc vào category liên kết, 1 lần nữa lúc "mua thật" ở goal con theo §1.9b) — sai lệch Số dư luỹ kế. Đã đối chiếu YNAB (mô hình 2 tầng: "assign" vào phong bì là hành động lập kế hoạch thuần, không phải transaction; chỉ tiền thật ra/vào mới ghi sổ) và Money Lover/Spendee (không có tính năng "rút quỹ ngân sách sang goal", 2 luồng độc lập). **CHỐT**:
1. **Hướng A (áp dụng ngay, không cần code gì thêm)**: giữ category liên kết (T-S48) và goal thủ công (T-S14) là **2 sổ hoàn toàn độc lập, không liên thông** — không bao giờ tạo giao dịch/thao tác mang nghĩa "chuyển từ category liên kết sang góp cho goal thủ công". Xem chi tiết đầy đủ ở CONSTITUTION §1.13 (đoạn bổ sung 10/08/2026 tiếp).
2. **Hướng B (backlog, KHÔNG lên lịch, chỉ ghi dự phòng)**: nếu tương lai cần đúng mô hình "quỹ chung → chia nhỏ goal con → tiêu chỉ trừ 1 lần" (envelope thật kiểu YNAB) — đây là tính năng lớn, cần thiết kế lại từ đầu (khái niệm "phân bổ nội bộ" không sinh transaction, cách đánh dấu 1 khoản mua thật dùng tiền đã tính rồi để không trừ Số dư luỹ kế lần 2), không tận dụng được code T-S48 hiện có, phá vỡ ranh giới "1 goal chỉ 1 loại" đã chốt. Chưa có task ID, chỉ mở khi có nhu cầu thật — xem CONSTITUTION §1.13.

## Hạn chế đã biết (chấp nhận ở giai đoạn hiện tại)
- **[Cập nhật 08/08/2026 — T-S14 code xong, giữ 🟡]** Đóng góp quỹ tiết kiệm trước đây được ghi nhận là `type='expense'` (qua fallback category "Khác"), làm méo nhẹ báo cáo thu/chi thật. Đã thêm `'transfer'` vào CHECK constraint `transactions.type` (migration `0013`, CHƯA CHẠY trên DB thật) và tách hẳn khỏi Thu/Chi ở `FinancialDashboard.tsx`/`TransactionHistory.tsx` (badge "Chuyển khoản" riêng, xem CHANGELOG 08/08/2026). Còn lại 2 việc ngoài phạm vi sandbox trước khi coi là hết hạn chế: (1) người yêu cầu tự chạy migration `0013`; (2) test tay xác nhận số liệu đúng ở cả 2 scope cá nhân/hộ gia đình. T-S19/T-S20 (mục dưới) vẫn chờ T-S14 đóng 🔒.
- **Chưa có khái niệm "Hoàn thành mục tiêu tiết kiệm"** — badge "đã đạt" ở `SavingGoals.tsx` chỉ tự tính (`currentAmount >= targetAmount`), không có action nào gắn với nó, không phân biệt được goal đang active/đã xong. Đã nghiên cứu thị trường (BudgetBakers/Wallet — insight: tiền "đã gom" chỉ là con số theo dõi, không tự động chuyển/trừ) và CHỐT thiết kế đầy đủ ở **CONSTITUTION §1.9** — 3 sự kiện tách biệt (đóng góp quỹ / mua thật / đánh dấu hoàn thành), không cần bù trừ dư/thiếu, cộng thêm khả năng **tự nhận diện qua giao dịch chi tiêu bình thường** (không bắt buộc phải bấm "Hoàn thành" trước) khi mô tả khớp tên 1 goal đang active — luôn qua banner xác nhận, không bao giờ tự động âm thầm. Ghi backlog **T-S19** (luồng thủ công, cần cột mới `saving_goals.completed_at`) và **T-S20** (nhận diện tự động qua SmartInput/AIAssistantBubble), cả 2 phụ thuộc T-S14 (kể cả bản sửa trigger `apply_goal_contribution` chỉ tính `type='transfer'`) — thuộc "Hỏi trước khi làm" §5, chưa lên lịch chạy.

## Rủi ro / giả định cần xác nhận (chưa lock)
- **[ĐÃ XÁC NHẬN 10/08/2026, hết là rủi ro]** "Số dư luỹ kế" (CONSTITUTION §1.15) tính cộng dồn thu thật trừ chi thật, mốc bắt đầu = **toàn bộ lịch sử giao dịch**, không giới hạn, không cấu hình thêm. T-S50 đã đủ điều kiện code.
- Chưa xác nhận môi trường deploy thật (cần có domain public) để test Telegram webhook — không thể verify T-S10 ở localhost.
- **[Gap mới phát hiện]**: chưa có RPC `transfer_ownership` (chuyển quyền chủ hộ cho thành viên khác). Hiện tại đường duy nhất để chủ hộ rời hộ khi còn thành viên là remove hết trước. Cần xác nhận có cần thêm task này không.
- Webhook Telegram cần domain public — nếu bạn chưa có kế hoạch deploy (Vercel/Netlify function hoặc Supabase Edge Function production), tính năng Telegram sẽ không test được ở local dù code đúng 100%. Cần xác nhận môi trường deploy trước khi làm task T-S08/T-S09.
- Gemini API free tier có rate limit — logic rule-first hiện tại đã giảm phụ thuộc AI, giữ nguyên khi migrate.

## Ngoài phạm vi (chưa làm ở giai đoạn này)
- Offline-first / đồng bộ khi mất mạng (có thể làm sau khi nền Supabase ổn định).
- Đăng nhập qua Zalo OAuth (Google đã đưa vào phạm vi — xem "Quyết định đã lock").
- **[Chốt 17/08/2026 — T-S94, quyết định GIỮ HIỆN TRẠNG]** Bot Telegram dùng provider/API key AI CÁ NHÂN giống hệt web (thay vì luôn dùng `GROQ_API_KEY` mặc định server). Lý do không làm ở giai đoạn hiện tại: (1) quy mô người dùng thực tế nhỏ (dưới 1000, ứng dụng cá nhân/hộ gia đình, không phải SaaS đa khách hàng lạ) — nhu cầu "mỗi người 1 provider riêng đồng bộ qua bot" gần như không phát sinh; (2) đây là cải tiến cá nhân hoá, KHÔNG giải quyết vấn đề gốc "nhận diện/phân loại kém" (nguyên nhân thật đã xác định và fix ở T-S95 — model Groq bị deprecate, không liên quan đến việc key thuộc ai); (3) đánh đổi rủi ro bảo mật (lưu API key cá nhân có mã hoá trên `profiles`, thêm bề mặt tấn công nhạy cảm nhất hệ thống) so với lợi ích thực tế ở quy mô này là không đáng. Nếu tương lai quy mô lớn hơn hoặc có nhu cầu thật, mở lại theo đúng PHASE 1 — PLAN, có 2 phương án: (a) đầy đủ — thêm cột mã hoá key cá nhân trên `profiles` + RPC ghi/đọc riêng cho bot (phức tạp, rủi ro cao hơn, đúng bài toán đa provider cá nhân); (b) tối ưu hơn, chi phí thấp — KHÔNG lưu key cá nhân, chỉ thêm 1 dòng thông báo trong bot Telegram kiểu "Bot đang dùng AI mặc định hệ thống, muốn đổi provider liên hệ admin đổi secret server" — đủ minh bạch, không cần schema mới/mã hoá, phù hợp hơn nếu chỉ cần biết chứ không cần tự chọn provider qua bot.

## Chốt 11/08/2026 — T-S57 (sửa liên kết category/khoảng ngày goal, đổi loại liên kết↔thủ công) + T-S60 (Rút quỹ nhiều lần)

Đóng 🔒 T-S49/T-S56/T-S59 sau khi người yêu cầu test tay xác nhận PASS toàn bộ (xem CHANGELOG). Bổ sung 2 yêu cầu mới, đã thảo luận kỹ qua nhiều vòng để tránh sai lệch dòng tiền trước khi cho phép code (đúng nguyên tắc §5 — ASK FIRST vì đổi ngữ nghĩa dữ liệu tài chính):

- **T-S57**: cho sửa `linked_category_id`/khoảng ngày của goal ĐÃ liên kết (đổi sang category khác, hoặc unlink về thủ công, hoặc link 1 goal thủ công có sẵn sang category) — **không mất trắng tiến độ cũ**, **không trừ tiền thật đúp lần 2**. Thiết kế đầy đủ: CONSTITUTION §1.20.
- **T-S60** (phụ thuộc T-S57): thay nút "Hoàn thành" 1 lần (T-S19 cũ) bằng "Rút quỹ" — hành động lặp lại được, goal sống tiếp sau khi rút trừ khi chủ động đóng; bắt chọn rõ nguồn rút (liên kết = chỉ ghi log lịch sử, không tạo giao dịch mới vì tiền đã chi tiêu thật ở nơi khác; thủ công = tạo giao dịch expense thật, trừ tiền lần đầu). Thiết kế đầy đủ: CONSTITUTION §1.21.

**Gốc rễ vấn đề đã giải quyết qua thảo luận**: goal liên kết category chi tiêu và goal thủ công (transfer) có bản chất dòng tiền khác nhau — liên kết là tiền ĐÃ tiêu thật (category gốc đã ghi `expense` thật), thủ công là tiền CHƯA tiêu thật (`transfer` nội bộ). Gộp chung 1 con số "dồn tiếp" khi đổi loại/category sẽ gây trừ tiền thật đúp lần 2 khi rút/hoàn thành sau này — người yêu cầu tự phát hiện rủi ro này, đã tách riêng 2 cột dồn (`carried_over_saved_amount` cho phần thủ công, `carried_over_spent_amount` cho phần liên kết) + `linked_history` (lưu chi tiết từng giai đoạn liên kết đã kết thúc, không chỉ 1 số trần trụi) để vẫn theo dõi được đầy đủ dòng tiền dù không tạo giao dịch thật cho phần đã tiêu.

Cả 2 task **CHƯA CODE** — chỉ mới chốt thiết kế, ghi vào CONSTITUTION + TASKS.md, chờ bắt đầu code T-S57 trước (T-S60 làm sau, phụ thuộc T-S57 xong).


## Chốt 14/08/2026 — Gói tính năng "Hoàn thiện Rút/Hoàn thành Goal kết hợp + phân biệt Ngân sách tiết kiệm khi liên kết"

Bắt nguồn từ bug T-S74 đang treo test (banner nhận diện sai category "mua Wukong" → "Du lịch"). Qua thảo luận sâu, xác nhận phần lớn thiết kế hiện có ĐÃ ĐÚNG (không phải bug), nhưng phát sinh 6 task mới, xem CONSTITUTION §1.22 để biết thiết kế đầy đủ:

- **T-S76**: banner tự động khớp goal (SmartInput/Bubble/mới thêm Sổ Giao Dịch) chỉ hiện khi goal đã gom đủ ≥100% — đảo ngược có chủ đích quyết định T-S20/T-S74 cũ (không có ngưỡng).
- **T-S77**: goal kết hợp (linked + manual) khi phát sinh chi tiêu thật — 3 dải phân bổ theo giá trị chi tiêu, ưu tiên manual trước khi còn trong tổng đã gom, đảo sang linked trước khi vượt tổng (không cap theo manual_pool ở dải vượt tổng).
- **T-S78** (phụ thuộc T-S77): rút/chi đúng bằng đúng số dư hiện có → tự động chuyển hoàn thành.
- **T-S79** (phụ thuộc T-S77): hoàn thành với 0 đồng — không ghi giao dịch, chỉ log lịch sử "đã gom đủ, chưa dùng".
- **T-S80/T-S81**: thêm lựa chọn tường minh "Ngân sách tiết kiệm" vs "Ngân sách chi tiêu thường" khi liên kết category — quyết định có tính hồi tố giao dịch trước ngày liên kết vào goal hay không. Đã cân nhắc và loại bỏ phương án tự nhận diện qua từ khóa tên category (rủi ro lặp lại đúng lớp lỗi khởi nguồn cuộc thảo luận này) — chọn phương án người dùng tự quyết định tường minh qua radio bắt buộc, không mặc định.

Cả 6 task **CHƯA CODE** — chỉ mới chốt thiết kế, ghi vào CONSTITUTION + TASKS.md, chờ người yêu cầu xác nhận thứ tự thực thi trước khi bắt đầu.

## Chốt 22/08/2026 — Dừng T-S125k, chuyển ưu tiên sang UI/UX toàn diện + Onboarding + Ẩn RLS Schema theo admin

Sau khi hoàn tất T-S125a→j (9/11 file, chỉ còn T-S125k IconPicker.tsx TẠM DỪNG theo yêu cầu người dùng — nhóm task thuần `aria-label`/focus ring đã đủ), người yêu cầu chuyển hướng sang 3 mảng giá trị thật hơn cho trải nghiệm người dùng. Đã thảo luận (dùng tool hỏi lựa chọn) để chốt cách làm trước khi code, tránh làm sai hướng phải sửa lại:

- **T-S134 — Ẩn tab "Postgres RLS Schema" chỉ cho admin**: người yêu cầu chọn **Cách A (ẩn ở giao diện)** sau khi được giải thích rõ đây KHÔNG phải chặn thật (nội dung SQL vẫn nằm trong JS bundle gửi cho mọi trình duyệt, chỉ không hiển thị trên UI cho người dùng thường) — chấp nhận được vì nội dung không chứa bí mật (API key/mật khẩu), chỉ là schema RLS công khai của chính app. So khớp email hiện tại (`session.user.email` qua Supabase Auth, không cần round-trip `profiles`) với hằng số `duchoan772003@gmail.com` — ẩn cả nút tab lẫn nội dung khi không khớp, không chỉ ẩn nội dung.
- **T-S135 — Tour chào mừng lần đầu**: modal nhiều bước giới thiệu 2 chế độ Cá nhân/Hộ gia đình, Nhập nhanh (gõ tự nhiên/AI), Ngân sách theo danh mục, Mục tiêu tiết kiệm, Sổ giao dịch, liên kết Telegram. Trạng thái "đã xem" lưu **`localStorage`** (người yêu cầu chọn phương án đơn giản, chấp nhận không đồng bộ giữa các thiết bị/trình duyệt khác nhau — đây là trạng thái UI thuần, không phải dữ liệu tài chính, không vi phạm nguyên tắc §... về localStorage vốn chỉ cấm dùng cho DỮ LIỆU TÀI CHÍNH cần làm nguồn sự thật).
- **T-S136 — Trung tâm trợ giúp thường trực**: nút "?" luôn có sẵn (không chỉ hiện lần đầu), giải thích khái niệm cơ bản bằng ngôn ngữ dễ hiểu cho người chưa quen quản lý tài chính cá nhân (hạn mức ngân sách, phân biệt Thu/Chi/Chuyển khoản, mục tiêu tiết kiệm hoạt động ra sao, cách dùng Nhập nhanh AI).
- **Cải tiến UI/UX tổng thể**: người yêu cầu xác nhận dùng đúng danh sách đã có sẵn trong TASKS.md (**T-S127** bảng vỡ layout mobile, **T-S128** màu cứng không theo dark mode, **T-S129** thiếu skeleton loading, **T-S130** vùng chạm nút nhỏ, **T-S132/T-S133** phân trang dùng chung) — không tạo task trùng, chỉ xác nhận đây là hàng đợi ưu tiên kế tiếp cùng T-S134/135/136.

Tất cả **CHƯA CODE** — chỉ mới chốt hướng làm, ghi vào TASKS.md, chờ người yêu cầu xác nhận thứ tự bắt đầu.

## Chốt 25/08/2026 — "Trích ngân sách tự động" (đề xuất mục 9 của AUDIT_PRODUCTION_READINESS_SmartSpendTracker.md), xác nhận đủ điểm 9.1(3)(4)(6)

Người yêu cầu đã trả lời đủ 3 điểm audit nêu ở mục 9.1 xin xác nhận trước khi mở task thật:

1. **9.1(3) — Kích hoạt bằng trigger nào?** Xác nhận **CẢ HAI** (a) trích ngay khi ghi nhận giao dịch `type='income'` VÀ (b) trích theo lịch cố định hàng tháng — không chỉ 1 trong 2. Thứ tự làm: **(a) trước** (rẻ, tái dùng đúng pattern trigger `saving_goals.current_amount` đã có, không cần hạ tầng mới), **(b) sau** (cần `pg_cron`, hạ tầng mới — tách task riêng, không gộp chung task (a) để không phá nguyên tắc "1 task/1 context sạch").
2. **9.1(4) — Trích bao nhiêu?** Xác nhận **CẢ HAI kiểu**: số tiền cố định (VNĐ) VÀ phần trăm (%) trên khoản thu — người dùng chọn 1 trong 2 kiểu khi bật tính năng (không ép 1 kiểu duy nhất, đúng đề xuất ở audit).
3. **9.1(6) — Không đủ số dư/không áp dụng được thì sao?** **[CẬP NHẬT 25/08/2026 — đã xác nhận, LOCK]**: giữ đúng đề xuất mặc định của audit (bỏ qua lần đó, KHÔNG tự trích số khác số đã cấu hình) — và người yêu cầu xác nhận thêm rằng cảnh báo phải hiện THẬT cho người dùng (qua `NotificationBell.tsx`, action `goal.auto_contribution_skipped`), không chỉ nằm câm trong bảng audit `auto_contribution_log`. Chi tiết implementation: xem `CONSTITUTION.md` §1.28.

**Quyết định phái sinh cho kiểu (b) — lịch cố định hàng tháng, cần làm rõ trước khi tách task T-S140 (xem CONSTITUTION §1.28 mục 5):**
- Ngày chạy: cấu hình được theo từng cấu hình trích tự động (`auto_contribution_day_of_month`, mặc định ngày 1), không cứng ngày 1 cho mọi người dùng.
- Nếu ngày chạy trong tháng đó KHÔNG tồn tại (vd chọn ngày 31 nhưng tháng 2 chỉ có 28/29 ngày): chạy vào ngày cuối cùng của tháng đó (không skip, không lỗi).
- Cơ chế: `pg_cron` gọi 1 RPC `SECURITY DEFINER` chạy 1 lần/ngày (00:05 giờ VN), tự quét toàn bộ cấu hình có `auto_contribution_day_of_month = ngày hôm nay (theo giờ VN)` (hoặc hôm nay là ngày cuối tháng VÀ ngày cấu hình > số ngày của tháng này) và `schedule_type = 'monthly'`, `enabled = true` — không phải 1 job/user (không scale được số lượng job `pg_cron` theo số người dùng).
- Trích (b) tính trên **tổng thu nhập THẬT của tháng vừa hoàn tất** (tháng trước ngày chạy, không phải tháng đang chạy dở) khi kiểu là phần trăm — tránh trích trên số thu chưa đầy đủ của tháng hiện tại. Khi kiểu là số tiền cố định, không phụ thuộc mốc tháng nào, trích thẳng số cấu hình (vẫn phải qua rule "không đủ số dư" ở trên nếu có kiểm tra số dư khả dụng).
- Đây là bản ghi phái sinh, **CHƯA xác nhận trực tiếp với người yêu cầu ở lượt hỏi trước** (chỉ suy luận hợp lý theo đúng các quyết định đã lock khác trong dự án để không tự chặn task (a) — sẽ hỏi lại tường minh trước khi bắt đầu Phase 2 của T-S140, đúng nguyên tắc §5 "hỏi trước khi làm" cho thay đổi ngữ nghĩa dữ liệu tài chính).

Chi tiết schema/trigger đầy đủ: xem `CONSTITUTION.md` §1.28. Atomic task breakdown: xem `TASKS.md` T-S138→T-S142 (tất cả **CHƯA CODE**, chỉ mới chốt thiết kế + ghi ledger, đúng PHASE 1 — chờ xác nhận bắt đầu Phase 2 từ T-S138).

## Chốt 25/08/2026 (tiếp) — Mở rộng T-S140: `monthly_schedule` áp dụng thêm cho CATEGORY (không chỉ goal), xác nhận qua hỏi-đáp trực tiếp

Sau khi T-S138 đóng 🔒, người yêu cầu nêu nhu cầu mới: tự động trích tiền **định kỳ hàng tháng vào 1 category ngân sách** (VD "Tiết kiệm & Đầu tư") — KHÁC hẳn T-S138 (target `goal_id`, trigger `on_income`, tạo `transfer`). Đã hỏi-đáp trực tiếp qua nhiều lượt để chốt đủ các điểm sau:

1. **Mục tiêu trích (target) có thêm lựa chọn thứ 2 — `category_id`**, song song `goal_id` đã có ở T-S138. 1 config chỉ trỏ ĐÚNG 1 trong 2 (XOR), không trộn.
2. **Chỉ dùng trigger `monthly_schedule`** cho target `category_id` (KHÔNG có `on_income` cho category — không hỏi/không cần, người yêu cầu chỉ muốn lịch cố định hàng tháng khi tạo category từ `BudgetLimits.tsx`/`SmartAllocator.tsx`).
3. **Giao dịch tự sinh cho target `category_id` là `type='expense'`** (không phải `transfer` như target `goal_id`) — đúng bản chất "bỏ tiền vào ngân sách category", tự động tính vào `limit_amount` của category đó như mọi khoản chi thường (xác nhận trực tiếp: "Có, tính chung vào limit_amount như mọi expense khác"). Nếu category đó đang liên kết 1 `saving_goals` (§1.13, `linked_category_id`), khoản chi tự sinh này TỰ ĐỘNG được tính vào `current_amount` của goal liên kết qua đúng cơ chế SUM sẵn có (§1.13 mục 2) — không cần code gì thêm ở phần liên kết, đây chính là cách người yêu cầu muốn "theo dõi được nhiều tháng/năm" cho khoản tiết kiệm qua category.
4. **Mốc xét "đủ/không đủ số dư" cho `monthly_schedule` (áp dụng cho CẢ target `goal_id` lẫn `category_id`, cả kiểu fixed lẫn percent, sau khi đã tính ra số tiền dự kiến trích)**: dùng **Số dư luỹ kế** (§1.15, hàm `getCumulativeBalance` đã có sẵn ở `incomeStats.ts`, tái dùng đúng, không viết công thức mới) tại đúng thời điểm cron chạy — nếu số tiền dự kiến trích > số dư luỹ kế hiện có → **skip, KHÔNG tạo giao dịch nào**, cảnh báo hiện thật (đúng cơ chế `skipped_insufficient`/`activity_log` đã chốt ở T-S138). Lý do chọn cumulative balance thay vì "net riêng tháng vừa hoàn tất" (phương án bị người yêu cầu tự sửa lại qua 2 lượt hỏi-đáp): tiền đã tiết kiệm/chi ở các tháng trước ĐÃ được trừ khỏi số dư luỹ kế và đang được theo dõi riêng — không thể "ném ngược" vào phép tính số dư khả dụng của tháng hiện tại, nên phải dùng đúng số dư CÒN LẠI THẬT SỰ tính lũy kế từ đầu, không giới hạn trong 1 tháng.
5. **Số tiền dự kiến trích (kiểu percent)** vẫn tính trên tổng thu nhập THẬT của tháng vừa hoàn tất (không đổi so với derived-decision gốc mục "Quyết định phái sinh cho kiểu (b)" phía trên) — đây là bước TÍNH RA số tiền, khác với bước mục 4 ở trên (KIỂM TRA đủ/không đủ số dư sau khi đã tính ra).
6. **UI**: nút/toggle "Trích tự động mỗi tháng" thêm vào lúc tạo/sửa category ở `BudgetLimits.tsx` VÀ lúc áp dụng gợi ý ở `SmartAllocator.tsx` (task UI riêng, chưa vào TASKS.md ở bản ghi này — xem T-S143 khi mở).

**Ảnh hưởng schema**: `auto_contribution_configs` (migration 0037) cần sửa — thêm cột `category_id` (nullable, FK → `categories`), đổi ràng buộc từ `goal_id not null` sang `(goal_id is not null) <> (category_id is not null)` (XOR đúng 1 trong 2). Đây là ALTER lên bảng đã tồn tại (không phải bảng mới) — cần 1 migration riêng, KHÔNG sửa lại `0037` đã apply (nguyên tắc chung của dự án: không sửa migration đã chạy trên production, luôn thêm migration mới). Chi tiết đầy đủ: xem `CONSTITUTION.md` §1.28.2 (mở khi bắt đầu code).

## Chốt 31/08/2026 — "Chế độ Hỏi-Đáp qua Telegram" (bot trả lời câu hỏi tài chính trực tiếp, không chỉ nhập giao dịch)

Người yêu cầu chỉ ra qua ảnh chụp UI thật: bot Telegram hiện tại CHỈ hỗ trợ nhập nhanh giao dịch — mọi câu hỏi kiểu "tổng chi tiêu tháng 8/2026", "tổng chi tiêu và thu nhập ngày hôm nay" đều bị từ chối với thông báo "Không nhận diện được khoản chi tiêu" (đúng vì `handleMessage` hiện coi MỌI tin nhắn không phải lệnh là khai báo giao dịch). Trong thực tế người dùng cần tra cứu nhanh qua chat (ngại mở web/app), nên bổ sung khả năng bot TRẢ LỜI câu hỏi trực tiếp bằng dữ liệu thật của chính người đó.

**Phạm vi 9 nhóm câu hỏi v1 (đã xác nhận với người yêu cầu, chọn TẤT CẢ)**:
1. Tổng chi tiêu / thu nhập theo kỳ (hôm nay, tuần này, tháng này, tháng cụ thể, năm nay, khoảng ngày tuỳ chọn).
2. Số dư luỹ kế (tái dùng đúng công thức `getCumulativeBalance`/§1.15, không viết công thức thứ 2).
3. Chi tiêu theo từng danh mục trong kỳ.
4. Hạn mức ngân sách còn lại của 1 danh mục (tái dùng đúng công thức `getCurrentMonthCategorySpending`/§1.15 — luôn đúng nghĩa THÁNG HIỆN TẠI, không phụ thuộc kỳ người dùng hỏi, giống hệt nguyên tắc đã chốt ở T-S112).
5. Tiến độ mục tiêu tiết kiệm (1 goal cụ thể qua khớp tên, hoặc toàn bộ danh sách).
6. Danh sách giao dịch gần đây / trong ngày.
7. Khoản chi lớn nhất trong kỳ.
8. So sánh chi tiêu tháng này vs tháng trước.
9. Trạng thái cấu hình trích ngân sách tự động (§1.28) — đang bật/tắt, đã trích bao nhiêu lần, lần gần nhất.

**Bảo mật/scope (yêu cầu tường minh của người yêu cầu, LOCK)**: mọi câu trả lời CHỈ được lấy dữ liệu của đúng tài khoản đã xác thực/liên kết qua `profiles.telegram_chat_id` (cơ chế hiện có §4), đúng `telegram_active_scope` hiện tại (cá nhân/hộ gia đình) — KHÔNG BAO GIỜ lộ dữ liệu người dùng khác, kể cả thành viên khác trong cùng hộ gia đình nếu không đúng scope. Vì Edge Function dùng `SERVICE_ROLE_KEY` (bypass RLS), đây là hàng rào DUY NHẤT — mọi hàm truy vấn mới bắt buộc lọc thủ công theo `owner_id`/`household_id`, dùng CHUNG 1 hàm tính scope (không viết lại logic này ở từng nơi — tái phạm đúng lớp bug đã sửa ở T-S90/`fetchCategoryNames`).

**Múi giờ**: giờ Việt Nam (UTC+7) cho mọi công thức thời gian tương đối ("hôm nay"/"tháng này"/"tuần này"...) — khớp cách người dùng thật đang trải nghiệm trên web (đã xác nhận).

**Câu hỏi không khớp 9 mẫu trên VÀ không giống khai báo giao dịch (không có số tiền)**: người yêu cầu xác nhận dùng AI (provider AI mặc định hệ thống sẵn có, không thêm provider mới) trả lời tự do — nhưng PHẢI được "khoá" (grounding) chỉ dựa trên 1 gói dữ liệu JSON đã truy vấn sẵn (scoped đúng người dùng), KHÔNG được tự suy diễn/bịa số liệu ngoài gói dữ liệu đó — nếu không đủ dữ liệu để trả lời, AI phải nói rõ và gợi ý mở web app, không đoán. Thiết kế kỹ thuật đầy đủ: CONSTITUTION §4.1.

Chi tiết kỹ thuật + atomic task breakdown: xem `CONSTITUTION.md` §4.1, `TASKS.md` T-S147 → T-S155 (tất cả **CHƯA CODE**, chờ xác nhận thứ tự bắt đầu).
