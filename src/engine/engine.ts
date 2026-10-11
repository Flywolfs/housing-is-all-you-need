// 核心计算引擎：买房 vs 租房的月度现金流推演
// 两个方案共用：月收入、生活开支、存款利率、时间轴。
// 买房方案：期初买楼 →（可选第 N 年起换大房 + 出租）→（可选第 S 年卖出转租）
// 租房方案：全程租房（第 N 年起换大房），首付资金按投资回报率复利。

import type { Inputs, SimResult, YearRow } from '../types.ts'
import { stampDutyResidential } from './stampDuty.ts'
import { maxMipTerms, mipSinglePremium } from './hkmc.ts'

const MONTHS_PER_YEAR = 12
const MDI_ANNUAL_CAP = 100_000 // 居所贷款利息扣除每年上限

/** 悬浮说明用的金额（保留 2 位小数便于核对月供等中间值） */
function money(x: number): string {
  const sign = x < 0 ? '-' : ''
  return `${sign}$${Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
}
/** 百分比显示（去尾零） */
function pct(x: number): string {
  return `${+(x * 100).toFixed(4)}%`
}

/** 把利率列表补齐到指定长度：增长率类补 0，利率类补最后值；返回小数（如 0.035） */
function padRates(list: number[], len: number, mode: 'zero' | 'last'): number[] {
  const clean = (list ?? []).map((v) => (Number.isFinite(v) ? Number(v) : 0))
  const out: number[] = []
  for (let i = 0; i < len; i++) {
    if (i < clean.length) out.push(clean[i] / 100)
    else out.push(mode === 'zero' ? 0 : (clean[clean.length - 1] ?? 0) / 100)
  }
  return out
}

/** 等额本息月供 */
function annuityPayment(balance: number, monthlyRate: number, months: number): number {
  if (balance <= 0 || months <= 0) return 0
  if (monthlyRate <= 0) return balance / months
  return (balance * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -months))
}

export function simulate(inp: Inputs): SimResult {
  const warnings: string[] = []
  const T = Math.max(1, Math.round(inp.years))

  // ---------- 曲线预计算 ----------
  const priceG = padRates(inp.priceGrowthRates, T, 'zero')
  const rentG = padRates(inp.rentGrowthRates, T, 'zero')
  const mRateY = padRates(inp.mortgageRates, Math.max(T, inp.loanYears), 'last')

  // 封顶利率提示：H 按实际利率不应超过封顶，超出说明输入可能有误
  const overCapYears: number[] = []
  for (let y = 1; y <= T; y++) {
    if (mRateY[y - 1] * 100 > inp.capRate + 1e-9) overCapYears.push(y)
  }
  if (overCapYears.length > 0) {
    warnings.push(
      `按揭利率列表中有 ${overCapYears.length} 年高于封顶利率 ${inp.capRate}%（首见第 ${overCapYears[0]} 年），` +
        `封顶利率仅为展示参数，引擎未强制套用，请确认输入。`,
    )
  }

  // 楼市值：下标 0..T（0 为现价）
  const priceAt: number[] = [inp.propertyPrice]
  for (let y = 1; y <= T; y++) priceAt.push(priceAt[y - 1] * (1 + priceG[y - 1]))

  // 自己单位的市场月租金（用于差饷地租、出租收入），下标 0..T
  const flatRentAt: number[] = [inp.rentalIncomeMonthly0]
  for (let y = 1; y <= T; y++) flatRentAt.push(flatRentAt[y - 1] * (1 + rentG[y - 1]))

  // 租客视角租金：第 1..N-1 年租小房，第 N 年起租大房（大房首年值为 rent2Monthly）
  const N = inp.switchYear
  const renterRentAt: number[] = [0]
  for (let y = 1; y <= T; y++) {
    let v: number
    if (N > 0 && y >= N) {
      v = inp.rent2Monthly
      for (let i = N; i < y; i++) v *= 1 + rentG[i - 1]
    } else {
      v = inp.rent1Monthly
      for (let i = 1; i < y; i++) v *= 1 + rentG[i - 1]
    }
    renterRentAt.push(v)
  }

  // ---------- 买入成本与按揭设定 ----------
  let loanPct = 100 - inp.downPaymentPct
  let mipEligible = false
  let mipPremium = 0
  if (loanPct > 70) {
    const mipTerms = maxMipTerms(inp.propertyPrice)
    if (!mipTerms) {
      warnings.push('楼价超过按保适用上限（$1,715 万），高成数不可行，已按 70% 贷款成数计算。')
      loanPct = 70
    } else {
      let capPct = mipTerms.ltv
      if (!inp.isFirstTimeBuyer) capPct = Math.min(capPct, 80)
      if (mipTerms.loanCap) capPct = Math.min(capPct, (mipTerms.loanCap / inp.propertyPrice) * 100)
      if (loanPct > capPct) {
        warnings.push(`按保承保成数上限为 ${capPct.toFixed(0)}%，贷款额已按此调整。`)
        loanPct = capPct
      }
      mipEligible = true
    }
  }

  const requestedLoan = (inp.propertyPrice * loanPct) / 100

  // 现金回赠（金管局 2005-02-28 通告 + 市场实务，见中原按揭王美凤/经络按揭曹德明 2026 年专栏）：
  //   1. 回赠基数：成数 ≤70% 按贷款额计；>70%（按保）时银行只按楼价七成计，不按实际贷款额
  //   2. 回赠金额 > 贷款额 1%：整笔回赠计入贷款额计算按揭成数
  //      → 实际批出贷款额 = 原贷款额 − 整笔回赠（完成日买家需多备等额首期，即"抬钱上会"）
  //   3. 整笔回赠于交易完成后以现金发放（模型视为第 0 月到账）
  const rebateBase = loanPct > 70 ? inp.propertyPrice * 0.7 : requestedLoan
  const rebateCash = (rebateBase * inp.cashRebatePct) / 100
  let loanAmount: number
  if (rebateCash > requestedLoan * 0.01 + 0.5) {
    loanAmount = requestedLoan - rebateCash
    warnings.push(
      `现金回赠超过贷款额 1%：整笔回赠 $${Math.round(rebateCash).toLocaleString()} 计入贷款额计算按揭成数，` +
        `实际批出贷款额由 $${Math.round(requestedLoan).toLocaleString()} 调低至 $${Math.round(loanAmount).toLocaleString()}（完成日需多备等额首期）；` +
        `整笔回赠于交易完成后以现金发放（模型视为第 0 月到账）。`,
    )
  } else {
    loanAmount = requestedLoan
  }
  const rebateDeducted = loanAmount < requestedLoan - 0.5

  if (mipEligible) {
    // 覆盖值语义 = 实收终值，直接采用（双引擎一致，不随放款缩放）；
    // 自动路径按名义费率计算后按实际放款缩放（回赠令放款调低时略小）
    mipPremium =
      inp.mipOverride ??
      mipSinglePremium(inp.propertyPrice, loanPct, inp.loanYears, inp.isFirstTimeBuyer) * (loanAmount / requestedLoan)
  }

  const stampDuty = inp.stampDutyOverride ?? stampDutyResidential(inp.propertyPrice)

  // 首期现金（交易完成时点）= 楼价 − 实际放款额；回赠尚未到账（数周后发放，见下方第 0 月现金流入）
  const upfrontBuy =
    inp.propertyPrice - loanAmount +
    stampDuty +
    (inp.propertyPrice * inp.agencyFeePct) / 100 +
    inp.legalFeeBuy +
    inp.legalFeeMortgage +
    inp.miscFees +
    mipPremium +
    inp.renovation

  // ---------- 共用参数 ----------
  const rInvM = inp.investmentReturnPct / 100 / MONTHS_PER_YEAR
  const rDepM = inp.depositRatePct / 100 / MONTHS_PER_YEAR
  const incomeAt = (y: number) => inp.monthlyIncome * Math.pow(1 + inp.incomeGrowthPct / 100, y - 1)

  // 租约事件年份（租客）：初始约第 1 年，每 cycle 年续约一次；第 N 年换楼重开周期
  const cycle = Math.max(1, inp.leaseRenewalCycleYears)
  const tenantRenewalYears = new Set<number>()
  if (N > 0) {
    for (let y = 1 + cycle; y < N; y += cycle) tenantRenewalYears.add(y)
    for (let y = N; y <= T; y += cycle) tenantRenewalYears.add(y)
  } else {
    for (let y = 1 + cycle; y <= T; y += cycle) tenantRenewalYears.add(y)
  }

  // ---------- 租房方案模拟 ----------
  let rLump = inp.initialCash
  let rFlow = 0
  let deposit = inp.depositMonths * inp.rent1Monthly
  // 上期 = 首月租金提前支付（押二付一），覆盖第 1 个月的租金，非额外成本；
  // 月循环将跳过前 prepaidMonths 个月的租金，此处扣的是"提前支付"的时点
  rLump -= deposit + inp.prepaidMonths * inp.rent1Monthly + inp.tenantAgentFeeMonths * inp.rent1Monthly
  rLump -= (inp.rent1Monthly * 12 * inp.tenantStampDutyPctOfAnnual) / 100
  rLump -= inp.movingCostPerMove

  const rentNW: number[] = []
  const rentLumpAt: number[] = []
  const rentFlowAt: number[] = []
  const rentDepositAt: number[] = []
  const rentPaidAt: number[] = []
  const rentMiscAt: number[] = []
  const rentNotes: Record<string, string>[] = []
  const prepaidAmount = inp.prepaidMonths * inp.rent1Monthly
  let prepaidLeft = inp.prepaidMonths // 已预付租金覆盖的剩余月数
  for (let y = 1; y <= T; y++) {
    const income = incomeAt(y)
    const rent = renterRentAt[y]
    // 资金池演变追踪（供计算面板）：年初余额（按金重置调整前）
    const rlStart = rLump
    const rfStart = rFlow
    let rlInt = 0
    let rfInt = 0
    let rentYearSurplus = 0
    let lumpAdj = 0
    // 换约杂费的原子分量
    let miscAgent = 0
    let miscStamp = 0
    let miscMoving = 0
    let oldDepositNote = ''
    if (tenantRenewalYears.has(y)) {
      miscAgent = inp.tenantAgentFeeMonths * rent
      miscStamp = (rent * 12 * inp.tenantStampDutyPctOfAnnual) / 100
      if (N > 0 && y === N) {
        miscMoving = inp.movingCostPerMove
        // 换楼：旧按金退回现金、新按金现金支付（净额入现金池），
        // 按金资产更新为新约按金——换楼时点净资产不因按金机制跳变
        const oldDeposit = deposit
        deposit = inp.depositMonths * rent
        const adj = oldDeposit - deposit
        rLump += adj
        lumpAdj = adj
        oldDepositNote = `；旧按金 ${money(oldDeposit)} 已退回现金池`
      }
    }
    const misc = miscAgent + miscStamp + miscMoving
    let yearPaid = 0
    let skippedThisYear = 0
    for (let month = 0; month < MONTHS_PER_YEAR; month++) {
      const li = rLump * rInvM
      rLump += li
      rlInt += li
      const fi = rFlow * rDepM
      rFlow += fi
      rfInt += fi
      let rentCharge: number
      if (prepaidLeft > 0) {
        prepaidLeft -= 1
        skippedThisYear++
        rentCharge = 0 // 首月租金已在签约时预付
      } else {
        rentCharge = rent
      }
      const s = income - inp.livingExpenseMonthly - rentCharge
      rentYearSurplus += s
      rFlow += s
      yearPaid += rentCharge
    }
    rFlow -= misc
    rentLumpAt.push(rLump)
    rentFlowAt.push(rFlow)
    rentDepositAt.push(deposit)
    rentPaidAt.push(yearPaid)
    rentMiscAt.push(misc)
    rentNW.push(rLump + rFlow + deposit)
    rentNotes.push({
      rentPaid:
        skippedThisYear > 0
          ? [
              `月租 ${money(rent)} × ${12 - skippedThisYear} 个月 = ${money(yearPaid)}`,
              `另有签约时预付的首月租金 ${money(prepaidAmount)}（在期初一次性支付，不重复计费）`,
              `月租来源：输入 ${money(inp.rent1Monthly)} × 累计租金涨幅`,
            ].join('\n')
          : `月租 ${money(rent)} × 12 个月 = ${money(yearPaid)}（输入值按租金涨幅逐年调整）`,
      deposit: [
        `${inp.depositMonths} 个月按金（输入）× 当年月租 ${money(rent)} = ${money(deposit)}`,
        oldDepositNote && `换楼：${oldDepositNote.replace('；', '')}`,
      ]
        .filter(Boolean)
        .join('\n'),
      rentNW: [
        ...(y === 1
          ? [
              '【期初推导（第 0 年，签约时一次性支付）】',
              `手头现金 ${money(inp.initialCash)}`,
              `− 按金 ${money(inp.depositMonths * inp.rent1Monthly)}（= ${inp.depositMonths} 个月 × 月租 ${money(inp.rent1Monthly)}，可回收资产）`,
              `− 上期 ${money(inp.prepaidMonths * inp.rent1Monthly)}（= ${inp.prepaidMonths} 个月 × 月租，即首月租金预付）`,
              `− 中介费 ${money(inp.tenantAgentFeeMonths * inp.rent1Monthly)}（= 月租 × ${inp.tenantAgentFeeMonths} 个月）`,
              `− 租约印花税 ${money((inp.rent1Monthly * 12 * inp.tenantStampDutyPctOfAnnual) / 100)}（= 年租 ${money(inp.rent1Monthly * 12)} × ${inp.tenantStampDutyPctOfAnnual}%）`,
              `− 搬迁费 ${money(inp.movingCostPerMove)}`,
              `= 大额投资期初 ${money(rlStart)}；定期结余期初 $0`,
            ]
          : ['大额投资年初 = 上年末（见上年"租净资产"）']),
        `大额投资 ${money(rLump)} = 年初 ${money(rlStart)} + 当年利息 ${money(rlInt)}（= 年初 × 年利率 ${inp.investmentReturnPct}% 按月复利）${lumpAdj !== 0 ? ` + 按金重置净额 ${money(lumpAdj)}（旧按金退回现金、新按金付出现金）` : ''}`,
        `定期结余 ${money(rFlow)} = 年初 ${money(rfStart)} + 当年利息 ${money(rfInt)}（年利率 ${inp.depositRatePct}% 按月复利）+ 当年月度结余 ${money(rentYearSurplus)}`,
        `  月度结余 = 收入 ${money(income * 12)}（月 ${money(income)} × 12）− 生活开支 ${money(inp.livingExpenseMonthly * 12)} − 租金 ${money(yearPaid)}`,
        misc > 0
          ? `− 换约杂费 ${money(misc)}（中介 ${money(miscAgent)} + 租约印花税 ${money(miscStamp)}${miscMoving > 0 ? ` + 搬迁 ${money(miscMoving)}` : ''}）`
          : '',
        `按金 ${money(deposit)}（资产，退租可回收）`,
        `合计净资产 = ${money(rLump)} + ${money(rFlow)} + ${money(deposit)} = ${money(rLump + rFlow + deposit)}`,
      ]
        .filter((l) => l !== '')
        .join('\n'),
    })
  }

  // ---------- 买房方案模拟 ----------
  const linkCap = inp.mortgageLinkEnabled ? loanAmount * 0.5 : 0
  let bLump = inp.initialCash - upfrontBuy
  bLump += rebateCash // 现金回赠于交易完成后数周到账（模型视为第 0 月）
  let bLink = Math.min(Math.max(bLump, 0), linkCap)
  bLump -= bLink
  let bFlow = 0
  let bal = loanAmount
  let sold = false

  let S = inp.sellYear
  if (S !== null && S > T) {
    warnings.push(`出售年份第 ${S} 年超过模拟时长 ${T} 年，已忽略出售设置。`)
    S = null
  }
  const salePriceDefault: number | null = S ? priceAt[S] : null

  const buyNW: number[] = []
  const buyBalAt: number[] = []
  const buySoldAt: boolean[] = []
  const buyMortgagePaid: number[] = []
  const buyHoldingPaid: number[] = []
  const buyRentPaid: number[] = []
  const buyRentalIncome: number[] = []
  const buyMiscPaid: number[] = []
  const buyPrepaid: number[] = []
  const buyLumpAt: number[] = []
  const buyLinkAt: number[] = []
  const buyFlowAt: number[] = []
  const buyDepositAt: number[] = []
  const buyNotes: Record<string, string>[] = []
  let monthlyPayment0 = 0
  let buyDeposit = 0 // 买房方案租房阶段的按金（现金→资产，退租可回收）
  let rentalEnteredYear: number | null = null
  let prevRentTenant = false

  for (let y = 1; y <= T; y++) {
    const rM = mRateY[y - 1] / MONTHS_PER_YEAR
    const soldAtStart = sold // 卖出结算发生在年末，当年全年仍按业主状态记账
    const balStart = bal // 年初贷款余额（月循环前）
    const remainingMonths = inp.loanYears * MONTHS_PER_YEAR - (y - 1) * MONTHS_PER_YEAR
    const pay = !sold && bal > 0.005 ? annuityPayment(bal, rM, remainingMonths) : 0
    if (y === 1) monthlyPayment0 = pay

    const income = incomeAt(y)
    const selfOccupied = !sold && (N === 0 || y < N)
    const livingRented = !sold && N > 0 && y >= N
    const rentingOut = !sold && inp.rentOutEnabled && N > 0 && y >= N
    const rentThisYear = sold || livingRented ? renterRentAt[y] : 0
    const rentTenant = rentThisYear > 0 // 今年处于租房居住状态（换大房或卖出后）
    const enteredThisYear = rentTenant && !prevRentTenant // 今年新进入租房状态
    if (rentTenant) prevRentTenant = true
    else prevRentTenant = false

    // 持有成本（月）：管理费 + 差饷地租(≈8%×市值租金) + 火险 + 维修
    const ratesM = inp.ratesGovRentOverride ?? flatRentAt[y - 1] * 0.08
    const maintM = (inp.propertyPrice * inp.maintenancePctOfPrice) / 100 / MONTHS_PER_YEAR
    const holdingM = inp.mgmtFeeMonthly + ratesM + inp.fireInsuranceAnnual / MONTHS_PER_YEAR + maintM

    // 出租净收入（月）：扣空置、物业税（15%×80%）、维修损耗
    let rentalNetM = 0
    let rentalGross = 0
    let rentalTax = 0
    if (rentingOut) {
      rentalGross = (flatRentAt[y] * (MONTHS_PER_YEAR - inp.vacancyMonths)) / MONTHS_PER_YEAR
      rentalTax = rentalGross * ((inp.propertyTaxRatePct / 100) * (inp.propertyTaxAllowancePct / 100))
      rentalNetM = rentalGross - rentalTax - inp.rentalMaintenanceAnnual / MONTHS_PER_YEAR
    }

    // 出租换约杂费（业主）：首次出租同意书费；每个新约的代理费 + 租约印花税（业主一半）
    let letMisc = 0
    if (rentingOut && y === N) letMisc += inp.consentToLeaseFee
    if (rentingOut && (y === N || (y - N) % cycle === 0)) {
      letMisc += inp.letAgentFeeMonths * flatRentAt[y] + (flatRentAt[y] * 12 * inp.tenantStampDutyPctOfAnnual) / 100
    }

    // 租客侧费用（与租房方案对称）：进入租房状态年付按金（现金→资产）+中介费+租约印花税+搬迁费；
    // 之后每 cycle 年续约付中介费+印花税。上期（首月预付）的时点效应忽略，月租照付（见文档 §10）
    let rentalFeesAgent = 0
    let rentalFeesStamp = 0
    let rentalFeesMoving = 0
    if (enteredThisYear) {
      rentalEnteredYear = y
      buyDeposit = inp.depositMonths * rentThisYear
      rentalFeesAgent = inp.tenantAgentFeeMonths * rentThisYear
      rentalFeesStamp = (rentThisYear * 12 * inp.tenantStampDutyPctOfAnnual) / 100
      rentalFeesMoving = inp.movingCostPerMove
      bFlow -= buyDeposit + rentalFeesAgent + rentalFeesStamp + rentalFeesMoving
    } else if (rentTenant && rentalEnteredYear !== null && y > rentalEnteredYear && (y - rentalEnteredYear) % cycle === 0) {
      rentalFeesAgent = inp.tenantAgentFeeMonths * rentThisYear
      rentalFeesStamp = (rentThisYear * 12 * inp.tenantStampDutyPctOfAnnual) / 100
      bFlow -= rentalFeesAgent + rentalFeesStamp
    }
    const rentalFees = rentalFeesAgent + rentalFeesStamp + rentalFeesMoving

    let yearMortgage = 0
    let yearInterest = 0
    // 资金池演变追踪（供悬浮说明）：年初余额、当年利息、月度结余、溢出
    const lumpStart = bLump
    const linkStart = bLink
    const flowStart = bFlow
    let lumpInt = 0
    let linkInt = 0
    let flowInt = 0
    let yearSurplus = 0
    let overflow = 0

    for (let m = 0; m < MONTHS_PER_YEAR; m++) {
      const li = bLump * rInvM
      bLump += li
      lumpInt += li
      const fi = bFlow * rDepM
      bFlow += fi
      flowInt += fi
      const ki = bLink * rM
      bLink += ki
      linkInt += ki
      if (bLink > linkCap) {
        const ov = bLink - linkCap
        bLump += ov
        overflow += ov
        bLink = linkCap
      }

      let interest = 0
      let principal = 0
      if (!sold && bal > 0.005) {
        interest = bal * rM
        principal = Math.min(Math.max(pay - interest, 0), bal) // max(0,...) 防御 pay≤0 时余额反增
        bal -= principal
        yearMortgage += interest + principal
        yearInterest += interest
      }

      const inflow = income + (rentingOut ? rentalNetM : 0)
      const outflow =
        inp.livingExpenseMonthly + pay + rentThisYear + (sold ? 0 : holdingM) + (rentingOut ? letMisc / MONTHS_PER_YEAR : 0)
      const surplus = inflow - outflow
      yearSurplus += surplus
      bFlow += surplus
    }

    // 年内大额池进出
    let saleNet: number | null = null
    let linkMerged = 0

    let yearMisc = letMisc + rentalFees

    // 居所贷款利息扣除（自住年份，年末一次性计入结余）
    let mdiIn = 0
    if (inp.mdiEnabled && selfOccupied && yearInterest > 0) {
      mdiIn = (Math.min(yearInterest, MDI_ANNUAL_CAP) * inp.mdiMarginalRatePct) / 100
      bFlow += mdiIn
    }

    // 年末提前还款（从定期结余扣款）
    let yearPrepaid = 0
    let prepayCost = 0
    if (!sold && inp.annualPrepayment > 0 && bal > 0.005) {
      const amount = Math.min(inp.annualPrepayment, Math.max(bFlow, 0), bal)
      if (amount > 0) {
        let cost = amount
        if (y <= inp.lockInYears) {
          const penalty = (amount * inp.prepayPenaltyPct) / 100
          const clawback = rebateCash * (amount / Math.max(bal, 1)) * ((inp.lockInYears - y + 1) / inp.lockInYears)
          cost += penalty + clawback
          yearMisc += penalty + clawback
        }
        bFlow -= cost
        bal -= amount
        yearPrepaid = amount
        prepayCost = cost
      }
    }

    // 年末卖出 → 转租房状态
    let balBeforeSale = 0
    if (S === y && !sold) {
      balBeforeSale = bal
      const salePrice = inp.salePriceOverride ?? salePriceDefault ?? priceAt[y]
      let net = salePrice - (salePrice * inp.sellAgencyFeePct) / 100 - inp.legalFeeSell - Math.max(bal, 0)
      if (y <= inp.lockInYears) {
        const clawback = rebateCash * ((inp.lockInYears - y + 1) / inp.lockInYears)
        const penalty = (Math.max(bal, 0) * inp.prepayPenaltyPct) / 100
        net -= clawback + penalty
        yearMisc += clawback + penalty
        warnings.push(`第 ${y} 年卖出处于罚息锁定期内，已计入回赠追讨与罚息。`)
      }
      bLump += net + bLink
      saleNet = net
      linkMerged = bLink
      bLink = 0
      sold = true
      bal = 0
    }

    buyMortgagePaid.push(yearMortgage)
    buyHoldingPaid.push(soldAtStart ? 0 : holdingM * MONTHS_PER_YEAR)
    buyRentPaid.push(rentThisYear * MONTHS_PER_YEAR)
    buyRentalIncome.push(rentingOut ? rentalNetM * MONTHS_PER_YEAR : 0)
    buyMiscPaid.push(yearMisc)
    buyPrepaid.push(yearPrepaid)
    buyLumpAt.push(bLump)
    buyLinkAt.push(bLink)
    buyFlowAt.push(bFlow)
    buyDepositAt.push(buyDeposit)
    buyBalAt.push(bal)
    buySoldAt.push(sold)
    const yearNW = (sold ? 0 : priceAt[y] - bal) + bLump + bLink + bFlow + buyDeposit
    buyNW.push(yearNW)

    // ---- 计算面板说明（展示层）：逐行原子化，数字拆到输入项或单一步骤 ----
    const note: Record<string, string> = {}
    note.price =
      y === 1
        ? [
            `楼市值 = 楼价现价 ${money(inp.propertyPrice)}（输入）× (1 + 第 1 年涨幅 ${pct(priceG[0])}（输入列表）)`,
            `= ${money(priceAt[y])}`,
          ].join('\n')
        : [
            `楼市值 = 上年末楼市值 ${money(priceAt[y - 1])}（见第 ${y - 1} 年"楼市值"）× (1 + 第 ${y} 年涨幅 ${pct(priceG[y - 1])}（输入列表）)`,
            `= ${money(priceAt[y])}`,
          ].join('\n')
    if (soldAtStart) {
      note.loan = '已卖出，贷款清零（见卖出当年的"剩余贷款"）'
      note.mortgage = '已卖出，无月供'
      note.holding = '已卖出，无持有成本'
    } else {
      const loanLines: string[] = []
      if (y === 1) {
        loanLines.push(`名义贷款额 = 楼价 ${money(inp.propertyPrice)} × 贷款成数 ${100 - inp.downPaymentPct}%（输入）= ${money(requestedLoan)}`)
        loanLines.push(
          rebateDeducted
            ? `现金回赠 ${money(rebateCash)}（= 贷款额 × ${inp.cashRebatePct}%）> 贷款额 1% → 整笔计入贷款额：实际放款 = ${money(loanAmount)}`
            : `现金回赠 ${money(rebateCash)}（= 贷款额 × ${inp.cashRebatePct}%）≤ 1% → 贷款额不变`,
        )
        loanLines.push(`实际批出贷款额 = ${money(loanAmount)}（第 0 年放款）`)
      } else {
        loanLines.push(`年初余额 = 上年末（见第 ${y - 1} 年"剩余贷款"）${money(balStart)}`)
      }
      loanLines.push(`当年还本 = 月供 ${money(pay)} × 12 − 当年利息 ${money(yearInterest)} = ${money(yearMortgage - yearInterest)}`)
      loanLines.push(`年末余额 = ${money(bal)}${sold ? '；年末卖出，售款优先偿清贷款后清零' : ''}`)
      note.loan = loanLines.join('\n')
      note.mortgage = [
        `月供公式（等额本息）：月供 = 余额 × 月利率 ÷ (1 − (1+月利率)^−期数)`,
        `  月利率 = 年利率 ${pct(rM * 12)}（输入列表第 ${y} 年）÷ 12；剩余期数 = ${remainingMonths}（还款期 ${inp.loanYears} 年 × 12 − 已过 ${y - 1} 年 × 12）`,
        `  → 月供 = ${money(pay)}`,
        `年供（本+息）= 月供 × 12 = ${money(yearMortgage)}，其中利息 ${money(yearInterest)}（每月 = 当月余额 × 月利率，逐月累加）+ 本金 ${money(yearMortgage - yearInterest)}`,
      ].join('\n')
      note.holding = [
        `管理费 ${money(inp.mgmtFeeMonthly)}/月（输入）`,
        `差饷+地租 = 自己单位月租 ${money(flatRentAt[y - 1])} × 8% = ${money(ratesM)}/月`,
        `火险 ${money(inp.fireInsuranceAnnual)}/年（输入）÷ 12 = ${money(inp.fireInsuranceAnnual / MONTHS_PER_YEAR)}/月`,
        `维修 = 楼价 ${money(inp.propertyPrice)} × ${inp.maintenancePctOfPrice}%（输入）÷ 12 = ${money(maintM)}/月`,
        `月合计 ${money(holdingM)} × 12 = ${money(holdingM * MONTHS_PER_YEAR)}`,
      ].join('\n')
    }
    note.rentalIncome = rentingOut
      ? [
          `自己单位的市值月租 ${money(flatRentAt[y])}（输入 ${money(inp.rentalIncomeMonthly0)} 按租金涨幅逐年调整）`,
          `× (12 − 空置 ${inp.vacancyMonths} 个月)/12 = ${money(rentalGross)}/月`,
          `− 物业税 = 毛租 × ${inp.propertyTaxRatePct}%（输入）× ${inp.propertyTaxAllowancePct}%（修葺扣减）= ${money(rentalTax)}/月`,
          `− 出租维修 ${money(inp.rentalMaintenanceAnnual)}/年（输入）÷ 12 = ${money(inp.rentalMaintenanceAnnual / MONTHS_PER_YEAR)}/月`,
          `= 净月租 ${money(rentalNetM)} × 12 = ${money(rentalNetM * MONTHS_PER_YEAR)}`,
        ].join('\n')
      : '当年未出租，无租金收入'
    note.buyDeposit =
      buyDeposit > 0
        ? enteredThisYear
          ? [
              `按金 = ${inp.depositMonths} 个月（输入）× 月租 ${money(rentThisYear)} = ${money(buyDeposit)}`,
              `今年新进入租房状态，从定期结余转出（现金→资产，退租可回收，不计息）`,
            ].join('\n')
          : `第 ${rentalEnteredYear} 年进入租房状态时支付的押金，保持不变（资产）`
        : '未处于租房状态'
    note.buyRent =
      rentThisYear > 0
        ? [
            `月租 ${money(rentThisYear)}${N > 0 && y >= N && !sold ? `（大房租金：输入 ${money(inp.rent2Monthly)} 按租金涨幅逐年调整）` : '（输入小房租金按租金涨幅调整）'}`,
            `× 12 个月 = ${money(rentThisYear * MONTHS_PER_YEAR)}`,
          ].join('\n')
        : '自住，无租房支出'
    const surplusLines = [
      `月度结余 ${money(yearSurplus)} = 全年 12 个月的（收入 − 支出）之和：`,
      `  + 收入 ${money(income * 12)}（月 ${money(income)} × 12${inp.incomeGrowthPct > 0 ? `，年收入增长 ${inp.incomeGrowthPct}%` : ''}）`,
      `  − 生活开支 ${money(inp.livingExpenseMonthly * 12)}（月 ${money(inp.livingExpenseMonthly)} × 12）`,
      ...(soldAtStart ? [] : [`  − 月供 ${money(yearMortgage)}`]),
      `  − 持有成本 ${money(soldAtStart ? 0 : holdingM * MONTHS_PER_YEAR)}`,
      ...(rentThisYear > 0 ? [`  − 租房 ${money(rentThisYear * MONTHS_PER_YEAR)}`] : []),
      ...(rentingOut ? [`  + 净租金收入 ${money(rentalNetM * MONTHS_PER_YEAR)}`] : []),
      ...(letMisc > 0 ? [`  − 出租换约杂费 ${money(letMisc)}（代理费+租约印花税，见"持有成本"同级的业主费用）`] : []),
    ]
    const flowLines = [
      ...(y === 1 ? [`定期结余期初 = $0（期初现金扣除各项买房支出后全部归入大额投资/M-link）`] : [`定期结余年初 = 上年末 ${money(flowStart)}`]),
      `定期结余 ${money(bFlow)} = 年初 ${money(flowStart)} + 当年利息 ${money(flowInt)}（年利率 ${inp.depositRatePct}%（输入）按月复利）+ 月度结余 ${money(yearSurplus)}`,
      ...surplusLines,
      ...(mdiIn > 0
        ? [`+ 利息扣税返还 ${money(mdiIn)} = min(当年按揭利息 ${money(yearInterest)}, 上限 ${money(MDI_ANNUAL_CAP)}) × 边际税率 ${inp.mdiMarginalRatePct}%（自住年适用）`]
        : []),
      ...(prepayCost > 0
        ? [`− 提前还款 ${money(yearPrepaid)}（含罚息/回赠追讨 ${money(prepayCost - yearPrepaid)} = 本金 × ${inp.prepayPenaltyPct}% + 回赠按剩余锁定期比例）`]
        : []),
      ...(rentalFees > 0
        ? enteredThisYear
          ? [
              `− 租房按金 ${money(buyDeposit)}（转资产，见"按金资产"列）`,
              `− 租房签约费 ${money(rentalFeesAgent + rentalFeesStamp + rentalFeesMoving)} = 中介 ${money(rentalFeesAgent)} + 租约印花税 ${money(rentalFeesStamp)} + 搬迁 ${money(rentalFeesMoving)}`,
            ]
          : [`− 换约费用 ${money(rentalFees)} = 中介 ${money(rentalFeesAgent)} + 租约印花税 ${money(rentalFeesStamp)}`]
        : []),
      `= 年末 ${money(bFlow)}`,
    ]
    const lumpLines = [
      ...(y === 1
        ? [
            `期初（第 0 年）= 手头现金 ${money(inp.initialCash)} − 期初总支出 ${money(upfrontBuy)} + 回赠现金 ${money(rebateCash)} = ${money(lumpStart)}，其中：`,
            `  期初总支出 = 首付 ${money(inp.propertyPrice - loanAmount)} + 印花税 ${money(stampDuty)} + 佣金 ${money((inp.propertyPrice * inp.agencyFeePct) / 100)} + 律师费 ${money(inp.legalFeeBuy + inp.legalFeeMortgage)} + 杂费 ${money(inp.miscFees)} + 按保费 ${money(mipPremium)} + 装修 ${money(inp.renovation)}`,
            `  印花税按税表（楼价 ${money(inp.propertyPrice)}）；佣金 = 楼价 × ${inp.agencyFeePct}%`,
            `  期初现金先填 M-link（上限 = 贷款 ${money(loanAmount)} × 50% = ${money(linkCap)}，利率更高），装不下的才进大额投资`,
          ]
        : [`大额投资年初 = 上年末 ${money(lumpStart)}`]),
      `大额投资 ${money(bLump)} = 年初 ${money(lumpStart)} + 当年利息 ${money(lumpInt)}（年利率 ${inp.investmentReturnPct}%（输入）按月复利）`,
      ...(overflow > 0 ? [`+ M-link 顶额溢出 ${money(overflow)}（M-link 超 ${money(linkCap)} 的部分转入）`] : []),
      ...(saleNet !== null
        ? [
            `+ 卖楼净回笼 ${money(saleNet)} = 售价 ${money(inp.salePriceOverride ?? salePriceDefault ?? priceAt[y])} − 佣金 ${money(((inp.salePriceOverride ?? salePriceDefault ?? priceAt[y]) * inp.sellAgencyFeePct) / 100)} − 律师费 ${money(inp.legalFeeSell)} − 贷款余额 ${money(balBeforeSale)}${y <= inp.lockInYears ? ` − 罚息/回赠追讨` : ''}`,
            `+ M-link 并入 ${money(linkMerged)}（卖楼后无需对冲，全部转大额投资）`,
          ]
        : []),
      `= 年末 ${money(bLump)}`,
    ]
    const linkLines = [
      ...(y === 1 ? [`M-link 期初 = ${money(linkStart)}（期初剩余现金全部转入；存款利率 = 按揭利率，冲抵利息）`] : [`M-link 年初 = 上年末 ${money(linkStart)}`]),
      `M-link ${money(bLink)} = 年初 ${money(linkStart)} + 当年利息 ${money(linkInt)}（年利率 = 当年按揭利率 ${pct(rM * 12)}，按月复利）`,
      ...(overflow > 0 ? [`超上限 ${money(linkCap)} 的部分溢出至大额投资 ${money(overflow)}`] : []),
      `= 年末 ${money(bLink)}`,
    ]
    const depositLine =
      buyDeposit > 0
        ? [
            `按金 ${money(buyDeposit)} = ${inp.depositMonths} 个月（输入）× 进入租房状态当年月租 ${money(renterRentAt[rentalEnteredYear ?? y])}`,
            `第 ${rentalEnteredYear} 年从定期结余转入（现金→资产），退租可回收，不计息`,
          ].join('\n')
        : null
    note.buyNW = [
      ...(y === 1 ? ['【期初推导（第 0 年，交易完成时）】'] : []),
      ...(y === 1
        ? [
            `手头现金 ${money(inp.initialCash)}（输入）`,
            `− 期初总支出 ${money(upfrontBuy)}（逐项见下）`,
            `  首付 = 楼价 ${money(inp.propertyPrice)} − 实际贷款 ${money(loanAmount)} = ${money(inp.propertyPrice - loanAmount)}`,
            `  印花税 ${money(stampDuty)}（按税表，楼价 ${money(inp.propertyPrice)}）`,
            `  佣金 = 楼价 × ${inp.agencyFeePct}%（输入）= ${money((inp.propertyPrice * inp.agencyFeePct) / 100)}`,
            `  律师费 ${money(inp.legalFeeBuy)}（买卖）+ ${money(inp.legalFeeMortgage)}（按揭）；杂费 ${money(inp.miscFees)}`,
            `  按保费 ${money(mipPremium)}${mipEligible ? `（贷款成数 > 70%，按 HKMC 费率）` : '（成数 ≤ 70%，免）'}`,
            `  装修 ${money(inp.renovation)}`,
            ...(rebateDeducted ? [`+ 回赠 ${money(rebateCash)}（>1% 部分已从贷款扣除，现金仍全额发放）`] : [`+ 回赠现金 ${money(rebateCash)}（= 贷款 × ${inp.cashRebatePct}%，完成后发放）`]),
            `= 期初可投资现金 ${money(lumpStart)}（先填 M-link，装不下进大额投资）`,
          ]
        : []),
      sold ? '已卖出，无楼值项' : `楼净值 = 楼市值 ${money(priceAt[y])} − 贷款 ${money(bal)} = ${money(priceAt[y] - bal)}`,
      ...lumpLines,
      ...linkLines,
      ...flowLines,
      ...(depositLine ? [depositLine] : []),
      `合计净资产 = ${money(yearNW)}`,
    ].join('\n')
    if (rentNW[y - 1] !== undefined) {
      note.diff = `买房净资产 ${money(yearNW)} − 租房净资产 ${money(rentNW[y - 1])} = ${money(yearNW - rentNW[y - 1])}`
    }
    buyNotes.push(note)
  }

  // ---------- 汇总 ----------
  const rows: YearRow[] = []
  for (let y = 1; y <= T; y++) {
    rows.push({
      year: y,
      notes: { ...rentNotes[y - 1], ...buyNotes[y - 1] },
      buyPropertyValue: priceAt[y],
      buyLoan: buyBalAt[y - 1],
      buyLump: buyLumpAt[y - 1],
      buyLink: buyLinkAt[y - 1],
      buyFlow: buyFlowAt[y - 1],
      buyDeposit: buyDepositAt[y - 1],
      buyNetWorth: buyNW[y - 1],
      buySold: buySoldAt[y - 1],
      buyMortgagePaid: buyMortgagePaid[y - 1],
      buyHoldingPaid: buyHoldingPaid[y - 1],
      buyRentPaid: buyRentPaid[y - 1],
      buyRentalIncome: buyRentalIncome[y - 1],
      buyMiscPaid: buyMiscPaid[y - 1],
      buyPrepaid: buyPrepaid[y - 1],
      rentLump: rentLumpAt[y - 1],
      rentFlow: rentFlowAt[y - 1],
      rentDeposit: rentDepositAt[y - 1],
      rentNetWorth: rentNW[y - 1],
      rentPaid: rentPaidAt[y - 1],
      rentMiscPaid: rentMiscAt[y - 1],
    })
  }

  const finalBuy = buyNW[T - 1] ?? inp.initialCash
  const finalRent = rentNW[T - 1] ?? inp.initialCash
  let breakEvenYear: number | null = null
  for (let y = 0; y < T; y++) {
    if (buyNW[y] > rentNW[y]) {
      breakEvenYear = y + 1
      break
    }
  }

  const dsrPct = inp.monthlyIncome > 0 ? (monthlyPayment0 / inp.monthlyIncome) * 100 : 0
  if (dsrPct > 50) warnings.push(`首年月供占收入 ${dsrPct.toFixed(0)}%，超过银行 DSR 50% 指引，实际可能批不了贷款。`)
  if (upfrontBuy > inp.initialCash) {
    warnings.push(`期初所需资金 $${Math.round(upfrontBuy).toLocaleString()} 超过手头现金 $${inp.initialCash.toLocaleString()}，现金将为负数。`)
  }
  if (S && N > 0 && S < N && inp.rentOutEnabled) {
    warnings.push('出售年份早于出租起始年，该单位从未出租过。')
  }

  return {
    rows,
    derived: {
      loanAmount,
      loanAmountGross: requestedLoan,
      ltvPct: (loanAmount / inp.propertyPrice) * 100,
      stampDuty,
      mipPremium,
      mipEligible,
      rebateDeducted,
      rebateAmount: rebateCash,
      monthlyPayment0,
      dsrPct,
      upfrontBuy,
      salePriceDefault,
      breakEvenYear,
      finalBuy,
      finalRent,
      finalDiff: finalBuy - finalRent,
    },
    warnings,
  }
}
