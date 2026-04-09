type StreamConfig = {
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
  digits: string;
};

function seededFraction(seed: number): number {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

function buildDigits(seed: number, length = 44): string {
  const values: string[] = [];
  for (let index = 0; index < length; index += 1) {
    const next = Math.floor(seededFraction(seed * 101 + index * 17 + 3) * 10);
    values.push(String(next));
  }
  return values.join("\n");
}

function buildStreams(count = 40): StreamConfig[] {
  return Array.from({ length: count }, (_, index) => {
    const seed = index + 1;
    return {
      id: seed,
      left: `${4 + seededFraction(seed * 7) * 92}%`,
      duration: `${12 + seededFraction(seed * 11) * 12}s`,
      delay: `${-1 * (seededFraction(seed * 19) * 22)}s`,
      opacity: `${0.28 + seededFraction(seed * 23) * 0.34}`,
      scale: `${0.84 + seededFraction(seed * 29) * 0.58}`,
      blur: `${seededFraction(seed * 31) > 0.76 ? 0.4 : 0}px`,
      driftA: `${(-10 + seededFraction(seed * 41) * 20).toFixed(2)}vw`,
      driftB: `${(-14 + seededFraction(seed * 43) * 28).toFixed(2)}vw`,
      driftC: `${(-9 + seededFraction(seed * 47) * 18).toFixed(2)}vw`,
      startY: `${(-34 - seededFraction(seed * 53) * 26).toFixed(2)}vh`,
      digits: buildDigits(seed * 37),
    };
  });
}

const STREAMS = buildStreams();

export function BackgroundNumberRain() {
  return (
    <div className="number-rain-overlay" aria-hidden="true">
      {STREAMS.map((stream) => (
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
          {stream.digits}
        </span>
      ))}
    </div>
  );
}
