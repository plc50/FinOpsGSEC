import { describe, expect, it } from 'vitest';
import { navItemsForRole } from './navConfig';

describe('role-aware navigation (§4)', () => {
  it('shows the full admin navigation', () => {
    const labels = navItemsForRole('admin').map((i) => i.label);
    expect(labels).toEqual([
      'Overview',
      'Consumers',
      'Requests',
      'Savings',
      'Forecast',
      'Alerts',
      'Models',
      'Routing',
      'Budgets',
      'Recommendations',
    ]);
  });

  it('hides admin-only items from consumers', () => {
    const labels = navItemsForRole('consumer').map((i) => i.label);
    expect(labels).toEqual([
      'Overview',
      'Requests',
      'Savings',
      'Forecast',
      'Alerts',
      'Recommendations',
    ]);
    expect(labels).not.toContain('Consumers');
    expect(labels).not.toContain('Models');
    expect(labels).not.toContain('Routing');
    expect(labels).not.toContain('Budgets');
  });
});
