# 代码审查意见（对照 METHODOLOGY.md 逐条核对）

> **审查范围**：`python/hk_engine.py`、`src/engine/engine.ts`、`src/engine/stampDuty.ts`、
> `src/engine/hkmc.ts`、`src/engine/defaults.ts`、`src/types.ts`、`src/components/`（UI 层）、
> `scripts/smoke.ts`、`python/test_engine.py`。
> **审查方法**：按 METHODOLOGY.md §4–§8 逐条核对公式与实现；两侧测试集全量运行；
> 对疑点编写探针脚本实证（双引擎 4 组场景逐年数值对照、边界输入、会计恒等式）。
> **行号基于 2026-10-10 版本，以函数名为准。**

---

## 1. 总体结论

模型主体（印花税税表、按保、回赠三规则、月供逐年重摊、双资金池、生命周期状态机、
汇总指标）与 METHODOLOGY.md 描述**一致**，33 项锚点测试两侧全绿，双引擎在 4 组抽查场景
（默认 / 卖出 / 30 年增长+分段利率 / 提前还款+回赠扣减）中**逐年 6 列数值完全一致**。

但发现 **4 个实质问题**（2 个计费口径错误、1 个崩溃路径、1 个双引擎语义分叉）、
**2 个中等问题**、若干轻微问题与测试覆盖缺口。其中问题 2.1 会使**租房方案净资产被虚增**
（默认场景约 $9,000），问题 2.4 会使**租房方案净资产被少计**（默认场景 $13,500），
两者方向相反、部分抵消，但都直接影响主对比结论。

---

## 2. 实质问题（建议修复）

### 2.1 【会计错误】换楼年按金重置缺少现金顶额扣付 → 租房净资产虚增

**位置**：[hk_engine.py L432-L434](file:///home/zhangchi/Documents/hk_realestate_value/python/hk_engine.py#L432-L434)、[engine.ts L160-L163](file:///home/zhangchi/Documents/hk_realestate_value/src/engine/engine.ts#L160-L163)

**现象**：租客在第 N 年换楼时，代码把按金资产直接重置为新租金的 `deposit_months` 倍：

```python
if N > 0 and y == N:
    misc += inp.moving_cost_per_move
    deposit = inp.deposit_months * rent   # 换楼：旧按金退、新按金付
```

但"新按金付、旧按金退"的**净现金支出**（`deposit_months × (rent2 − rent1)`）从未从
`r_lump/r_flow` 中扣除。净资产 `rentNW = r_lump + r_flow + deposit` 中资产端涨了、
现金端没动，凭空多出 `deposit_months × (rent2 − rent1)`。

**与需求相悖**：METHODOLOGY §10-12 明确写"旧按金退、新按金付，**净差在当年体现**"，
代码只体现了资产端，未体现现金端。§6-C3 的 C3 事件清单中也没有这一净支出项。

**实证**（探针：零收入零开支零利率，`switch_year=2, deposit_months=2`）：

| 场景 | 第 2 年 rentNW 相对基准差 |
|---|---|
| rent2 = rent1 = 13,500 | 0 |
| rent2 = 18,000 | −47,385 |

分解：多付租金 −54,000 − 多付换约杂费 −2,385 + **虚增按金资产 +9,000**。
若按金顶额正确计为现金支出，第 2 年差应为 −56,385（换楼时点净资产不变，符合现实）。

**影响**：租房净资产自第 N 年起虚增（默认场景 $9,000），拉低"买房−租房"差额、
推迟打平年。金额不算大，但属于方向明确的系统性偏差。

**建议**：在换楼年把 `deposit_months × (rent2_at_N − 旧按金/月租金)` 计入当年现金支出
（并入 `misc` 或单列），双引擎同步；补一个"按金重置不改变净资产"的不变量测试。

---

### 2.2 【崩溃路径】`sell_year > years` 时 Python 引擎 IndexError / TS 返回 undefined

**位置**：[hk_engine.py L460](file:///home/zhangchi/Documents/hk_realestate_value/python/hk_engine.py#L460)（`sale_price_default = price_at[S] if S else None`）、[engine.ts L192](file:///home/zhangchi/Documents/hk_realestate_value/src/engine/engine.ts#L192)

**现象**（探针实证）：

- Python：`simulate(replace(DEFAULT_INPUTS, years=5, sell_year=10))` → `IndexError: list index out of range`
  （`price_at` 只有 0..5，取下标 10）；
- TS：同输入不崩溃，但 `derived.salePriceDefault` 返回 **`undefined`**（类型声明是 `number | null`），
  且两引擎都**静默**把"第 10 年末出售"降级为"持有到期末"，无任何警告。

**可达路径（UI 真实操作）**：先设"中途出售=第 10 年末"，再把"模拟时长"从 10 调小到 5——
InputPanel 只在变更 `sellYear` 时赋值（[InputPanel.tsx L31](file:///home/zhangchi/Documents/hk_realestate_value/src/components/InputPanel.tsx#L31)、[L52](file:///home/zhangchi/Documents/hk_realestate_value/src/components/InputPanel.tsx#L52)），
`years` 变小后 `sellYear` 不回收，直接把非法状态送进引擎。`switch_year` 有同样的"不回收"
问题，但因 >T 只是"不换房"，无崩溃。

**建议**：引擎入口统一钳制 `S = min(S, T)`（或越界时报 warning 并忽略出售），
`sale_price_default` 取 `price_at[S] if S and S <= T else None`；UI 在 `years` 变更时
联动回收 `sellYear`/`switchYear`。双引擎同步。

---

### 2.3 【双引擎分叉】`mip_override` 语义不一致：TS 缩放、Python 不缩放

**位置**：[hk_engine.py L371-L375](file:///home/zhangchi/Documents/hk_realestate_value/python/hk_engine.py#L371-L375) vs [engine.ts L106-L110](file:///home/zhangchi/Documents/hk_realestate_value/src/engine/engine.ts#L106-L110)

Python（覆盖值直接采用，不缩放）：

```python
mip_premium = inp.mip_override if inp.mip_override is not None else mip_single_premium(...) * (loan_amount / requested_loan)
```

TS（覆盖值也按放款缩放）：

```ts
const mipOnGross = inp.mipOverride ?? mipSinglePremium(...)
mipPremium = mipOnGross * (loanAmount / requestedLoan)
```

**实证**（`down_payment_pct=10, cash_rebate_pct=1.5, mip_override=50000`）：
Python `mip_premium = 50,000`；TS `mipPremium = 49,416.67`（×0.98833）。

**与需求相悖**：METHODOLOGY §2 承诺"双引擎逻辑 1:1 对应"；§5-B5 只描述了
"实际计收时按放款缩放"的自动费率路径，未定义覆盖值语义，两边各自解读导致分叉。
现有测试用 `mip_override=0` 场景（两结果都是 0）掩盖了差异。

**建议**：先定口径——若覆盖值是"名义保费"则按 §5-B5 两边都缩放（改 Python）；
若覆盖值是"实收终值"则两边都不缩放（改 TS）并在 METHODOLOGY §3 注明。补一条
`mip_override≠0 且回赠>1%` 的对照测试锁定行为。

### 2.4 【计费口径错误】"上期"与逐月租金重复计费 → 租房净资产少计一个月租金

**位置**：[hk_engine.py L419-L422](file:///home/zhangchi/Documents/hk_realestate_value/python/hk_engine.py#L419-L422)（期初 `r_lump -= … + prepaid_months × rent1 + …`）+ 租房月循环 [L436-L440](file:///home/zhangchi/Documents/hk_realestate_value/python/hk_engine.py#L436-L440)；TS 侧 [engine.ts L144](file:///home/zhangchi/Documents/hk_realestate_value/src/engine/engine.ts#L144)。`prepaid_months` 全引擎仅此一处参与计算。

**现象**：期初把"上期"当独立真支出扣了一次 `prepaid_months × rent1`（默认 $13,500），
而租房月循环对第 1..12T 个月**每月都扣租金**（含第一个月）——第一个月租金被收了两次。
行业口径"押二付一"的"付一"就是**首月租金提前支付**，它覆盖的就是第一个月的居住，
不是租金之外的额外费用。无论理解为"首月先付"还是"末月预付"，全租期内租金总额都应是
`12T × 月租`，模型多收 `prepaid_months` 个月。

**与需求相悖**：METHODOLOGY §3/C1 把"上期"标注为"真支出"并列入期初扣款（C1 第 2 项），
这一口径本身与行业规则不符；§6-C4 的月循环又全额计租，两处叠加即重复计费。
（注：本项在审查初稿中曾被误述为"换楼年新约应补扣上期"，正确方向恰恰相反——
两处都不应额外扣，详见下方修正记录。）

**影响**：租房净资产少计 `prepaid_months × rent1`（默认 $13,500），此后随投资回报率复利
偏差继续扩大；方向上**偏袒买房方案**、打平年提前。与问题 2.1（偏袒租房 $9,000）方向相反。

**建议**：删去期初 `prepaid_months × rent1` 扣款（最简，月循环已覆盖全部租期）；
或保留扣款但月循环跳过第一个月租金（更贴近"签约日实付"的现金流时点，期末总额相同）。
同步修改：① METHODOLOGY §3/C1/§6 的"上期（真支出）"改为"上期（=首月租金提前支付，
非额外成本）"；② [smoke.ts L77](file:///home/zhangchi/Documents/hk_realestate_value/scripts/smoke.ts#L77)
不变量 B 期望值 `upfrontRent = prepaidMonths×1000 + …` 固化了旧口径，需一并更新；
③ 第 N 年换楼的新约**无需**补扣上期（原初稿建议有误）。

---

## 3. 中等问题

### 3.1 舍入规则双引擎不一致（银行家舍入 vs 四舍五入）

**位置**：[hk_engine.py L66-L68](file:///home/zhangchi/Documents/hk_realestate_value/python/hk_engine.py#L66-L68)（`round()`）vs [stampDuty.ts L34-L36](file:///home/zhangchi/Documents/hk_realestate_value/src/engine/stampDuty.ts#L34-L36)（`Math.round()`）

Python 的 `round()` 是银行家舍入（.5 取偶），JS 的 `Math.round()` 是 .5 远离零。
**实证**：`stamp_duty(4,500,005)` → Python 67,500 / TS 67,501；
`stamp_duty(21,000,005)` → Python 850,000 / TS 850,001。
恰逢 .5 的输入会差 $1，违背"数字可与网页版互相核对"的承诺（见 hk_engine.py 文件头注释）。
**建议**：Python 侧统一改 `int(x + 0.5)`（或两边都用 floor(x+0.5)）。

### 3.2 卖出年"持有成本"列显示 $0（文档 §11 已知瑕疵，确认存在）

**位置**：[hk_engine.py L566](file:///home/zhangchi/Documents/hk_realestate_value/python/hk_engine.py#L566)、[engine.ts L311](file:///home/zhangchi/Documents/hk_realestate_value/src/engine/engine.ts#L311)

`buy_holding_paid.append(0.0 if sold else ...)` 在卖出结算（`sold=True`）之后执行，
卖出年实际已付的 12 个月持有成本不入列。净资产与现金流正确，仅该列偏小 12×holding_m。
METHODOLOGY §11 的描述准确，修复方案（卖出结算前快照当年持有成本）也正确，属展示层。
既然已经定位清楚，建议顺手修掉，不必留作长期瑕疵。

---

## 4. 轻微问题与建议（不改也可，建议文档注明）

| # | 位置 | 问题 |
|---|---|---|
| 4.1 | [hk_engine.py L360](file:///home/zhangchi/Documents/hk_realestate_value/python/hk_engine.py#L360) / [engine.ts L94](file:///home/zhangchi/Documents/hk_realestate_value/src/engine/engine.ts#L94) | 回赠 1% 判定用 `> 1%×贷款 + 0.5 元容差`，与文档 ">1%" 字面不符。容差合理（防浮点），建议在 §5-B3 注明 |
| 4.2 | [hk_engine.py L514](file:///home/zhangchi/Documents/hk_realestate_value/python/hk_engine.py#L514) / [engine.ts L256](file:///home/zhangchi/Documents/hk_realestate_value/src/engine/engine.ts#L256) | `principal = min(pay − interest, bal)` 在 `pay=0`（剩余月数≤0 但余额>0.005）时为负，余额反增。理论上只剩浮点残差才可达，但建议防御性加 `max(0, …)` 并保证余额钳制 |
| 4.3 | 租房/买房月循环 | `r_flow`/`b_flow` 允许为负且负余额仍按正存款利率复利（对透支"收息"）。§10-14 只提到 r_flow 允许为负，未写负余额计息约定；建议文档补充 |
| 4.4 | 提前还款分支（[hk_engine.py L537-L548](file:///home/zhangchi/Documents/hk_realestate_value/python/hk_engine.py#L537-L548)） | `amount` 受 `b_flow` 约束，但罚息+回赠追讨（`cost`）不受，`b_flow` 可被扣负。与 §10-14 大体一致，建议明确写入文档 |
| 4.5 | [InputPanel.tsx L250-L254](file:///home/zhangchi/Documents/hk_realestate_value/src/components/InputPanel.tsx#L250-L254) | UI 层 `defaultSale()` 复算了楼价曲线，与 §2 "UI 不含任何模型计算"的说法冲突。数字与引擎一致（非错账），但存在重复逻辑漂移风险；建议直接读 `derived.salePriceDefault`，顺带规避 2.2 的 undefined |
| 4.6 | [hk_engine.py L277-L286](file:///home/zhangchi/Documents/hk_realestate_value/python/hk_engine.py#L277-L286) vs [engine.ts L14-L22](file:///home/zhangchi/Documents/hk_realestate_value/src/engine/engine.ts#L14-L22) | `_pad_rates`：TS 把非有限数清洗为 0，Python 会让 NaN 传播 / None 抛 TypeError。健壮性差异，建议对齐 |
| 4.7 | `cap_rate` 参数 | 引擎完全不使用（仅展示），利率超封顶无提示——与 §3 "仅展示"一致，但建议超封顶时给 warning，避免用户误以为引擎已套用封顶 |
| 4.8 | 测试集 | §13 写"共 33 项，两侧同步"，实际断言数不一致（Python 43 条、TS 30 条；不变量测试 Python 跑 10 年、TS 跑 8 年）。建议对齐后更新文档数字 |

---

## 5. 测试覆盖缺口

现有两侧测试全绿，但以下分支**零覆盖**（本次审查发现的 2.1/2.2/2.3 恰好都落在无测试区域）：

1. **提前还款（D9）整段**：所有测试 `annual_prepayment=0`，罚息、回赠按比例追讨、
   `b_flow` 现金约束均未执行过；
2. **卖出在锁定期内的追讨（D10）**：卖出测试在第 5 年、`lock_in_years=3`，恰好绕开
   `y ≤ lock_in_years` 分支——`clawback`/`penalty` 路径从未被验证；
3. **换楼年按金重置**（C3）：不变量测试把 `deposit_months` 设为 0，问题 2.1 无从暴露；
4. **"上期"计费**：不变量 B 的期望值 `upfrontRent = prepaidMonths×1000 + …`（smoke.ts L77）
   反而把旧口径（上期=额外真支出）固化进了锚点，问题 2.4 被测试"锁死"，修复时须同步更新；
5. **`mip_override ≠ 0`**：唯一用到的场景是 `mip_override=0`，问题 2.3 被掩盖；
6. **`sell_year > years`、`sell_year = 0`、`switch_year > years` 等边界输入**；
7. **租金/楼价增长率非零的默认对照**（现只测了横盘场景）。

建议补充上述场景各 1–2 条锚点，并双侧同步（注意先修 2.1–2.4 再定锚点数字）。

---

## 6. 核对通过项（与文档一致，未发现问题）

- **印花税 13 段税表**（`stamp_duty_residential` / `stampDutyResidential`）：与 IRD
  2025.2.26 口径一致，含 $10M→$370,000 边际减免（非 375,000）、4M→$100 等全部锚点；
- **按保**（`max_mip_terms` / `mip_single_premium`）：成数分档、$9M/$12M 贷款上限、
  非首置封顶 80%、70–75% 免保费、>17.15M 强制降 70% 并警告、保费按放款缩放——均与
  §5-B1/B5 一致（`_MIP_MID` 无非首置表与 §5-B5 描述一致，属文档口径内的简化）；
- **现金回赠三规则**（§5-B3）：回赠基数（>70% 成数按楼价七成）、>1% 整笔计入贷款额、
  完成后现金发放（第 0 月入池、`upfront_buy` 不预扣）——与金管局通告及中原/经络算例
  逐分吻合，也与项目既定约束一致；
- **月供**：等额本息公式正确（3.5M@3.5%/30y→15,716.57 锚点通过），逐年按余额+剩余月数
  重摊与 §9-8 一致；
- **曲线预计算 A1–A5**：楼价/租金曲线、租金跳涨（第 N 年换 rent2 后按增长率复利）、
  卖出后沿用租金曲线、`_pad_rates` 补齐规则（增长率补 0、利率补末值）均与 §4 一致；
- **状态机 D3–D11**：`self_occupied/living_rented/renting_out` 判定、持有成本未卖出全额承担、
  出租净收入（空置 11/12 × 物业税 12% − 维修）、业主换约杂费（同意书/代理费/印花税）、
  MDI（仅自住年、年末入账、上限 $10 万）、卖出结算（佣金/律师/还贷/追讨/罚息）、
  净资产公式——均与 §7 一致；
- **租房方案 C1–C5**：期初一次性支出五项、换约年份集合（N 年换楼重开周期）、
  月末存入计息顺序、按金计资产——与 §6 一致（按金顶额的现金处理除外，见 2.1）；
- **汇总 E**：final/break_even（严格大于）/DSR/upfront/ltv/警告清单与 §8 一致；
  §1 的公平性约定与"收入不影响结论"推论成立（两侧同收入同开支，仅影响 DSR 警告）；
- **双引擎数值一致性**：4 组场景（默认 / 第 5 年卖出 / 30 年 3%+2% 增长与 3.5%→4.5%
  分段利率 / 年供 30 万提前还款+1.5% 回赠）逐年 6 列（买净资产、租净资产、剩余贷款、
  持有成本、杂费、净租金）全部一致（除 2.3/3.1 两个已知分叉点）。

---

## 7. 修复优先级建议

| 优先级 | 事项 | 理由 |
|---|---|---|
| P0 | 2.1 按金顶额现金扣付（双引擎+测试） | 直接影响主对比结论，方向系统性 |
| P0 | 2.4 删除"上期"重复计费（双引擎+更新不变量 B 锚点） | 直接影响主对比结论，多收一个月租金 |
| P0 | 2.2 `sell_year > years` 崩溃/undefined（引擎钳制+UI 联动） | Python 侧可被普通 UI 操作触发崩溃 |
| P1 | 2.3 `mip_override` 口径统一 + 补对照测试 | 破坏"双引擎 1:1"承诺 |
| P1 | 3.1 舍入统一、测试缺口 1/2（提前还款、锁定期卖出） | 消除 $1 级分叉；D9/D10 分支目前从未被测 |
| P2 | 3.2 展示瑕疵顺手修复、第 4 节轻微项 | 展示与文档一致性 |
| P2 | 更新 METHODOLOGY：§3/C1/§6 上期表述、§10-12 按金表述、§5-B3 容差、§13 测试项数 | 文档与代码同步 |

> 复现方式：探针脚本位于 `/tmp/probe_review.py`、`/tmp/probe_review.ts`、
> `/tmp/parity_py.py`、`/tmp/parity_ts.ts`；测试命令 `node scripts/smoke.ts`、
> `cd python && python3 test_engine.py`。
