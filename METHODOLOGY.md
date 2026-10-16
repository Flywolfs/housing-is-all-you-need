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
| `src/types.ts` | `Inputs / SimResult / YearRow / Derived` | — | TS 类型定义（YearRow.notes 为各列计算过程的悬浮说明，**仅展示层，不参与计算**，Python 版不含） |
| `src/engine/defaults.ts` | `DEFAULT_INPUTS / MAX_YEARS` | — | 默认值（元朗 $500 万场景） |
| `src/data/hkHistory.ts` | `HK_HISTORY` | — | RVD 官方楼价/租金指数 1981–2025 逐年涨跌幅（`scripts/parse_rvd.mjs` 生成） |
| `scripts/smoke.ts`、`python/test_engine.py` | — | — | 锚点测试（TS 55 项 / Python 67 项断言），两侧同步 |

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
| | `sell_year` / `sale_price_override` | None / None | 第 S 年末出售 / 手动出售价；S 超过 T 时引擎忽略并警告，UI 在缩短时长时联动回收 |
| | `initial_cash` / `cash_follow_upfront` | 2,000,000 / True | 手头现金 / True 时手头现金自动锁定为期初总支出（纯粹对比口径） |
| 二 交易成本 | `down_payment_pct` | 30 | 首付比例（贷款成数 = 100−此值） |
| | `agency_fee_pct` | 1 | 买楼佣金 |
| | `stamp_duty_override` | None | 印花税覆盖（None=按税表） |
| | `legal_fee_buy / legal_fee_mortgage / misc_fees` | 10,000/8,000/3,000 | 律师费、杂费 |
| | `mip_override` | None | 按保费覆盖（None=按 HKMC 表） |
| | `renovation` | 20,000 | 装修家电 |
| 三 按揭 | `loan_years` | 30 | 还款期 |
| | `mortgage_rates` | 全 3.0 ×30 | 按揭利率列表（%/年，分段可变） |
| | `cap_rate` | 3.0 | 封顶利率（仅展示） |
| | `cash_rebate_pct` | 1.2 | 现金回赠（占贷款额 %） |
| | `lock_in_years` / `prepay_penalty_pct` | 3 / 1 | 罚息锁定期 / 罚息率 |
| | `annual_prepayment` | 0 | 每年年末提前还款额 |
| | `prepayment_start_year` | 4 | 提前还款起始年（第 Y 年起年末还款；默认 = 默认罚息期结束后，避免误踩罚息） |
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
| | `rent_deduction_enabled` | True | 住宅租金税项扣除（min(实付租金, 10 万) × 边际税率，年末入结余；买房方案租房居住年对称享受） |
| | `rent1_monthly` / `rent2_monthly` | 13,500 / 18,000 | 小房租金 / 大房租金（N 年起首年值） |
| | `deposit_months` / `prepaid_months` | 2 / 1 | 按金（可回收，计资产）/ 上期（=首月租金提前支付，覆盖第 1 个月租金，**非额外成本**） |
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
若 rebate_cash > 1% × requested_loan：          # 触发金管局规则（含 $0.5 容差防浮点误差）
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
覆盖值 mip_override 语义 = **实收终值**，直接采用、不随放款缩放（双引擎一致）
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
       − prepaid_months × rent1            # 上期 = 首月租金提前支付（非额外成本，见 C4）
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
`moving_cost_per_move`，且**按金重置**：旧按金退回现金、新按金现金支付
（净额 `old_deposit − deposit_months×rent2` 入现金池 `r_lump`），按金资产更新为新约按金
——**换楼时点净资产不因按金机制跳变**（有不变量测试锁定，见 §13-8）。

**C4 每月循环**（顺序敏感：先计息后入账 = 月末存入约定）：

```
r_lump ×= (1 + investment_return/12)      # 大额资金按投资回报率月复利
r_flow ×= (1 + deposit_rate/12)           # 定期结余按定存利率月复利
rent_charge = 0（前 prepaid_months 个月，首月租金已签约时预付）
            = renterRentAt[y]（其余月份）
r_flow += income_at(y) − living_expense − rent_charge
```

其中 `income_at(y) = monthly_income × (1 + income_growth%)^(y−1)`。
上期口径下全租期总租金支出 = 12T × 月租（期初预付 1 个月 + 月循环 12T−1 个月），无重复计费。

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
> 还款本金有 `max(0, …)` 防御：pay≤0 的浮点残差场景下余额不会反增。

**D3 状态判定**（每年）：

```
self_occupied = !sold && (N == 0 || y < N)      # 自住：付持有成本、无租金支出
living_rented = !sold && N > 0 && y >= N        # 已换房：付持有成本 + 付大房租金
renting_out   = !sold && rentOutEnabled && N > 0 && y >= N   # 出租收租
rent_this_year = (sold || living_rented) ? renterRentAt[y] : 0
rent_tenant = rent_this_year > 0                # 今年处于租房居住状态
entered_this_year = rent_tenant && !上年 rent_tenant   # 新进入租房状态
```

**D3b 租客侧费用与按金（与租房方案对称）**：

```
进入租房状态年（首年换大房 y==N，或卖出次年）：
    按金 buyDeposit = deposit_months × rent_this_year   # 现金→资产（从 b_flow 转出），退租可回收
    签约费用（b_flow 扣）= tenant_agent_fee_months × 租金 + 租金×12×stamp_duty% + moving_cost
之后每 cycle 年续约（b_flow 扣）= 中介费 + 租约印花税（租客份额）
按金保持进入时的额度不变（HK 惯例：续约按金不重置），计入每年净资产
上期（首月预付）的时点效应忽略：月租照付（总额相同，差 1 个月利息 <$50）
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
M-link 自动存款（mortgage_link_auto_deposit，默认开）：
结余 > 0 且 b_link < link_cap 时，min(结余, 剩余额度) 转入 b_link，
其余进 b_flow（M-link 利率=按揭利率 > 定期利率 → 结余优先填 M-link）
```

**D8 居所贷款利息扣税（MDI）**——年末一次性：

```
若 mdi_enabled 且 self_occupied 且当年有利息：
b_flow += min(当年利息总和, 100_000) × mdi_marginal_rate%
```

**D8b 住宅租金税项扣除**（2022/23 课税年度起，需打厘印租约）——年末一次性：

```
租房方案：若 rent_deduction_enabled 且当年实付租金 > 0：
r_flow += min(当年实付租金, 100_000) × mdi_marginal_rate%    # 第 1 年实付 11 个月（首月以"上期"预付）
买房方案：若 rent_deduction_enabled 且 rent_tenant（换大房/卖出转租年）：
b_flow += min(当年自付租金 × 12, 100_000) × mdi_marginal_rate%
与 MDI 互斥（同一课税年度同一纳税人二选一），模型中由居住状态自然隔离：
自住年 → MDI；租房居住年 → 租金扣除；两方案平行世界各自适用
```

**D9 年末提前还款**（从 `b_flow` 扣，不允许扣成负）：

```
amount = min(annual_prepayment, max(b_flow, 0), bal)   # 仅当 y ≥ prepayment_start_year
若 y ≤ lock_in_years（罚息期内）：
    cost += amount × prepay_penalty%
    cost += rebate_cash × (amount/bal) × ((lock_in − y + 1)/lock_in)   # 回赠按比例追讨
b_flow −= cost; bal −= amount
```

> 罚息+追讨（cost 的附加部分）不受 `b_flow` 现金约束，`b_flow` 可被扣为负值（透支口径见 §10）。

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
buyNW[y] = (sold ? 0 : priceAt[y] − bal) + b_lump + b_link + b_flow + buy_deposit
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
| 12 | 换楼年（N）按金重置：**旧按金退回现金、新按金现金支付，净额入现金池**；净资产在换楼时点不跳变 | 按金=现金转资产、退回转回现金，机制上不应改变净资产（不变量测试锁定） |
| 13 | **上期 = 首月租金提前支付**：期初扣 `prepaid×月租`，月循环跳过前 `prepaid` 个月租金，总租金 = 12T×月租 | "押二付一"的行业口径，上期覆盖首月居住，非额外成本 |
| 14 | `r_flow`/`b_flow` **允许为负**，负余额仍按正存款利率复利（透支近似） | 提前还款的罚息+追讨可把 b_flow 扣负；正常参数下金额极小 |
| 15 | 封顶利率 `cap_rate` 仅为展示参数：任一年利率超封顶时**给警告**，引擎不强制套用 | 让用户感知输入异常，不静默改数 |
| 16 | 不建模通胀（名义值对比）；收入增长不改变对比结论（两方案同） | 名义净资产排序与实际购买力排序在两方案间一致 |
| 17 | 提前还款上限受 `b_flow` 现金约束（罚息/追讨除外） | 现金不够就少还，符合现实 |
| 18 | 租客换楼年（N）会同时支付：首约成本（C1 已扣，基于小房租金）+ 新约成本（基于大房租金）+ 搬迁费 | 现实中首约不足一年提前解约，中介费确实难退，保守处理 |

## 11. 展示瑕疵修复记录

**卖出年（S 年）明细表"持有成本"列显示 $0 的问题已修复**：现以 `sold_at_start`（年首状态）
记账——卖出年全年按业主状态计入 12 个月持有成本，卖出后各年记 0。净资产与明细表现已一致。

另外两项 UI 层修复：
- 数字输入框使用 draft 状态，**可整格删除后重新输入**（删除时提交 0 但显示保持空白，失焦回落显示实际值）；
- **资金联动**：摘要区在手头现金不足期初总支出时显示红色横幅（含缺口金额），
  "期初总支出"与"手头现金"并列为指标卡；"手头现金"字段的提示实时显示期初总支出。

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

两侧测试集（`node scripts/smoke.ts`：61 项断言 / `cd python && python3 test_engine.py`：72 项断言，
Python 侧不变量测试逐行断言更多），关键锚点：

| 类别 | 锚点 |
|---|---|
| 印花税 | 4M→100；5M→112,500；6M→135,000；6.7M→201,000；**10M→370,000**（边际减免）；21,739,121→923,913 |
| 月供 | 3.5M @3.5%/30y → 15,716.57 |
| 不变量 A | 租金=0、全费用=0、零利率、全现金买房 → 每一年 `buyNW − rentNW = 0` |
| 不变量 B | 上期=首月预付（prepaid=1）、零利率 → `buyNW − rentNW = 12,000×y`（总租金无重复计费） |
| 按金不变量 | 零利率下 `deposit_months`=2 vs 0 → 每一年 `rentNW` 完全相等（换楼按金重置不改变净资产） |
| 默认场景 | finalBuy≈4,957,655；finalRent≈5,675,907；差额 −718,252；期初支出 1,745,500；印花税 112,500（默认：现金=期初总支出、利率 3.0%、回赠 1.2%、装修 2 万、租金扣除开） |
| 按金对称 | 买房换房年（第 6 年）buyDeposit=36,000（2×18,000）、签约杂费 22,695（租客 14,540 + 业主 8,155）；卖出次年转租同理 |
| 按保 | 80% 成数→保费 36,800（4M×0.92%）；90%→97,200（4.5M×2.16%）；非首置封顶 80% |
| 回赠>1% | 350 万贷款 1.5% 回赠 → 回赠 52,500、贷款 3,447,500、期初 1,756,000 |
| 高成数回赠基数 | 800 万楼九成按揭 1.3% → 回赠 72,800（=800万×70%×1.3%）、贷款 7,127,200（与经络按揭专栏逐分一致） |
| 卖出场景 | 第 5 年以 4M 卖出 → finalBuy≈4,114,609，第 5 年末 buySold=True |
| 锁定期卖出 | 第 2 年卖出（lock_in=3）→ 杂费 = 42,000×2/3 + 基线年末余额×1%，贷款清零，有警告 |
| 提前还款 | 年末提前还款 → 杂费 = amount×1% + 42,000×amount/基线年末余额，贷款减少 |
| 租金税项扣除 | 默认场景：租房方案每年 17,000 入池（min(162,000, 100,000)×17%）；买房方案第 6-10 年租大房对称享受；关闭后 finalRent/finalBuy 即回退 |
| 边界输入 | sell_year>years → 不崩溃、忽略出售、salePriceDefault=null、有警告 |
| mip_override | 覆盖值 50,000 → mipPremium=50,000（实收终值，不缩放） |
| 方向性 | 楼价年涨 10% → 买房赢且打平年 ≤3 |

审查时任何引擎改动后：两侧测试必须全绿；若改动影响锚点数字，须先核对官方来源再同步更新
两侧锚点。
