# Mô phỏng lại đúng logic của RPC get_effective_categories (plpgsql) bằng
# Python thuần, để verify tĩnh không cần Postgres thật trong sandbox.

def get_effective(categories, periods, year_month, current_month):
    """
    categories: list of dict {id, limit_amount, is_recurring}
    periods: dict {(category_id, year_month): limit_amount}  (mutated in-place, mô phỏng INSERT)
    """
    out = {}
    for c in categories:
        cid = c["id"]
        period_limit = periods.get((cid, year_month))

        if period_limit is None and c["is_recurring"] and year_month == current_month:
            # carry forward from latest prior period
            prior_months = sorted(
                (ym for (pid, ym) in periods if pid == cid and ym < year_month), reverse=True
            )
            carry = periods[(cid, prior_months[0])] if prior_months else None
            if carry is None:
                carry = c["limit_amount"]
            if carry is not None:
                periods[(cid, year_month)] = carry
                period_limit = carry

        out[cid] = period_limit
    return out


pass_c = fail_c = 0
def check(desc, actual, expected):
    global pass_c, fail_c
    ok = actual == expected
    if ok: pass_c += 1
    else: fail_c += 1
    print(f"{'PASS' if ok else 'FAIL'} | expected={expected} actual={actual} | {desc}")


# --- Case 1: category recurring=true, limit set tháng 08, sang tháng 09 (hiện tại) -> tự copy ---
cats = [{"id": "cat_an_uong", "limit_amount": 2_000_000, "is_recurring": True}]
periods = {("cat_an_uong", "2026-08"): 2_000_000}  # đã có period tháng 8 (do trigger ghi lúc set)
res = get_effective(cats, periods, "2026-09", "2026-09")
check("recurring=true: tháng 08 có limit -> tháng 09 (hiện tại) tự copy sang", res["cat_an_uong"], 2_000_000)
check("sau khi materialize, period tháng 09 đã được ghi lại (upsert)", periods.get(("cat_an_uong", "2026-09")), 2_000_000)

# --- Case 2: category is_recurring=false, limit set tháng 08, sang tháng 09 -> PHẢI ẩn (null), KHÔNG xoá lịch sử ---
cats2 = [{"id": "cat_du_lich", "limit_amount": 5_000_000, "is_recurring": False}]
periods2 = {("cat_du_lich", "2026-08"): 5_000_000}
res2 = get_effective(cats2, periods2, "2026-09", "2026-09")
check("is_recurring=false: tháng 09 (đã qua tháng tạo) -> None (ẩn khỏi ngân sách)", res2["cat_du_lich"], None)
check("is_recurring=false: dòng lịch sử tháng 08 KHÔNG bị xoá", periods2.get(("cat_du_lich", "2026-08")), 5_000_000)
res2_hist = get_effective(cats2, periods2, "2026-08", "2026-09")
check("is_recurring=false: query lại đúng tháng 08 (báo cáo) vẫn thấy giá trị cũ", res2_hist["cat_du_lich"], 5_000_000)

# --- Case 3: category mới set limit lần đầu ngay tháng hiện tại (trigger vừa ghi) -> đọc luôn không cần materialize ---
cats3 = [{"id": "cat_moi", "limit_amount": 1_000_000, "is_recurring": True}]
periods3 = {("cat_moi", "2026-09"): 1_000_000}
res3 = get_effective(cats3, periods3, "2026-09", "2026-09")
check("category mới, period đã có sẵn tháng hiện tại -> đọc thẳng, không materialize thêm", res3["cat_moi"], 1_000_000)

# --- Case 4: category recurring=true nhưng NGẮT QUÃNG nhiều tháng không ai đọc (period chỉ có tháng 06) -> carry từ tháng gần nhất ---
cats4 = [{"id": "cat_giai_tri", "limit_amount": 300_000, "is_recurring": True}]
periods4 = {("cat_giai_tri", "2026-06"): 300_000}
res4 = get_effective(cats4, periods4, "2026-09", "2026-09")
check("recurring=true, bỏ lỡ 07/08 (không ai đọc), đọc tháng 09 -> vẫn carry đúng từ tháng 06 gần nhất", res4["cat_giai_tri"], 300_000)

# --- Case 5: category chưa từng có period nào (limit set trước khi có trigger/migration, categories.limit_amount vẫn có) ---
# Trường hợp này thực tế được migration backfill xử lý (INSERT initial period cho tháng hiện tại lúc apply
# migration) nên periods sẽ có sẵn — nhưng vẫn test fallback categories.limit_amount hoạt động đúng nếu
# vì lý do nào đó backfill bị bỏ qua.
cats5 = [{"id": "cat_fallback", "limit_amount": 700_000, "is_recurring": True}]
periods5 = {}
res5 = get_effective(cats5, periods5, "2026-09", "2026-09")
check("recurring=true, chưa từng có period nào -> fallback categories.limit_amount (template)", res5["cat_fallback"], 700_000)

# --- Case 6: category KHÔNG có limit_amount nào cả (chưa từng set) -> None mãi mãi, không lỗi ---
cats6 = [{"id": "cat_trong", "limit_amount": None, "is_recurring": True}]
periods6 = {}
res6 = get_effective(cats6, periods6, "2026-09", "2026-09")
check("category chưa từng đặt hạn mức -> None, không lỗi, không materialize", res6["cat_trong"], None)

# --- Case 7: is_recurring=false NHƯNG limit set ĐÚNG tháng hiện tại (chưa qua tháng tạo) -> vẫn hiện ---
cats7 = [{"id": "cat_hien_tai", "limit_amount": 800_000, "is_recurring": False}]
periods7 = {("cat_hien_tai", "2026-09"): 800_000}
res7 = get_effective(cats7, periods7, "2026-09", "2026-09")
check("is_recurring=false, đúng tháng tạo (hiện tại) -> vẫn hiện bình thường", res7["cat_hien_tai"], 800_000)

# --- Case 8: query 1 tháng TƯƠNG LAI (không phải hiện tại) cho recurring=true, chưa có period -> KHÔNG được tự bịa ---
cats8 = [{"id": "cat_tuong_lai", "limit_amount": 900_000, "is_recurring": True}]
periods8 = {("cat_tuong_lai", "2026-08"): 900_000}
res8 = get_effective(cats8, periods8, "2026-12", "2026-09")  # hỏi tháng 12 trong khi hiện tại là 09
check("query tháng TƯƠNG LAI (không phải current_month) -> KHÔNG materialize, trả None", res8["cat_tuong_lai"], None)
check("query tháng tương lai KHÔNG được tự ghi thêm dòng period nào", periods8.get(("cat_tuong_lai", "2026-12")), None)

print(f"\n{pass_c} PASS / {fail_c} FAIL / {pass_c+fail_c} total")
import sys
sys.exit(1 if fail_c else 0)
