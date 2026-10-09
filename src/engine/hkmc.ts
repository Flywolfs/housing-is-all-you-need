// 按揭保险计划（MIP / HKMC）最高成数与保费估算
// 来源：香港按证保险有限公司 Premium Rate Sheet（2024 年 10 月 16 日起生效）
// https://www.hkmc.com.hk（浮息按揭、一次性保费、首置自用）
// 保费为占原始贷款额的百分比，可按十年期档位取整。

/** 最高按保成数（首置，固定受薪前提）：返回 {ltv, loanCap}，null 表示超出按保适用范围 */
export function maxMipTerms(price: number): { ltv: number; loanCap?: number } | null {
  if (price <= 10_000_000) return { ltv: 90 }
  if (price < 11_250_000) return { ltv: 90, loanCap: 9_000_000 }
  if (price <= 15_000_000) return { ltv: 80 }
  if (price <= 17_150_000) return { ltv: 80, loanCap: 12_000_000 }
  return null // >$1,715 万：银行上限 70%，不适用按保
}

// 一次性保费表（占贷款额 %）—— 浮息按揭
// band: 保费档位对应"承保范围 70% 至 X%"，即贷款成数落在 (70, X] 用该行
type TenorTable = Record<number, number> // tenor years -> premium %

// Table 1：物业 ≤ $600 万（首置，承保至 90%）
const TABLE_LOW: Record<number, TenorTable> = {
  80: { 10: 0.5, 15: 0.6, 20: 0.76, 25: 0.83, 30: 0.92 },
  85: { 10: 0.86, 15: 1.02, 20: 1.25, 25: 1.35, 30: 1.41 },
  90: { 10: 1.25, 15: 1.48, 20: 1.79, 25: 2.03, 30: 2.16 },
}
// Table 3：物业 $600 万 – $1,500 万（首置，承保至 90%）
const TABLE_MID: Record<number, TenorTable> = {
  80: { 10: 0.6, 15: 0.71, 20: 0.9, 25: 0.97, 30: 1.09 },
  85: { 10: 1.01, 15: 1.2, 20: 1.46, 25: 1.57, 30: 1.64 },
  90: { 10: 1.46, 15: 1.72, 20: 2.08, 25: 2.35, 30: 2.5 },
}
// Table 2：物业 ≤ $600 万，非首置（承保仅至 80%）
const TABLE_LOW_NON_FIRST: Record<number, TenorTable> = {
  80: { 10: 0.65, 15: 0.75, 20: 0.91, 25: 0.98, 30: 1.07 },
}

function nearestTenor(years: number): number {
  const options = [10, 15, 20, 25, 30]
  return options.reduce((best, o) => (Math.abs(o - years) < Math.abs(best - years) ? o : best), 10)
}

/** 按保一次性保费（$）。loanPct 为承保后贷款成数；非首置最高 80%。 */
export function mipSinglePremium(
  price: number,
  loanPct: number,
  loanYears: number,
  isFirstTimeBuyer: boolean,
): number {
  if (loanPct <= 70) return 0
  const tenor = nearestTenor(loanYears)
  let band: number
  if (loanPct <= 75) band = 75 // 实际费率 0
  else if (loanPct <= 80) band = 80
  else if (loanPct <= 85) band = 85
  else band = 90
  if (band === 75) return 0
  if (!isFirstTimeBuyer && band > 80) return 0 // 非首置不可超过 80%
  const table = price <= 6_000_000 ? (isFirstTimeBuyer ? TABLE_LOW : TABLE_LOW_NON_FIRST) : TABLE_MID
  const t = table[band]
  if (!t) return 0
  const pct = t[tenor] ?? t[30]
  return (price * (loanPct / 100) * pct) / 100
}
