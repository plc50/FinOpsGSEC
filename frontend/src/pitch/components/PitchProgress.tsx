export function PitchProgress({
  current,
  total,
}: {
  current: number;
  total: number;
}) {
  const value = ((current + 1) / total) * 100;
  return (
    <>
      <div
        className="pitch-progress"
        role="progressbar"
        aria-label="Presentation progress"
        aria-valuemin={1}
        aria-valuemax={total}
        aria-valuenow={current + 1}
      >
        <span style={{ width: `${value}%` }} />
      </div>
      <span className="pitch-counter" aria-label={`Slide ${current + 1} of ${total}`}>
        {String(current + 1).padStart(2, '0')}
        <i>/</i>
        {String(total).padStart(2, '0')}
      </span>
    </>
  );
}
