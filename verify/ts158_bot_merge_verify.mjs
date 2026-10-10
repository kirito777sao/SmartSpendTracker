// Mô phỏng logic merge trong fetchCategoriesFull (T-S158b) — không cần Deno/Supabase thật.
function mergeEffective(rows, effectiveRows) {
  const effectiveMap = new Map(effectiveRows.map((e) => [e.id, e.limit_amount]));
  return rows.map((row) =>
    effectiveMap.has(row.id) ? { ...row, limit_amount: effectiveMap.get(row.id) ?? null } : row
  );
}

let pass = 0, fail = 0;
function check(desc, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++; else fail++;
  console.log(`${ok ? "PASS" : "FAIL"} | ${desc} | expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
}

const rawRows = [
  { id: "c1", name: "ăn uống", limit_amount: 2000000, type: "expense" }, // recurring, stale (chưa materialize)
  { id: "c2", name: "du lịch", limit_amount: 5000000, type: "expense" }, // is_recurring=false, đã hết hạn
  { id: "c3", name: "hoá đơn", limit_amount: 1000000, type: "expense" }, // recurring, đã materialize đúng
];
const effectiveRows = [
  { id: "c1", limit_amount: 2000000 }, // vừa materialize xong, giá trị giống raw (trùng hợp)
  { id: "c2", limit_amount: null },    // hết hạn -> null
  { id: "c3", limit_amount: 1000000 },
];

const merged = mergeEffective(rawRows, effectiveRows);
check("c1 giữ đúng limit hiệu lực", merged.find((r) => r.id === "c1").limit_amount, 2000000);
check("c2 (hết hạn) -> null, ghi đè giá trị thô 5tr cũ", merged.find((r) => r.id === "c2").limit_amount, null);
check("c3 giữ nguyên", merged.find((r) => r.id === "c3").limit_amount, 1000000);
check("name/type không đổi (chỉ merge limit_amount)", merged.find((r) => r.id === "c2").name, "du lịch");

// Case: RPC lỗi -> fallback rows nguyên bản (test riêng nhánh code, không qua hàm merge)
console.log("\n(RPC lỗi -> fallback trả nguyên `rows` gốc, đã review trực tiếp trong code, không cần mô phỏng thêm)");

console.log(`\n${pass} PASS / ${fail} FAIL / ${pass+fail} total`);
process.exit(fail ? 1 : 0);
