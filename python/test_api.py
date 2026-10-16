# -*- coding: utf-8 -*-
"""
API 层测试：python3 test_api.py
验证 api.build_inputs 的参数映射与校验（引擎逻辑已由 test_engine.py 75 项覆盖）。
"""
import json
import subprocess
import sys

from api import build_inputs, load_params, run_simulate

failures = 0


def expect(name, cond, detail=""):
    global failures
    if not cond:
        failures += 1
    print(f"{'PASS' if cond else 'FAIL'} {name} {detail}")


def expect_close(name, actual, expected, tol=1):
    expect(name, abs(actual - expected) <= tol, f"actual={actual:.2f} expected={expected}")


# 1. 映射：租价 → 出租收入 + 租房自住租金（同值）
inp, warn = build_inputs({"price": 5_000_000, "rent": 14_000})
expect("rent → rental_income_monthly_0", inp.rental_income_monthly_0 == 14_000)
expect("rent → rent1_monthly 同值", inp.rent1_monthly == 14_000)
expect("rent2 默认 18000", inp.rent2_monthly == 18_000)
expect("price → property_price", inp.property_price == 5_000_000)
expect("cash_follow_upfront 强制开启", inp.cash_follow_upfront is True)

# 2. 换房开关联动：switch=True → rent_out_enabled + switch_year 生效
inp_sw, _ = build_inputs({"price": 5_000_000, "rent": 14_000, "switch": True, "switch_year": 4})
expect("switch=True → rent_out_enabled", inp_sw.rent_out_enabled is True)
expect("switch_year=4 生效", inp_sw.switch_year == 4)
expect("rent2 覆盖", build_inputs({"price": 5_000_000, "rent": 14_000, "rent2": 20_000})[0].rent2_monthly == 20_000)

# 3. 换房关闭：switch_year 强制归零（引擎语义 0 = 不换）
inp_off, _ = build_inputs({"price": 5_000_000, "rent": 14_000, "switch": False, "switch_year": 4})
expect("switch=False → switch_year=0", inp_off.switch_year == 0)
expect("switch=False → rent_out_enabled=False", inp_off.rent_out_enabled is False)

# 4. 其余参数走默认（与 DEFAULT_INPUTS 一致）
expect("mortgage_rates 默认 3.0", inp.mortgage_rates[0] == 3.0 and len(set(inp.mortgage_rates)) == 1)
expect("cash_rebate_pct 默认 1.2", inp.cash_rebate_pct == 1.2)
expect("renovation 默认 20000", inp.renovation == 20_000)
expect("mgmt_fee 映射", build_inputs({"price": 5_000_000, "rent": 14_000, "mgmt_fee": 2000})[0].mgmt_fee_monthly == 2000)

# 5. 校验
def expect_error(name, spec, keyword):
    try:
        build_inputs(spec)
        expect(name, False, "（未抛错）")
    except ValueError as e:
        expect(name, keyword in str(e), f"msg={e}")

expect_error("缺 price 报错", {"rent": 14000}, "price")
expect_error("缺 rent 报错", {"price": 5000000}, "rent")
expect_error("years>30 报错", {"price": 5, "rent": 1, "years": 31}, "years")
expect_error("down_payment>100 报错", {"price": 5, "rent": 1, "down_payment": 101}, "down_payment")
expect_error("switch_year<1 报错", {"price": 5, "rent": 1, "switch": True, "switch_year": 0}, "switch_year")
inp_warn, warn = build_inputs({"price": 5_000_000, "rent": 14_000, "switch": True, "switch_year": 11, "years": 10})
expect("switch_year>T 产生警告（不崩）", any("超过模拟时长" in w for w in warn))

# 6. run_simulate 输出结构与数字自洽
out = run_simulate({"price": 5_000_000, "rent": 13_500, "switch": True, "switch_year": 6})
expect_close("默认口径 diff = buy − rent", out["diff"], out["buy_net_worth"] - out["rent_net_worth"], 0.02)
expect("输出字段齐全", all(k in out for k in
      ["buy_net_worth", "rent_net_worth", "diff", "break_even_year", "monthly_payment", "upfront_buy", "warnings"]))
expect("手头现金=期初总支出（无资金不足警告）", all("资金不足" not in w for w in out["warnings"]))

# 7. 与 test_engine.py 默认场景锚点一致（同参数直连引擎）
inp_anchor, _ = build_inputs({"price": 5_000_000, "rent": 13_500, "switch": True, "switch_year": 6})
expect("API 与 UI 默认参数一致（renovation 20000）", inp_anchor.renovation == 20_000)

# 8. CLI 冒烟：python3 api.py simulate 输出合法 JSON
proc = subprocess.run(
    [sys.executable, "api.py", "simulate", "--price", "5000000", "--rent", "13500",
     "--switch", "--switch-year", "6"],
    capture_output=True, text=True,
)
expect("CLI 退出码 0", proc.returncode == 0, proc.stderr[:200])
cli_out = json.loads(proc.stdout)
expect_close("CLI 与 run_simulate diff 一致", cli_out["diff"], out["diff"], 0.02)

# 9. 参数文件层（UI 导出 → api.py --params）
import tempfile
import os

ui_params = {  # 模拟 UI 导出：camelCase + {metadata, params} 包装
    "metadata": {"description": "test"},
    "params": {
        "years": 25, "mortgageRates": [3.2] * 30, "cashRebatePct": 1.0,
        "renovation": 30_000, "monthlyIncome": 80_000, "livingExpenseMonthly": 25_000,
        "rentOutEnabled": True, "switchYear": 5, "downPaymentPct": 50,
        "cashFollowUpfront": True, "unknownField": 123,
    },
}
tmp = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8")
json.dump(ui_params, tmp)
tmp.close()
p_dict, p_warn = load_params(tmp.name)
expect("load_params 映射 mortgageRates→mortgage_rates", p_dict.get("mortgage_rates") == [3.2] * 30)
expect("load_params 忽略未知字段并警告", any("unknownField" in w for w in p_warn))
expect("load_params 字段数 = UI 导出有效字段数", len(p_dict) == len(ui_params["params"]) - 1)

inp_p, _ = build_inputs({"price": 5_000_000, "rent": 13_500}, p_dict)
expect("params 层 引擎字段生效（利率 3.2）", inp_p.mortgage_rates[0] == 3.2)
expect("params 层 回赠 1.0", inp_p.cash_rebate_pct == 1.0)
expect("params 层 装修 30000", inp_p.renovation == 30_000)
expect("params 层 收入 80000", inp_p.monthly_income == 80_000)
expect("params 层 years 25", inp_p.years == 25)
expect("params 层 down 50", inp_p.down_payment_pct == 50)
expect("params 层 换房 rent_out_enabled=True/switch_year=5", inp_p.rent_out_enabled is True and inp_p.switch_year == 5)
expect("params 层 price/rent 仍由请求接管", inp_p.property_price == 5_000_000 and inp_p.rent1_monthly == 13_500)

# 请求显式参数覆盖 params 层
inp_p2, _ = build_inputs({"price": 5_000_000, "rent": 13_500, "years": 8, "down_payment": 40}, p_dict)
expect("请求层覆盖 params（years 8）", inp_p2.years == 8)
expect("请求层覆盖 params（down 40）", inp_p2.down_payment_pct == 40)
expect("未覆盖字段仍用 params（利率 3.2）", inp_p2.mortgage_rates[0] == 3.2)

# CLI --params 集成：请求显式 --years 覆盖 params，其余用 params
proc2 = subprocess.run(
    [sys.executable, "api.py", "--params", tmp.name, "simulate",
     "--price", "5000000", "--rent", "13500", "--years", "12", "--no-switch"],
    capture_output=True, text=True,
)
expect("CLI --params 退出码 0", proc2.returncode == 0, proc2.stderr[:300])
cli2 = json.loads(proc2.stdout)
expect("CLI --params years=12（请求覆盖）", cli2["years"] == 12)
expect_close(
    "CLI --params diff 与 run_simulate 一致",
    cli2["diff"],
    run_simulate({"price": 5_000_000, "rent": 13_500, "years": 12, "switch": False}, p_dict)["diff"],
    0.02,
)
expect("CLI --params 无换房（--no-switch 覆盖 params True）", cli2["switch"] is False)
os.unlink(tmp.name)

print()
print("全部通过" if failures == 0 else f"{failures} 个失败")
raise SystemExit(0 if failures == 0 else 1)
