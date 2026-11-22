import type { ReactNode, TouchEventHandler } from 'react';
import type { PresenterNotes } from '../pitchTypes';
import { usePitch } from '../PitchContext';
import { PitchProgress } from './PitchProgress';

export interface RenderedPitchSlide {
  id: string;
  title: string;
  notes: PresenterNotes;
  content: ReactNode;
}

export function PitchShell({
  slides,
  index,
  notesOpen,
  setupOpen,
  isFullscreen,
  onPrevious,
  onNext,
  onToggleNotes,
  onOpenSetup,
  onToggleFullscreen,
  touchHandlers,
}: {
  slides: RenderedPitchSlide[];
  index: number;
  notesOpen: boolean;
  setupOpen: boolean;
  isFullscreen: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onToggleNotes: () => void;
  onOpenSetup: () => void;
  onToggleFullscreen: () => void;
  touchHandlers: {
    onTouchStart: TouchEventHandler<HTMLElement>;
    onTouchEnd: TouchEventHandler<HTMLElement>;
  };
}) {
  const pitch = usePitch();
  const active = slides[index];
  return (
    <main className="pitch-root" {...touchHandlers}>
      <div className="pitch-stage">
        <div className="pitch-grid" aria-hidden="true" />
        {slides.map((slide, slideIndex) => (
          <section
            key={slide.id}
            id={slide.id}
            className={`pitch-slide${slideIndex === index ? ' is-active' : ''}`}
            aria-hidden={slideIndex !== index}
            aria-label={`${slideIndex + 1}. ${slide.title}`}
          >
            {slide.content}
          </section>
        ))}

        <PitchProgress current={index} total={slides.length} />
        <span className="pitch-brand" aria-hidden="true">
          FINOPS<span>GSEC</span>
        </span>

        {pitch.pendingBudget ? (
          <button
            type="button"
            className="pitch-global-restore"
            onClick={() => void pitch.restorePendingBudget()}
          >
            <span aria-hidden="true">!</span>
            Budget changed · Restore {pitch.pendingBudget.consumer}
          </button>
        ) : null}

        <nav className="pitch-controls" aria-label="Presentation controls">
          <button
            type="button"
            onClick={onPrevious}
            disabled={index === 0}
            aria-label="Previous slide"
            title="Previous (←)"
          >
            ←
          </button>
          <button
            type="button"
            onClick={onNext}
            disabled={index === slides.length - 1}
            aria-label="Next slide"
            title="Next (→ or Space)"
          >
            →
          </button>
          <button
            type="button"
            onClick={onToggleNotes}
            aria-pressed={notesOpen}
            aria-label="Toggle presenter notes"
            title="Presenter notes (N)"
          >
            N
          </button>
          <button
            type="button"
            onClick={onOpenSetup}
            aria-expanded={setupOpen}
            aria-label="Open preflight"
            title="Preflight"
          >
            ⚙
          </button>
          <button
            type="button"
            onClick={onToggleFullscreen}
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            title="Fullscreen"
          >
            {isFullscreen ? '↙' : '↗'}
          </button>
        </nav>

        {notesOpen && active ? (
          <aside className="pitch-notes" aria-label="Presenter notes">
            <div className="pitch-notes__head">
              <span>Presenter notes · {active.title}</span>
              <button type="button" onClick={onToggleNotes} aria-label="Close notes">
                ×
              </button>
            </div>
            <dl>
              <div>
                <dt>Say</dt>
                <dd>{active.notes.message}</dd>
              </div>
              <div>
                <dt>Do</dt>
                <dd>{active.notes.action}</dd>
              </div>
              <div>
                <dt>Timing</dt>
                <dd>{active.notes.duration}</dd>
              </div>
              <div>
                <dt>If it fails</dt>
                <dd>{active.notes.fallback}</dd>
              </div>
            </dl>
          </aside>
        ) : null}
      </div>
    </main>
  );
}
