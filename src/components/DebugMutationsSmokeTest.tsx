/**
 * CHỈ DÙNG TẠM để verify T-S06c bằng mắt. XOÁ FILE NÀY (và chỗ gọi nó ở
 * App.tsx) sau khi verify xong — không phải 1 phần deliverable của T-S06c.
 *
 * Cách dùng: giống DebugHooksSmokeTest (T-S06b) — render tạm trong App.tsx,
 * npm run dev, đăng nhập, bấm các nút test theo scope hiện tại (đổi scope
 * bằng khung debug T-S06b nếu bạn còn giữ nó, hoặc dùng nút trong khung này).
 *
 * Mỗi nút gọi 1 mutation thật vào Supabase project TEST rồi dựa vào
 * `useCategories/useGoals/useTransactions/useHousehold` (đã invalidate)
 * để xác nhận UI tự cập nhật sau khi round-trip xong — không optimistic
 * (đúng phạm vi T-S06c).
 */
import { useState } from "react";
import { useScope } from "../context/ScopeContext";
import { useCurrentUserId } from "../hooks/useCurrentUserId";
import { useDataScope } from "../hooks/useDataScope";
import {
  useCategories,
  useCreateCategory,
  useSoftDeleteCategory,
} from "../hooks/useCategories";
import { useCreateGoal, useGoals, useSoftDeleteGoal } from "../hooks/useGoals";
import {
  useCreateTransaction,
  useSoftDeleteTransaction,
  useTransactions,
} from "../hooks/useTransactions";
import {
  useCreateHousehold,
  useHousehold,
  useJoinHousehold,
  useLeaveHousehold,
} from "../hooks/useHousehold";

export function DebugMutationsSmokeTest() {
  const { scopeMode } = useScope();
  const userId = useCurrentUserId();
  const { householdId } = useDataScope();

  const categories = useCategories();
  const goals = useGoals();
  const transactions = useTransactions();
  const household = useHousehold();

  const createCategory = useCreateCategory();
  const deleteCategory = useSoftDeleteCategory();
  const createGoal = useCreateGoal();
  const deleteGoal = useSoftDeleteGoal();
  const createTransaction = useCreateTransaction();
  const deleteTransaction = useSoftDeleteTransaction();
  const createHousehold = useCreateHousehold();
  const joinHousehold = useJoinHousehold();
  const leaveHousehold = useLeaveHousehold();

  const [inviteCodeInput, setInviteCodeInput] = useState("");
  const [log, setLog] = useState<string[]>([]);
  const pushLog = (msg: string) => setLog((l) => [msg, ...l].slice(0, 10));

  const scope = scopeMode === "household" ? { household_id: householdId } : { owner_id: userId };
  const createdBy = userId as string;

  return (
    <div
      style={{
        position: "fixed",
        bottom: 0,
        right: 0,
        width: 380,
        maxHeight: "60vh",
        overflow: "auto",
        background: "#fff",
        zIndex: 9999,
        padding: 12,
        boxShadow: "0 0 8px rgba(0,0,0,0.3)",
        fontSize: 12,
      }}
    >
      <h3 style={{ margin: "0 0 8px" }}>🔧 T-S06c Debug (xoá sau khi verify)</h3>
      <div>scopeMode: <b>{scopeMode}</b> — householdId: <code>{householdId ?? "null"}</code></div>

      <div style={{ marginTop: 8, borderTop: "1px solid #eee", paddingTop: 8 }}>
        <b>Category</b> ({categories.data?.length ?? 0} hiện có)
        <div>
          <button
            disabled={createCategory.isPending}
            onClick={() =>
              createCategory.mutate(
                { ...scope, name: `Test ${Date.now()}`, icon: "🧪", created_by: createdBy },
                {
                  onSuccess: (row) => pushLog(`✅ created category ${row.id}`),
                  onError: (e) => pushLog(`❌ create category: ${(e as Error).message}`),
                }
              )
            }
          >
            + Tạo category test
          </button>{" "}
          <button
            disabled={deleteCategory.isPending || !categories.data?.length}
            onClick={() => {
              const last = categories.data?.[categories.data.length - 1];
              if (!last) return;
              deleteCategory.mutate(last.id, {
                onSuccess: () => pushLog(`✅ soft-deleted category ${last.id}`),
                onError: (e) => pushLog(`❌ delete category: ${(e as Error).message}`),
              });
            }}
          >
            − Xoá category cuối
          </button>
        </div>
      </div>

      <div style={{ marginTop: 8, borderTop: "1px solid #eee", paddingTop: 8 }}>
        <b>Goal</b> ({goals.data?.length ?? 0} hiện có)
        <div>
          <button
            disabled={createGoal.isPending}
            onClick={() =>
              createGoal.mutate(
                { ...scope, name: `Test goal ${Date.now()}`, target_amount: 1000000, created_by: createdBy },
                {
                  onSuccess: (row) => pushLog(`✅ created goal ${row.id}`),
                  onError: (e) => pushLog(`❌ create goal: ${(e as Error).message}`),
                }
              )
            }
          >
            + Tạo goal test
          </button>{" "}
          <button
            disabled={deleteGoal.isPending || !goals.data?.length}
            onClick={() => {
              const last = goals.data?.[goals.data.length - 1];
              if (!last) return;
              deleteGoal.mutate(last.id, {
                onSuccess: () => pushLog(`✅ soft-deleted goal ${last.id}`),
                onError: (e) => pushLog(`❌ delete goal: ${(e as Error).message}`),
              });
            }}
          >
            − Xoá goal cuối
          </button>
        </div>
      </div>

      <div style={{ marginTop: 8, borderTop: "1px solid #eee", paddingTop: 8 }}>
        <b>Transaction</b> ({transactions.data?.length ?? 0} hiện có)
        <div>
          <button
            disabled={createTransaction.isPending}
            onClick={() =>
              createTransaction.mutate(
                {
                  ...scope,
                  member_id: scopeMode === "household" ? createdBy : undefined,
                  type: "expense",
                  description: "Test transaction",
                  amount: 1000,
                  date: new Date().toISOString().slice(0, 10),
                },
                {
                  onSuccess: (row) => pushLog(`✅ created transaction ${row.id}`),
                  onError: (e) => pushLog(`❌ create transaction: ${(e as Error).message}`),
                }
              )
            }
          >
            + Tạo transaction test
          </button>{" "}
          <button
            disabled={deleteTransaction.isPending || !transactions.data?.length}
            onClick={() => {
              const last = transactions.data?.[0];
              if (!last) return;
              deleteTransaction.mutate(last.id, {
                onSuccess: () => pushLog(`✅ soft-deleted transaction ${last.id}`),
                onError: (e) => pushLog(`❌ delete transaction: ${(e as Error).message}`),
              });
            }}
          >
            − Xoá transaction đầu
          </button>
        </div>
      </div>

      <div style={{ marginTop: 8, borderTop: "1px solid #eee", paddingTop: 8 }}>
        <b>Household</b> — hiện tại: <code>{household.data?.name ?? "null"}</code>
        <div>
          <button
            disabled={createHousehold.isPending}
            onClick={() =>
              createHousehold.mutate(`Hộ test ${Date.now()}`, {
                onSuccess: (id) => pushLog(`✅ created household ${id}`),
                onError: (e) => pushLog(`❌ create household: ${(e as Error).message}`),
              })
            }
          >
            + Tạo household test
          </button>
        </div>
        <div style={{ marginTop: 4 }}>
          <input
            placeholder="invite code"
            value={inviteCodeInput}
            onChange={(e) => setInviteCodeInput(e.target.value)}
            style={{ width: 90 }}
          />{" "}
          <button
            disabled={joinHousehold.isPending || !inviteCodeInput}
            onClick={() =>
              joinHousehold.mutate(inviteCodeInput, {
                onSuccess: (id) => pushLog(`✅ joined household ${id}`),
                onError: (e) => pushLog(`❌ join household: ${(e as Error).message}`),
              })
            }
          >
            Join
          </button>{" "}
          <button
            disabled={leaveHousehold.isPending}
            onClick={() =>
              leaveHousehold.mutate(undefined, {
                onSuccess: () => pushLog(`✅ left household`),
                onError: (e) => pushLog(`❌ leave household: ${(e as Error).message}`),
              })
            }
          >
            Leave
          </button>
        </div>
      </div>

      <div style={{ marginTop: 8, borderTop: "1px solid #eee", paddingTop: 8 }}>
        <b>Log</b>
        <ul style={{ margin: 0, paddingLeft: 16 }}>
          {log.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
