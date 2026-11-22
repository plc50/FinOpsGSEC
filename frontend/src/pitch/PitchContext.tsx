import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { pitchEndpoints } from '@/api/endpoints';
import { isMockMode } from '@/api/mocks';
import type { Me } from '@/api/types';
import { readableApiError, restoreBudgetChange, transportForMode } from './pitchApi';
import type {
  ConsumerKeyState,
  DemoMode,
  PendingBudgetChange,
} from './pitchTypes';

export const DEMO_KEYS_ENABLED =
  import.meta.env.DEV || import.meta.env.VITE_ENABLE_DEMO_KEYS === 'true';

export const KNOWN_DEMO_CONSUMERS = [
  {
    consumer: 'equipo-marketing',
    label: 'Marketing',
    key: 'finops_key_marketing',
  },
  {
    consumer: 'equipo-producto',
    label: 'Producto',
    key: 'finops_key_producto',
  },
  {
    consumer: 'equipo-atencion-cliente',
    label: 'Atención al cliente',
    key: 'finops_key_atencion',
  },
] as const;

interface PitchContextValue {
  adminApiKey: string;
  adminMe: Me;
  mode: DemoMode;
  setMode: (mode: DemoMode) => void;
  transport: ReturnType<typeof transportForMode>;
  demoConsumerApiKey: string;
  setDemoConsumerApiKey: (key: string) => void;
  clearDemoConsumerApiKey: () => void;
  consumerKeyState: ConsumerKeyState;
  pendingBudget: PendingBudgetChange | null;
  rememberBudget: (change: PendingBudgetChange) => void;
  restorePendingBudget: () => Promise<boolean>;
  restorationMessage: string | null;
  invalidateDemoQueries: () => Promise<void>;
}

const PitchContext = createContext<PitchContextValue | null>(null);

export function PitchProvider({
  adminApiKey,
  adminMe,
  children,
}: {
  adminApiKey: string;
  adminMe: Me;
  children: ReactNode;
}) {
  const queryClient = useQueryClient();
  const [mode, setModeState] = useState<DemoMode>(() =>
    isMockMode() ? 'rehearsal' : 'safe-backend',
  );
  const [demoConsumerApiKey, setConsumerKey] = useState('');
  const [consumerKeyState, setConsumerKeyState] = useState<ConsumerKeyState>({
    status: 'missing',
    me: null,
    message: null,
  });
  const [pendingBudget, setPendingBudget] =
    useState<PendingBudgetChange | null>(null);
  const [restorationMessage, setRestorationMessage] = useState<string | null>(null);
  const pendingRef = useRef<PendingBudgetChange | null>(null);
  const adminKeyRef = useRef(adminApiKey);

  useEffect(() => {
    pendingRef.current = pendingBudget;
  }, [pendingBudget]);

  useEffect(() => {
    adminKeyRef.current = adminApiKey;
  }, [adminApiKey]);

  const setDemoConsumerApiKey = useCallback((key: string) => {
    setConsumerKey(key.trim());
    setRestorationMessage(null);
  }, []);

  const clearDemoConsumerApiKey = useCallback(() => {
    setConsumerKey('');
    setConsumerKeyState({ status: 'missing', me: null, message: null });
  }, []);

  useEffect(() => {
    if (!demoConsumerApiKey) {
      setConsumerKeyState({ status: 'missing', me: null, message: null });
      return;
    }
    const controller = new AbortController();
    setConsumerKeyState({ status: 'checking', me: null, message: null });
    pitchEndpoints
      .me(demoConsumerApiKey, controller.signal, transportForMode(mode))
      .then((me) => {
        if (me.role !== 'consumer') {
          setConsumerKeyState({
            status: 'error',
            me: null,
            message: 'Use a consumer key here, not the administrative session key.',
          });
          return;
        }
        setConsumerKeyState({ status: 'ready', me, message: null });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setConsumerKeyState({
          status: 'error',
          me: null,
          message: readableApiError(error),
        });
      });
    return () => controller.abort();
  }, [demoConsumerApiKey, mode]);

  const rememberBudget = useCallback((change: PendingBudgetChange) => {
    setPendingBudget((current) => {
      const remembered = current ?? change;
      pendingRef.current = remembered;
      return remembered;
    });
    setRestorationMessage(null);
  }, []);

  const setMode = useCallback((nextMode: DemoMode) => {
    const pending = pendingRef.current;
    if (pending && pending.mode !== nextMode) {
      setRestorationMessage('Restore the pending budget before switching demo modes.');
      return;
    }
    setModeState(nextMode);
  }, []);

  const invalidateDemoQueries = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['pitch'] }),
      queryClient.invalidateQueries({ queryKey: ['requests'] }),
      queryClient.invalidateQueries({ queryKey: ['summary'] }),
      queryClient.invalidateQueries({ queryKey: ['budgets'] }),
      queryClient.invalidateQueries({ queryKey: ['alerts'] }),
      queryClient.invalidateQueries({ queryKey: ['savings'] }),
    ]);
  }, [queryClient]);

  const restorePendingBudget = useCallback(async () => {
    const pending = pendingRef.current;
    if (!pending) {
      setRestorationMessage('Budget already matches the captured original state.');
      return true;
    }
    try {
      await restoreBudgetChange(adminKeyRef.current, pending);
      pendingRef.current = null;
      setPendingBudget(null);
      setRestorationMessage(
        `Restored ${pending.consumer} to ${pending.original.budget} ${pending.original.currency}.`,
      );
      await invalidateDemoQueries();
      return true;
    } catch (error) {
      setRestorationMessage(`Restore failed: ${readableApiError(error)}`);
      return false;
    }
  }, [invalidateDemoQueries]);

  useEffect(() => {
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!pendingRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', warnBeforeUnload);
      const pending = pendingRef.current;
      if (pending) {
        // Best effort only. The visible restore control remains the primary path.
        void restoreBudgetChange(adminKeyRef.current, pending).catch(() => undefined);
      }
    };
  }, []);

  const value = useMemo<PitchContextValue>(
    () => ({
      adminApiKey,
      adminMe,
      mode,
      setMode,
      transport: transportForMode(mode),
      demoConsumerApiKey,
      setDemoConsumerApiKey,
      clearDemoConsumerApiKey,
      consumerKeyState,
      pendingBudget,
      rememberBudget,
      restorePendingBudget,
      restorationMessage,
      invalidateDemoQueries,
    }),
    [
      adminApiKey,
      adminMe,
      mode,
      demoConsumerApiKey,
      setDemoConsumerApiKey,
      clearDemoConsumerApiKey,
      consumerKeyState,
      pendingBudget,
      rememberBudget,
      restorePendingBudget,
      restorationMessage,
      invalidateDemoQueries,
    ],
  );

  return <PitchContext.Provider value={value}>{children}</PitchContext.Provider>;
}

export function usePitch(): PitchContextValue {
  const value = useContext(PitchContext);
  if (!value) throw new Error('usePitch must be used within PitchProvider');
  return value;
}
