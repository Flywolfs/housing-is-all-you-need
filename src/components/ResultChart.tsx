import { useEffect, useRef } from 'react'
import * as echarts from 'echarts'
import type { YearRow } from '../types.ts'

export function ResultChart({ rows }: { rows: YearRow[] }) {
  const ref = useRef<HTMLDivElement>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)

  useEffect(() => {
    if (ref.current) {
      chartRef.current = echarts.init(ref.current)
      const onResize = () => chartRef.current?.resize()
      window.addEventListener('resize', onResize)
      return () => {
        window.removeEventListener('resize', onResize)
        chartRef.current?.dispose()
        chartRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    const years = rows.map((r) => `第${r.year}年`)
    chart.setOption({
      animationDuration: 200,
      tooltip: {
        trigger: 'axis',
        valueFormatter: (v: number) => `$${Math.round(v).toLocaleString('en-US')}`,
      },
      legend: { top: 0 },
      grid: { left: 60, right: 20, top: 36, bottom: 28 },
      xAxis: { type: 'category', data: years },
      yAxis: {
        type: 'value',
        axisLabel: { formatter: (v: number) => `${(v / 10_000).toFixed(0)}万` },
        splitLine: { lineStyle: { color: '#eee' } },
      },
      series: [
        {
          name: '买房净资产',
          type: 'line',
          data: rows.map((r) => Math.round(r.buyNetWorth)),
          symbol: 'circle',
          symbolSize: 5,
          lineStyle: { width: 2.5, color: '#1a7f4b' },
          itemStyle: { color: '#1a7f4b' },
        },
        {
          name: '租房净资产',
          type: 'line',
          data: rows.map((r) => Math.round(r.rentNetWorth)),
          symbol: 'circle',
          symbolSize: 5,
          lineStyle: { width: 2.5, color: '#2563eb' },
          itemStyle: { color: '#2563eb' },
        },
        {
          name: '差额（买−租）',
          type: 'line',
          data: rows.map((r) => Math.round(r.buyNetWorth - r.rentNetWorth)),
          lineStyle: { width: 1.5, type: 'dashed', color: '#d97706' },
          itemStyle: { color: '#d97706' },
          symbol: 'none',
          markLine:
            rows.length > 0
              ? { silent: true, symbol: 'none', data: [{ yAxis: 0 }], lineStyle: { color: '#bbb' }, label: { show: false } }
              : undefined,
        },
      ],
    })
  }, [rows])

  return <div ref={ref} className="chart" />
}
