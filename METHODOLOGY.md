# 模型规格与代码地图（供代码审查用）

> **本文档用途**：完整描述本计算系统（香港买房 vs 租房）涉及的**每一项计算、每一个对比、
> 以及它们各自所在的代码位置**，供审查 agent 逐条核对"代码是否正确实现了模型"。
> 行号基于当前版本，可能有小幅漂移，**以函数名为准**。
> 双引擎（TS / Python）逻辑 1:1 对应，本文以 Python 命名为主，括号内给 TS 对应物。

---

## 0. 阅读指南（建议的审查步骤）

1. 先读 §1 对比框架，理解"两方案在什么口径下比什么"；
2. 对照 §2 代码地图打开对应文件；
3. 按 §4–§8 逐条核对公式与代码实现；
4. §9 列出所有**有意为之的简化**——这些不是 bug，审查时不应作为问题上报；
5. §10 是一处已知的展示层瑕疵（净资产计算正确、明细表显示有偏）；
6. 最后按 §13 运行两侧测试集，确认 33 项锚点全部通过。

---

## 1. 系统目标与对比框架

**目标**：从第 0 年起，比较"在香港买房"与"持续租房"两条路径在第 T 年末（1 ≤ T ≤ 30）
的总资产（净资产）谁更多。

**公平性约定**（这是全部对比成立的前提）：

| 约定 | 实现 |
|---|---|
| 两方案**同一个人**：相同月收入、相同收入增长率、相同生活开支 | `income_at(y)`，engine.ts L130 / hk_engine.py `共用参数`段 |
| 两方案**同一起点现金** `initialCash` | 两个方案各自从 `initialCash` 出发扣各自期初成本 |
| 两方案资金都生息，但池子和利率不同（见 §4 资金分池） | `b_lump/b_link/b_flow` vs `r_lump/r_flow` |
| 时间轴相同，按**月**推演、按**年**汇总展示 | 两个 for 循环均 12 个月/年 |

**推论**（审查时可用来设计不变量测试）：因为收入、生活开支、定存利率两方案完全相同，
把收入改成任何值，两条净资产曲线同向平移，**结论（谁赢、打平年）不变**。
收入在模型里只用于 DSR 可行性检查，不影响对比结论。

**生命周期状态机**（买房方案的隐式状态）：

```
自住 ──(第 N 年, N=switch_year)──> 出租自己单位 + 自己租大房
  │                                      │
  └──(第 S 年, S=sell_year)──────────────┴──> 卖出结算 → 转为租房状态（租金曲线与租房方案共用）
```

- `N = 0` 表示不换房不自租，一直自住到 T 或卖出；
- `S = null` 表示不出售，持有到期末；
- S 与 N 互相独立（可以先卖后换、先换后卖、只换不卖、不换不卖）；
- 卖出发生在**年末**，因此卖出当年全年仍按业主状态计现金流，从下一年起转租房状态。

---

## 2. 代码地图

| 文件 | 函数/常量 | 行号 | 职责 |
|---|---|---|---|
| `python/hk_engine.py` | `stamp_duty_residential` | L60 | 住宅从价印花税（13 段税表查表） |
| | `_RESIDENTIAL_BANDS` | L42 | 税表数据（2025.2.26 起生效版，来源 IRD） |
| | `lease_stamp_duty` | L72 | 租约印花税参考函数（主流程实际用参数化税率，见 §10-11） |
| | `max_mip_terms` | L82 | 按保最高成数（按楼价分档） |
| | `_MIP_LOW / _MIP_MID / _MIP_LOW_NON_FIRST` | L96–109 | HKMC 保费费率表（2024.10 版） |
| | `mip_single_premium` | L115 | 按保一次性保费 |
| | `Inputs` / `DEFAULT_INPUTS` | L142 / L214 | 输入参数定义与默认值 |
| | `YearRow / Derived / SimResult` | L221 / L248 / L268 | 输出结构 |
| | `_pad_rates` | L277 | 增长率/利率列表补齐（增长率补 0、利率补末值，%→小数） |
| | `_annuity_payment` | L289 | 等额本息月供公式 |
| | `simulate` | L298 | **主模拟**（全部核心计算都在这里） |
| `src/engine/engine.ts` | `padRates` / `annuityPayment` / `simulate` | L14 / L25 / L31 | 同上 TS 版；simulate 内部分段：曲线预计算 L35、按揭设定 L63、共用参数 L125、租房模拟 L140、买房模拟 L181、汇总 L324 |
| `src/engine/stampDuty.ts` | `RESIDENTIAL_BANDS` / `stampDutyResidential` | L14 / L30 | 同 `stamp_duty_residential` |
| `src/engine/hkmc.ts` | `maxMipTerms` / 费率表 / `mipSinglePremium` | L7 / L20–34 / L42 | 同 `max_mip_terms` / `mip_single_premium` |
| `src/types.ts` | `Inputs / SimResult / YearRow / Derived` | — | TS 类型定义 |
| `src/engine/defaults.ts` | `DEFAULT_INPUTS / MAX_YEARS` | — | 默认值（元朗 $500 万场景） |
| `src/data/hkHistory.ts` | `HK_HISTORY` | — | RVD 官方楼价/租金指数 1981–2025 逐年涨跌幅（`scripts/parse_rvd.mjs` 生成） |
| `scripts/smoke.ts`、`python/test_engine.py` | — | — | 33 项锚点测试，两侧同步 |

UI 层（`src/components/`）只做输入钳制与结果展示，**不含任何模型计算**，审查重心在引擎。

---

## 3. 输入参数全集（8 组）

定义于 `Inputs`（hk_engine.py L142，types.ts），默认值在 `DEFAULT_INPUTS`。
UI 分组与参数一一对应（`src/components/InputPanel.tsx`）。

| 组 | 参数（Python 名） | 默认值 | 含义 |
|---|---|---|---|
| 一 基本 | `years` (T) | 10 | 模拟时长 1–30 |
| | `property_price` | 5,000,000 | 第 0 年买入价 |
| | `price_growth_rates` | 全 0 ×30 | 楼价年增长率列表（%） |
| | `sell_year` / `sale_price_override` | None / None | 第 S 年末出售 / 手动出售价 |
| | `initial_cash` | 2,000,000 | 手头现金 |
| 二 交易成本 | `down_payment_pct` | 30 | 首付比例（贷款成数 = 100−此值） |
| | `agency_fee_pct` | 1 | 买楼佣金 |
| | `stamp_duty_override` | None | 印花税覆盖（None=按税表） |
| | `legal_fee_buy / legal_fee_mortgage / misc_fees` | 10,000/8,000/3,000 | 律师费、杂费 |
| | `mip_override` | None | 按保费覆盖（None=按 HKMC 表） |
| | `renovation` | 150,000 | 装修家电 |
| 三 按揭 | `loan_years` | 30 | 还款期 |
| | `mortgage_rates` | 全 3.5 ×30 | 按揭利率列表（%/年，分段可变） |
| | `cap_rate` | 3.5 | 封顶利率（仅展示） |
| | `cash_rebate_pct` | 0.8 | 现金回赠（占贷款额 %） |
| | `lock_in_years` / `prepay_penalty_pct` | 3 / 1 | 罚息锁定期 / 罚息率 |
| | `annual_prepayment` | 0 | 每年年末提前还款额 |
| | `mortgage_link_enabled` | True | Mortgage-Link（上限=贷款 50%，利率=按揭利率） |
| | `mdi_enabled` / `mdi_marginal_rate_pct` | True / 17 | 居所贷款利息扣税 |
| 四 持有成本 | `mgmt_fee_monthly` | 1,500 | 管理费/月 |
| | `rates_gov_rent_override` | None | 差饷+地租/月（None=自动 ≈8%×市值租金） |
| | `fire_insurance_annual` / `maintenance_pct_of_price` | 1,500 / 0.5 | 火险/年、维修占楼价%/年 |
| | `sell_agency_fee_pct` / `legal_fee_sell` | 1 / 6,000 | 卖楼佣金、卖楼律师费 |
| 五 出租+换房 | `rent_out_enabled` / `switch_year` (N) | True / 6 | 是否出租+换大房 / 起始年（0=不换） |
| | `rental_income_monthly_0` | 13,500 | 自己单位的市值租金（第 0 年值） |
| | `property_tax_rate_pct` / `property_tax_allowance_pct` | 15 / 80 | 物业税税率 / 法定修葺扣减 |
| | `vacancy_months` | 1 | 出租空置（月/年） |
| | `let_agent_fee_months` / `lease_renewal_cycle_years` | 0.5 / 2 | 业主换约代理费 / 换约周期 |
| | `rental_maintenance_annual` / `consent_to_lease_fee` | 2,000 / 1,000 | 出租维修、出租同意书费 |
| 六 租房 | `rent_growth_rates` | 全 0 ×30 | 租金年增长率列表（同时驱动租金支出与出租收入） |
| | `rent1_monthly` / `rent2_monthly` | 13,500 / 18,000 | 小房租金 / 大房租金（N 年起首年值） |
| | `deposit_months` / `prepaid_months` | 2 / 1 | 按金（可回收，计资产）/ 上期（真支出） |
| | `tenant_agent_fee_months` | 0.5 | 租客换约中介费 |
| | `tenant_stamp_duty_pct_of_annual` | 0.25 | 租约印花税（占年租 %，各付一半后的租客份额） |
| | `moving_cost_per_move` | 5,000 | 搬迁费/次 |
| 七 共同财务 | `monthly_income` / `income_growth_pct` | 60,000 / 0 | 月收入、年增长 |
| | `living_expense_monthly` | 20,000 | 生活开支/月 |
| | `deposit_rate_pct` / `investment_return_pct` | 2.5 / 2.5 | 定存利率 / 大额资金投资回报率 |
| 八 身份 | `is_first_time_buyer` | True | 首置（只影响按保资格 >80% 成数；印花税 2024.2 后无身份差别） |

---

## 4. 计算 A：曲线预计算（simulate 开头，ts L35–62 / py L311 起）

**A1 楼价曲线** `priceAt[0..T]`：

```
priceAt[0] = property_price
priceAt[y] = priceAt[y−1] × (1 + price_growth_rates[y−1]/100)
```

**A2 自己单位市值租金曲线** `flatRentAt[0..T]`（用于差饷地租基数、出租收入）：

```
flatRentAt[0] = rental_income_monthly_0
flatRentAt[y] = flatRentAt[y−1] × (1 + rent_growth_rates[y−1]/100)
```

**A3 租客租金曲线** `renterRentAt[1..T]`（租客视角实际付的租金）：

```
若 N>0 且 y≥N：renterRentAt[y] = rent2_monthly × Π_{i=N}^{y−1}(1 + rentG[i−1])
否则：          renterRentAt[y] = rent1_monthly × Π_{i=1}^{y−1}(1 + rentG[i−1])
```

即第 N 年跳涨为大房租金，之后随租金增长率复利。**卖出后（sold）也沿用此曲线**：
若 S<N，S+1..N−1 年租小房、N 年起租大房；若从未换房（N=0），卖出后一直租小房。

**A4 利率曲线** `mRateY[1..max(T, loan_years)]`：按揭利率列表补齐（不足补末值）、%→小数。

**A5 列表补齐规则** `_pad_rates`（ts L14 / py L277）：**增长率类不足补 0，利率类不足补最后值**；
输入列表长于需要时截断使用。

---

## 5. 计算 B：交易成本与按揭设定（ts L63–125 / py L331–391）

**B1 贷款成数与按保资格**：

```
loan_pct = 100 − down_payment_pct
若 loan_pct > 70：查 max_mip_terms(price)：
   price ≤ 10M → 90%；< 11.25M → 90% 且贷款上限 9M；≤ 15M → 80%；
   ≤ 17.15M → 80% 且贷款上限 12M；> 17.15M → 不适用按保（强行降回 70% + 警告）
   非首置 → 成数封顶 80%；有贷款上限时换算为成数封顶取 min
   超出封顶 → loan_pct 调低至封顶 + 警告；此时 mip_eligible = True
```

**B2 名义贷款额**：`requested_loan = price × loan_pct / 100`

**B3 现金回赠（金管局 2005-02-28 通告 + 市场实务，经历 3 版修正后定稿）**：

```
回赠基数 rebate_base = (loan_pct > 70) ? price × 0.7 : requested_loan
                       # 高成数按保贷款的回赠只按楼价七成计，不按实际贷款额（行业实务）
rebate_cash = rebate_base × cash_rebate_pct / 100
若 rebate_cash > 1% × requested_loan：          # 触发金管局规则
    loan_amount = requested_loan − rebate_cash  # 整笔回赠计入贷款额 → 贷款额被调低
    （完成日买家需多备等额首期，即"抬钱上会"；警告提示）
否则：
    loan_amount = requested_loan                # 贷款额不变
rebate_cash 全额于交易完成后以现金发放 → 模型视为第 0 月进入买房方案资金池
```

> 审查注意：此规则历史上实现错过两次（"≥1% 不发现金"、"首 1% 现金+超出扣本金"），
> 现行版依据：①金管局通告原文"整笔回赠计入贷款额计算按揭成数"；
> ②中原按揭王美凤（大公报 2026-05-18）算例：770 万贷款 1.2% 回赠 → 贷款降至 760.76 万；
> ③经络按揭曹德明（星岛 2026-06-08）算例：800 万楼九成按揭 1.3% 回赠 → 回赠
> 800万×70%×1.3%=72,800，贷款 720万−72,800=712.72 万。测试锚点 §13-6/7 与此逐分对应。

**B4 印花税** `stamp_duty_residential`（py L60 / stampDuty.ts L30）：
13 段税表（2025.2.26 起：≤4M 象征式 $100；4M–4,323,780 为 100+20%×超额的边际减免段；
4,323,781–4.5M 为 1.5%……最高档 >109,574,470 为 6.5%）。逐段数值见
`_RESIDENTIAL_BANDS`。注意 **$10M 楼价正确值是 $370,000**（落在 9M–10.08M 边际减免段：
270,000+10%×1M），不是 3.75% 的 375,000——这是税表的边际减免设计，不是 bug。

**B5 按保一次性保费** `mip_single_premium`（py L115 / hkmc.ts L42）：

```
loan_pct ≤ 75 → 0（70–75% 段 2024.10 起免保费）
75 < loan_pct ≤ 80/85/90 → 对应档位
非首置且档位 > 80 → 0（规则上不可承保）
费率表：price ≤ 6M 用 _MIP_LOW（首置）/_MIP_LOW_NON_FIRST（非首置）；
        6M < price ≤ 17.15M 用 _MIP_MID
年期取 10/15/20/25/30 中最近档
保费(占名义贷款额) = price × loan_pct% × 费率%
实际计收时按放款缩放：mip_premium = 上式 × (loan_amount / requested_loan)
    # 回赠令放款调低时保费略小
```

**B6 期初总支出 `upfront_buy`**（交易完成日实付，**不预扣回赠**——回赠完成后才到账）：

```
upfront_buy = price − loan_amount          # 首期现金 = 楼价 − 实际放款
            + stamp_duty + price×agency% + legal_fee_buy + legal_fee_mortgage
            + misc_fees + mip_premium + renovation
```

---

## 6. 计算 C：租房方案逐年推演（ts L140–180 / py 约 L412–450）

**C1 期初一次性支出**（从 `initial_cash` 扣）：

```
r_lump = initial_cash
       − deposit_months × rent1            # 按金（资产，后续计入净资产）
       − prepaid_months × rent1            # 上期（真支出）
       − tenant_agent_fee_months × rent1   # 首约中介费
       − rent1 × 12 × tenant_stamp_duty%   # 首约租约印花税（租客份额）
       − moving_cost_per_move              # 搬迁费
```

**C2 换约年份集合** `tenant_renewal_years`（周期 `cycle = lease_renewal_cycle_years`）：

```
N > 0：{1+cycle, 1+2cycle, …} 中 < N 的年份 ∪ {N, N+cycle, N+2cycle, … ≤ T}
N = 0：{1+cycle, 1+2cycle, … ≤ T}
```

首约（第 1 年）不收费（已计入 C1）；第 N 年既是续约年也是换楼年。

**C3 每年事件**：若是续约年，`misc = tenant_agent_fee_months × renterRentAt[y]
+ renterRentAt[y] × 12 × tenant_stamp_duty%`；若同时 `y == N`（换楼年）再加
`moving_cost_per_move`，且**按金重置**为新租金的 `deposit_months` 倍
（旧按金退、新按金付，净差在当年体现）。

**C4 每月循环**（顺序敏感：先计息后入账 = 月末存入约定）：

```
r_lump ×= (1 + investment_return/12)      # 大额资金按投资回报率月复利
r_flow ×= (1 + deposit_rate/12)           # 定期结余按定存利率月复利
r_flow += income_at(y) − living_expense − renterRentAt[y]   # 当月结余
```

其中 `income_at(y) = monthly_income × (1 + income_growth%)^(y−1)`。

**C5 年末**：`r_flow −= misc`；`rentNW[y] = r_lump + r_flow + deposit`（按金计资产）。

---

## 7. 计算 D：买房方案逐年推演（ts L181–322 / py 约 L452–612）

**D1 期初资金分配**：

```
b_lump = initial_cash − upfront_buy + rebate_cash     # 回赠第 0 月到账（见 §10-1）
link_cap = mortgage_link_enabled ? loan_amount × 50% : 0
b_link = min(max(b_lump, 0), link_cap)                # 优先填满 M-link
b_lump −= b_link                                      # 溢出回大额池
```

**D2 每年按揭参数**：

```
月利率 rM = mortgage_rates[y−1] / 12
剩余月数 = loan_years × 12 − (y−1) × 12
月供 pay = annuity(bal, rM, remainingMonths)          # 等额本息（_annuity_payment, py L289）
   bal × rM / (1 − (1+rM)^(−months))；rM=0 时 bal/months
monthly_payment_0 = 第 1 年的 pay（用于 DSR）
```

> 注意：月供**每年按当前余额 + 剩余月数重新摊还**，而非锁定首年月供。
> 恒定利率下与标准还款计划一致；分段利率下等价于每年重定价重新摊还（有意选择，见 §9-8）。

**D3 状态判定**（每年）：

```
self_occupied = !sold && (N == 0 || y < N)      # 自住：付持有成本、无租金支出
living_rented = !sold && N > 0 && y >= N        # 已换房：付持有成本 + 付大房租金
renting_out   = !sold && rent_out_enabled && N > 0 && y >= N   # 出租收租
rent_this_year = (sold || living_rented) ? renterRentAt[y] : 0
```

**D4 持有成本（月）** `holding_m`——**只要未卖出就全额承担**（包括出租期间）：

```
holding_m = mgmt_fee + 差饷地租 + fire_insurance/12 + 维修
差饷地租 = rates_gov_rent_override ?? flatRentAt[y−1] × 8%   # 应课租值≈市值租金×12，差饷5%+地租3%
维修 = property_price × maintenance_pct% / 12
```

**D5 出租净收入（月）** `rental_net_m`：

```
毛租金 = flatRentAt[y] × (12 − vacancy_months) / 12     # 扣空置
物业税 = 毛租金 × (property_tax_rate% × property_tax_allowance%)   # 15%×80%=12%
rental_net_m = 毛租金 − 物业税 − rental_maintenance_annual/12
```

**D6 业主换约杂费** `let_misc`（在换约年发生）：

```
首次出租年（y == N）：+ consent_to_lease_fee（出租同意书，一次性）
每个新约（y == N 或 (y−N) % cycle == 0）：
   + let_agent_fee_months × flatRentAt[y] + flatRentAt[y] × 12 × tenant_stamp_duty%
```

**D7 每月循环**（顺序与租房方案一致）：

```
b_lump ×= (1 + investment_return/12)
b_flow ×= (1 + deposit_rate/12)
b_link ×= (1 + rM)                       # M-link 利率 = 当年按揭利率
若 b_link > link_cap：溢出部分回 b_lump
按揭：interest = bal × rM; principal = min(pay − interest, bal); bal −= principal
b_flow += income_at(y)
        + (renting_out ? rental_net_m : 0)          # 租金净收入按月入账
        − living_expense
        − pay                                        # 月供（本+息）
        − rent_this_year                             # 自己租房（换房后/卖出后）
        − (sold ? 0 : holding_m)                     # 持有成本（未卖出才付）
        − (renting_out ? let_misc/12 : 0)            # 换约杂费按月摊
```

**D8 居所贷款利息扣税（MDI）**——年末一次性：

```
若 mdi_enabled 且 self_occupied 且当年有利息：
b_flow += min(当年利息总和, 100_000) × mdi_marginal_rate%
```

**D9 年末提前还款**（从 `b_flow` 扣，不允许扣成负）：

```
amount = min(annual_prepayment, max(b_flow, 0), bal)
若 y ≤ lock_in_years（罚息期内）：
    cost += amount × prepay_penalty%
    cost += rebate_cash × (amount/bal) × ((lock_in − y + 1)/lock_in)   # 回赠按比例追讨
b_flow −= cost; bal −= amount
```

**D10 年末卖出结算**（`S == y`，卖出价 = `sale_price_override ?? priceAt[S]`）：

```
net = salePrice − salePrice × sell_agency% − legal_fee_sell − max(bal, 0)
若 y ≤ lock_in_years：
    net −= rebate_cash × ((lock_in − y + 1)/lock_in)   # 回赠追讨
    net −= bal × prepay_penalty%                        # 罚息
b_lump += net + b_link; b_link = 0; sold = True; bal = 0
之后年份：rent_this_year = renterRentAt[y]（转租房状态），不再有持有成本/月供
```

**D11 年末净资产**：

```
buyNW[y] = (sold ? 0 : priceAt[y] − bal) + b_lump + b_link + b_flow
```

---

## 8. 计算 E：汇总与派生指标（ts L324 起 / py 约 L614 起）

| 指标 | 公式 | 用途 |
|---|---|---|
| `final_buy / final_rent` | 第 T 年末 `buyNW / rentNW` | 最终对比 |
| `final_diff` | `final_buy − final_rent` | 正=买房赢 |
| `break_even_year` | 首个满足 `buyNW[y] > rentNW[y]` 的 y（严格大于；全程不超过则 None） | 打平年 |
| `monthly_payment_0` | 第 1 年月供 | 展示 + DSR |
| `dsr_pct` | `monthly_payment_0 / monthly_income × 100` | >50% 出警告 |
| `loan_amount / loan_amount_gross` | 实际批出 / 名义申请 | 回赠调低前后 |
| `ltv_pct` | `loan_amount / price × 100` | 展示 |
| `upfront_buy` | §5 B6 | 展示 + 资金充足性检查 |
| `sale_price_default` | `priceAt[S]` | UI 显示推算出售价 |

**警告（warnings）**：DSR>50%；期初支出 > 手头现金；按保封顶调整；楼价超按保上限；
回赠超 1% 扣减说明；罚息期内卖出提示；S<N 且开启出租（单位从未出租）。

---

## 9. 对比口径：系统里有哪些对比

1. **主对比（核心输出）**：逐年 `buyNW[y]` vs `rentNW[y]`，两方案同起点 `initial_cash`、
   同收入、同生活开支 → 结论卡展示 T 年末谁多多少、§8 的打平年。
2. **流量对比（明细表，`DetailTable.tsx`）**：买房侧的"月供年合计 / 持有成本年合计 /
   净租金收入 / 自己租房支出" vs 租房侧的"租金支出 / 换约杂费"。
3. **资产结构对比**：买方的"楼市值−贷款+M-link+定期+大额" vs 租方的"大额+定期+按金"——
   买房的资产在楼里（赚楼价涨幅、付利息），租房的资产在投资池（赚投资回报率），
   这就是"机会成本"机制：`investment_return_pct` 越高对租房越有利。
4. **场景对比（用户手动驱动）**：改任一输入即时重算对比，最典型的是用
   `price_growth_rates` 填入 RVD 真实历史区间（如 1998 年起 vs 2021 年起），
   看"同一套持有逻辑在不同楼价路径下的结论翻转"。
5. **不同时点卖出的对比**：`sell_year` 任意设 + `sale_price_override` 覆盖出售价，
   扫描"第几年卖 × 卖什么价"对期末净资产的影响。

---

## 10. 已知简化（有意为之，不是 bug）

| # | 简化 | 理由 |
|---|---|---|
| 1 | 回赠现金视为**第 0 月**到账（实际交易完成后数周） | 30 年尺度下时间差可忽略；但**完成日首付不含回赠抵扣**（`upfront_buy` 不减回赠），保持"抬钱上会"的真实资金压力 |
| 2 | 回赠追讨按剩余锁定期**线性比例** | 行业惯例的近似，无公开精确公式 |
| 3 | 定期存款简化为**随存随取、按月复利、利率恒定**；每月结余**月末存入**（当月不计息） | 每月都有新钱进来时现实中只能滚动短存；月末存入是保守约定 |
| 4 | MIP 保费**期初现金支付**（现实中常加借进贷款摊还） | 保守口径（对买房方案略不利），避免保费计息的复杂度 |
| 5 | 差饷+地租 ≈ **8% × 市值月租金** | 应课租值≈市值租金×12，差饷 5%+地租 3%；随租金曲线联动，可手动覆盖 |
| 6 | 物业税 = 租金 × 15% × **80%**（法定修葺扣减）= 12% | 税务局标准计算口径 |
| 7 | MDI 利息扣除**年末一次性**入账，仅自住年，年利息上限 $100,000 | 实际在薪俸税年度结算，年末近似 |
| 8 | 月供**每年重新摊还**（余额+剩余月数），非锁定首年月供 | 恒定利率下与标准表一致；分段利率下等价于每年重定价 |
| 9 | 增长率列表不足 T 年补 0、利率列表不足补末值（`_pad_rates`） | 补 0=横盘假设，补末值=利率维持假设 |
| 10 | 楼价/租金为年复利平滑曲线，无年内波动；默认出售价取第 S 年**末**曲线值 | 用户可用 `sale_price_override` 自定义任何卖出价 |
| 11 | 租约印花税用参数 `0.25% × 年租`（=0.5% 各付一半后的租客份额），业主换约同份额 | 与 `lease_stamp_duty` 参考函数一致；参数化便于用户改 |
| 12 | 换楼年（N）按金重置为新租金的 2 个月 | 旧按金退、新按金付，净差在当年体现 |
| 13 | 不建模通胀（名义值对比）；收入增长不改变对比结论（两方案同） | 名义净资产排序与实际购买力排序在两方案间一致 |
| 14 | 提前还款上限受 `b_flow` 现金约束；租房方案 `r_flow` 允许为负（透支） | 简化；正常参数下不会触发 |
| 15 | 租客换楼年（N）会同时支付：首约成本（C1 已扣，基于小房租金）+ 新约成本（基于大房租金）+ 搬迁费 | 现实中首约不足一年提前解约，中介费确实难退，保守处理 |

## 11. 已知展示瑕疵（净资产正确，仅明细表显示有偏）

**卖出年（S 年）明细表的"持有成本"列显示 $0**：因为 `buy_holding_paid` 在 `sold` 置位
之后才记录，而当年 12 个月持有成本实际已在月循环中扣除。**净资产与现金流均正确**，
仅 `YearRow.buy_holding_paid` 这一列在卖出年偏小（差 12×holding_m）。如需修复，
应在卖出结算前先把当年持有成本快照存下再 push。

---

## 12. 规则与数据来源

| 内容 | 来源 | 版本/口径 |
|---|---|---|
| 印花税税表 | 税务局 IRD《从价印花税》FAQ | 2025.2.26 起生效（≤$4M 象征式 $100）；2024.2.28 起 BSD/NRSD/SSD 全撤，全员第二标准税率 |
| 按保成数与保费 | 香港按证保险 HKMC《Premium Rate Sheet》 | 2024.10.16 起生效版（浮息、一次性保费、首置自用） |
| 楼价/租金历史 | 差饷物业估价署 RVD 官方 Excel（his_data_3/4.xls） | "所有类别"年度指数，1981–2025 逐年涨跌幅 |
| 回赠规则 | 金管局通告（2005-02-28）+ 中原按揭王美凤（大公报 2026-05-18）+ 经络按揭曹德明（星岛 2026-06-08） | 整笔回赠计入贷款额计算成数；回赠按原贷款额（高成数按楼价七成）计；完成后现金发放 |
| DSR 50% | 金管局指引（压力测试 2024.2 已取消，仅 DSR） | 仅作警告，不阻止计算 |

## 13. 测试锚点与验证方法

两侧测试集（`node scripts/smoke.ts` / `cd python && python3 test_engine.py`）共 33 项，
关键锚点：

| 类别 | 锚点 |
|---|---|
| 印花税 | 4M→100；5M→112,500；6M→135,000；6.7M→201,000；**10M→370,000**（边际减免）；21,739,121→923,913 |
| 月供 | 3.5M @3.5%/30y → 15,716.57 |
| 不变量 A | 租金=0、全费用=0、零利率、全现金买房 → 每一年 `buyNW − rentNW = 0` |
| 不变量 B | 零利率、租金 1,000/月 → `buyNW − rentNW = 期初一次性支出 + 12,000×y` |
| 默认场景 | finalBuy≈4,833,406；finalRent≈5,804,800；期初支出 1,833,500；印花税 112,500 |
| 按保 | 80% 成数→保费 36,800（4M×0.92%）；90%→97,200（4.5M×2.16%）；非首置封顶 80% |
| 回赠>1% | 350 万贷款 1.5% 回赠 → 回赠 52,500、贷款 3,447,500、期初 1,886,000 |
| 高成数回赠基数 | 800 万楼九成按揭 1.3% → 回赠 72,800（=800万×70%×1.3%）、贷款 7,127,200（与经络按揭专栏逐分一致） |
| 卖出场景 | 第 5 年以 4M 卖出 → finalBuy≈4,101,293，第 5 年末 buySold=True |

审查时任何引擎改动后：两侧测试必须全绿；若改动影响锚点数字，须先核对官方来源再同步更新
两侧锚点。
