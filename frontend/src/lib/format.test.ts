import { describe, expect, it } from 'vitest';
import {
  formatCurrency,
  formatInt,
  formatLatency,
  formatPercent,
  formatScore,
  humanizeEnum,
} from './format';

describe('formatCurrency (§9)', () => {
  it('renders amounts >= 1 with 2 decimals', () => {
    expect(formatCurrency(12.34)).toBe('$12.34');
    expect(formatCurrency(10)).toBe('$10.00');
    expect(formatCurrency(42.75)).toBe('$42.75');
  });

  it('renders sub-dollar amounts with up to 6 decimals', () => {
    expect(formatCurrency(0.000041)).toBe('$0.000041');
    expect(formatCurrency(0.0049)).toBe('$0.0049');
  });

  it('handles zero and nullish values', () => {
    expect(formatCurrency(0)).toBe('$0.00');
    expect(formatCurrency(null)).toBe('—');
    expect(formatCurrency(undefined)).toBe('—');
  });

  it('handles negative values', () => {
    expect(formatCurrency(-5)).toBe('-$5.00');
  });
});

describe('formatPercent (§9)', () => {
  it('converts a ratio to a percentage', () => {
    expect(formatPercent(0.84)).toBe('84%');
    expect(formatPercent(1)).toBe('100%');
    expect(formatPercent(0)).toBe('0%');
  });

  it('keeps precision for admin fractional ratios when requested', () => {
    expect(formatPercent(0.4275, { decimals: 1 })).toBe('42.8%');
  });

  it('handles nullish', () => {
    expect(formatPercent(null)).toBe('—');
  });
});

describe('formatLatency (§9)', () => {
  it('renders >= 1000ms in seconds', () => {
    expect(formatLatency(1840)).toBe('1.84s');
    expect(formatLatency(3100)).toBe('3.10s');
  });

  it('renders < 1000ms in ms', () => {
    expect(formatLatency(450)).toBe('450ms');
  });

  it('handles nullish', () => {
    expect(formatLatency(null)).toBe('—');
  });
});

describe('formatScore (§9)', () => {
  it('rounds to 2 decimals', () => {
    expect(formatScore(0.224)).toBe('0.22');
    expect(formatScore(0.226)).toBe('0.23');
  });
});

describe('formatInt', () => {
  it('rounds integers', () => {
    expect(formatInt(41)).toBe('41');
  });
});

describe('humanizeEnum', () => {
  it('humanizes snake_case', () => {
    expect(humanizeEnum('projected_over_budget')).toBe('Projected over budget');
    expect(humanizeEnum('on_track')).toBe('On track');
  });
});
