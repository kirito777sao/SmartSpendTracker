/**
 * Types khớp CONSTITUTION.md §2 (schema đã CHỐT). Viết tay vì môi trường
 * này không có quyền truy cập trực tiếp Supabase project thật để chạy
 * `supabase gen types typescript --linked`.
 *
 * QUAN TRỌNG: đây KHÔNG phải nguồn sự thật vĩnh viễn. Khi bạn có Supabase
 * CLI linked với project thật, hãy chạy:
 *
 *   supabase gen types typescript --linked > src/lib/database.types.ts
 *
 * ...và diff với file này — nếu lệch, schema thật thắng (đồng thời báo lại
 * để cập nhật CONSTITUTION.md §2 nếu có drift ngoài kế hoạch).
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

// T-S61 (migration 0019, CONSTITUTION §1.20 tu chỉnh 11/08/2026) — 1 dòng
// giao dịch gốc đã được "đóng băng" vào 1 giai đoạn linked_history, snapshot
// BẤT BIẾN tại thời điểm đóng băng (không đổi dù sau này sửa/xoá giao dịch
// gốc).
export interface TransactionSnapshotEntry {
  id: string;
  description: string;
  date: string;
  amount: number;
}

// T-S57 (migration 0018) + T-S61 (migration 0019, CONSTITUTION §1.20 tu
// chỉnh) — 1 phần tử của `saving_goals.linked_history`: snapshot 1 giai đoạn
// đã KẾT THÚC. `type: 'linked'` = giai đoạn liên kết category (đổi category
// khác hoặc unlink); `type: 'manual'` = giai đoạn thủ công đóng băng lúc
// link sang category (T-S61, trước đây bị bỏ sót hoàn toàn). Ghi bởi RPC
// `update_goal_link`. `type`/`transactions_snapshot` optional để đọc được cả
// dữ liệu CŨ ghi bởi RPC 0018 (trước T-S61) — mapRows.ts mặc định
// `type: 'linked'`, `transactions_snapshot: []` khi thiếu.
// T-S60 (migration 0021) — `type: 'withdrawal_log'` = 1 lần "Rút quỹ" từ
// phần liên kết, ghi bởi RPC `withdraw_from_linked_goal`. `note` chỉ có ý
// nghĩa cho loại này (mục đích rút).
export interface LinkedHistoryEntry {
  type?: "linked" | "manual" | "withdrawal_log";
  category_name: string | null;
  start_date: string | null;
  end_date: string | null;
  amount: number;
  ended_at: string;
  transactions_snapshot?: TransactionSnapshotEntry[];
  note?: string;
  // T-S83 (migration 0023) — chỉ có giá trị khi `type === 'withdrawal_log'`
  // VÀ lần rút bị cascade sang cả phần thủ công (dòng `transactions` cùng
  // `withdrawal_group_id`). undefined/null với dữ liệu cũ trước T-S83 hoặc
  // rút chỉ 1 nguồn.
  withdrawal_group_id?: string | null;
  // T-S79 (migration 0024)
  manual_amount?: number;
  linked_amount?: number;
}

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          name: string;
          personal_role: string;
          household_id: string | null;
          household_role: "owner" | "member" | null;
          telegram_chat_id: string | null;
          telegram_username: string | null;
          telegram_link_token: string | null;
          telegram_active_scope: "personal" | "household";
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          name: string;
          personal_role?: string;
        };
        Update: {
          email?: string;
          name?: string;
          personal_role?: string;
          // household_id / household_role / telegram_chat_id KHÔNG được update
          // trực tiếp từ client — chỉ qua RPC (xem CONSTITUTION §5, hardening T-S12).
          telegram_username?: string | null;
          telegram_active_scope?: "personal" | "household";
        };
      };
      households: {
        Row: {
          id: string;
          name: string;
          invite_code: string;
          owner_id: string;
          // T-S15 (0010_household_ownerless_soft_delete.sql) — soft-delete.
          // null = đang hoạt động (có thể "ownerless" nếu không ai
          // household_role='owner' trỏ tới); not null = đã xoá tường minh
          // qua delete_household(), chỉ chủ hộ CŨ (owner_id) còn xem được
          // (RLS archive-view).
          deleted_at: string | null;
          created_at: string;
        };
        // Không có Insert/Update ở đây theo thiết kế — insert/join/rời hộ
        // đi qua RPC SECURITY DEFINER (create_household, join_household_by_code,
        // leave_household, remove_member, transfer_ownership), bảng chỉ có
        // policy SELECT (xem CONSTITUTION §3).
        Insert: never;
        Update: never;
      };
      categories: {
        Row: {
          id: string;
          owner_id: string | null;
          household_id: string | null;
          name: string;
          icon: string;
          // T-S06e1b (0009_categories_add_income_type.sql) — phân biệt danh
          // mục THU/CHI, thay cho chuỗi "Thu nhập" hard-code trước đây.
          type: "income" | "expense";
          limit_amount: number | null;
          is_recurring: boolean;
          created_by: string;
          // T-S16 (migration 0012) — snapshot định danh người tạo lúc TẠO
          // category, do trigger DB tự set ("${personal_role} (${name})"),
          // KHÔNG gửi từ client. Cố ý KHÔNG khai báo ở Insert/Update — cùng
          // nguyên tắc bất biến đã áp cho `member_name_snapshot` (§1.8).
          created_by_display_snapshot: string | null;
          deleted_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          owner_id?: string | null;
          household_id?: string | null;
          name: string;
          icon: string;
          // Optional: cột DB có default 'expense' — chỗ gọi nào không quan
          // tâm (vd BudgetLimits/T-S06e2 chưa migrate) vẫn tạo category chi
          // tiêu đúng như trước, không phá hành vi cũ.
          type?: "income" | "expense";
          limit_amount?: number | null;
          is_recurring?: boolean;
          created_by: string;
        };
        Update: {
          name?: string;
          icon?: string;
          type?: "income" | "expense";
          limit_amount?: number | null;
          is_recurring?: boolean;
          deleted_at?: string | null;
        };
      };
      // T-S158 (migration 0041, hướng A) — lịch sử hạn mức theo TỪNG THÁNG.
      // RLS bật, KHÔNG có policy nào (chặn hoàn toàn PostgREST trực tiếp) —
      // chỉ ghi qua trigger `sync_category_budget_period`, chỉ đọc qua RPC
      // `get_effective_categories`. Khai Insert/Update = never vì client
      // KHÔNG BAO GIỜ được phép gọi thẳng .from("category_budget_periods").
      category_budget_periods: {
        Row: {
          id: string;
          category_id: string;
          year_month: string; // 'YYYY-MM'
          limit_amount: number;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
      };
      saving_goals: {
        Row: {
          id: string;
          owner_id: string | null;
          household_id: string | null;
          name: string;
          target_amount: number | null;
          current_amount: number;
          target_date: string | null;
          created_by: string;
          // T-S16 (migration 0012) — cùng thiết kế với categories ở trên.
          created_by_display_snapshot: string | null;
          deleted_at: string | null;
          created_at: string;
          updated_at: string;
          // T-S19 (migration 0016, CONSTITUTION §1.9 mục 3) — NULL = đang
          // tiết kiệm, có giá trị = đã "Hoàn thành" (thủ công hoặc qua
          // banner tự động T-S20, cùng 1 action `useCompleteGoal`).
          completed_at: string | null;
          // T-S48 (migration 0017, CONSTITUTION §1.13) — NULL = goal thủ
          // công (mặc định). Có giá trị = goal liên kết category, 2 cột
          // ngày BẮT BUỘC cùng có giá trị (constraint DB), current_amount
          // của bảng này bỏ qua/không dùng cho loại goal này (client tự
          // tính lại từ transactions, không đọc cột current_amount).
          linked_category_id: string | null;
          linked_start_date: string | null;
          linked_end_date: string | null;
          // T-S57 (migration 0018, CONSTITUTION §1.20) — CHỈ ghi qua RPC
          // `update_goal_link` (SECURITY DEFINER, xem services/goals.ts
          // `updateGoalLink`). KHÔNG có trong Update type bên dưới — cố ý
          // chặn ở tầng kiểu dữ liệu để không ai vô tình ghi tay 3 field
          // này qua `updateGoal()` thường, tránh sai lệch dồn tiền.
          carried_over_saved_amount: number;
          carried_over_spent_amount: number;
          linked_history: LinkedHistoryEntry[];
          // T-S61 (migration 0019, CONSTITUTION §1.20 tu chỉnh 11/08/2026) —
          // ID mọi giao dịch gốc (expense trong category liên kết HOẶC
          // transfer thủ công) đã từng được cộng vào carried_over_* ở BẤT KỲ
          // lần đóng băng nào trước đó của goal này. Nguồn sự thật chống
          // đếm đúp khi link/unlink lặp lại — so theo ID cụ thể, không so
          // theo ngày/category. CHỈ ghi qua RPC `update_goal_link`, không có
          // ở Update type bên dưới (không ai được ghi tay).
          carried_over_transaction_ids: string[];
          // T-S80 (migration 0022, CONSTITUTION §1.22.5) — người dùng tự
          // chọn tường minh lúc liên kết: true = category "tiết kiệm/theo
          // dõi dòng tiền" (hồi tố đầy đủ theo khoảng ngày, hành vi gốc),
          // false = category "chi tiêu thường" (chỉ tính từ linked_at trở
          // đi). Vô nghĩa khi linked_category_id là null.
          is_savings_link: boolean;
          // T-S80 — thời điểm THẬT SỰ bấm liên kết gần nhất (khác
          // linked_start_date, cột người dùng tự chọn ngày tuỳ ý). Mặc định
          // now() lúc INSERT; RPC `update_goal_link` tự ghi lại now() mỗi
          // lần relink. KHÔNG có ở Insert/Update bên dưới — Insert dùng
          // DEFAULT của cột, không cho client gán ngày giả; sửa lại chỉ qua
          // RPC (không có ở Update, cùng mức bảo vệ carried_over_*).
          linked_at: string;
        };
        Insert: {
          owner_id?: string | null;
          household_id?: string | null;
          name: string;
          target_amount?: number | null;
          target_date?: string | null;
          created_by: string;
          // KHÔNG có completed_at ở Insert — goal luôn tạo mới ở trạng thái
          // đang tiết kiệm, "Hoàn thành" là 1 hành động riêng sau đó
          // (useCompleteGoal), không phải tuỳ chọn lúc tạo.
          // T-S48 — cả 3 optional, nhưng khi tạo goal liên kết category cả
          // 3 phải cùng có giá trị (validate ở form, DB có constraint chặn
          // trạng thái nửa vời).
          linked_category_id?: string | null;
          linked_start_date?: string | null;
          linked_end_date?: string | null;
          // T-S80 — chỉ cần khi tạo goal ĐÃ liên kết category ngay từ đầu
          // (linked_category_id có giá trị); bỏ qua = false (an toàn hơn,
          // không hồi tố — khớp default cột). KHÔNG có linked_at ở đây, dùng
          // DEFAULT now() của cột (xem giải thích ở Row).
          is_savings_link?: boolean;
        };
        Update: {
          name?: string;
          target_amount?: number | null;
          target_date?: string | null;
          deleted_at?: string | null;
          // T-S19 — cho phép set (đánh dấu Hoàn thành) hoặc unset lại về
          // null (mở khoá tiếp tục tiết kiệm, phòng trường hợp bấm nhầm —
          // chưa có nút riêng ở UI cho việc mở khoá lại, nhưng type-level
          // không khoá khả năng này để không phải sửa lại migration sau).
          completed_at?: string | null;
          // current_amount KHÔNG được update tay từ client — trigger
          // trg_goal_contribution ở DB tự tính (CONSTITUTION §2.6).
          // T-S48 — cho sửa lại category/khoảng ngày liên kết sau khi tạo
          // (hoặc gỡ liên kết bằng cách set cả 3 về null — quyết định UI cụ
          // thể để lúc code form Sửa, type-level không khoá khả năng này).
          linked_category_id?: string | null;
          linked_start_date?: string | null;
          linked_end_date?: string | null;
        };
      };
      transactions: {
        Row: {
          id: string;
          owner_id: string | null;
          household_id: string | null;
          member_id: string | null;
          // T-S14 (migration 0013, CONSTITUTION §1.9) — 'transfer' = đóng
          // góp quỹ tiết kiệm (chuyển khoản nội bộ), loại trừ khỏi thu/chi
          // thật. Xem `apply_goal_contribution` — chỉ cộng/trừ current_amount
          // khi type='transfer'.
          type: "income" | "expense" | "transfer";
          description: string;
          amount: number;
          date: string;
          note: string | null;
          category_id: string | null;
          goal_id: string | null;
          source: "web" | "telegram";
          telegram_batch_id: string | null;
          deleted_at: string | null;
          created_at: string;
          updated_at: string;
          // T-S17 (migration 0011) — snapshot tên thành viên lúc TẠO giao
          // dịch, do trigger DB tự set, KHÔNG gửi từ client. Xem cột này
          // trong Insert/Update: cố ý KHÔNG khai báo ở đó (bất biến, chỉ
          // trigger được ghi).
          member_name_snapshot: string | null;
          // T-S83 (migration 0023) — id nhóm gom 2 phần thủ công+liên kết
          // của CÙNG 1 lần "Rút quỹ" bị cascade (xem LinkedHistoryEntry ở
          // types.ts). NULL với mọi giao dịch khác.
          withdrawal_group_id: string | null;
        };
        Insert: {
          owner_id?: string | null;
          household_id?: string | null;
          member_id?: string | null;
          type: "income" | "expense" | "transfer";
          description: string;
          amount: number;
          date: string;
          note?: string | null;
          category_id?: string | null;
          goal_id?: string | null;
          source?: "web" | "telegram";
          // T-S83 — chỉ set khi tầng gọi (handleSaveWithdraw) phát hiện
          // cascade cả 2 nguồn cho cùng 1 lần rút.
          withdrawal_group_id?: string | null;
        };
        Update: {
          description?: string;
          amount?: number;
          date?: string;
          note?: string | null;
          category_id?: string | null;
          goal_id?: string | null;
          deleted_at?: string | null;
          // T-S23 (CONSTITUTION §1.10, migration 0014) — mở khoá CÓ KIỂM
          // SOÁT: chỉ 2 chiều income <-> expense, KHÔNG bao gồm 'transfer'
          // (chặn ở chính type-level TypeScript này, không chỉ ở trigger
          // DB). Validate goal_id/category cùng nhóm nằm ở
          // `buildTransactionUpdate` (toTransactionInsert.ts, tầng 1) +
          // trigger `guard_transaction_type_change` (tầng 2, DB).
          type?: "income" | "expense";
        };
      };
      activity_log: {
        Row: {
          id: string;
          household_id: string | null;
          // [T-S27, migration 0030] owner_id — scope cá nhân, đúng 1 trong 2
          // (owner_id/household_id) có giá trị (activity_log_scope_xor).
          owner_id: string | null;
          actor_id: string;
          action: string;
          entity_type: string;
          entity_id: string | null;
          message: string;
          source: "web" | "telegram" | "system";
          // [T-S27] null = chưa đọc. Chỉ đổi qua RPC mark_activity_read.
          read_at: string | null;
          created_at: string;
        };
        // Chỉ đọc từ client — mọi insert đi qua trigger DB SECURITY DEFINER
        // (xem CONSTITUTION §1.11/§3, "read own or household activity").
        Insert: never;
        Update: never;
      };
      // T-S138 (migration 0037, CONSTITUTION §1.28) — cấu hình trích ngân
      // sách tự động vào 1 saving_goal thủ công. Ghi/sửa/xoá CHỈ qua RPC
      // SECURITY DEFINER (create/update/delete/toggle_auto_contribution_config),
      // KHÔNG qua PostgREST insert/update/delete trực tiếp — cùng pattern
      // activity_log ở trên (Insert/Update: never).
      // [T-S140, migration 0038 — CONSTITUTION §1.28.2, bổ sung 26/08/2026
      // khi soát lại trước khi code T-S139: `category_id`/`goal_id` NULLABLE
      // đúng lớp lỗi "gọi rpc() mà chưa khai type" đã lặp lại 3 lần trước ở
      // đây (soft_delete_category/update_goal_link/soft_delete_transaction)
      // — file này bị bỏ sót khi viết 0038, sửa bổ sung ngay trước T-S139]
      // đúng CHECK chk_target_xor: (goal_id is not null) <> (category_id is
      // not null) — client PHẢI luôn truyền đúng 1 trong 2, không cả 2/không cả 2.
      auto_contribution_configs: {
        Row: {
          id: string;
          owner_id: string | null;
          household_id: string | null;
          goal_id: string | null;
          category_id: string | null;
          trigger_type: "on_income" | "monthly_schedule";
          amount_type: "fixed" | "percent";
          amount_value: number;
          day_of_month: number | null;
          enabled: boolean;
          created_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
      };
      // T-S138 (migration 0037) — audit trail riêng cho auto-contribution.
      // KHÔNG phải nguồn notification (notification thật đi qua
      // activity_log, action `goal.auto_contribution` / `goal.auto_contribution_skipped`).
      // Chỉ đọc (SELECT) từ client, mọi insert do trigger DB tự làm.
      auto_contribution_log: {
        Row: {
          id: string;
          config_id: string | null; // null nếu config gốc đã bị xoá cứng (ON DELETE SET NULL)
          triggered_by_transaction_id: string | null;
          contribution_transaction_id: string | null;
          computed_amount: number;
          status: "applied" | "skipped_insufficient" | "skipped_other";
          skip_reason: string | null;
          created_at: string;
        };
        Insert: never;
        Update: never;
      };
    };
    Views: Record<string, never>;
    Functions: {
      create_household: {
        Args: { p_name: string };
        Returns: string; // uuid household mới
      };
      join_household_by_code: {
        Args: { p_invite_code: string };
        Returns: string; // uuid household đã join
      };
      leave_household: {
        Args: Record<string, never>;
        Returns: void;
      };
      remove_member: {
        Args: { p_member_id: string };
        Returns: void;
      };
      transfer_ownership: {
        Args: { p_new_owner_id: string };
        Returns: void;
      };
      // T-S05 — xem 0004_rpc_soft_delete_restore_category.sql. Trước bản vá
      // này 2 hàm dưới đây bị categories.ts gọi qua supabase.rpc() mà KHÔNG
      // hề khai báo ở đây — nghĩa là lời gọi đó chưa từng được type-check
      // thật, chỉ "chạy được" nhờ generic fallback lỏng của supabase-js.
      soft_delete_category: {
        Args: { p_id: string };
        Returns: void;
      };
      restore_category: {
        Args: { p_id: string };
        Returns: void;
      };
      // [T-S27, migration 0030] p_ids: null = đánh dấu mọi hoạt động đang
      // xem được (chưa đọc) là đã đọc; not null = chỉ đúng các id đó.
      mark_activity_read: {
        Args: { p_ids?: string[] | null };
        Returns: void;
      };
      // T-S05 — xem 0006_fix_soft_delete_restore_transaction_security_definer.sql.
      // Cùng lỗ hổng đã fix cho category ở trên: transactions.ts gọi 2 hàm
      // này qua supabase.rpc() từ 0004 nhưng CHƯA từng được khai báo ở đây.
      soft_delete_transaction: {
        Args: { p_id: string };
        Returns: void;
      };
      restore_transaction: {
        Args: { p_id: string };
        Returns: void;
      };
      // T-S05b — xem 0008_rpc_delete_goal.sql.
      delete_goal: {
        Args: { p_goal_id: string };
        Returns: void;
      };
      // T-S15 — xem 0010_household_ownerless_soft_delete.sql.
      delete_household: {
        Args: Record<string, never>;
        Returns: void;
      };
      // T-S57 (migration 0018) + T-S61 (migration 0019, CONSTITUTION §1.20.1)
      // — xem services/goals.ts `updateGoalLink`. BỊ BỎ SÓT ở đây từ 0018
      // (cùng lớp lỗi "gọi rpc() nhưng chưa khai báo Functions" đã ghi chú ở
      // soft_delete_category/soft_delete_transaction phía trên) — phát hiện
      // và bổ sung lúc soát lại T-S61. Không đổi hành vi runtime (client vẫn
      // gọi đúng tên hàm), chỉ bổ sung type-check còn thiếu cho lời gọi này.
      update_goal_link: {
        Args: {
          p_goal_id: string;
          p_new_linked_category_id: string | null;
          p_new_linked_start_date: string | null;
          p_new_linked_end_date: string | null;
          // T-S80 (migration 0022) — optional ở type-level vì SQL có DEFAULT
          // false, nhưng client (services/goals.ts updateGoalLink) LUÔN
          // truyền tường minh khi có liên kết mới (radio bắt buộc T-S81,
          // không dựa vào default false khi thật sự đang link category).
          p_is_savings_link?: boolean;
        };
        Returns: Database["public"]["Tables"]["saving_goals"]["Row"];
      };
      // T-S60 (migration 0021, CONSTITUTION §1.21) — xem services/goals.ts
      // `withdrawFromLinkedGoal`. Rút quỹ từ PHẦN LIÊN KẾT (ghi log vào
      // linked_history, không tạo giao dịch). Khai báo ngay từ đầu (không
      // để rơi vào lớp lỗi "bỏ sót Functions" đã gặp ở update_goal_link).
      withdraw_from_linked_goal: {
        Args: {
          p_goal_id: string;
          p_amount: number | null;
          p_note: string | null;
          p_close_goal: boolean;
        };
        Returns: Database["public"]["Tables"]["saving_goals"]["Row"];
      };
      // T-S138 (migration 0037, CONSTITUTION §1.28) — 4 RPC CRUD cho
      // auto_contribution_configs. Mỗi RPC tự re-check auth.uid() đúng
      // quyền sở hữu qua goal_id/category_id/config_id (không nhận actor
      // qua tham số).
      // [T-S140, migration 0038] — chữ ký đổi hẳn: p_goal_id giờ optional
      // (nullable, default null), thêm p_category_id ở CUỐI. Bản 0038 đã
      // DROP chữ ký 5-tham-số cũ (xem comment migration "BUGFIX tự phát
      // hiện... T-S86 tái diễn") — CHỈ CÒN đúng 1 overload 6 tham số này
      // tồn tại thật trên DB, khai type phải khớp đúng bản còn sống.
      // Đúng CHECK chk_target_xor + chk_category_only_monthly: truyền ĐÚNG
      // 1 trong 2 (p_goal_id XOR p_category_id); nếu dùng p_category_id,
      // p_trigger_type BẮT BUỘC 'monthly_schedule'.
      create_auto_contribution_config: {
        Args: {
          p_goal_id?: string | null;
          p_trigger_type: "on_income" | "monthly_schedule";
          p_amount_type: "fixed" | "percent";
          p_amount_value: number;
          p_day_of_month?: number | null;
          p_category_id?: string | null;
        };
        Returns: string; // uuid config mới
      };
      update_auto_contribution_config: {
        Args: {
          p_config_id: string;
          p_trigger_type: "on_income" | "monthly_schedule";
          p_amount_type: "fixed" | "percent";
          p_amount_value: number;
          p_day_of_month?: number | null;
        };
        Returns: void;
      };
      delete_auto_contribution_config: {
        Args: { p_config_id: string };
        Returns: void;
      };
      // p_enabled=true bị chặn (raise exception) nếu đã có 1 config khác
      // đang bật trong cùng scope (v1 chỉ cho 1 cấu hình active/lúc).
      toggle_auto_contribution_config: {
        Args: { p_config_id: string; p_enabled: boolean };
        Returns: void;
      };
      // T-S158 (migration 0041, hướng A) — nguồn đọc DUY NHẤT cho "category
      // kèm hạn mức ÁP DỤNG đúng 1 tháng". p_year_month null = tháng hiện
      // tại (giờ VN). Đúng 1 trong 2: p_owner_id XOR p_household_id (khớp
      // quy ước "2 phạm vi tách biệt" đã dùng ở listCategories/listTransactions
      // — hàm tự raise exception nếu cả 2 null hoặc không đúng quyền).
      // limit_amount = null nghĩa là category KHÔNG có hạn mức áp dụng
      // tháng đó (is_recurring=false đã qua tháng tạo, hoặc chưa từng đặt
      // hạn mức) — KHÔNG bị lọc khỏi kết quả trả về.
      get_effective_categories: {
        Args: {
          p_owner_id?: string | null;
          p_household_id?: string | null;
          p_year_month?: string | null;
        };
        Returns: {
          id: string;
          name: string;
          icon: string;
          type: "income" | "expense";
          limit_amount: number | null;
          is_recurring: boolean;
          template_limit_amount: number | null;
        }[];
      };
    };
    Enums: Record<string, never>;
  };
}