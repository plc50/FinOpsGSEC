import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import type { Role } from '@/api/types';

/**
 * Route guard. Admin controls/pages must never render based on frontend state
 * alone (§3/§10) — this checks the role resolved from /dashboard/me and
 * redirects unauthorized roles instead of rendering the admin page.
 */
export function RequireRole({
  role,
  children,
}: {
  role: Role;
  children: ReactNode;
}) {
  const { me } = useAuth();
  if (!me || me.role !== role) {
    return <Navigate to="/overview" replace />;
  }
  return <>{children}</>;
}
