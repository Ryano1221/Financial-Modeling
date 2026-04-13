type DigitConfig = {
  id: number;
  left: string;
  duration: string;
  delay: string;
  opacity: string;
  scale: string;
  blur: string;
  driftA: string;
  driftB: string;
  driftC: string;
  startY: string;
  digit: string;
};

function seededFraction(seed: number): number {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

function buildDigit(seed: number): string {
  return String(Math.floor(seededFraction(seed * 101 + 3) * 10));
}

function buildDigits(count = 180): DigitConfig[] {
  return Array.from({ length: count }, (_, index) => {
    const seed = index + 1;
    return {
      id: seed,
      left: `${seededFraction(seed * 7) * 100}%`,
      duration: `${7 + seededFraction(seed * 11) * 10}s`,
      delay: `${-1 * (seededFraction(seed * 19) * 18)}s`,
      opacity: `${0.24 + seededFraction(seed * 23) * 0.36}`,
      scale: `${0.78 + seededFraction(seed * 29) * 0.72}`,
      blur: `${seededFraction(seed * 31) > 0.76 ? 0.4 : 0}px`,
      driftA: `${(-8 + seededFraction(seed * 41) * 16).toFixed(2)}vw`,
      driftB: `${(-12 + seededFraction(seed * 43) * 24).toFixed(2)}vw`,
      driftC: `${(-10 + seededFraction(seed * 47) * 20).toFixed(2)}vw`,
      startY: `${(-12 - seededFraction(seed * 53) * 108).toFixed(2)}vh`,
      digit: buildDigit(seed * 37),
    };
  });
}

const DIGITS = buildDigits();

export function BackgroundNumberRain() {
  return (
    <div className="number-rain-overlay" aria-hidden="true">
      {DIGITS.map((stream) => (
        <span
          key={stream.id}
          className="number-rain-stream"
          style={{
            left: stream.left,
            animationDuration: stream.duration,
            animationDelay: stream.delay,
            opacity: stream.opacity,
            ["--number-rain-scale" as string]: stream.scale,
            ["--number-rain-drift-a" as string]: stream.driftA,
            ["--number-rain-drift-b" as string]: stream.driftB,
            ["--number-rain-drift-c" as string]: stream.driftC,
            ["--number-rain-start-y" as string]: stream.startY,
            filter: `blur(${stream.blur})`,
          }}
        >
          {stream.digit}
        </span>
      ))}
    </div>
  );
}
