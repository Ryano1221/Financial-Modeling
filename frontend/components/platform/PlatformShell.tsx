import type { ReactNode } from "react";

type PlatformModuleTab = {
  id: string;
  label: string;
  description?: string;
};

type PlatformModuleTabsProps = {
  tabs: readonly PlatformModuleTab[];
  activeId: string;
  onChange: (id: string) => void;
  dense?: boolean;
};

type PlatformSectionProps = {
  kicker?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
};

type PlatformPanelProps = {
  kicker?: string;
  title: string;
  children: ReactNode;
  className?: string;
};

export function PlatformModuleTabs({
  tabs,
  activeId,
  onChange,
  dense = false,
}: PlatformModuleTabsProps) {
  return (
    <div className="border border-white/20 bg-black/40 p-2">
      <div className="grid w-full grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2">
        {tabs.map((tab) => {
          const isActive = tab.id === activeId;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChange(tab.id)}
              className={`border text-left transition-colors ${
                dense ? "px-3 py-2" : "px-4 py-3"
              } ${
                isActive
                  ? "border-cyan-300 bg-cyan-500/20 text-cyan-100"
                  : "border-white/20 text-slate-200 hover:bg-white/5"
              }`}
            >
              <div className={dense ? "text-sm" : "text-sm sm:text-base"}>{tab.label}</div>
              {!dense && tab.description ? (
                <div className="text-[11px] text-slate-400 mt-1">{tab.description}</div>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function PlatformSection({
  kicker = "Module",
  title,
  description,
  actions,
  children,
}: PlatformSectionProps) {
  return (
    <section className="scroll-mt-24 bg-grid">
      <div className="mx-auto w-full max-w-6xl space-y-4 border border-white/15 p-3 sm:p-4 bg-grid">
        <div className="border border-white/15 bg-black/25 p-4 sm:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="heading-kicker mb-2">{kicker}</p>
              <h2 className="heading-section mb-2">{title}</h2>
              {description ? <p className="text-sm text-slate-300 max-w-3xl">{description}</p> : null}
            </div>
            {actions ? <div className="shrink-0">{actions}</div> : null}
          </div>
        </div>
        {children}
      </div>
    </section>
  );
}

export function PlatformPanel({
  kicker,
  title,
  children,
  className = "",
}: PlatformPanelProps) {
  return (
    <div className={`border border-white/15 bg-black/30 p-4 ${className}`.trim()}>
      {kicker ? <p className="heading-kicker mb-2">{kicker}</p> : null}
      <h3 className="text-base sm:text-lg text-white mb-2">{title}</h3>
      <div>{children}</div>
    </div>
  );
}
