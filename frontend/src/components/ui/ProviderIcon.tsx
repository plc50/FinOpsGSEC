import { cn } from '@/lib/cn';
import openrouterLogo from '@/assets/providers/openrouter.png';
import fireworksLogo from '@/assets/providers/fireworks.png';

/**
 * Provider avatar: official logo image when we have one (openrouter,
 * fireworks), otherwise simple inline glyphs / initials on a brand-colored
 * rounded chip. Providers are OpenAI-compatible backends from the routing
 * catalog (tabbyapi, openrouter, fireworks, plus any future ids like openai
 * or groq). Unknown providers get a deterministic color from a fixed palette.
 */

interface BrandSpec {
  bg: string;
  fg: string;
  initials: string;
  glyph?: 'spark' | 'route' | 'cat' | 'ring' | 'bolt';
  /** Transparent-background logo rendered on a light chip. */
  image?: { src: string; alt: string };
}

const BRANDS: Record<string, BrandSpec> = {
  tabbyapi: { bg: '#0e9db8', fg: '#ffffff', initials: 'T', glyph: 'cat' },
  openrouter: {
    bg: '#f1f5f9',
    fg: '#475569',
    initials: 'OR',
    image: { src: openrouterLogo, alt: 'OpenRouter' },
  },
  fireworks: {
    bg: '#f3efff',
    fg: '#7c3aed',
    initials: 'F',
    image: { src: fireworksLogo, alt: 'Fireworks AI' },
  },
  openai: { bg: '#10a37f', fg: '#ffffff', initials: 'OA', glyph: 'ring' },
  groq: { bg: '#f55036', fg: '#ffffff', initials: 'G', glyph: 'bolt' },
};

const FALLBACK_COLORS = ['#3556e6', '#0d9464', '#c47b08', '#b84db8', '#5b6779'];

function fallbackSpec(provider: string): BrandSpec {
  let hash = 0;
  for (let i = 0; i < provider.length; i++) {
    hash = (hash * 31 + provider.charCodeAt(i)) >>> 0;
  }
  return {
    bg: FALLBACK_COLORS[hash % FALLBACK_COLORS.length],
    fg: '#ffffff',
    initials: provider.slice(0, 2).toUpperCase(),
  };
}

function Glyph({ glyph, color }: { glyph: BrandSpec['glyph']; color: string }) {
  switch (glyph) {
    case 'spark':
      // Four-point spark (Fireworks).
      return (
        <svg viewBox="0 0 16 16" className="h-[62%] w-[62%]" aria-hidden>
          <path
            d="M8 1l1.6 5.4L15 8l-5.4 1.6L8 15l-1.6-5.4L1 8l5.4-1.6L8 1z"
            fill={color}
          />
        </svg>
      );
    case 'route':
      // Forked route (OpenRouter).
      return (
        <svg viewBox="0 0 16 16" className="h-[62%] w-[62%]" aria-hidden>
          <path
            d="M2 13c4 0 4-9 8-9M2 13c4 0 4 0 8 0"
            stroke={color}
            strokeWidth="1.8"
            strokeLinecap="round"
            fill="none"
          />
          <path d="M9.5 1.5L13 4l-3.5 2.5v-5zM9.5 10.5L13 13l-3.5 2.5v-5z" fill={color} />
        </svg>
      );
    case 'cat':
      // Cat ears + face (TabbyAPI).
      return (
        <svg viewBox="0 0 16 16" className="h-[66%] w-[66%]" aria-hidden>
          <path
            d="M3 7l-.6-4.2L6 4.6a5.4 5.4 0 014 0l3.6-1.8L13 7a5 5 0 11-10 0z"
            fill={color}
          />
        </svg>
      );
    case 'ring':
      // Hexagonal ring (OpenAI-style knot, simplified).
      return (
        <svg viewBox="0 0 16 16" className="h-[62%] w-[62%]" aria-hidden>
          <path
            d="M8 2.2l5 2.9v5.8l-5 2.9-5-2.9V5.1l5-2.9z"
            stroke={color}
            strokeWidth="1.7"
            fill="none"
            strokeLinejoin="round"
          />
        </svg>
      );
    case 'bolt':
      return (
        <svg viewBox="0 0 16 16" className="h-[62%] w-[62%]" aria-hidden>
          <path d="M9 1L3 9.5h4L7 15l6-8.5H9L9 1z" fill={color} />
        </svg>
      );
    default:
      return null;
  }
}

const SIZE_CLASSES = {
  sm: 'h-4.5 w-4.5 text-[8px]',
  md: 'h-6 w-6 text-[9px]',
  lg: 'h-8 w-8 text-[11px]',
} as const;

export function ProviderIcon({
  provider,
  size = 'md',
  className,
  title,
}: {
  provider: string;
  size?: keyof typeof SIZE_CLASSES;
  className?: string;
  title?: string;
}) {
  const spec = BRANDS[provider.toLowerCase()] ?? fallbackSpec(provider);
  return (
    <span
      title={title ?? provider}
      aria-label={title ?? provider}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center rounded-full font-bold leading-none',
        SIZE_CLASSES[size],
        className,
      )}
      style={{ backgroundColor: spec.bg, color: spec.fg }}
    >
      {spec.image ? (
        <img
          src={spec.image.src}
          alt={spec.image.alt}
          className="h-[68%] w-[68%] object-contain"
          draggable={false}
        />
      ) : spec.glyph ? (
        <Glyph glyph={spec.glyph} color={spec.fg} />
      ) : (
        spec.initials
      )}
    </span>
  );
}

/** Icon + provider id, for table cells. */
export function ProviderChip({
  provider,
  label,
  className,
}: {
  provider: string;
  label?: string;
  className?: string;
}) {
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <ProviderIcon provider={provider} size="sm" />
      <span className="font-mono text-xs">{label ?? provider}</span>
    </span>
  );
}
