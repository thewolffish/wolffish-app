/**
 * The live plot for a `.chart.json` spec. Owns the ECharts instance:
 * selective chart/component registration (tree-shaken core build), resize
 * via ResizeObserver, and full re-theme when the app flips light/dark.
 * Chrome colors come from the CSS custom properties at render time, so the
 * plot always matches the surface it sits on.
 */
import { useTheme } from '@providers/theme/useTheme'
import * as echarts from 'echarts/core'
import {
  BarChart,
  FunnelChart,
  GaugeChart,
  HeatmapChart,
  LineChart,
  PieChart,
  RadarChart,
  ScatterChart
} from 'echarts/charts'
import {
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  TooltipComponent,
  VisualMapComponent
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { useEffect, useMemo, useRef } from 'react'
import type { ChartSpec } from './spec'
import { readChartTheme } from './theme'
import { chartSpecToOption } from './toOption'

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  ScatterChart,
  HeatmapChart,
  RadarChart,
  GaugeChart,
  FunnelChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  VisualMapComponent,
  MarkLineComponent,
  MarkAreaComponent,
  CanvasRenderer
])

export type ChartSpecPlotProps = {
  spec: ChartSpec
  className?: string
  /** Latest live instance (for PNG export); called with null on dispose. */
  onInstance?: (chart: echarts.EChartsType | null) => void
}

export function ChartSpecPlot({
  spec,
  className,
  onInstance
}: ChartSpecPlotProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<echarts.EChartsType | null>(null)
  const { isDark } = useTheme()

  const option = useMemo(() => chartSpecToOption(spec, readChartTheme(isDark)), [spec, isDark])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const chart = echarts.init(host)
    chartRef.current = chart
    onInstance?.(chart)
    const observer = new ResizeObserver(() => chart.resize())
    observer.observe(host)
    return () => {
      observer.disconnect()
      chartRef.current = null
      onInstance?.(null)
      chart.dispose()
    }
    // The instance lives for the component's lifetime; option updates flow
    // through the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    // notMerge replaces the whole option — stale series never linger when the
    // spec or theme changes.
    chartRef.current?.setOption(option, { notMerge: true })
  }, [option])

  return <div ref={hostRef} className={className} />
}
