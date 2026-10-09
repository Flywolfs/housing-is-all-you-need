# -*- coding: utf-8 -*-
"""
引擎对照测试：python3 test_engine.py
断言与 scripts/smoke.ts（TypeScript 版）完全一致，全部通过说明两个引擎数字一致。
"""
from hk_engine import Inputs, DEFAULT_INPUTS, simulate, stamp_duty_residential

failures = 0


def expect_close(name, actual, expected, tol=1):
    global failures
    ok = abs(actual - expected) <= tol
    if not ok:
        failures += 1
    print(f"{'PASS' if ok else 'FAIL'} {name}: actual={actual:.2f} expected={expected}")


# 1. 印花税税表（IRD 官方锚点）
expect_close("SD 4M", stamp_duty_residential(4_000_000), 100)
expect_close("SD 5M", stamp_duty_residential(5_000_000), 112_500)
expect_close("SD 6M", stamp_duty_residential(6_000_000), 135_000)
expect_close("SD 6.7M", stamp_duty_residential(6_700_000), 201_000)
expect_close("SD 10M", stamp_duty_residential(10_000_000), 370_000)  # 9M-10.08M 段有边际减免
expect_close("SD 21,739,121", stamp_duty_residential(21_739_121), round(21_739_121 * 0.0425))

# 2. 首年月供：$3.5M @3.5% 30年 ≈ $15,716.57
r = simulate(Inputs(**{**DEFAULT_INPUTS.__dict__, "switch_year": 0, "rent_out_enabled": False, "mdi_enabled": False}))
expect_close("首年月供 3.5M@3.5%/30y", r.derived.monthly_payment_0, 15_716.57, 1)

# 3. 不变量：租金=0、无任何费用、零利率时，两方案净资产完全相等（同一起点现金）
zero_all = dict(
    down_payment_pct=100,  # 全现金买，排除按揭利息干扰
    investment_return_pct=0,
    deposit_rate_pct=0,
    rent1_monthly=0,
    rent2_monthly=0,
    deposit_months=0,
    prepaid_months=0,
    tenant_agent_fee_months=0,
    tenant_stamp_duty_pct_of_annual=0,
    moving_cost_per_move=0,
    mgmt_fee_monthly=0,
    rates_gov_rent_override=0,
    fire_insurance_annual=0,
    maintenance_pct_of_price=0,
    renovation=0,
    agency_fee_pct=0,
    stamp_duty_override=0,
    legal_fee_buy=0,
    legal_fee_mortgage=0,
    misc_fees=0,
    switch_year=0,
    rent_out_enabled=False,
    sell_year=None,
    monthly_income=50_000,
    living_expense_monthly=20_000,
    mdi_enabled=False,
    mortgage_link_enabled=False,
    cash_rebate_pct=0,
)
r_a = simulate(Inputs(**{**DEFAULT_INPUTS.__dict__, **zero_all}))
for row in r_a.rows:
    expect_close(f"不变量A@第{row.year}年", row.buy_net_worth - row.rent_net_worth, 0, 2)

# 3b. 零利率下：差额 = 租客累计总支出（与楼价和现金无关）
r_b = simulate(Inputs(**{**DEFAULT_INPUTS.__dict__, **zero_all, "rent1_monthly": 1_000}))
for row in r_b.rows:
    expect_close(f"不变量B@第{row.year}年", row.buy_net_worth - row.rent_net_worth, 1_000 * 12 * row.year, 2)

# 4. 与 TS 版对照的关键数字（scripts/smoke.ts 同款场景）
r_default = simulate(DEFAULT_INPUTS)
expect_close("默认场景 finalBuy", r_default.derived.final_buy, 4_833_406, 1)
expect_close("默认场景 finalRent", r_default.derived.final_rent, 5_804_800, 1)
expect_close("默认场景 第10年差额", r_default.rows[-1].buy_net_worth - r_default.rows[-1].rent_net_worth, -971_394, 1)
expect_close("默认场景 印花税", r_default.derived.stamp_duty, 112_500, 0)
expect_close("默认场景 期初总支出", r_default.derived.upfront_buy, 1_833_500, 1)  # 完成日实付；0.8%回赠 28,000 完成后才到账

# 5. 按保：80% 成数 → 4M×0.92% = $36,800；90% 成数 → 4.5M×2.16% = $97,200
r_mip80 = simulate(Inputs(**{**DEFAULT_INPUTS.__dict__, "down_payment_pct": 20}))
expect_close("MIP 80% LTV", r_mip80.derived.mip_premium, 36_800, 1)
r_mip90 = simulate(Inputs(**{**DEFAULT_INPUTS.__dict__, "down_payment_pct": 10}))
expect_close("MIP 90% LTV", r_mip90.derived.mip_premium, 97_200, 1)

# 6. 高成数非首置：封顶 80%
r_nonfirst = simulate(Inputs(**{**DEFAULT_INPUTS.__dict__, "down_payment_pct": 10, "is_first_time_buyer": False}))
expect_close("非首置 LTV 封顶 80", r_nonfirst.derived.ltv_pct, 80, 0.1)

# 7. 第5年以$4M卖出（跌20%，锁定期外无罚息）
r_sale = simulate(Inputs(**{**DEFAULT_INPUTS.__dict__, "sell_year": 5, "sale_price_override": 4_000_000}))
expect_close("卖出场景 finalBuy", r_sale.derived.final_buy, 4_101_293, 2)
expect_close("卖出场景 第5年末已售", 1 if r_sale.rows[4].buy_sold else 0, 1, 0)

# 7. 回赠 >1%（金管局规则 + 市场实务）：回赠按原贷款额计，整笔回赠从贷款额扣除，
#    完成交易后整笔回赠以现金发放（模型视为第 0 月到账）
# 贷款 350万 → 回赠 = 350万×1.5% = 52,500 → 实际批出贷款额 = 3,447,500
# 期初 = 5,000,000 − 3,447,500 + 印花税112,500 + 佣金50,000 + 律师18,000 + 杂费3,000 + 装修150,000 = 1,886,000
r_rebate = simulate(Inputs(**{**DEFAULT_INPUTS.__dict__, "cash_rebate_pct": 1.5}))
expect_close("回赠超标 贷款额已调低", r_rebate.derived.loan_amount, 3_447_500, 1)
expect_close("回赠超标 期初总支出", r_rebate.derived.upfront_buy, 1_886_000, 1)
expect_close("回赠超标 现金回赠全额", r_rebate.derived.rebate_amount, 52_500, 1)

# 7b. 高成数按保的回赠基数 = 楼价七成（经络按揭曹德明 2026-06 例子）：
# 800万楼、九成按揭 720万、回赠 1.3% → 回赠 = 800万×70%×1.3% = 72,800（> 1%×720万 = 72,000 触发扣减）
# 实际贷款额 = 720万 − 72,800 = 7,127,200
r_hilv = simulate(Inputs(**{**DEFAULT_INPUTS.__dict__, "property_price": 8_000_000,
                            "down_payment_pct": 10, "cash_rebate_pct": 1.3, "mip_override": 0}))
expect_close("高成数回赠基数=七成楼价", r_hilv.derived.rebate_amount, 72_800, 1)
expect_close("高成数回赠 贷款额", r_hilv.derived.loan_amount, 7_127_200, 1)

print()
print("全部通过" if failures == 0 else f"{failures} 个失败")
raise SystemExit(0 if failures == 0 else 1)
