# Smart Spend Tracker — Kế hoạch di trú sang Supabase

## 0. Tóm tắt tình trạng hiện tại (đã đọc toàn bộ mã nguồn)

Kiến trúc hiện tại **không phải "chỉ dùng localStorage"** — nó là một hệ lai khá phức tạp:

- `server.ts` (Express) đóng vai trò "backend" nhưng lưu toàn bộ dữ liệu vào **một file JSON duy nhất** (`data_store.json`) trên đĩa server.
- Client (`App.tsx`) vừa gọi API tới server, vừa **ghi lại y hệt dữ liệu đó vào localStorage** theo từng key kiểu `smartspend_user_<email>_transactions`, `..._categories`, `..._goals`, `..._household`.
- Khi ở chế độ "household", client **poll `/api/household/get` mỗi 4 giây** để giả lập realtime.
- AI parser (Gemini) chạy server-side qua `/api/parse-transaction` — điểm này làm đúng (không lộ key ra client).

Đây là 5 vấn đề nghiêm trọng cần xử lý trước khi nói đến "cải tiến giao diện", vì chúng là **lỗi kiến trúc/bảo mật**, không phải thẩm mỹ:

| # | Vấn đề | Bằng chứng trong code | Mức độ |
|---|---|---|---|
| 1 | **Mật khẩu lưu plaintext** | `server.ts`: `passwordHash: password` — không hash, không salt. So sánh login bằng `user.passwordHash !== password`. | 🔴 Nghiêm trọng |
| 2 | **Không có session/JWT — auth theo "danh dự"** | Mọi API (`update-profile`, `household/sync`, `household/leave`...) nhận `email` trong body và tin tưởng tuyệt đối. Bất kỳ ai cũng có thể gọi API với email của người khác để sửa hồ sơ hoặc dữ liệu hộ gia đình của họ. | 🔴 Nghiêm trọng |
| 3 | **"Database" là 1 file JSON, không có transaction/lock** | `readStore()`/`writeStore()` đọc-sửa-ghi toàn bộ file. Hai request ghi đồng thời (2 thành viên hộ gia đình thao tác cùng lúc) có thể **ghi đè mất dữ liệu của nhau** (race condition). Không có backup, không scale quá 1 instance. | 🟠 Cao |
| 4 | **Logic merge chỉ cộng dồn, không bao giờ xoá được** | `/api/household/sync` merge bằng `Map` theo `id`: dữ liệu server + dữ liệu client được **union** lại. Nếu bạn xoá 1 giao dịch trên client, server vẫn giữ bản cũ trong map → **giao dịch đã xoá sẽ tự hồi sinh** ở lần sync/poll tiếp theo. Đây gần như chắc chắn là một bug bạn đã/sẽ gặp phải khi test xoá dữ liệu ở household mode. | 🟠 Cao (bug logic thật, không phải giả định) |
| 5 | **Poll 4 giây/lần** | Không scale, tốn băng thông, và khi lên serverless/production sẽ tạo tải không cần thiết lên DB. | 🟡 Trung bình |

Ngoài ra một điểm mô hình dữ liệu đáng chú ý: `Transaction.amount` dùng **dấu âm để biểu diễn thu nhập** (`amount: -18000000` = lương). Đây là quy ước ẩn, rải rác khắp codebase — dễ gây bug khi có người (hoặc AI) quên đảo dấu. Nên có field `type: 'income' | 'expense'` tường minh thay vì suy luận từ dấu.

**Kết luận:** việc chuyển sang Supabase không chỉ là "đổi chỗ lưu trữ" — nó **sửa luôn cả 4 trong 5 vấn đề trên gần như miễn phí**, vì Supabase Auth lo việc hash mật khẩu + session, và Postgres + RLS lo việc lưu trữ an toàn/có transaction. Đây là lý do nên làm sớm, không phải "làm sau khi xong tính năng".

---

## 1. Trả lời thẳng câu hỏi: tự viết auth hay dùng Supabase Auth?

**Dùng Supabase Auth cho phần lõi (mật khẩu, session, token), KHÔNG tự viết lại.** Lý do:

- Cái bạn đang "tự chế" hiện tại (lưu password plaintext, không session) **kém an toàn hơn Supabase Auth ở mọi khía cạnh**. Đây không phải trade-off ngang nhau.
- Cái bạn thấy "giới hạn" ở Supabase Auth thường không phải giới hạn thật — mà là do thiếu 1 bảng phụ. `auth.users` của Supabase chỉ có `id, email, encrypted_password,...` — **không có chỗ cho `role`, `displayName`, `telegramChatId`, `householdId`**. Cách chuẩn (và gần như mọi dự án Supabase production đều làm) là:
  1. Giữ `auth.users` chỉ để xác thực (email/password, OAuth nếu cần sau này).
  2. Tạo bảng `public.profiles` (1-1 với `auth.users.id`) chứa toàn bộ field nghiệp vụ của bạn.
  3. Dùng 1 trigger `on auth.users insert` để tự tạo dòng `profiles` tương ứng.

  → Bạn vẫn có toàn quyền kiểm soát field tuỳ ý, chỉ là **không phải tự viết register/login/hash/token nữa**.
- Lợi ích lớn nhất không phải là "tiện", mà là **Row Level Security (RLS) đọc thẳng `auth.uid()`**. Toàn bộ logic "ai được xem/sửa dữ liệu hộ gia đình nào" hiện đang nằm rải rác trong `server.ts` (so sánh email thủ công) sẽ được thay bằng policy SQL khai báo 1 lần, DB tự chặn — không phụ thuộc vào việc bạn có nhớ check đúng chỗ trong từng endpoint hay không (chính là nguyên nhân gây ra vấn đề #2 ở trên).

**Khi nào mới cần tự viết thêm:** nếu sau này bạn cần đăng nhập bằng số điện thoại/Zalo hoặc không muốn bắt buộc email — lúc đó dùng Supabase Admin API từ 1 edge function, chứ không quay lại tự hash mật khẩu.

---

## 2. Schema Postgres đề xuất

```sql
-- 1. Hồ sơ người dùng, 1-1 với auth.users
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text not null,
  role text not null default 'Cá nhân',
  display_name text generated always as (role || ' (' || name || ')') stored,
  household_id uuid references public.households(id) on delete set null,
  telegram_chat_id text,
  telegram_username text,
  created_at timestamptz not null default now()
);

-- 2. Hộ gia đình
create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text unique not null,
  owner_id uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

-- 3. Danh mục chi tiêu (thuộc về 1 household)
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null,
  icon text not null,
  limit_amount numeric,
  is_recurring boolean not null default false,
  created_at timestamptz not null default now()
);

-- 4. Giao dịch
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  member_id uuid references public.profiles(id),
  category_id uuid references public.categories(id),
  type text not null check (type in ('income','expense')),  -- thay cho quy ước "amount âm"
  description text not null,
  amount numeric not null check (amount >= 0),
  date date not null,
  note text,
  goal_id uuid references public.saving_goals(id),
  created_at timestamptz not null default now()
);

-- 5. Mục tiêu tiết kiệm
create table public.saving_goals (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null,
  target_amount numeric,
  current_amount numeric not null default 0,
  target_date date,
  created_at timestamptz not null default now()
);

-- 6. Thông báo trong app
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  message text not null,
  created_at timestamptz not null default now()
);
```

**RLS mẫu (áp dụng chung 1 pattern cho categories/transactions/goals/notifications):**

```sql
alter table public.transactions enable row level security;

create policy "member can read household transactions"
on public.transactions for select
using (
  household_id = (select household_id from public.profiles where id = auth.uid())
);

create policy "member can write household transactions"
on public.transactions for insert with check (
  household_id = (select household_id from public.profiles where id = auth.uid())
);

create policy "member can update/delete own household transactions"
on public.transactions for update using (
  household_id = (select household_id from public.profiles where id = auth.uid())
);
```

Với schema + RLS này, **toàn bộ logic merge thủ công trong `/api/household/sync` biến mất** — mỗi client CRUD trực tiếp vào Postgres qua Supabase client SDK, DB tự đảm bảo tính nhất quán (transaction thật, không phải union JSON), và xoá thì mất thật, không hồi sinh.

---

## 3. Kiến trúc mới đề xuất

```
client (React)
  ├─ Supabase JS client (anon key) → CRUD trực tiếp có RLS bảo vệ
  ├─ Supabase Realtime subscribe theo household_id → thay thế polling 4s
  └─ Supabase Auth → login/register/session (thay AuthAndTelegram tự chế)

Supabase Edge Function (thay phần còn lại của server.ts)
  ├─ /parse-transaction  → giữ nguyên logic Gemini, nhưng đọc GEMINI_API_KEY từ secrets
  └─ /telegram-webhook   → verify token, insert notification, gọi Supabase service-role client
```

Bạn **không cần tự host Express server nữa** — trừ khi muốn giữ webhook Telegram, cái đó vẫn cần 1 endpoint public (Edge Function làm được, không cần Node server riêng).

### Việc cần đổi ở tầng code

1. **Data access layer**: tạo `src/lib/supabaseClient.ts` + `src/services/{transactions,categories,goals,household}.ts`. Component không được gọi `fetch`/`localStorage` trực tiếp nữa (hiện `App.tsx` 1460 dòng đang làm hết mọi việc — nên tách).
2. **Data fetching**: thay state thủ công + `JSON.stringify` so sánh (đang có trong polling loop) bằng **TanStack Query** + Supabase Realtime `on('postgres_changes')` để invalidate cache. Xoá hẳn `setInterval` 4 giây.
3. **Auth**: thay `AuthAndTelegram.tsx` phần login/register bằng `supabase.auth.signUp` / `signInWithPassword`, giữ lại phần UI liên kết Telegram (đó là nghiệp vụ riêng, không phải auth).
4. **localStorage**: bỏ hoàn toàn vai trò "nguồn sự thật". Nếu muốn giữ trải nghiệm offline sau này, dùng nó như cache đọc-thôi, không ghi state qua nó nữa.
5. **Amount sign convention**: migrate `amount` → luôn dương + thêm cột `type`. Viết 1 script migrate dữ liệu demo/hiện có 1 lần.

---

## 4. Đề xuất chia task theo HARNESS (Phase 1 → TASKS.md)

| Task | Input | Output / Acceptance criteria | Phụ thuộc |
|---|---|---|---|
| T-S01 | — | Tạo project Supabase, chạy migration schema ở mục 2, bật RLS, test bằng SQL editor | — |
| T-S02 | T-S01 | Trigger `handle_new_user` tự tạo `profiles` khi có `auth.users` mới; test đăng ký 1 tài khoản | T-S01 |
| T-S03 | T-S02 | Thay `AuthAndTelegram` phần login/register bằng Supabase Auth SDK; xoá `/api/auth/*` khỏi server | T-S02 |
| T-S04 | T-S01 | Tạo `services/` layer (CRUD transactions/categories/goals) dùng Supabase client, có type từ `supabase gen types` | T-S01 |
| T-S05 | T-S04 | Thay toàn bộ `saveTransactions/saveCategories/saveGoals` trong `App.tsx` gọi qua services, xoá localStorage-as-source-of-truth | T-S04 |
| T-S06 | T-S05 | Thay polling 4s bằng Realtime subscription theo `household_id` | T-S05 |
| T-S07 | T-S01 | Chuyển `/api/parse-transaction` thành Supabase Edge Function, giữ nguyên logic rule-first + Gemini fallback | T-S01 |
| T-S08 | T-S03 | Chuyển Telegram webhook thành Edge Function, dùng service-role client để insert notification | T-S03 |
| T-S09 | T-S05 | Script migrate dữ liệu demo: đổi `amount` âm/dương → cột `type` tường minh | T-S05 |
| T-S10 | tất cả | Xoá `server.ts`, `data_store.json`, các key localStorage cũ; cập nhật README | T-S03,S06,S07,S08 |

Mỗi task nên chạy độc lập theo đúng quy trình Phase 2/3 bạn đã định sẵn (1 task/context sạch, verify, commit riêng).

---

## 5. Ý tưởng cải tiến thêm (sau khi migration ổn định)

- **Optimistic UI** cho thêm giao dịch (TanStack Query `useMutation` + `onMutate`) — cảm giác "mượt" bạn muốn nằm chủ yếu ở đây, không phải ở CSS.
- **Soft delete** (`deleted_at`) thay vì xoá cứng, để có thể "hoàn tác" — dễ làm đúng với Postgres hơn nhiều so với JSON union hiện tại.
- **Audit log** đơn giản (bảng `activity_log`) thay cho cách nhét `actionDescription` vào notification — tách rõ "lịch sử thao tác" và "thông báo đẩy Telegram".
- Dùng **Postgres function + trigger** để tự cập nhật `saving_goals.current_amount` khi có transaction gắn `goal_id`, thay vì tính tay ở client (nguồn sự thật nên nằm ở DB khi có nhiều client).
