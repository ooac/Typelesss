interface WaveDotsProps {
  count?: number;
  active?: boolean;
}

export function WaveDots({ count = 10, active = false }: WaveDotsProps) {
  return (
    <div className={`wave-dots ${active ? "recording" : ""}`} aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <span key={i} />
      ))}
    </div>
  );
}
