import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type TouchEventHandler,
} from 'react';

function slideFromHash(total: number): number {
  const match = window.location.hash.match(/^#slide-(\d+)$/);
  const requested = match ? Number(match[1]) - 1 : 0;
  return Math.min(total - 1, Math.max(0, Number.isFinite(requested) ? requested : 0));
}

export function isDeckInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return !!target.closest('input, textarea, select, button, [contenteditable="true"]');
}

interface DeckNavigationOptions {
  panelOpen: boolean;
  onClosePanel: () => void;
  onToggleNotes: () => void;
  onExit: () => void;
}

export function useDeckNavigation(
  total: number,
  { panelOpen, onClosePanel, onToggleNotes, onExit }: DeckNavigationOptions,
) {
  const [index, setIndex] = useState(() => slideFromHash(total));
  const [isFullscreen, setIsFullscreen] = useState(() => !!document.fullscreenElement);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const goTo = useCallback(
    (next: number) => setIndex(Math.min(total - 1, Math.max(0, next))),
    [total],
  );
  const next = useCallback(() => goTo(index + 1), [goTo, index]);
  const previous = useCallback(() => goTo(index - 1), [goTo, index]);

  useEffect(() => {
    const expected = `#slide-${index + 1}`;
    if (window.location.hash === expected) return;
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${window.location.search}${expected}`,
    );
  }, [index]);

  useEffect(() => {
    const restoreFromHash = () => setIndex(slideFromHash(total));
    window.addEventListener('hashchange', restoreFromHash);
    return () => window.removeEventListener('hashchange', restoreFromHash);
  }, [total]);

  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (panelOpen) {
          event.preventDefault();
          onClosePanel();
        } else if (!isDeckInteractiveTarget(event.target)) {
          event.preventDefault();
          if (document.fullscreenElement) void document.exitFullscreen();
          else onExit();
        }
        return;
      }
      if (isDeckInteractiveTarget(event.target)) return;

      if (event.key.toLowerCase() === 'n') {
        event.preventDefault();
        onToggleNotes();
        return;
      }
      if (panelOpen) return;

      if (
        event.key === 'ArrowRight' ||
        event.key === 'PageDown' ||
        event.key === ' '
      ) {
        event.preventDefault();
        setIndex((current) => Math.min(total - 1, current + 1));
      } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault();
        setIndex((current) => Math.max(0, current - 1));
      } else if (event.key === 'Home') {
        event.preventDefault();
        setIndex(0);
      } else if (event.key === 'End') {
        event.preventDefault();
        setIndex(total - 1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClosePanel, onExit, onToggleNotes, panelOpen, total]);

  const toggleFullscreen = useCallback(async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  }, []);

  const touchHandlers = useMemo<{
    onTouchStart: TouchEventHandler<HTMLElement>;
    onTouchEnd: TouchEventHandler<HTMLElement>;
  }>(
    () => ({
      onTouchStart: (event) => {
        if (isDeckInteractiveTarget(event.target) || panelOpen) return;
        const point = event.changedTouches[0];
        if (point) touchStart.current = { x: point.clientX, y: point.clientY };
      },
      onTouchEnd: (event) => {
        const start = touchStart.current;
        touchStart.current = null;
        if (!start || panelOpen) return;
        const point = event.changedTouches[0];
        if (!point) return;
        const dx = point.clientX - start.x;
        const dy = point.clientY - start.y;
        if (Math.abs(dx) < 54 || Math.abs(dx) <= Math.abs(dy)) return;
        setIndex((current) =>
          dx < 0 ? Math.min(total - 1, current + 1) : Math.max(0, current - 1),
        );
      },
    }),
    [panelOpen, total],
  );

  return {
    index,
    goTo,
    next,
    previous,
    isFullscreen,
    toggleFullscreen,
    touchHandlers,
  };
}
