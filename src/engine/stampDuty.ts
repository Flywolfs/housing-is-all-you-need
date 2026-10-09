// 从价印花税（AVD）第二标准税率表
// 来源：香港税务局 https://www.ird.gov.hk/chi/faq/avd.htm
// 2024.2.28 起撤销 BSD/NRSD/SSD，所有买家（含非永久居民）统一按第二标准税率；
// 2025.2.26 起 $400 万或以下物业税率为象征式 $100（2026.2.26 起该表维持不变）。

interface Band {
  upTo: number // 本段上限（含），最后一段为 Infinity
  base: number // 基础税款
  rate?: number // 超出下限部分的比例税率（部分档位）
  over?: number // 计算比例税的下限
  pct?: number // 整段比例税率档位
}

const RESIDENTIAL_BANDS: Band[] = [
  { upTo: 4_000_000, base: 100 },
  { upTo: 4_323_780, base: 100, rate: 0.2, over: 4_000_000 },
  { upTo: 4_500_000, base: 0, pct: 0.015 },
  { upTo: 4_935_480, base: 67_500, rate: 0.1, over: 4_500_000 },
  { upTo: 6_000_000, base: 0, pct: 0.0225 },
  { upTo: 6_642_860, base: 135_000, rate: 0.1, over: 6_000_000 },
  { upTo: 9_000_000, base: 0, pct: 0.03 },
  { upTo: 10_080_000, base: 270_000, rate: 0.1, over: 9_000_000 },
  { upTo: 20_000_000, base: 0, pct: 0.0375 },
  { upTo: 21_739_120, base: 750_000, rate: 0.1, over: 20_000_000 },
  { upTo: 100_000_000, base: 0, pct: 0.0425 },
  { upTo: 109_574_470, base: 4_250_000, rate: 0.3, over: 100_000_000 },
  { upTo: Infinity, base: 0, pct: 0.065 },
]

export function stampDutyResidential(price: number): number {
  const p = Math.max(0, price)
  for (const b of RESIDENTIAL_BANDS) {
    if (p <= b.upTo) {
      if (b.pct !== undefined) return Math.round(p * b.pct)
      const extra = b.rate !== undefined ? (p - (b.over ?? 0)) * b.rate : 0
      return Math.round(b.base + extra)
    }
  }
  return 0
}

// 租约印花税：租期 1-3 年为平均年租的 0.5%，业主租客各付一半
export function leaseStampDutyTenant(monthlyRent: number, sharePct = 50): number {
  const annual = monthlyRent * 12
  return Math.round(annual * 0.005 * (sharePct / 100))
}
