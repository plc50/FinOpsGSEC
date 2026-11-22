import { useMemo } from 'react';
import type { EChartsOption } from 'echarts';
import { BaseChart } from './BaseChart';
import { areaGradient } from '@/lib/echarts';
import { formatCurrency, formatLocalTimeShort } from '@/lib/format';
import { forecastColor, SIGNAL } from '@/lib/signals';
import type { ForecastStatus } from '@/api/types';

export interface ForecastPoint {
  bucket_start: string;
  actual_cost: number | null;
  projected_cost: number | null;
}

/**
 * Forecast line (§6.5): actual spend + projected spend + budget markLine.
 * The projected series takes the forecast_status color (on_track green,
 * at_risk amber, projected_over_budget red).
 */
export function ForecastChart({
  series,
  budget,
  status,
  currency = 'USD',
  height = 280,
}: {
  series: ForecastPoint[];
  budget: number;
  status: ForecastStatus;
  currency?: string;
  height?: number;
}) {
  const statusColor = forecastColor(status);

  const option = useMemo<EChartsOption>(() => {
    const labels = series.map((p) => formatLocalTimeShort(p.bucket_start));
    const actual = series.map((p) => p.actual_cost);
    const projected = series.map((p) => p.projected_cost);

    return {
      grid: { left: 8, right: 12, top: 34, bottom: 24, containLabel: true },
      legend: {
        top: 0,
        right: 0,
        data: ['Actual spend', 'Projected spend'],
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'line' },
        valueFormatter: (v) =>
          typeof v === 'number' ? formatCurrency(v, currency) : '—',
      },
      xAxis: {
        type: 'category',
        data: labels,
        boundaryGap: false,
        axisLabel: { hideOverlap: true, margin: 12 },
      },
      yAxis: {
        type: 'value',
        axisLabel: {
          formatter: (v: number) => formatCurrency(v, currency),
        },
      },
      series: [
        {
          name: 'Actual spend',
          type: 'line',
          data: actual,
          connectNulls: false,
          showSymbol: false,
          smooth: 0.25,
          lineStyle: { width: 2.5, color: SIGNAL.accent, cap: 'round' },
          itemStyle: { color: SIGNAL.accent },
          areaStyle: { color: areaGradient(SIGNAL.accent) },
        },
        {
          name: 'Projected spend',
          type: 'line',
          data: projected,
          connectNulls: true,
          showSymbol: false,
          smooth: 0.25,
          lineStyle: { width: 2, type: [6, 4], color: statusColor, cap: 'round' },
          itemStyle: { color: statusColor },
          areaStyle: { color: areaGradient(statusColor, 0.1, 0) },
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { color: SIGNAL.red, type: 'dashed', width: 1.5 },
            label: {
              formatter: `Budget ${formatCurrency(budget, currency)}`,
              color: SIGNAL.red,
              fontSize: 11,
              position: 'insideEndTop',
            },
            data: [{ yAxis: budget }],
          },
        },
      ],
      animationDuration: 600,
      animationEasing: 'cubicOut',
      media: [
        {
          query: { maxWidth: 480 },
          option: {
            grid: { top: 44 },
            legend: { top: 0, left: 0 },
            yAxis: { axisLabel: { show: true, fontSize: 10 } },
          },
        },
      ],
    };
  }, [series, budget, statusColor, currency]);

  return <BaseChart option={option} height={height} ariaLabel="Forecast chart" />;
}
