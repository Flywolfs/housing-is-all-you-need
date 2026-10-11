// 系统输入与输出的类型定义

export interface Inputs {
  // 一、基本设定
  years: number // 模拟时长 T（1-30 年）
  propertyPrice: number // 楼价现价（第 0 年买入价）
  priceGrowthRates: number[] // 楼价增长率列表（%每年，长度 ≥ T）
  sellYear: number | null // 第几年出售（null = 不出售）
  salePriceOverride: number | null // 手动出售价（null = 按曲线推算）
  initialCash: number // 手头现金（第 0 年）

  // 二、买房 · 交易成本（期初一次性）
  downPaymentPct: number // 首付比例（%）
  agencyFeePct: number // 买楼代理佣金（%）
  stampDutyOverride: number | null // 印花税覆盖值（null = 自动按税表）
  legalFeeBuy: number // 律师费（买卖）
  legalFeeMortgage: number // 律师费（按揭）
  miscFees: number // 政府注册杂费
  mipOverride: number | null // 按揭保险费覆盖值（null = 自动按 HKMC 费率）
  renovation: number // 装修 / 家电家具

  // 三、买房 · 按揭
  loanYears: number // 还款期（年）
  mortgageRates: number[] // 按揭利率列表（%每年）
  capRate: number // 封顶利率（%，校验展示用）
  cashRebatePct: number // 现金回赠（占贷款额 %）
  lockInYears: number // 罚息 / 回赠锁定期（年）
  prepayPenaltyPct: number // 提前还款罚息（%）
  annualPrepayment: number // 每年提前还款额（年末，$）
  mortgageLinkEnabled: boolean // Mortgage-Link 存款账户（上限 = 贷款额 50%）
  mdiEnabled: boolean // 居所贷款利息扣除（自住期间）
  mdiMarginalRatePct: number // 薪俸税边际税率（%）

  // 四、买房 · 持有成本
  mgmtFeeMonthly: number // 管理费（$/月）
  ratesGovRentOverride: number | null // 差饷+地租覆盖值（$/月，null = 自动 ≈8%×市值租金）
  fireInsuranceAnnual: number // 火险（$/年）
  maintenancePctOfPrice: number // 维修保养（占楼价 %/年）
  sellAgencyFeePct: number // 卖楼代理佣金（%）
  legalFeeSell: number // 卖楼律师费（$）

  // 五、出租 + 换大房
  rentOutEnabled: boolean // 是否出租自己单位
  switchYear: number // 第 N 年起换大房 + 出租（0 = 不换，一直自住）
  rentalIncomeMonthly0: number // 出租租金（第 0 年值，$/月）
  propertyTaxRatePct: number // 物业税税率（%）
  propertyTaxAllowancePct: number // 物业税法定修葺扣减（%）
  vacancyMonths: number // 出租空置期（月/年）
  letAgentFeeMonths: number // 出租代理费（月租金/次）
  leaseRenewalCycleYears: number // 换约周期（年，每次新约付代理费+租约印花税）
  rentalMaintenanceAnnual: number // 出租维修 / 家电损耗（$/年）
  consentToLeaseFee: number // 出租同意书费用（一次性，$）

  // 六、租房方案
  rentGrowthRates: number[] // 租金增长率列表（%每年）
  rent1Monthly: number // 小房租金（$/月，第 0 年值）
  rent2Monthly: number // 大房租金（$/月，第 N 年起的首年值）
  depositMonths: number // 按金（月，期末退回计资产）
  prepaidMonths: number // 上期（月，真支出）
  tenantAgentFeeMonths: number // 租客中介费（月租金/次新约）
  tenantStampDutyPctOfAnnual: number // 租客租约印花税（占年租金 %，各付一半）
  movingCostPerMove: number // 搬迁费（$/次）

  // 七、共同财务参数
  monthlyIncome: number // 月收入（$）
  incomeGrowthPct: number // 收入年增长率（%）
  livingExpenseMonthly: number // 生活开支（$/月）
  depositRatePct: number // 定期存款利率（%，每月结余去处）
  investmentReturnPct: number // 大额资金投资回报率（%，首付资金/卖楼回笼资金）

  // 八、身份
  isFirstTimeBuyer: boolean // 是否首置（影响按保资格 >80% 成数）
}

export interface YearRow {
  year: number
  /** 各列计算过程的悬浮说明（TS 展示层字段，不参与计算，Python 版不含；键见 DetailTable 列） */
  notes?: Record<string, string>
  // 买房方案
  buyPropertyValue: number // 楼市值（年末）
  buyLoan: number // 剩余贷款（年末）
  buyLump: number // 大额投资（年末）
  buyLink: number // Mortgage-Link 余额（年末）
  buyFlow: number // 定期储蓄（年末）
  buyDeposit: number // 买房方案租房阶段的按金（年末，可回收资产）
  buyNetWorth: number // 净资产
  buySold: boolean // 该年末已卖出
  // 买房方案当年现金流（合计）
  buyMortgagePaid: number
  buyHoldingPaid: number // 管理费+差饷地租+火险+维修+杂费
  buyRentPaid: number // 自己租房支出（换大房后/卖出后）
  buyRentalIncome: number // 净租金收入（扣物业税/空置后，未扣换约杂费）
  buyMiscPaid: number // 换约代理费/印花税/同意书/罚息/回赠追讨等杂项
  buyPrepaid: number // 提前还款
  // 租房方案
  rentLump: number
  rentFlow: number
  rentDeposit: number // 按金（可回收资产）
  rentNetWorth: number
  rentPaid: number // 当年总租金
  rentMiscPaid: number // 中介费+租约印花税+搬迁
}

export interface Derived {
  loanAmount: number // 贷款额（回赠调整后）
  loanAmountGross: number // 调整前贷款额
  ltvPct: number
  stampDuty: number
  mipPremium: number
  mipEligible: boolean
  rebateDeducted: boolean // 回赠 >1%：贷款额按含回赠口径调低（回赠仍全额现金发放）
  rebateAmount: number
  monthlyPayment0: number // 首年月供
  dsrPct: number // 月供 / 收入
  upfrontBuy: number // 期初总支出（不含按金类）
  salePriceDefault: number | null
  breakEvenYear: number | null // 买房首次领先租房的年份
  finalBuy: number
  finalRent: number
  finalDiff: number // 买房 − 租房
}

export interface SimResult {
  rows: YearRow[]
  derived: Derived
  warnings: string[]
}
