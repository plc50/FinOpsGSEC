import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import { endpoints } from '@/api/endpoints';
import { ApiError } from '@/api/client';
import type { Me } from '@/api/types';

/**
 * Auth context. The API key lives in memory (React state) and, optionally, in
 * sessionStorage for reload persistence — NEVER localStorage (§10).
 * Role and scope come exclusively from GET /dashboard/me (§3).
 */

const SESSION_KEY = 'finops.apiKey';

function readSessionKey(): string | null {
  try {
    return sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

interface AuthContextValue {
  apiKey: string | null;
  me: Me | null;
  status: 'signed_out' | 'loading' | 'ready' | 'error';
  error: ApiError | null;
  signIn: (key: string) => void;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [apiKey, setApiKey] = useState<string | null>(() => readSessionKey());

  const meQuery = useQuery({
    queryKey: ['me', apiKey],
    queryFn: ({ signal }) => endpoints.me(apiKey as string, signal),
    enabled: !!apiKey,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  const signIn = useCallback((key: string) => {
    const trimmed = key.trim();
    try {
      sessionStorage.setItem(SESSION_KEY, trimmed);
    } catch {
      // sessionStorage may be unavailable; in-memory state still works.
    }
    setApiKey(trimmed);
  }, []);

  const signOut = useCallback(() => {
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {
      // ignore
    }
    setApiKey(null);
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    let status: AuthContextValue['status'] = 'signed_out';
    if (apiKey) {
      if (meQuery.isPending) status = 'loading';
      else if (meQuery.isError) status = 'error';
      else if (meQuery.data) status = 'ready';
      else status = 'loading';
    }
    return {
      apiKey,
      me: meQuery.data ?? null,
      status,
      error: (meQuery.error as ApiError | null) ?? null,
      signIn,
      signOut,
    };
  }, [apiKey, meQuery.isPending, meQuery.isError, meQuery.data, meQuery.error, signIn, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}

/** Convenience: the API key guaranteed present inside authenticated screens. */
export function useApiKey(): string {
  const { apiKey } = useAuth();
  if (!apiKey) throw new Error('useApiKey called without an API key');
  return apiKey;
}

/** Convenience: the resolved Me, guaranteed present inside authenticated screens. */
export function useMe(): Me {
  const { me } = useAuth();
  if (!me) throw new Error('useMe called before /dashboard/me resolved');
  return me;
}
