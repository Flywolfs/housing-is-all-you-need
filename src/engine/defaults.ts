// 默认输入值（元朗 $500 万单位场景）
import type { Inputs } from '../types.ts'

export const MAX_YEARS = 30

const zeros = (n: number) => Array<number>(n).fill(0)

export const DEFAULT_INPUTS: Inputs = {
  // 一、基本设定
  years: 10,
  propertyPrice: 5_000_000,
  priceGrowthRates: zeros(MAX_YEARS),
  sellYear: null,
  salePriceOverride: null,
  initialCash: 2_000_000,
  cashFollowUpfront: false,

  // 二、交易成本
  downPaymentPct: 30,
  agencyFeePct: 1,
  stampDutyOverride: null,
  legalFeeBuy: 10_000,
  legalFeeMortgage: 8_000,
  miscFees: 3_000,
  mipOverride: null,
  renovation: 150_000,

  // 三、按揭
  loanYears: 30,
  mortgageRates: zeros(MAX_YEARS).fill(3.5),
  capRate: 3.5,
  cashRebatePct: 0.8,
  lockInYears: 3,
  prepayPenaltyPct: 1,
  annualPrepayment: 0,
  prepaymentStartYear: 4, // 默认 = 默认罚息期（3 年）结束后
  mortgageLinkEnabled: true,
  mortgageLinkAutoDeposit: true,
  mdiEnabled: true,
  mdiMarginalRatePct: 17,

  // 四、持有成本
  mgmtFeeMonthly: 1_500,
  ratesGovRentOverride: null,
  fireInsuranceAnnual: 1_500,
  maintenancePctOfPrice: 0.5,
  sellAgencyFeePct: 1,
  legalFeeSell: 6_000,

  // 五、出租 + 换大房
  rentOutEnabled: true,
  switchYear: 6,
  rentalIncomeMonthly0: 13_500,
  propertyTaxRatePct: 15,
  propertyTaxAllowancePct: 80,
  vacancyMonths: 1,
  letAgentFeeMonths: 0.5,
  leaseRenewalCycleYears: 2,
  rentalMaintenanceAnnual: 2_000,
  consentToLeaseFee: 1_000,

  // 六、租房方案
  rentGrowthRates: zeros(MAX_YEARS),
  rent1Monthly: 13_500,
  rent2Monthly: 18_000,
  depositMonths: 2,
  prepaidMonths: 1,
  tenantAgentFeeMonths: 0.5,
  tenantStampDutyPctOfAnnual: 0.25,
  movingCostPerMove: 5_000,

  // 七、共同财务
  monthlyIncome: 60_000,
  incomeGrowthPct: 0,
  livingExpenseMonthly: 20_000,
  depositRatePct: 2.5,
  investmentReturnPct: 2.5,

  // 八、身份
  isFirstTimeBuyer: true,
}
