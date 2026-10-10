import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Thiếu VITE_SUPABASE_URL hoặc VITE_SUPABASE_ANON_KEY. Kiểm tra file .env (xem .env.example)."
  );
}

// Thêm generic <Database> so với bản T-S04 — không đổi cách khởi tạo hay
// export, chỉ bật type-safety cho .from()/.rpc() dùng ở services/ (T-S05).
// authMapping.ts (T-S04) không cần sửa gì, tự nhận type tốt hơn miễn phí.
export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey);
