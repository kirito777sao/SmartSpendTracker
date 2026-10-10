import { beforeAll, afterAll } from "vitest";
import { supabase } from "../../lib/supabaseClient";

/**
 * Test tích hợp THẬT — gọi thẳng vào 1 Supabase project TEST (KHÔNG phải
 * production), đúng acceptance criteria T-S05 ("unit test gọi thật vào
 * Supabase"). Cần set trong .env.test (xem .env.example):
 *   VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY       → trỏ project TEST
 *   VITE_TEST_USER_EMAIL / VITE_TEST_USER_PASSWORD   → 1 user thật đã tồn
 *                                                        tại trong project
 *                                                        TEST đó
 *
 * Prefix VITE_ bắt buộc ở cả 2 biến user test (dù không cần cho mục đích
 * bảo mật) — Vite/Vitest chỉ expose biến có prefix này qua import.meta.env,
 * kể cả khi chạy test (mode mặc định 'test' → tự load .env.test); thiếu
 * prefix sẽ đọc ra undefined mà không báo lỗi rõ ràng ở đâu.
 *
 * KHÔNG chạy được trong sandbox này (không có quyền truy cập mạng ra
 * *.supabase.co) — đây là phần bạn cần tự chạy `npm test` để verify thật,
 * cùng cơ chế UNVERIFIED-by-me như T-S04/T-S04b.
 */
export function setupAuthedTestUser() {
  beforeAll(async () => {
    const email = import.meta.env.VITE_TEST_USER_EMAIL as string;
    const password = import.meta.env.VITE_TEST_USER_PASSWORD as string;
    if (!email || !password) {
      throw new Error(
        "Thiếu VITE_TEST_USER_EMAIL / VITE_TEST_USER_PASSWORD trong .env.test — xem .env.example."
      );
    }
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  });

  afterAll(async () => {
    await supabase.auth.signOut();
  });
}
