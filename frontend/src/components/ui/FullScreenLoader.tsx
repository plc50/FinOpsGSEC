export function FullScreenLoader({ message }: { message?: string }) {
  return (
    <div className="flex min-h-full items-center justify-center bg-bg">
      <div className="flex flex-col items-center gap-3">
        <span className="inline-block h-3 w-3 animate-ping rounded-full bg-accent" />
        <p className="text-xs uppercase tracking-widest text-text-secondary">
          {message ?? 'Loading…'}
        </p>
      </div>
    </div>
  );
}
