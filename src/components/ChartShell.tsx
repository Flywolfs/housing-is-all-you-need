import { useEffect, useRef } from 'react'
import * as echarts from 'echarts'

export default function ChartShell({ option }: { option: Parameters<echarts.ECharts['setOption']>[0] }) {
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
    chartRef.current?.setOption(option, { lazyUpdate: true })
  }, [option])

  return <div ref={ref} className="chart" />
}
