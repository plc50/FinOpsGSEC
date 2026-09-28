import type { Role } from '@/api/types';

export interface NavItem {
  label: string;
  path: string;
  /** Roles allowed to see this item. Absent = all authenticated roles. */
  roles?: Role[];
}

/**
 * Role-aware navigation (§4). Admin and consumer see different items.
 * Order follows the spec's navigation listing.
 */
export const NAV_ITEMS: NavItem[] = [
  { label: 'Overview', path: '/overview' },
  { label: 'Consumers', path: '/consumers', roles: ['admin'] },
  { label: 'Requests', path: '/requests' },
  { label: 'Savings', path: '/savings' },
  { label: 'Forecast', path: '/forecast' },
  { label: 'Alerts', path: '/alerts' },
  { label: 'Models', path: '/models', roles: ['admin'] },
  { label: 'Routing', path: '/routing', roles: ['admin'] },
  { label: 'Budgets', path: '/budgets', roles: ['admin'] },
  { label: 'Recommendations', path: '/recommendations' },
];

export function navItemsForRole(role: Role): NavItem[] {
  return NAV_ITEMS.filter((item) => !item.roles || item.roles.includes(role));
}
