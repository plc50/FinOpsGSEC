import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApiKey, useMe } from '@/auth/AuthContext';
import { PitchProvider, usePitch } from './PitchContext';
import { useDeckNavigation } from './useDeckNavigation';
import { PitchShell, type RenderedPitchSlide } from './components/PitchShell';
import { PreflightPanel } from './components/PreflightPanel';
import { OpeningSlide } from './slides/OpeningSlide';
import { ProblemSlide } from './slides/ProblemSlide';
import { ArchitectureSlide } from './slides/ArchitectureSlide';
import { RoutingDemoSlide } from './slides/RoutingDemoSlide';
import { BudgetDemoSlide } from './slides/BudgetDemoSlide';
import { CacheDemoSlide } from './slides/CacheDemoSlide';
import { SavingsSlide } from './slides/SavingsSlide';
import { ClosingSlide } from './slides/ClosingSlide';
import './pitch.css';

const SLIDES: RenderedPitchSlide[] = [
  {
    id: 'pitch-opening',
    title: 'Opening',
    content: <OpeningSlide />,
    notes: {
      message: 'Every AI call already chooses a cost, a quality level and a risk profile. FinOpsGSEC makes that decision explicit.',
      action: 'Pause on the control-plane flow; name Route, Control and Optimize.',
      duration: '20 seconds',
      fallback: 'No live dependency on this slide.',
    },
  },
  {
    id: 'pitch-problem',
    title: 'The problem',
    content: <ProblemSlide />,
    notes: {
      message: 'The problem is not merely expensive models; it is disconnected decisions with no enforcement point.',
      action: 'Scan the five gaps from left to right without reading every sentence.',
      duration: '25 seconds',
      fallback: 'No live dependency on this slide.',
    },
  },
  {
    id: 'pitch-architecture',
    title: 'How it works',
    content: <ArchitectureSlide />,
    notes: {
      message: 'The client keeps the OpenAI contract. The proxy classifies, routes, applies budget and cache policy, then audits the result.',
      action: 'Trace one request from client through the five controls to a provider.',
      duration: '30 seconds',
      fallback: 'Explain that this is the deployed architecture, not a metric.',
    },
  },
  {
    id: 'pitch-routing',
    title: 'Routing demo',
    content: <RoutingDemoSlide />,
    notes: {
      message: 'We never infer routing facts from the chat payload; the evidence is the newly correlated audit row.',
      action: 'Pick a prompt, send it, then point to category, tier, provider, model, cost and latency.',
      duration: '60 seconds',
      fallback: 'Keep the model response and explain the non-blocking audit timeout, or switch to rehearsal.',
    },
  },
  {
    id: 'pitch-budget',
    title: 'Budget policy demo',
    content: <BudgetDemoSlide />,
    notes: {
      message: 'Budget policy intervenes before spend: warn, degrade one compatible tier, then block.',
      action: 'Apply pressure, show the audited action, force block, then use the bright Restore control.',
      duration: '65 seconds',
      fallback: 'Restore first. If the provider fails, show the policy audit or continue in rehearsal mode.',
    },
  },
  {
    id: 'pitch-cache',
    title: 'Semantic cache demo',
    content: <CacheDemoSlide />,
    notes: {
      message: 'Cache savings are claimed only after usage_source or status confirms a semantic cache hit.',
      action: 'Send A, then B. Keep exact replay enabled for the most reproducible jury demo.',
      duration: '55 seconds',
      fallback: 'If the semantic variant misses, enable exact replay and resend B.',
    },
  },
  {
    id: 'pitch-savings',
    title: 'Impact and savings',
    content: <SavingsSlide />,
    notes: {
      message: 'This is the economic result: actual spend versus an explicit baseline, broken down by mechanism.',
      action: 'Lead with total saved and reduction percentage; point out measured versus estimated labels.',
      duration: '30 seconds',
      fallback: 'Retry once or switch to rehearsal; the label will change to DEMO DATA.',
    },
  },
  {
    id: 'pitch-closing',
    title: 'Closing',
    content: <ClosingSlide />,
    notes: {
      message: 'FinOpsGSEC turns AI infrastructure into an observable, enforceable and optimizable system.',
      action: 'Land the sentence, pause, then invite questions.',
      duration: '15 seconds',
      fallback: 'No live dependency on this slide.',
    },
  },
];

function setSetupQuery(open: boolean) {
  const url = new URL(window.location.href);
  if (open) url.searchParams.set('setup', '1');
  else url.searchParams.delete('setup');
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

function PitchDeck() {
  const navigate = useNavigate();
  const pitch = usePitch();
  const [notesOpen, setNotesOpen] = useState(false);
  const [setupOpen, setSetupOpenState] = useState(
    () => new URLSearchParams(window.location.search).get('setup') === '1',
  );

  const setSetupOpen = useCallback((open: boolean) => {
    setSetupOpenState(open);
    setSetupQuery(open);
  }, []);

  const closePanel = useCallback(() => {
    if (setupOpen) setSetupOpen(false);
    else setNotesOpen(false);
  }, [setSetupOpen, setupOpen]);

  const toggleNotes = useCallback(() => {
    if (setupOpen) setSetupOpen(false);
    setNotesOpen((open) => !open);
  }, [setSetupOpen, setupOpen]);

  const exit = useCallback(() => {
    if (pitch.pendingBudget) {
      setSetupOpen(true);
      return;
    }
    navigate('/overview');
  }, [navigate, pitch.pendingBudget, setSetupOpen]);

  const deck = useDeckNavigation(SLIDES.length, {
    panelOpen: setupOpen || notesOpen,
    onClosePanel: closePanel,
    onToggleNotes: toggleNotes,
    onExit: exit,
  });

  useEffect(() => {
    const previousTitle = document.title;
    document.title = `FinOpsGSEC Pitch · ${deck.index + 1}/${SLIDES.length}`;
    document.body.classList.add('pitch-active');
    return () => {
      document.title = previousTitle;
      document.body.classList.remove('pitch-active');
    };
  }, [deck.index]);

  const shellProps = useMemo(
    () => ({
      slides: SLIDES,
      index: deck.index,
      notesOpen,
      setupOpen,
      isFullscreen: deck.isFullscreen,
      onPrevious: deck.previous,
      onNext: deck.next,
      onToggleNotes: toggleNotes,
      onOpenSetup: () => setSetupOpen(true),
      onToggleFullscreen: () => void deck.toggleFullscreen(),
      touchHandlers: deck.touchHandlers,
    }),
    [deck, notesOpen, setSetupOpen, setupOpen, toggleNotes],
  );

  return (
    <>
      <PitchShell {...shellProps} />
      <PreflightPanel
        open={setupOpen}
        onClose={() => setSetupOpen(false)}
        onResetDeck={() => {
          deck.goTo(0);
          setNotesOpen(false);
        }}
      />
    </>
  );
}

export function PitchPage() {
  const adminApiKey = useApiKey();
  const adminMe = useMe();
  return (
    <PitchProvider adminApiKey={adminApiKey} adminMe={adminMe}>
      <PitchDeck />
    </PitchProvider>
  );
}
