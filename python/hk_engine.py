# -*- coding: utf-8 -*-
"""
香港买房 vs 租房 计算引擎（Python 版）
=====================================

与 TypeScript 版 src/engine/engine.ts 完全同一套逻辑的移植，
数字可与网页版互相核对。

模型概要
--------
两个方案在同一时间轴上按月推演（月收入、生活开支、利率完全相同）：

  买房方案净资产(t) = 楼市值(t) − 剩余贷款(t) + 大额投资(t) + M-link存款(t) + 定期储蓄(t)
  租房方案净资产(t) = 大额投资(t) + 定期储蓄(t) + 按金(可回收)

  * 买房方案期初支付：首付 + 印花税 + 佣金 + 律师费 + 杂费 + 按保费 + 装修 − 现金回赠
  * 第 N 年起：搬去租大房，同时把自己的单位出租（收租金 − 物业税 − 空置损耗）
  * 可选第 S 年卖出：净入 = 售价 − 佣金 − 律师费 − 剩余贷款（罚息期内加回赠追讨+罚息），
    之后转成租房状态
  * 每月结余存入"定期"（deposit_rate），期初大额资金按"投资回报率"（investment_return）复利，
    Mortgage-Link 上限内存款按按揭利率生息（冲抵利息）

直接运行本文件可看默认场景（元朗 $500 万单位）的逐年结果：
    python3 hk_engine.py
"""

from dataclasses import dataclass, field
from math import isfinite
from typing import Optional, List

MONTHS_PER_YEAR = 12
MDI_ANNUAL_CAP = 100_000  # 居所贷款利息扣除每年上限（$10 万）
MAX_YEARS = 30


# ============================================================
# 一、从价印花税（AVD 第二标准税率）
# 来源：香港税务局 https://www.ird.gov.hk/chi/faq/avd.htm
# 2024.2.28 起撤销 BSD/NRSD/SSD，所有买家统一第二标准税率；
# 2025.2.26 起 $400 万或以下为象征式 $100。
# 每段 = (上限, 基础税款, 超额比例, 超额下限) 或整段比例
# ============================================================
_RESIDENTIAL_BANDS = [
    # (段上限, 基础税款, 超额税率, 超额计算下限, 整段比例税率)
    (4_000_000, 100, None, None, None),
    (4_323_780, 100, 0.20, 4_000_000, None),
    (4_500_000, 0, None, None, 0.015),
    (4_935_480, 67_500, 0.10, 4_500_000, None),
    (6_000_000, 0, None, None, 0.0225),
    (6_642_860, 135_000, 0.10, 6_000_000, None),
    (9_000_000, 0, None, None, 0.03),
    (10_080_000, 270_000, 0.10, 9_000_000, None),
    (20_000_000, 0, None, None, 0.0375),
    (21_739_120, 750_000, 0.10, 20_000_000, None),
    (100_000_000, 0, None, None, 0.0425),
    (109_574_470, 4_250_000, 0.30, 100_000_000, None),
    (float("inf"), 0, None, None, 0.065),
]


def _round_half_up(x: float) -> int:
    """与 TS Math.round 对齐的四舍五入（.5 远离零）；Python 内置 round 是银行家舍入"""
    return int(x + 0.5) if x >= 0 else -int(-x + 0.5)


def stamp_duty_residential(price: float) -> int:
    """住宅从价印花税（第二标准税率表）"""
    p = max(0.0, price)
    for up_to, base, rate, over, flat in _RESIDENTIAL_BANDS:
        if p <= up_to:
            if flat is not None:
                return _round_half_up(p * flat)
            extra = (p - over) * rate if rate is not None else 0.0
            return _round_half_up(base + extra)
    return 0


def lease_stamp_duty(monthly_rent: float, share_pct: float = 50) -> int:
    """租约印花税：租期 1-3 年为平均年租的 0.5%，业主租客各付一半"""
    return _round_half_up(monthly_rent * 12 * 0.005 * share_pct / 100)


# ============================================================
# 二、按揭保险计划（MIP / HKMC）
# 来源：香港按证保险 Premium Rate Sheet（2024.10.16 起生效）
# 浮息按揭、一次性保费（占贷款额 %）、首置自用
# ============================================================
def max_mip_terms(price: float) -> Optional[dict]:
    """最高按保成数（首置）。返回 {'ltv': x, 'loan_cap': 可选}；超限返回 None（只能 70%）"""
    if price <= 10_000_000:
        return {"ltv": 90}
    if price < 11_250_000:
        return {"ltv": 90, "loan_cap": 9_000_000}
    if price <= 15_000_000:
        return {"ltv": 80}
    if price <= 17_150_000:
        return {"ltv": 80, "loan_cap": 12_000_000}
    return None


# 保费表：{承保档位: {贷款年期档: 保费%}}；承保档位指贷款成数落在 (70%, 档位]
_MIP_LOW = {  # 物业 ≤ $600 万（首置，承保至 90%）
    80: {10: 0.50, 15: 0.60, 20: 0.76, 25: 0.83, 30: 0.92},
    85: {10: 0.86, 15: 1.02, 20: 1.25, 25: 1.35, 30: 1.41},
    90: {10: 1.25, 15: 1.48, 20: 1.79, 25: 2.03, 30: 2.16},
}
_MIP_MID = {  # 物业 $600 万 – $1,500 万（首置）
    80: {10: 0.60, 15: 0.71, 20: 0.90, 25: 0.97, 30: 1.09},
    85: {10: 1.01, 15: 1.20, 20: 1.46, 25: 1.57, 30: 1.64},
    90: {10: 1.46, 15: 1.72, 20: 2.08, 25: 2.35, 30: 2.50},
}
_MIP_LOW_NON_FIRST = {  # 物业 ≤ $600 万，非首置（承保只到 80%）
    80: {10: 0.65, 15: 0.75, 20: 0.91, 25: 0.98, 30: 1.07},
}


def _nearest_tenor(years: int) -> int:
    return min([10, 15, 20, 25, 30], key=lambda o: abs(o - years))


def mip_single_premium(price: float, loan_pct: float, loan_years: int, is_first_time_buyer: bool) -> float:
    """按保一次性保费（$）。loan_pct 为贷款成数；非首置最高 80%"""
    if loan_pct <= 70:
        return 0.0
    tenor = _nearest_tenor(loan_years)
    if loan_pct <= 75:
        return 0.0
    elif loan_pct <= 80:
        band = 80
    elif loan_pct <= 85:
        band = 85
    else:
        band = 90
    if not is_first_time_buyer and band > 80:
        return 0.0
    table = (_MIP_LOW if is_first_time_buyer else _MIP_LOW_NON_FIRST) if price <= 6_000_000 else _MIP_MID
    tenors = table.get(band)
    if not tenors:
        return 0.0
    pct = tenors.get(tenor, tenors[30])
    return price * (loan_pct / 100) * pct / 100


# ============================================================
# 三、输入参数
# ============================================================
@dataclass
class Inputs:
    # ---- 一、基本设定 ----
    years: int = 10                        # 模拟时长 T（1-30 年）
    property_price: float = 5_000_000      # 楼价现价（第 0 年买入价）
    price_growth_rates: List[float] = field(default_factory=lambda: [0.0] * MAX_YEARS)  # 楼价增长率 %/年
    sell_year: Optional[int] = None        # 第几年末出售（None = 不出售）
    sale_price_override: Optional[float] = None  # 手动出售价（None = 按曲线推算）
    initial_cash: float = 2_000_000        # 手头现金（第 0 年）

    # ---- 二、买房 · 交易成本（期初一次性） ----
    down_payment_pct: float = 30           # 首付比例 %
    agency_fee_pct: float = 1              # 买楼代理佣金 %
    stamp_duty_override: Optional[float] = None  # 印花税覆盖（None = 自动按税表）
    legal_fee_buy: float = 10_000          # 律师费（买卖）
    legal_fee_mortgage: float = 8_000      # 律师费（按揭）
    misc_fees: float = 3_000               # 政府注册杂费
    mip_override: Optional[float] = None   # 按保费覆盖（None = 自动按 HKMC 费率）
    renovation: float = 150_000            # 装修 / 家电家具

    # ---- 三、买房 · 按揭 ----
    loan_years: int = 30                   # 还款期（年）
    mortgage_rates: List[float] = field(default_factory=lambda: [3.5] * MAX_YEARS)  # 按揭利率 %/年
    cap_rate: float = 3.5                  # 封顶利率（展示用）
    cash_rebate_pct: float = 0.8           # 现金回赠（占贷款额 %）
    lock_in_years: int = 3                 # 罚息 / 回赠锁定期（年）
    prepay_penalty_pct: float = 1          # 提前还款罚息 %
    annual_prepayment: float = 0           # 每年年末提前还款额 $
    prepayment_start_year: int = 4         # 提前还款起始年（第 Y 年起年末还款；默认 = 默认罚息期结束后）
    mortgage_link_enabled: bool = True     # Mortgage-Link（上限 = 贷款额 50%）
    mortgage_link_auto_deposit: bool = True  # 每月结余自动优先存入 M-Link（至上限，超出进定期）
    mdi_enabled: bool = True               # 居所贷款利息扣除（自住期间）
    mdi_marginal_rate_pct: float = 17      # 薪俸税边际税率 %

    # ---- 四、买房 · 持有成本 ----
    mgmt_fee_monthly: float = 1_500        # 管理费 $/月
    rates_gov_rent_override: Optional[float] = None  # 差饷+地租 $/月（None = 自动 ≈8%×市值租金）
    fire_insurance_annual: float = 1_500   # 火险 $/年
    maintenance_pct_of_price: float = 0.5  # 维修保养（占楼价 %/年）
    sell_agency_fee_pct: float = 1         # 卖楼代理佣金 %
    legal_fee_sell: float = 6_000          # 卖楼律师费

    # ---- 五、出租 + 换大房 ----
    rent_out_enabled: bool = True          # 是否出租自己单位
    switch_year: int = 6                   # 第 N 年起换大房 + 出租（0 = 不换）
    rental_income_monthly_0: float = 13_500  # 出租租金（第 0 年值 $/月）
    property_tax_rate_pct: float = 15      # 物业税税率 %
    property_tax_allowance_pct: float = 80  # 物业税法定修葺扣减 %
    vacancy_months: float = 1              # 出租空置期（月/年）
    let_agent_fee_months: float = 0.5      # 出租代理费（月租金/次）
    lease_renewal_cycle_years: int = 2     # 换约周期（年）
    rental_maintenance_annual: float = 2_000  # 出租维修 / 家电损耗 $/年
    consent_to_lease_fee: float = 1_000    # 出租同意书费（一次性）

    # ---- 六、租房方案 ----
    rent_growth_rates: List[float] = field(default_factory=lambda: [0.0] * MAX_YEARS)  # 租金增长率 %/年
    rent1_monthly: float = 13_500          # 小房租金（第 0 年值 $/月）
    rent2_monthly: float = 18_000          # 大房租金（第 N 年起首年值 $/月）
    deposit_months: float = 2              # 按金（月，期末退回计资产）
    prepaid_months: float = 1              # 上期（月，真支出）
    tenant_agent_fee_months: float = 0.5   # 租客中介费（月租金/次新约）
    tenant_stamp_duty_pct_of_annual: float = 0.25  # 租客租约印花税（占年租金 %）
    moving_cost_per_move: float = 5_000    # 搬迁费 $/次

    # ---- 七、共同财务参数 ----
    monthly_income: float = 60_000         # 月收入
    income_growth_pct: float = 0           # 收入年增长率 %
    living_expense_monthly: float = 20_000  # 生活开支 $/月
    deposit_rate_pct: float = 2.5          # 定期存款利率 %（每月结余去处）
    investment_return_pct: float = 2.5     # 大额资金投资回报率 %（首付资金/卖楼回笼资金）

    # ---- 八、身份 ----
    is_first_time_buyer: bool = True       # 是否首置（影响按保资格 >80%）


DEFAULT_INPUTS = Inputs()


# ============================================================
# 四、输出结构
# ============================================================
@dataclass
class YearRow:
    year: int
    # 买房方案
    buy_property_value: float      # 楼市值（年末）
    buy_loan: float                # 剩余贷款（年末）
    buy_lump: float                # 大额投资（年末）
    buy_link: float                # Mortgage-Link 余额（年末）
    buy_flow: float                # 定期储蓄（年末）
    buy_deposit: float             # 买房方案租房阶段的按金（年末，可回收资产）
    buy_net_worth: float           # 净资产
    buy_sold: bool                 # 该年末已卖出
    # 买房方案当年现金流
    buy_mortgage_paid: float       # 月供（年合计）
    buy_holding_paid: float        # 持有成本（管理费+差饷地租+火险+维修）
    buy_rent_paid: float           # 自己租房支出（年）
    buy_rental_income: float       # 净租金收入（年）
    buy_misc_paid: float           # 换约杂费/罚息/回赠追讨
    buy_prepaid: float             # 提前还款
    # 租房方案
    rent_lump: float
    rent_flow: float
    rent_deposit: float            # 按金（可回收资产）
    rent_net_worth: float
    rent_paid: float               # 当年总租金
    rent_misc_paid: float          # 中介+租约印花税+搬迁


@dataclass
class Derived:
    loan_amount: float             # 贷款额（回赠调整后）
    loan_amount_gross: float
    ltv_pct: float
    stamp_duty: float
    mip_premium: float
    mip_eligible: bool
    rebate_deducted: bool          # 回赠 >1%：贷款额按含回赠口径调低（回赠仍全额现金发放）
    rebate_amount: float            # 现金回赠全额（>1% 时放款额已相应调低，回赠交易完成后发放）
    monthly_payment_0: float       # 首年月供
    dsr_pct: float                 # 月供 / 收入
    upfront_buy: float             # 期初总支出
    sale_price_default: Optional[float]
    break_even_year: Optional[int]  # 买房首次领先租房的年份
    final_buy: float
    final_rent: float
    final_diff: float              # 买房 − 租房


@dataclass
class SimResult:
    rows: List[YearRow]
    derived: Derived
    warnings: List[str]


# ============================================================
# 五、核心模拟
# ============================================================
def _pad_rates(values: List[float], length: int, mode: str) -> List[float]:
    """利率列表补齐到指定长度：增长率类补 0，利率类补最后值；返回小数（3.5% → 0.035）。
    非有限数（NaN/inf/None）清洗为 0，与 TS 版行为一致"""
    clean: List[float] = []
    for v in (values or []):
        try:
            f = float(v)
        except (TypeError, ValueError):
            f = 0.0
        clean.append(f if isfinite(f) else 0.0)
    out = []
    for i in range(length):
        if i < len(clean):
            out.append(clean[i] / 100)
        else:
            out.append(0.0 if mode == "zero" else (clean[-1] if clean else 0.0) / 100)
    return out


def _annuity_payment(balance: float, monthly_rate: float, months: int) -> float:
    """等额本息月供"""
    if balance <= 0 or months <= 0:
        return 0.0
    if monthly_rate <= 0:
        return balance / months
    return balance * monthly_rate / (1 - (1 + monthly_rate) ** (-months))


def simulate(inp: Inputs) -> SimResult:
    warnings: List[str] = []
    T = max(1, round(inp.years))

    # ---------- 曲线预计算 ----------
    price_g = _pad_rates(inp.price_growth_rates, T, "zero")
    rent_g = _pad_rates(inp.rent_growth_rates, T, "zero")
    m_rate_y = _pad_rates(inp.mortgage_rates, max(T, inp.loan_years), "last")

    # 封顶利率提示：H 按实际利率不应超过封顶，超出说明输入可能有误
    over_cap_years = [y for y in range(1, T + 1) if m_rate_y[y - 1] * 100 > inp.cap_rate + 1e-9]
    if over_cap_years:
        warnings.append(
            f"按揭利率列表中有 {len(over_cap_years)} 年高于封顶利率 {inp.cap_rate}%（首见第 {over_cap_years[0]} 年），"
            f"封顶利率仅为展示参数，引擎未强制套用，请确认输入。"
        )

    # 楼市值，下标 0..T（0 为现价）
    price_at = [inp.property_price]
    for y in range(1, T + 1):
        price_at.append(price_at[y - 1] * (1 + price_g[y - 1]))

    # 自己单位的市场月租金（用于差饷地租、出租收入）
    flat_rent_at = [inp.rental_income_monthly_0]
    for y in range(1, T + 1):
        flat_rent_at.append(flat_rent_at[y - 1] * (1 + rent_g[y - 1]))

    # 租客视角租金：第 1..N-1 年租小房，第 N 年起租大房（大房首年值为 rent2）
    N = inp.switch_year
    renter_rent_at = [0.0]
    for y in range(1, T + 1):
        if N > 0 and y >= N:
            v = inp.rent2_monthly
            for i in range(N, y):
                v *= 1 + rent_g[i - 1]
        else:
            v = inp.rent1_monthly
            for i in range(1, y):
                v *= 1 + rent_g[i - 1]
        renter_rent_at.append(v)

    # ---------- 买入成本与按揭设定 ----------
    loan_pct = 100 - inp.down_payment_pct
    mip_eligible = False
    mip_premium = 0.0
    if loan_pct > 70:
        mip_terms = max_mip_terms(inp.property_price)
        if mip_terms is None:
            warnings.append("楼价超过按保适用上限（$1,715 万），高成数不可行，已按 70% 贷款成数计算。")
            loan_pct = 70
        else:
            cap_pct = mip_terms["ltv"]
            if not inp.is_first_time_buyer:
                cap_pct = min(cap_pct, 80)
            if "loan_cap" in mip_terms:
                cap_pct = min(cap_pct, mip_terms["loan_cap"] / inp.property_price * 100)
            if loan_pct > cap_pct:
                warnings.append(f"按保承保成数上限为 {cap_pct:.0f}%，贷款额已按此调整。")
                loan_pct = cap_pct
            mip_eligible = True

    requested_loan = inp.property_price * loan_pct / 100

    # 现金回赠（金管局 2005-02-28 通告 + 市场实务，见中原按揭王美凤/经络按揭曹德明 2026 年专栏）：
    #   1. 回赠基数：成数 ≤70% 按贷款额计；>70%（按保）时银行只按楼价七成计，不按实际贷款额
    #   2. 回赠金额 > 贷款额 1%：整笔回赠计入贷款额计算按揭成数
    #      → 实际批出贷款额 = 原贷款额 − 整笔回赠（完成日买家需多备等额首期，即"抬钱上会"）
    #   3. 整笔回赠于交易完成后以现金发放（模型视为第 0 月到账）
    rebate_base = inp.property_price * 0.7 if loan_pct > 70 else requested_loan
    rebate_cash = rebate_base * inp.cash_rebate_pct / 100
    if rebate_cash > requested_loan * 0.01 + 0.5:
        loan_amount = requested_loan - rebate_cash
        warnings.append(
            f"现金回赠超过贷款额 1%：整笔回赠 ${rebate_cash:,.0f} 计入贷款额计算按揭成数，"
            f"实际批出贷款额由 ${requested_loan:,.0f} 调低至 ${loan_amount:,.0f}（完成日需多备等额首期）；"
            f"整笔回赠于交易完成后以现金发放（模型视为第 0 月到账）。"
        )
    else:
        loan_amount = requested_loan
    rebate_deducted = loan_amount < requested_loan - 0.5

    if mip_eligible:
        # 按保费按实际放款额计（回赠令放款额调低时略小）
        mip_premium = inp.mip_override if inp.mip_override is not None else mip_single_premium(
            inp.property_price, loan_pct, inp.loan_years, inp.is_first_time_buyer
        ) * (loan_amount / requested_loan)

    stamp_duty = inp.stamp_duty_override if inp.stamp_duty_override is not None else stamp_duty_residential(inp.property_price)

    # 首期现金（交易完成时点）= 楼价 − 实际放款额；回赠尚未到账（数周后发放，见下方第 0 月现金流入）
    upfront_buy = (
        inp.property_price - loan_amount
        + stamp_duty
        + inp.property_price * inp.agency_fee_pct / 100
        + inp.legal_fee_buy
        + inp.legal_fee_mortgage
        + inp.misc_fees
        + mip_premium
        + inp.renovation
    )

    # ---------- 共用参数 ----------
    r_inv_m = inp.investment_return_pct / 100 / MONTHS_PER_YEAR
    r_dep_m = inp.deposit_rate_pct / 100 / MONTHS_PER_YEAR

    def income_at(y: int) -> float:
        return inp.monthly_income * (1 + inp.income_growth_pct / 100) ** (y - 1)

    # 租约事件年份（租客）：初始约第 1 年，每 cycle 年续约一次；第 N 年换楼重开周期
    cycle = max(1, inp.lease_renewal_cycle_years)
    tenant_renewal_years = set()
    if N > 0:
        y = 1 + cycle
        while y < N:
            tenant_renewal_years.add(y)
            y += cycle
        y = N
        while y <= T:
            tenant_renewal_years.add(y)
            y += cycle
    else:
        y = 1 + cycle
        while y <= T:
            tenant_renewal_years.add(y)
            y += cycle

    # ---------- 租房方案模拟 ----------
    r_lump = inp.initial_cash
    r_flow = 0.0
    deposit = inp.deposit_months * inp.rent1_monthly
    # 上期 = 首月租金提前支付（押二付一），覆盖第 1 个月的租金，非额外成本；
    # 月循环将跳过前 prepaid_months 个月的租金，此处扣的是"提前支付"的时点
    r_lump -= deposit + inp.prepaid_months * inp.rent1_monthly + inp.tenant_agent_fee_months * inp.rent1_monthly
    r_lump -= inp.rent1_monthly * 12 * inp.tenant_stamp_duty_pct_of_annual / 100
    r_lump -= inp.moving_cost_per_move

    rent_lump_at, rent_flow_at, rent_deposit_at = [], [], []
    rent_paid_at, rent_misc_at, rent_nw = [], [], []
    prepaid_left = inp.prepaid_months  # 已预付租金覆盖的剩余月数
    for y in range(1, T + 1):
        income = income_at(y)
        rent = renter_rent_at[y]
        misc = 0.0
        if y in tenant_renewal_years:
            misc += inp.tenant_agent_fee_months * rent + rent * 12 * inp.tenant_stamp_duty_pct_of_annual / 100
            if N > 0 and y == N:
                misc += inp.moving_cost_per_move
                # 换楼：旧按金退回现金、新按金现金支付（净额入现金池），
                # 按金资产更新为新约按金——换楼时点净资产不因按金机制跳变
                old_deposit = deposit
                deposit = inp.deposit_months * rent
                r_lump += old_deposit - deposit
        year_paid = 0.0
        for _ in range(MONTHS_PER_YEAR):
            r_lump *= 1 + r_inv_m
            r_flow *= 1 + r_dep_m
            if prepaid_left > 0:
                prepaid_left -= 1
                rent_charge = 0.0  # 首月租金已在签约时预付
            else:
                rent_charge = rent
            r_flow += income - inp.living_expense_monthly - rent_charge
            year_paid += rent_charge
        r_flow -= misc
        rent_lump_at.append(r_lump)
        rent_flow_at.append(r_flow)
        rent_deposit_at.append(deposit)
        rent_paid_at.append(year_paid)
        rent_misc_at.append(misc)
        rent_nw.append(r_lump + r_flow + deposit)

    # ---------- 买房方案模拟 ----------
    link_cap = loan_amount * 0.5 if inp.mortgage_link_enabled else 0.0
    b_lump = inp.initial_cash - upfront_buy
    b_lump += rebate_cash  # 现金回赠于交易完成后数周到账（模型视为第 0 月）
    b_link = min(max(b_lump, 0.0), link_cap)
    b_lump -= b_link
    b_flow = 0.0
    bal = loan_amount
    sold = False

    S = inp.sell_year
    if S is not None and S > T:
        warnings.append(f"出售年份第 {S} 年超过模拟时长 {T} 年，已忽略出售设置。")
        S = None
    sale_price_default = price_at[S] if S else None

    buy_nw, buy_bal_at, buy_sold_at = [], [], []
    buy_lump_at, buy_link_at, buy_flow_at, buy_deposit_at = [], [], [], []
    buy_mortgage_paid, buy_holding_paid, buy_rent_paid = [], [], []
    buy_rental_income, buy_misc_paid, buy_prepaid = [], [], []
    buy_deposit = 0.0        # 买房方案租房阶段的按金（现金→资产，退租可回收）
    rental_entered_year: Optional[int] = None
    prev_rent_tenant = False
    monthly_payment_0 = 0.0

    for y in range(1, T + 1):
        r_m = m_rate_y[y - 1] / MONTHS_PER_YEAR
        sold_at_start = sold  # 卖出结算发生在年末，当年全年仍按业主状态记账
        remaining_months = inp.loan_years * MONTHS_PER_YEAR - (y - 1) * MONTHS_PER_YEAR
        pay = _annuity_payment(bal, r_m, remaining_months) if (not sold and bal > 0.005) else 0.0
        if y == 1:
            monthly_payment_0 = pay

        income = income_at(y)
        self_occupied = (not sold) and (N == 0 or y < N)
        living_rented = (not sold) and N > 0 and y >= N
        renting_out = (not sold) and inp.rent_out_enabled and N > 0 and y >= N
        rent_this_year = renter_rent_at[y] if (sold or living_rented) else 0.0
        rent_tenant = rent_this_year > 0  # 今年处于租房居住状态（换大房或卖出后）
        entered_this_year = rent_tenant and not prev_rent_tenant
        prev_rent_tenant = rent_tenant

        # 持有成本（月）：管理费 + 差饷地租(≈8%×市值租金) + 火险 + 维修
        rates_m = inp.rates_gov_rent_override if inp.rates_gov_rent_override is not None else flat_rent_at[y - 1] * 0.08
        maint_m = inp.property_price * inp.maintenance_pct_of_price / 100 / MONTHS_PER_YEAR
        holding_m = inp.mgmt_fee_monthly + rates_m + inp.fire_insurance_annual / MONTHS_PER_YEAR + maint_m

        # 出租净收入（月）：扣空置、物业税（15%×80%）、维修损耗
        rental_net_m = 0.0
        if renting_out:
            gross = flat_rent_at[y] * (MONTHS_PER_YEAR - inp.vacancy_months) / MONTHS_PER_YEAR
            tax = gross * (inp.property_tax_rate_pct / 100) * (inp.property_tax_allowance_pct / 100)
            rental_net_m = gross - tax - inp.rental_maintenance_annual / MONTHS_PER_YEAR

        # 出租换约杂费（业主）：首次出租同意书费；每个新约的代理费 + 租约印花税（业主一半）
        let_misc = 0.0
        if renting_out and y == N:
            let_misc += inp.consent_to_lease_fee
        if renting_out and (y == N or (y - N) % cycle == 0):
            let_misc += inp.let_agent_fee_months * flat_rent_at[y] + flat_rent_at[y] * 12 * inp.tenant_stamp_duty_pct_of_annual / 100

        # 租客侧费用（与租房方案对称）：进入租房状态年付按金（现金→资产）+中介费+租约印花税+搬迁费；
        # 之后每 cycle 年续约付中介费+印花税。上期（首月预付）的时点效应忽略，月租照付
        rental_fees = 0.0
        if entered_this_year:
            rental_entered_year = y
            buy_deposit = inp.deposit_months * rent_this_year
            rental_fees = (
                inp.tenant_agent_fee_months * rent_this_year
                + rent_this_year * 12 * inp.tenant_stamp_duty_pct_of_annual / 100
                + inp.moving_cost_per_move
            )
            b_flow -= buy_deposit + rental_fees
        elif rent_tenant and rental_entered_year is not None and y > rental_entered_year and (y - rental_entered_year) % cycle == 0:
            rental_fees = inp.tenant_agent_fee_months * rent_this_year + rent_this_year * 12 * inp.tenant_stamp_duty_pct_of_annual / 100
            b_flow -= rental_fees

        year_mortgage = 0.0
        year_interest = 0.0
        year_surplus = 0.0
        link_auto_in = 0.0
        for _ in range(MONTHS_PER_YEAR):
            b_lump *= 1 + r_inv_m
            b_flow *= 1 + r_dep_m
            b_link *= 1 + r_m
            if b_link > link_cap:
                b_lump += b_link - link_cap
                b_link = link_cap

            interest = 0.0
            principal = 0.0
            if not sold and bal > 0.005:
                interest = bal * r_m
                principal = min(max(pay - interest, 0.0), bal)  # max(0,...) 防御 pay≤0 时余额反增
                bal -= principal
                year_mortgage += interest + principal
                year_interest += interest

            inflow = income + (rental_net_m if renting_out else 0.0)
            outflow = (
                inp.living_expense_monthly
                + pay
                + rent_this_year
                + (0.0 if sold else holding_m)
                + (let_misc / MONTHS_PER_YEAR if renting_out else 0.0)
            )
            surplus = inflow - outflow
            year_surplus += surplus
            # M-Link 自动存款：结余（正数部分）优先存入 M-Link 至上限（利率=按揭利率 > 定期利率），超出进定期
            if inp.mortgage_link_auto_deposit and (not sold) and surplus > 0 and b_link < link_cap:
                to_link = min(surplus, link_cap - b_link)
                b_link += to_link
                link_auto_in += to_link
                b_flow += surplus - to_link
            else:
                b_flow += surplus

        year_misc = let_misc + rental_fees

        # 居所贷款利息扣除（自住年份，年末一次性计入结余）
        if inp.mdi_enabled and self_occupied and year_interest > 0:
            b_flow += min(year_interest, MDI_ANNUAL_CAP) * inp.mdi_marginal_rate_pct / 100

        # 年末提前还款（从定期结余扣款）
        year_prepaid = 0.0
        if not sold and inp.annual_prepayment > 0 and y >= inp.prepayment_start_year and bal > 0.005:
            amount = min(inp.annual_prepayment, max(b_flow, 0.0), bal)
            if amount > 0:
                cost = amount
                if y <= inp.lock_in_years:
                    penalty = amount * inp.prepay_penalty_pct / 100
                    clawback = rebate_cash * (amount / max(bal, 1.0)) * ((inp.lock_in_years - y + 1) / inp.lock_in_years)
                    cost += penalty + clawback
                    year_misc += penalty + clawback
                b_flow -= cost
                bal -= amount
                year_prepaid = amount

        # 年末卖出 → 转租房状态
        if S == y and not sold:
            sale_price = inp.sale_price_override if inp.sale_price_override is not None else (sale_price_default or price_at[y])
            net = sale_price - sale_price * inp.sell_agency_fee_pct / 100 - inp.legal_fee_sell - max(bal, 0.0)
            if y <= inp.lock_in_years:
                clawback = rebate_cash * ((inp.lock_in_years - y + 1) / inp.lock_in_years)
                penalty = max(bal, 0.0) * inp.prepay_penalty_pct / 100
                net -= clawback + penalty
                year_misc += clawback + penalty
                warnings.append(f"第 {y} 年卖出处于罚息锁定期内，已计入回赠追讨与罚息。")
            b_lump += net + b_link
            b_link = 0.0
            sold = True
            bal = 0.0

        buy_mortgage_paid.append(year_mortgage)
        buy_holding_paid.append(0.0 if sold_at_start else holding_m * MONTHS_PER_YEAR)
        buy_rent_paid.append(rent_this_year * MONTHS_PER_YEAR)
        buy_rental_income.append(rental_net_m * MONTHS_PER_YEAR if renting_out else 0.0)
        buy_misc_paid.append(year_misc)
        buy_prepaid.append(year_prepaid)
        buy_lump_at.append(b_lump)
        buy_link_at.append(b_link)
        buy_flow_at.append(b_flow)
        buy_deposit_at.append(buy_deposit)
        buy_bal_at.append(bal)
        buy_sold_at.append(sold)
        buy_nw.append((0.0 if sold else price_at[y] - bal) + b_lump + b_link + b_flow + buy_deposit)

    # ---------- 汇总 ----------
    rows = [
        YearRow(
            year=y,
            buy_property_value=price_at[y],
            buy_loan=buy_bal_at[y - 1],
            buy_lump=buy_lump_at[y - 1],
            buy_link=buy_link_at[y - 1],
            buy_flow=buy_flow_at[y - 1],
            buy_deposit=buy_deposit_at[y - 1],
            buy_net_worth=buy_nw[y - 1],
            buy_sold=buy_sold_at[y - 1],
            buy_mortgage_paid=buy_mortgage_paid[y - 1],
            buy_holding_paid=buy_holding_paid[y - 1],
            buy_rent_paid=buy_rent_paid[y - 1],
            buy_rental_income=buy_rental_income[y - 1],
            buy_misc_paid=buy_misc_paid[y - 1],
            buy_prepaid=buy_prepaid[y - 1],
            rent_lump=rent_lump_at[y - 1],
            rent_flow=rent_flow_at[y - 1],
            rent_deposit=rent_deposit_at[y - 1],
            rent_net_worth=rent_nw[y - 1],
            rent_paid=rent_paid_at[y - 1],
            rent_misc_paid=rent_misc_at[y - 1],
        )
        for y in range(1, T + 1)
    ]

    final_buy = buy_nw[T - 1] if buy_nw else inp.initial_cash
    final_rent = rent_nw[T - 1] if rent_nw else inp.initial_cash
    break_even_year = next((y for y in range(1, T + 1) if buy_nw[y - 1] > rent_nw[y - 1]), None)

    dsr_pct = monthly_payment_0 / inp.monthly_income * 100 if inp.monthly_income > 0 else 0.0
    if dsr_pct > 50:
        warnings.append(f"首年月供占收入 {dsr_pct:.0f}%，超过银行 DSR 50% 指引，实际可能批不了贷款。")
    if upfront_buy > inp.initial_cash:
        warnings.append(
            f"期初所需资金 ${upfront_buy:,.0f} 超过手头现金 ${inp.initial_cash:,.0f}，现金将为负数。"
        )
    if S and N > 0 and S < N and inp.rent_out_enabled:
        warnings.append("出售年份早于出租起始年，该单位从未出租过。")

    return SimResult(
        rows=rows,
        derived=Derived(
            loan_amount=loan_amount,
            loan_amount_gross=requested_loan,
            ltv_pct=loan_amount / inp.property_price * 100,
            stamp_duty=stamp_duty,
            mip_premium=mip_premium,
            mip_eligible=mip_eligible,
            rebate_deducted=rebate_deducted,
            rebate_amount=rebate_cash,
            monthly_payment_0=monthly_payment_0,
            dsr_pct=dsr_pct,
            upfront_buy=upfront_buy,
            sale_price_default=sale_price_default,
            break_even_year=break_even_year,
            final_buy=final_buy,
            final_rent=final_rent,
            final_diff=final_buy - final_rent,
        ),
        warnings=warnings,
    )


# ============================================================
# 六、演示入口：python3 hk_engine.py
# ============================================================
def _demo() -> None:
    result = simulate(DEFAULT_INPUTS)
    d = result.derived
    print("=" * 72)
    print("默认场景：$500万楼、30%首付、3.5%利率、10年、第6年起出租+换大房（楼价租金横盘）")
    print("=" * 72)
    print(f"贷款额 ${d.loan_amount:,.0f}（LTV {d.ltv_pct:.0f}%）  首年月供 ${d.monthly_payment_0:,.0f}"
          f"  DSR {d.dsr_pct:.0f}%  印花税 ${d.stamp_duty:,.0f}  期初总支出 ${d.upfront_buy:,.0f}")
    for w in result.warnings:
        print(f"  [提示] {w}")
    print("-" * 72)
    print(f"{'年':>3} {'楼市值':>12} {'剩余贷款':>12} {'买净资产':>12} {'租净资产':>12} {'差额(买-租)':>12}")
    for r in result.rows:
        print(f"{r.year:>3} {r.buy_property_value:>12,.0f} {r.buy_loan:>12,.0f} "
              f"{r.buy_net_worth:>12,.0f} {r.rent_net_worth:>12,.0f} {r.buy_net_worth - r.rent_net_worth:>12,.0f}")
    print("-" * 72)
    winner = "买房" if d.final_diff > 0 else "租房"
    print(f"结论：{result.rows[-1].year} 年末 {winner} 更优，多 ${abs(d.final_diff):,.0f}"
          f"（打平年份：{'第 ' + str(d.break_even_year) + ' 年' if d.break_even_year else '模拟期内未出现'}）")
    print()
    print("改参数示例：")
    print("  from dataclasses import replace")
    print("  from hk_engine import simulate, DEFAULT_INPUTS")
    print("  r = simulate(replace(DEFAULT_INPUTS, years=30, price_growth_rates=[3.0]*30))")


if __name__ == "__main__":
    _demo()
