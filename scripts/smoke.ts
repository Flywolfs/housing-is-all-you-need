// 引擎冒烟测试：node scripts/smoke.ts
import { DEFAULT_INPUTS } from '../src/engine/defaults.ts'
import { simulate } from '../src/engine/engine.ts'
import { stampDutyResidential } from '../src/engine/stampDuty.ts'

let failures = 0
function expectClose(name: string, actual: number, expected: number, tol = 1) {
  const ok = Math.abs(actual - expected) <= tol
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: actual=${actual.toFixed(2)} expected=${expected}`)
}
function expectTrue(name: string, cond: boolean, detail = '') {
  if (!cond) failures++
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name} ${detail}`)
}

// 1. 印花税税表（IRD 官方锚点）
expectClose('SD 4M', stampDutyResidential(4_000_000), 100)
expectClose('SD 5M', stampDutyResidential(5_000_000), 112_500)
expectClose('SD 6M', stampDutyResidential(6_000_000), 135_000)
expectClose('SD 6.7M', stampDutyResidential(6_700_000), 201_000)
expectClose('SD 10M', stampDutyResidential(10_000_000), 370_000) // 9M-10.08M 段: 270000+10%×(10M−9M)，边际减免设计
expectClose('SD 21,739,121', stampDutyResidential(21_739_121), Math.round(21_739_121 * 0.0425))

// 2. 月供：$3.5M @3.5% 30年 ≈ $15,716.57
{
  const inp = { ...DEFAULT_INPUTS, priceGrowthRates: Array(10).fill(0), switchYear: 0, rentOutEnabled: false, mdiEnabled: false }
  const r = simulate(inp)
  expectClose('首年月供 3.5M@3.5%/30y', r.derived.monthlyPayment0, 15_716.57, 1)
}

// 3. 不变量A：租金=0、无任何费用、零利率时，两方案净资产完全相等（同一起点现金）
// 3b. 不变量B：零利率下，买房净资产 − 租房净资产 = 楼价 − 租客累计总支出
{
  const inp: typeof DEFAULT_INPUTS = {
    ...DEFAULT_INPUTS,
    years: 8,
    propertyPrice: 5_000_000,
    downPaymentPct: 100, // 全现金买，排除按揭利息干扰
    investmentReturnPct: 0,
    depositRatePct: 0,
    priceGrowthRates: Array(8).fill(0),
    rentGrowthRates: Array(8).fill(0),
    rent1Monthly: 0,
    rent2Monthly: 0,
    depositMonths: 0,
    prepaidMonths: 0,
    tenantAgentFeeMonths: 0,
    tenantStampDutyPctOfAnnual: 0,
    movingCostPerMove: 0,
    mgmtFeeMonthly: 0,
    ratesGovRentOverride: 0,
    fireInsuranceAnnual: 0,
    maintenancePctOfPrice: 0,
    renovation: 0,
    agencyFeePct: 0,
    stampDutyOverride: 0,
    legalFeeBuy: 0,
    legalFeeMortgage: 0,
    miscFees: 0,
    switchYear: 0,
    rentOutEnabled: false,
    sellYear: null,
    monthlyIncome: 50_000,
    livingExpenseMonthly: 20_000,
    mdiEnabled: false,
    mortgageLinkEnabled: false,
    cashRebatePct: 0,
  }
  const rA = simulate(inp)
  for (const row of rA.rows) {
    expectClose(`不变量A@第${row.year}年`, row.buyNetWorth - row.rentNetWorth, 0, 2)
  }
  const rB = simulate({ ...inp, rent1Monthly: 1_000 })
  for (const row of rB.rows) {
    // 零利率下：diff = 租客累计总支出（期初一次性 + 已付租金），与楼价和现金无关
    const upfrontRent = inp.prepaidMonths * 1_000 + inp.tenantAgentFeeMonths * 0 + inp.movingCostPerMove
    expectClose(`不变量B@第${row.year}年`, row.buyNetWorth - row.rentNetWorth, upfrontRent + 1_000 * 12 * row.year, 2)
  }
}

// 4. 默认场景概览（人工检查）
{
  const r = simulate(DEFAULT_INPUTS)
  console.log('\n=== 默认场景（$5M、30%首付、3.5%、10年、第6年出租+换大房）===')
  console.log('derived:', JSON.stringify(r.derived, null, 2))
  console.log('warnings:', r.warnings)
  for (const row of r.rows) {
    console.log(
      `Y${row.year}`,
      '楼', Math.round(row.buyPropertyValue),
      '贷', Math.round(row.buyLoan),
      '买净资产', Math.round(row.buyNetWorth),
      '| 租净资产', Math.round(row.rentNetWorth),
      '| 差', Math.round(row.buyNetWorth - row.rentNetWorth),
    )
  }
}

// 5. 卖出场景：第5年卖、跌20%
{
  const r = simulate({ ...DEFAULT_INPUTS, sellYear: 5, salePriceOverride: 4_000_000 })
  expectTrue('卖出场景 第5年末已售', r.rows[4].buySold)
  expectClose('卖出场景 finalBuy', r.derived.finalBuy, 4_101_293, 2)
  console.log('\n=== 第5年以$4M卖出（跌20%）===')
  console.log('final buy:', Math.round(r.derived.finalBuy), 'final rent:', Math.round(r.derived.finalRent))
  console.log('Y5 row:', JSON.stringify(r.rows[4], null, 0))
}

// 6. 回赠 >1%（金管局规则 + 市场实务）：回赠按原贷款额计，整笔回赠从贷款额扣除，
//    完成交易后整笔回赠以现金发放（模型视为第 0 月到账）
// 贷款 350万 → 回赠 = 350万×1.5% = 52,500 → 实际批出贷款额 = 3,447,500
// 期初 = 5,000,000 − 3,447,500 + 印花税112,500 + 佣金50,000 + 律师18,000 + 杂费3,000 + 装修150,000 = 1,886,000
{
  const r = simulate({ ...DEFAULT_INPUTS, cashRebatePct: 1.5 })
  expectTrue('回赠超标 贷款额已调低', Math.abs(r.derived.loanAmount - 3_447_500) < 1)
  expectClose('回赠超标 期初总支出', r.derived.upfrontBuy, 1_886_000, 1)
  expectClose('回赠超标 现金回赠全额', r.derived.rebateAmount, 52_500, 1)
}

// 6b. 高成数按保的回赠基数 = 楼价七成（经络按揭曹德明 2026-06 例子）：
// 800万楼、九成按揭 720万、回赠 1.3% → 回赠 = 800万×70%×1.3% = 72,800（> 1%×720万 = 72,000 触发扣减）
// 实际贷款额 = 720万 − 72,800 = 7,127,200
{
  const r = simulate({
    ...DEFAULT_INPUTS,
    propertyPrice: 8_000_000,
    downPaymentPct: 10,
    cashRebatePct: 1.3,
    mipOverride: 0,
  })
  expectClose('高成数回赠基数=七成楼价', r.derived.rebateAmount, 72_800, 1)
  expectClose('高成数回赠 贷款额', r.derived.loanAmount, 7_127_200, 1)
}

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 个失败`)
process.exit(failures === 0 ? 0 : 1)
