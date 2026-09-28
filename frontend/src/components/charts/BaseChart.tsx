import { useEffect, useRef } from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import type { EChartsOption } from 'echarts';
import { ensureEchartsTheme, FINOPS_THEME, echarts } from '@/lib/echarts';

ensureEchartsTheme();

/**
 * Thin ECharts wrapper (§1.1.1 / §1.1.2):
 *  - registers only used modules (see lib/echarts).
 *  - container has a defined height; never sets width/height in the option.
 *  - resize() is driven by a ResizeObserver so charts follow layout changes,
 *    not just window resizes.
 */
export function BaseChart({
  option,
  height = 260,
  className,
  ariaLabel,
}: {
  option: EChartsOption;
  height?: number | string;
  className?: string;
  ariaLabel?: string;
}) {
  const chartRef = useRef<ReactEChartsCore>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      chartRef.current?.getEchartsInstance().resize();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ width: '100%', height }}
      role="img"
      aria-label={ariaLabel}
    >
      <ReactEChartsCore
        ref={chartRef}
        echarts={echarts}
        option={option}
        theme={FINOPS_THEME}
        notMerge
        lazyUpdate
        style={{ width: '100%', height: '100%' }}
        opts={{ renderer: 'canvas' }}
      />
    </div>
  );
}
