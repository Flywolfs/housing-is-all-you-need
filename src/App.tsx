import { useEffect, useMemo, useState } from 'react'
import type { Inputs } from './types.ts'
import { DEFAULT_INPUTS } from './engine/defaults.ts'
import { simulate } from './engine/engine.ts'
import { InputPanel } from './components/InputPanel.tsx'
import { Summary } from './components/Summary.tsx'
import { ResultChart } from './components/ResultChart.tsx'
import { DetailTable } from './components/DetailTable.tsx'
import { SensitivityPanel } from './components/SensitivityPanel.tsx'

const STORAGE_KEY = 'hk-rv-inputs-v1'

function loadInputs(): Inputs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      return { ...DEFAULT_INPUTS, ...parsed }
    }
  } catch {
    // ignore
  }
  return DEFAULT_INPUTS
}

export default function App() {
  const [inputs, setInputs] = useState<Inputs>(loadInputs)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(inputs))
    } catch {
      // ignore
    }
  }, [inputs])

  const set = <K extends keyof Inputs>(key: K, value: Inputs[K]) => {
    setInputs((prev) => ({ ...prev, [key]: value }))
    // 注：不按模拟时长钳制 switchYear/sellYear——引擎对 N>T（全程自住）和 S>T（忽略出售+警告）
    // 均安全，保留用户原值；缩短时长后调回时设置不丢失
  }

  const result = useMemo(() => simulate(inputs), [inputs])

  return (
    <div className="app">
      <header className="app-header">
        <h1>香港买房 vs 租房 计算器</h1>
        <p>
          同一收入起点，比较第 N 年末两方案的总资产 · 数据基准：2024.2 撤销辣招后的印花税制度、HKMC 按保费率（2024.10）、RVD 官方历史指数
        </p>
      </header>
      <main className="layout">
        <InputPanel inputs={inputs} set={set} derived={result.derived} />
        <section className="results">
          <Summary result={result} inputs={inputs} />
          <div className="card">
            <h2>净资产曲线</h2>
            <ResultChart rows={result.rows} />
          </div>
          <div className="card">
            <h2>逐年明细</h2>
            <DetailTable rows={result.rows} />
          </div>
          <SensitivityPanel inputs={inputs} />
        </section>
      </main>
    </div>
  )
}
