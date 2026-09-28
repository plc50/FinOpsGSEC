import { useMemo } from 'react';
import type { EChartsOption } from 'echarts';
import { BaseChart } from './BaseChart';
import { areaGradient } from '@/lib/echarts';
import { formatCurrency, formatLocalTimeShort } from '@/lib/format';
import { SIGNAL } from '@/lib/signals';

export interface SpendPoint {
  bucket_start: string;
  actual_cost: number | null;
}

/** Cumulative actual spend over time (Overview §7.1). */
export function SpendOverTimeChart({
  points,
  currency = 'USD',
  height = 240,
}: {
  points: SpendPoint[];
  currency?: string;
  height?: number;
}) {
  const option = useMemo<EChartsOption>(() => {
    const labels = points.map((p) => formatLocalTimeShort(p.bucket_start));
    const data = points.map((p) => p.actual_cost);
    return {
      grid: { left: 8, right: 12, top: 16, bottom: 24, containLabel: true },
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
        axisLabel: { formatter: (v: number) => formatCurrency(v, currency) },
      },
      series: [
        {
          name: 'Spend',
          type: 'line',
          data,
          connectNulls: false,
          showSymbol: false,
          smooth: 0.25,
          lineStyle: { width: 2.5, color: SIGNAL.accent, cap: 'round' },
          itemStyle: { color: SIGNAL.accent },
          emphasis: {
            itemStyle: {
              borderColor: '#ffffff',
              borderWidth: 2,
              shadowBlur: 6,
              shadowColor: 'rgba(53,86,230,0.4)',
            },
          },
          areaStyle: { color: areaGradient(SIGNAL.accent) },
        },
      ],
      animationDuration: 600,
      animationEasing: 'cubicOut',
    };
  }, [points, currency]);

  return (
    <BaseChart option={option} height={height} ariaLabel="Spend over time chart" />
  );
}
