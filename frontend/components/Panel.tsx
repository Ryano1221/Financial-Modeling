import type { ReactNode } from "react";

interface PanelProps {
  children: ReactNode;
  className?: string;
  kicker?: string;
  title?: string;
  bodyClassName?: string;
}

export function Panel({ children, className = "", kicker, title, bodyClassName = "" }: PanelProps) {
  return (
    <section className={`nominal-panel ${className}`}>
      {(kicker || title) && (
        <header className="nominal-panel-header">
          {kicker ? <p className="heading-kicker mb-1">{kicker}</p> : null}
          {title ? <h2 className="heading-section">{title}</h2> : null}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

