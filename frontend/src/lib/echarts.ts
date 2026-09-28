/**
 * ECharts setup: register only the modules we use (tree-shaking, §1.1.1) and
 * a light theme derived from the design tokens in index.css.
 */
import * as echarts from 'echarts/core';
import { LineChart, BarChart, PieChart } from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkLineComponent,
  DataZoomComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { SIGNAL } from './signals';

echarts.use([
  LineChart,
  BarChart,
  PieChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkLineComponent,
  DataZoomComponent,
  CanvasRenderer,
]);

export const FINOPS_THEME = 'finops-light';

const SANS =
  "'Inter',ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif";

const themeDefinition = {
  color: [SIGNAL.accent, SIGNAL.green, SIGNAL.amber, SIGNAL.red, '#7c3aed', '#0e9db8'],
  backgroundColor: 'transparent',
  textStyle: {
    fontFamily: SANS,
    color: SIGNAL.text,
  },
  title: {
    textStyle: { color: SIGNAL.text, fontFamily: SANS, fontWeight: 600 },
    subtextStyle: { color: SIGNAL.secondary, fontFamily: SANS },
  },
  legend: {
    textStyle: { color: SIGNAL.secondary, fontFamily: SANS, fontSize: 11 },
    inactiveColor: SIGNAL.line,
    icon: 'roundRect',
    itemWidth: 12,
    itemHeight: 4,
  },
  grid: {
    borderColor: SIGNAL.line,
    left: 8,
    right: 12,
    top: 28,
    bottom: 8,
    containLabel: true,
  },
  categoryAxis: {
    axisLine: { show: true, lineStyle: { color: SIGNAL.line } },
    axisTick: { show: false },
    axisLabel: { color: SIGNAL.muted, fontFamily: SANS, fontSize: 11 },
    splitLine: { show: false },
  },
  valueAxis: {
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: SIGNAL.muted, fontFamily: SANS, fontSize: 11 },
    splitLine: { show: true, lineStyle: { color: SIGNAL.line, type: [4, 4] } },
  },
  tooltip: {
    backgroundColor: 'rgba(255,255,255,0.98)',
    borderColor: SIGNAL.line,
    borderWidth: 1,
    padding: [8, 12],
    extraCssText:
      'box-shadow: 0 4px 12px rgba(23,33,52,0.08), 0 12px 32px rgba(23,33,52,0.10); border-radius: 10px;',
    textStyle: { color: SIGNAL.text, fontFamily: SANS, fontSize: 12 },
    axisPointer: {
      lineStyle: { color: SIGNAL.line },
      crossStyle: { color: SIGNAL.line },
    },
  },
  line: {
    symbol: 'circle',
    symbolSize: 5,
    showSymbol: false,
    smooth: 0.25,
    lineStyle: { width: 2.5, cap: 'round' },
    emphasis: { focus: 'series' },
    animationDuration: 600,
    animationEasing: 'cubicOut',
  },
  bar: {
    itemStyle: { borderRadius: [4, 4, 0, 0] },
  },
};

/** Vertical gradient fill for line-chart areas (soft fade to transparent). */
export function areaGradient(hex: string, from = 0.22, to = 0.01) {
  return new echarts.graphic.LinearGradient(0, 0, 0, 1, [
    { offset: 0, color: hexWithAlpha(hex, from) },
    { offset: 1, color: hexWithAlpha(hex, to) },
  ]);
}

function hexWithAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

let registered = false;

export function ensureEchartsTheme(): typeof echarts {
  if (!registered) {
    echarts.registerTheme(FINOPS_THEME, themeDefinition);
    registered = true;
  }
  return echarts;
}

export { echarts };
