/**
 * CHỈ DÙNG TẠM để verify T-S06b bằng mắt. XOÁ FILE NÀY (và chỗ gọi nó ở
 * App.tsx) sau khi verify xong — không phải 1 phần deliverable của T-S06b.
 *
 * Cách dùng:
 * 1. Copy file này vào src/components/.
 * 2. Trong App.tsx, thêm tạm 1 dòng render <DebugHooksSmokeTest /> ở đâu đó
 *    dễ thấy (vd ngay dưới thẻ mở <div className="..."> đầu tiên trong JSX
 *    return, hoặc thay tạm nội dung 1 tab). Không cần đụng gì khác.
 * 3. Chạy app, đăng nhập như bình thường, nhìn khối debug hiện ra.
 * 4. Bấm nút đổi scope cá nhân/hộ, xem 3 khối transactions/categories/goals
 *    có đổi đúng dữ liệu theo scope không (không lẫn cá nhân/hộ).
 * 5. Nếu đúng hết -> xoá file này + dòng gọi nó ở App.tsx, báo lại kết quả.
 */
import { useScope } from "../context/ScopeContext";
import { useHousehold } from "../hooks/useHousehold";
import { useCategories } from "../hooks/useCategories";
import { useGoals } from "../hooks/useGoals";
import { useTransactions } from "../hooks/useTransactions";

export function DebugHooksSmokeTest() {
  const { scopeMode, setScopeMode } = useScope();
  const household = useHousehold();
  const categories = useCategories();
  const goals = useGoals();
  const transactions = useTransactions();

  const Section = ({
    title,
    query,
  }: {
    title: string;
    query: { data: unknown; isLoading: boolean; isError: boolean; error: unknown };
  }) => (
    <div style={{ border: "1px solid #ccc", padding: 8, marginBottom: 8 }}>
      <strong>{title}</strong>{" "}
      {query.isLoading ? "(loading...)" : query.isError ? "(ERROR)" : `(${Array.isArray(query.data) ? query.data.length : query.data === null ? "null" : "1"} kết quả)`}
      {query.isError && (
        <pre style={{ color: "red", fontSize: 11 }}>{String((query.error as Error)?.message ?? query.error)}</pre>
      )}
      <pre style={{ fontSize: 11, maxHeight: 150, overflow: "auto" }}>
        {JSON.stringify(query.data, null, 2)}
      </pre>
    </div>
  );

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        width: 380,
        maxHeight: "100vh",
        overflow: "auto",
        background: "#fff",
        zIndex: 9999,
        padding: 12,
        boxShadow: "0 0 8px rgba(0,0,0,0.3)",
      }}
    >
      <h3 style={{ margin: "0 0 8px" }}>🔧 T-S06b Debug (xoá sau khi verify)</h3>
      <div style={{ marginBottom: 8 }}>
        scopeMode hiện tại: <b>{scopeMode}</b>{" "}
        <button onClick={() => setScopeMode(scopeMode === "personal" ? "household" : "personal")}>
          Đổi sang {scopeMode === "personal" ? "household" : "personal"}
        </button>
      </div>
      <Section title="household (không đổi theo scopeMode)" query={household} />
      <Section title={`categories (scope=${scopeMode})`} query={categories} />
      <Section title={`goals (scope=${scopeMode})`} query={goals} />
      <Section title={`transactions (scope=${scopeMode})`} query={transactions} />
    </div>
  );
}
