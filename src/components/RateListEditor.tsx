import { useState } from 'react'
import { DraftNumberInput } from './fields.tsx'

interface HistorySource {
  label: string // 如 "RVD 楼价指数"
  years: number[] // 可选起始年份（升序）
  yoy: Record<number, number>
}

interface Props {
  values: number[] // 固定长度 30
  count: number // 展示/生效的前 N 年
  onChange: (next: number[]) => void
  kind: 'growth' | 'rate'
  history?: HistorySource
  fillCapRate?: number
}

export function RateListEditor({ values, count, onChange, kind, history, fillCapRate }: Props) {
  const [uniform, setUniform] = useState('3')
  const [histStart, setHistStart] = useState<number>(history?.years[0] ?? 0)
  const [histNote, setHistNote] = useState('')

  const copy = () => [...values]
  const setAt = (i: number, v: number) => {
    const next = copy()
    next[i] = v
    onChange(next)
  }

  const applyHistory = () => {
    if (!history) return
    const next = copy()
    let covered = 0
    for (let i = 0; i < count; i++) {
      const v = history.yoy[histStart + i]
      if (v === undefined) {
        next[i] = 0
      } else {
        next[i] = v
        covered++
      }
    }
    onChange(next)
    const lastAvail = history.years[history.years.length - 1]
    setHistNote(
      covered < count
        ? `历史数据只到 ${lastAvail} 年，已覆盖 ${covered} 年，其余年份填 0`
        : `已填入 ${histStart} 年起共 ${count} 年的真实历史变化`,
    )
  }

  return (
    <div className="rate-editor">
      <div className="rate-toolbar">
        {kind === 'growth' && (
          <button type="button" className="btn btn-sm" onClick={() => onChange(copy().map(() => 0))}>
            全部 0%
          </button>
        )}
        {fillCapRate !== undefined && (
          <button type="button" className="btn btn-sm" onClick={() => onChange(copy().map(() => fillCapRate))}>
            按封顶 {fillCapRate}% 填充
          </button>
        )}
        <span className="rate-uniform">
          统一
          <input
            type="number"
            step="0.1"
            value={uniform}
            onChange={(e) => setUniform(e.target.value)}
            onClick={() => onChange(copy().map(() => Number(uniform)))}
          />
          % <button type="button" className="btn btn-sm" onClick={() => onChange(copy().map(() => Number(uniform)))}>填充</button>
        </span>
        {history && (
          <span className="rate-hist">
            <select value={histStart} onChange={(e) => setHistStart(Number(e.target.value))}>
              {history.years.map((y) => (
                <option key={y} value={y}>
                  {y} 年起
                </option>
              ))}
            </select>
            <button type="button" className="btn btn-sm" onClick={applyHistory}>
              填历史
            </button>
          </span>
        )}
      </div>
      {histNote && <div className="rate-note">{histNote}</div>}
      <div className="rate-grid">
        {Array.from({ length: count }, (_, i) => (
          <label key={i} className="rate-cell" title={`第 ${i + 1} 年`}>
            <span>{i + 1}</span>
            <DraftNumberInput value={values[i] ?? 0} onCommit={(v) => setAt(i, v)} step="0.1" />
          </label>
        ))}
      </div>
      <div className="rate-summary">
        {count} 年累计变化：{((values.slice(0, count).reduce((acc, v) => acc * (1 + v / 100), 1) - 1) * 100).toFixed(1)}%
      </div>
    </div>
  )
}
