import { useId } from "react";

type GridVariant = "hero" | "section" | "dashboard";

interface BackgroundGridProps {
  variant?: GridVariant;
  className?: string;
}

const VARIANT_SETTINGS: Record<
  GridVariant,
  {
    spacing: number;
    primaryOpacity: number;
    secondaryOpacity: number;
    glowOpacity: number;
    vignetteOpacity: number;
  }
> = {
  hero: {
    spacing: 44,
    primaryOpacity: 0.18,
    secondaryOpacity: 0.12,
    glowOpacity: 0.32,
    vignetteOpacity: 0.42,
  },
  section: {
    spacing: 38,
    primaryOpacity: 0.14,
    secondaryOpacity: 0.09,
    glowOpacity: 0.22,
    vignetteOpacity: 0.34,
  },
  dashboard: {
    spacing: 34,
    primaryOpacity: 0.16,
    secondaryOpacity: 0.1,
    glowOpacity: 0.18,
    vignetteOpacity: 0.3,
  },
};

export function BackgroundGrid({ variant = "section", className = "" }: BackgroundGridProps) {
  const id = useId().replace(/:/g, "");
  const settings = VARIANT_SETTINGS[variant];
  const spacing = settings.spacing;
  const half = Math.max(1, Math.round(spacing / 2));

  return (
    <div className={`absolute inset-0 -z-10 pointer-events-none overflow-hidden ${className}`} aria-hidden>
      <svg className="absolute inset-0 h-full w-full" preserveAspectRatio="none" viewBox="0 0 100 100">
        <defs>
          <pattern
            id={`${id}-diag`}
            width={spacing}
            height={spacing}
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <line x1="0" y1="0" x2="0" y2={spacing} stroke="rgba(255,255,255,0.8)" strokeWidth="1" />
          </pattern>
          <pattern id={`${id}-cross`} width={half} height={half} patternUnits="userSpaceOnUse">
            <path d={`M 0 0 H ${half} M 0 0 V ${half}`} fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="0.7" />
          </pattern>
        </defs>

        <rect width="100%" height="100%" fill={`url(#${id}-diag)`} opacity={settings.primaryOpacity} />
        <rect width="100%" height="100%" fill={`url(#${id}-cross)`} opacity={settings.secondaryOpacity} />
      </svg>
      <div
        className="absolute inset-0"
        style={{
          background: `radial-gradient(120% 68% at 50% 0%, rgba(255,255,255,${settings.glowOpacity}) 0%, rgba(255,255,255,0) 56%), radial-gradient(130% 120% at 50% 85%, rgba(0,0,0,${settings.vignetteOpacity}) 0%, rgba(0,0,0,0.78) 72%)`,
        }}
      />
    </div>
  );
}

