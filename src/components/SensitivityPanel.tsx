import { useDeferredValue, useMemo, useState } from 'react'
import ChartShell from './ChartShell.tsx'
import { NumberField } from './fields.tsx'
import { simulate } from '../engine/engine.ts'
import type { Inputs } from '../types.ts'

type ScanKey = 'propertyPrice' | 'investmentReturnPct' | 'mortgageRate' | 'rent'

const SCAN_DEFS: { key: ScanKey; label: string; describe: (v: number) => string }[] = [
  { key: 'propertyPrice', label: '楼价现价', describe: (v) => `$${(v / 10_000).toFixed(0)} 万` },
  { key: 'investmentReturnPct', label: '投资回报率', describe: (v) => `${v.toFixed(2)}%` },
  { key: 'mortgageRate', label: '按揭利率', describe: (v) => `${v.toFixed(2)}%` },
  { key: 'rent', label: '租金水平', describe: (v) => `$${Math.round(v).toLocaleString('en-US')}/月` },
]

// 各轴默认范围；displayScale = 输入框显示单位换算（楼价以"万"输入）
const DEFAULT_RANGES: Record<ScanKey, { min: number; max: number; displayScale: number; suffix: string }> = {
  propertyPrice: { min: 2_000_000, max: 8_000_000, displayScale: 10_000, suffix: '万' },
  investmentReturnPct: { min: 0, max: 8, displayScale: 1, suffix: '%' },
  mortgageRate: { min: 2, max: 6, displayScale: 1, suffix: '%' },
  rent: { min: 8_000, max: 30_000, displayScale: 1, suffix: '$/月' },
}

function scanPoints(key: ScanKey, range: { min: number; max: number }): { xs: number[]; apply: (inp: Inputs, v: number) => Inputs } {
  const N = 121
  const step = (range.max - range.min) / (N - 1)
  const xs = Array.from({ length: N }, (_, i) => range.min + i * step)
  if (key === 'propertyPrice') {
    return { xs, apply: (p, v) => ({ ...p, propertyPrice: v }) }
  }
  if (key === 'investmentReturnPct') {
    return { xs, apply: (p, v) => ({ ...p, investmentReturnPct: v }) }
  }
  if (key === 'mortgageRate') {
    return { xs, apply: (p, v) => ({ ...p, mortgageRates: Array(30).fill(v) }) }
  }
  // 租金水平：rent1 与 rent2 同比例缩放，保持换房跳幅
  return {
    xs,
    apply: (p, v) => {
      const ratio = p.rent1Monthly > 0 ? v / p.rent1Monthly : 1
      return { ...p, rent1Monthly: v, rent2Monthly: Math.round(p.rent2Monthly * ratio) }
    },
  }
}

export function SensitivityPanel({ inputs }: { inputs: Inputs }) {
  const [scanKey, setScanKey] = useState<ScanKey>('propertyPrice')
  const [ranges, setRanges] = useState(DEFAULT_RANGES)
  const def = SCAN_DEFS.find((d) => d.key === scanKey)!
  const range = ranges[scanKey]
  const setRange = (part: Partial<{ min: number; max: number }>) =>
    setRanges((r) => ({ ...r, [scanKey]: { ...r[scanKey], ...part } }))
  // 扫描 41 次模拟放低优先级：输入框连续变化时不阻塞主界面
  const deferredInputs = useDeferredValue(inputs)
  const deferredRange = useDeferredValue(range)

  const { xs, ys, flatPoints, currentX } = useMemo(() => {
    const { xs, apply } = scanPoints(scanKey, deferredRange)
    const ys = xs.map((v) => {
      const r = simulate(apply(deferredInputs, v), { skipNotes: true })
      return Math.round(r.derived.finalDiff)
    })
    // 打平点：相邻异号线性插值
    const flatPoints: number[] = []
    for (let i = 1; i < ys.length; i++) {
      if ((ys[i - 1] <= 0 && ys[i] > 0) || (ys[i - 1] >= 0 && ys[i] < 0)) {
        const t = ys[i - 1] / (ys[i - 1] - ys[i])
        flatPoints.push(xs[i - 1] + t * (xs[i] - xs[i - 1]))
      }
    }
    // 当前输入值在横轴上的位置
    const currentX =
      scanKey === 'propertyPrice' ? deferredInputs.propertyPrice
      : scanKey === 'investmentReturnPct' ? deferredInputs.investmentReturnPct
      : scanKey === 'mortgageRate' ? deferredInputs.mortgageRates[0]
      : deferredInputs.rent1Monthly
    return { xs, ys, flatPoints, currentX }
  }, [deferredInputs, deferredRange, scanKey])

  // series 含 markPoint 动态字段，交给 setOption 宽松校验
  const option = {
    animationDuration: 200,
    tooltip: {
      trigger: 'axis',
      formatter: (params: unknown) => {
        const p = (Array.isArray(params) ? params[0] : params) as { axisValue: number; value: number | number[] }
        const y = Array.isArray(p.value) ? p.value[1] : p.value
        return `${def.describe(p.axisValue)}<br/>期末差值（买−租）：<b>$${Math.round(y).toLocaleString('en-US')}</b>`
      },
    },
    grid: { left: 70, right: 24, top: 30, bottom: 46 },
    xAxis: {
      type: 'value',
      name: def.label,
      nameLocation: 'middle',
      nameGap: 30,
      axisLabel: { formatter: (v: number) => (scanKey === 'propertyPrice' || scanKey === 'rent' ? (v / 10_000).toFixed(0) + (scanKey === 'propertyPrice' ? '万' : '') : v.toFixed(1) + '%') },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      name: '期末差值（买−租）',
      axisLabel: { formatter: (v: number) => `${(v / 10_000).toFixed(0)}万` },
      splitLine: { lineStyle: { color: '#eee' } },
    },
    series: [
      {
        type: 'line',
        data: xs.map((x, i) => [x, ys[i]]),
        symbol: 'none',
        lineStyle: { width: 2.5, color: '#d97706' },
        areaStyle: { color: 'rgba(217, 119, 6, 0.06)' },
        markLine: {
          silent: true,
          symbol: 'none',
          data: [{ yAxis: 0 }],
          lineStyle: { color: '#999' },
          label: { show: false },
        },
        markPoint: {
          symbol: 'circle',
          symbolSize: 9,
          data: [
            ...flatPoints.map((x) => ({
              coord: [x, 0] as [number, number],
              value: '打平',
              itemStyle: { color: '#111' },
              label: { formatter: `打平 ${def.describe(x)}`, position: 'bottom' as const, fontSize: 11 },
            })),
            {
              coord: [currentX, ys[Math.max(0, xs.findIndex((x) => x >= currentX))] ?? 0] as [number, number],
              value: '当前',
              symbolRotate: 0,
              itemStyle: { color: '#2563eb' },
              label: { formatter: '当前设置', position: 'top' as const, fontSize: 11 },
            },
          ],
        },
      },
    ],
  }

  return (
    <div className="card">
      <h2>单因素敏感性扫描</h2>
      <p className="table-hint">
        固定其他输入，仅沿横轴改变一个因素；纵轴为期末净资产差（买 − 租）。曲线与零线的交点即「打平点」；
        零线以上买房赢、以下租房赢。蓝点为当前设置的位置。
      </p>
      <div className="scan-controls">
        {SCAN_DEFS.map((d) => (
          <button
            key={d.key}
            type="button"
            className={`scan-tab ${scanKey === d.key ? 'scan-tab-active' : ''}`}
            onClick={() => setScanKey(d.key)}
          >
            {d.label}
          </button>
        ))}
      </div>
      <div className="field-row scan-range">
        <NumberField
          label="范围从"
          value={range.min / range.displayScale}
          suffix={range.suffix}
          onChange={(v) => setRange({ min: v * range.displayScale })}
        />
        <NumberField
          label="到"
          value={range.max / range.displayScale}
          suffix={range.suffix}
          onChange={(v) => setRange({ max: v * range.displayScale })}
        />
        <span className="scan-range-hint">121 个扫描点自动均分</span>
      </div>
      <ChartShell option={option} />
    </div>
  )
}
