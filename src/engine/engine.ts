// 核心计算引擎：买房 vs 租房的月度现金流推演
// 两个方案共用：月收入、生活开支、存款利率、时间轴。
// 买房方案：期初买楼 →（可选第 N 年起换大房 + 出租）→（可选第 S 年卖出转租）
// 租房方案：全程租房（第 N 年起换大房），首付资金按投资回报率复利。

import type { Inputs, SimResult, YearRow } from '../types.ts'
import { stampDutyResidential } from './stampDuty.ts'
import { maxMipTerms, mipSinglePremium } from './hkmc.ts'

const MONTHS_PER_YEAR = 12
const MDI_ANNUAL_CAP = 100_000 // 居所贷款利息扣除每年上限

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
    // 按保费按实际放款额计（回赠令放款额调低时略小）
    const mipOnGross = inp.mipOverride ?? mipSinglePremium(inp.propertyPrice, loanPct, inp.loanYears, inp.isFirstTimeBuyer)
    mipPremium = mipOnGross * (loanAmount / requestedLoan)
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
  rLump -= deposit + inp.prepaidMonths * inp.rent1Monthly + inp.tenantAgentFeeMonths * inp.rent1Monthly
  rLump -= (inp.rent1Monthly * 12 * inp.tenantStampDutyPctOfAnnual) / 100
  rLump -= inp.movingCostPerMove

  const rentNW: number[] = []
  const rentLumpAt: number[] = []
  const rentFlowAt: number[] = []
  const rentDepositAt: number[] = []
  const rentPaidAt: number[] = []
  const rentMiscAt: number[] = []
  for (let y = 1; y <= T; y++) {
    const income = incomeAt(y)
    const rent = renterRentAt[y]
    let misc = 0
    if (tenantRenewalYears.has(y)) {
      misc += inp.tenantAgentFeeMonths * rent + (rent * 12 * inp.tenantStampDutyPctOfAnnual) / 100
      if (N > 0 && y === N) {
        misc += inp.movingCostPerMove
        deposit = inp.depositMonths * rent // 换楼：旧按金退、新按金付
      }
    }
    let yearPaid = 0
    for (let m = 0; m < MONTHS_PER_YEAR; m++) {
      rLump *= 1 + rInvM
      rFlow *= 1 + rDepM
      rFlow += income - inp.livingExpenseMonthly - rent
      yearPaid += rent
    }
    rFlow -= misc
    rentLumpAt.push(rLump)
    rentFlowAt.push(rFlow)
    rentDepositAt.push(deposit)
    rentPaidAt.push(yearPaid)
    rentMiscAt.push(misc)
    rentNW.push(rLump + rFlow + deposit)
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

  const S = inp.sellYear
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
  let monthlyPayment0 = 0

  for (let y = 1; y <= T; y++) {
    const rM = mRateY[y - 1] / MONTHS_PER_YEAR
    const remainingMonths = inp.loanYears * MONTHS_PER_YEAR - (y - 1) * MONTHS_PER_YEAR
    const pay = !sold && bal > 0.005 ? annuityPayment(bal, rM, remainingMonths) : 0
    if (y === 1) monthlyPayment0 = pay

    const income = incomeAt(y)
    const selfOccupied = !sold && (N === 0 || y < N)
    const livingRented = !sold && N > 0 && y >= N
    const rentingOut = !sold && inp.rentOutEnabled && N > 0 && y >= N
    const rentThisYear = sold || livingRented ? renterRentAt[y] : 0

    // 持有成本（月）：管理费 + 差饷地租(≈8%×市值租金) + 火险 + 维修
    const ratesM = inp.ratesGovRentOverride ?? flatRentAt[y - 1] * 0.08
    const maintM = (inp.propertyPrice * inp.maintenancePctOfPrice) / 100 / MONTHS_PER_YEAR
    const holdingM = inp.mgmtFeeMonthly + ratesM + inp.fireInsuranceAnnual / MONTHS_PER_YEAR + maintM

    // 出租净收入（月）：扣空置、物业税（15%×80%）、维修损耗
    let rentalNetM = 0
    if (rentingOut) {
      const gross = (flatRentAt[y] * (MONTHS_PER_YEAR - inp.vacancyMonths)) / MONTHS_PER_YEAR
      const tax = gross * ((inp.propertyTaxRatePct / 100) * (inp.propertyTaxAllowancePct / 100))
      rentalNetM = gross - tax - inp.rentalMaintenanceAnnual / MONTHS_PER_YEAR
    }

    // 出租换约杂费（业主）：首次出租同意书费；每个新约的代理费 + 租约印花税（业主一半）
    let letMisc = 0
    if (rentingOut && y === N) letMisc += inp.consentToLeaseFee
    if (rentingOut && (y === N || (y - N) % cycle === 0)) {
      letMisc += inp.letAgentFeeMonths * flatRentAt[y] + (flatRentAt[y] * 12 * inp.tenantStampDutyPctOfAnnual) / 100
    }

    let yearMortgage = 0
    let yearInterest = 0

    for (let m = 0; m < MONTHS_PER_YEAR; m++) {
      bLump *= 1 + rInvM
      bFlow *= 1 + rDepM
      bLink *= 1 + rM
      if (bLink > linkCap) {
        bLump += bLink - linkCap
        bLink = linkCap
      }

      let interest = 0
      let principal = 0
      if (!sold && bal > 0.005) {
        interest = bal * rM
        principal = Math.min(pay - interest, bal)
        bal -= principal
        yearMortgage += interest + principal
        yearInterest += interest
      }

      const inflow = income + (rentingOut ? rentalNetM : 0)
      const outflow =
        inp.livingExpenseMonthly + pay + rentThisYear + (sold ? 0 : holdingM) + (rentingOut ? letMisc / MONTHS_PER_YEAR : 0)
      bFlow += inflow - outflow
    }

    let yearMisc = letMisc

    // 居所贷款利息扣除（自住年份，年末一次性计入结余）
    if (inp.mdiEnabled && selfOccupied && yearInterest > 0) {
      bFlow += (Math.min(yearInterest, MDI_ANNUAL_CAP) * inp.mdiMarginalRatePct) / 100
    }

    // 年末提前还款（从定期结余扣款）
    let yearPrepaid = 0
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
      }
    }

    // 年末卖出 → 转租房状态
    if (S === y && !sold) {
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
      bLink = 0
      sold = true
      bal = 0
    }

    buyMortgagePaid.push(yearMortgage)
    buyHoldingPaid.push(sold ? 0 : holdingM * MONTHS_PER_YEAR)
    buyRentPaid.push(rentThisYear * MONTHS_PER_YEAR)
    buyRentalIncome.push(rentingOut ? rentalNetM * MONTHS_PER_YEAR : 0)
    buyMiscPaid.push(yearMisc)
    buyPrepaid.push(yearPrepaid)
    buyLumpAt.push(bLump)
    buyLinkAt.push(bLink)
    buyFlowAt.push(bFlow)
    buyBalAt.push(bal)
    buySoldAt.push(sold)
    buyNW.push((sold ? 0 : priceAt[y] - bal) + bLump + bLink + bFlow)
  }

  // ---------- 汇总 ----------
  const rows: YearRow[] = []
  for (let y = 1; y <= T; y++) {
    rows.push({
      year: y,
      buyPropertyValue: priceAt[y],
      buyLoan: buyBalAt[y - 1],
      buyLump: buyLumpAt[y - 1],
      buyLink: buyLinkAt[y - 1],
      buyFlow: buyFlowAt[y - 1],
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
