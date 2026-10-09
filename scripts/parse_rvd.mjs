// 解析 RVD 官方 xls → 提取"所有類別"年度指数 → 生成 src/data/hkHistory.ts
import fs2 from 'fs'
import XLSX from 'xlsx'

function extractAnnual(file) {
  const wb = XLSX.readFile(file)
  const ws = wb.Sheets['Annual  按年']
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null })
  const out = {} // year -> all-classes index
  for (const r of rows) {
    if (!r) continue
    const year = r[2]
    const allClasses = r[26]
    if (typeof year === 'number' && typeof allClasses === 'number') {
      out[year] = allClasses
    }
  }
  return out
}

function toYoY(idx) {
  const years = Object.keys(idx).map(Number).sort((a, b) => a - b)
  const yoy = {}
  for (let i = 1; i < years.length; i++) {
    const prev = idx[years[i - 1]]
    const cur = idx[years[i]]
    yoy[years[i]] = +(((cur - prev) / prev) * 100).toFixed(2)
  }
  return { index: idx, yoy }
}

const price = extractAnnual('/tmp/rvd_price.xls')
const rent = extractAnnual('/tmp/rvd_rent.xls')
const priceYoY = toYoY(price)
const rentYoY = toYoY(rent)

console.log('price years:', Object.keys(price).length, 'rent years:', Object.keys(rent).length)
console.log('price yoy sample:', JSON.stringify(Object.fromEntries(Object.entries(priceYoY.yoy).slice(0, 5))))
console.log('price yoy recent:', JSON.stringify(Object.fromEntries(Object.entries(priceYoY.yoy).slice(-8))))
console.log('rent yoy recent:', JSON.stringify(Object.fromEntries(Object.entries(rentYoY.yoy).slice(-8))))

const ts = `// 数据来源：香港差饷物业估价署 (RVD)《香港物业报告》统计资料
// https://www.rvd.gov.hk/tc/publications/property_market_statistics.html
// 私人住宅各类单位售价/租金指数（全港）"所有类别"，年度平均值，1999=100（早年重订基期）
// yoy[x] = x 年相对 x-1 年的涨跌幅（百分比）。可直接用于"历史区间"快捷填充。

export interface HkHistory {
  // 年份 -> 涨跌幅（%）
  priceYoy: Record<number, number>
  rentYoy: Record<number, number>
  // 年份 -> 指数原值（参考用）
  priceIndex: Record<number, number>
  rentIndex: Record<number, number>
}

export const HK_HISTORY: HkHistory = {
  priceYoy: ${JSON.stringify(priceYoY.yoy, null, 2)},
  rentYoy: ${JSON.stringify(rentYoY.yoy, null, 2)},
  priceIndex: ${JSON.stringify(priceYoY.index, null, 2)},
  rentIndex: ${JSON.stringify(rentYoY.index, null, 2)},
}

export const HK_HISTORY_PRICE_YEARS = Object.keys(HK_HISTORY.priceYoy)
  .map(Number)
  .sort((a, b) => a - b)
export const HK_HISTORY_RENT_YEARS = Object.keys(HK_HISTORY.rentYoy)
  .map(Number)
  .sort((a, b) => a - b)
`

fs2.writeFileSync('/home/zhangchi/Documents/hk_realestate_value/src/data/hkHistory.ts', ts)
console.log('written src/data/hkHistory.ts')

