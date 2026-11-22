import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { navItemsForRole } from './navConfig';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/controls';
import { isMockMode } from '@/api/mocks';

function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex h-6 w-6 items-center justify-center rounded-sm bg-accent text-[11px] font-bold text-white">
        F
      </span>
      <span className="text-sm font-semibold tracking-tight text-text">
        {compact ? 'FinOps' : 'FinOps Console'}
      </span>
    </div>
  );
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const { me } = useAuth();
  if (!me) return null;
  const items = navItemsForRole(me.role);
  return (
    <nav className="flex flex-col gap-0.5 p-2">
      {items.map((item) => (
        <NavLink
          key={item.path}
          to={item.path}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'rounded-sm px-2.5 py-1.5 text-sm font-medium transition-colors',
              isActive
                ? 'bg-accent-soft text-accent-strong'
                : 'text-text-secondary hover:bg-surface-raised hover:text-text',
            )
          }
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}

function Identity() {
  const { me, signOut } = useAuth();
  if (!me) return null;
  return (
    <div className="border-t border-line p-3">
      <div className="mb-2 space-y-0.5">
        <p className="truncate text-sm font-medium text-text">{me.consumer}</p>
        <p className="text-[11px] uppercase tracking-wide text-text-secondary">
          {me.role}
        </p>
        <p className="truncate font-mono text-[11px] text-text-muted">
          {me.api_key_prefix}
        </p>
      </div>
      <Button size="sm" variant="ghost" className="w-full" onClick={signOut}>
        Sign out
      </Button>
    </div>
  );
}

export function AppShell() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();

  // Close the mobile drawer on route change.
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  return (
    <div className="flex min-h-full flex-col bg-bg text-text">
      {/* Top bar (mobile shows menu toggle) */}
      <header className="flex items-center justify-between border-b border-line bg-surface px-3 py-2 lg:hidden">
        <BrandMark compact />
        <Button
          size="sm"
          variant="default"
          aria-label="Toggle navigation"
          aria-expanded={drawerOpen}
          onClick={() => setDrawerOpen((v) => !v)}
        >
          Menu
        </Button>
      </header>

      <div className="flex flex-1">
        {/* Desktop sidebar */}
        <aside className="hidden w-56 shrink-0 flex-col border-r border-line bg-surface lg:flex">
          <div className="border-b border-line px-3 py-3.5">
            <BrandMark />
          </div>
          {isMockMode() ? (
            <div className="border-b border-line bg-signal-amber-dim px-3 py-1 text-[10px] font-medium uppercase tracking-wide text-signal-amber">
              Mock data
            </div>
          ) : null}
          <div className="flex-1 overflow-y-auto">
            <NavList />
          </div>
          <Identity />
        </aside>

        {/* Mobile drawer */}
        {drawerOpen ? (
          <div
            className="fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-sm lg:hidden"
            onClick={() => setDrawerOpen(false)}
          >
            <div
              className="flex h-full w-64 max-w-[80%] flex-col border-r border-line bg-surface shadow-pop"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-line px-3 py-3">
                <BrandMark compact />
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Close navigation"
                  onClick={() => setDrawerOpen(false)}
                >
                  ✕
                </Button>
              </div>
              <div className="flex-1 overflow-y-auto">
                <NavList onNavigate={() => setDrawerOpen(false)} />
              </div>
              <Identity />
            </div>
          </div>
        ) : null}

        {/* Main content — fluid container that uses the full viewport width */}
        <main className="min-w-0 flex-1 overflow-x-hidden">
          <div className="mx-auto w-full max-w-[1800px] p-3 sm:p-4 lg:p-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
