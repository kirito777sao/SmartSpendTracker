import { defineConfig } from "vitest/config";

// Vitest tự load .env.test vào import.meta.env (mode mặc định = 'test',
// theo đúng cơ chế loadEnv của Vite) — không cần cấu hình thêm ở đây.
// Xem src/services/__tests__/testSetup.ts + .env.example cho danh sách
// biến bắt buộc phải có trong .env.test.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // [T-S145, 31/08/2026] BẮT BUỘC — mọi file test tích hợp thật trong
    // src/services/__tests__/ dùng CHUNG đúng 1 tài khoản Supabase TEST
    // (xem testSetup.ts, project TEST chỉ có 1 user). Các file này mutate
    // state per-user DÙNG CHUNG không có khoá: profiles.household_id
    // (household.test.ts/rlsHardening.test.ts), ràng buộc "1 config
    // enabled=true/scope" của CONSTITUTION §1.28 (autoContribution.test.ts).
    // Mặc định Vitest chạy nhiều FILE test song song -> các file giẫm chân
    // nhau (VD household.test.ts tạo household cho user ngay giữa lúc
    // rlsHardening.test.ts đang rời hộ rồi kiểm tra lại). fileParallelism:
    // false ép chạy TUẦN TỰ từng file — sửa tối thiểu, không đổi kiến trúc
    // test/không cần thêm test user thứ 2.
    fileParallelism: false,
  },
});
