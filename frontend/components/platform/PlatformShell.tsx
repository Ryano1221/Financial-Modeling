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
  maxWidthClassName?: string;
  headerAlign?: "left" | "center";
};

type PlatformPanelProps = {
  kicker?: string;
  title: string;
  children: ReactNode;
  className?: string;
};

type PlatformDataTableProps = {
  headers: string[];
  children: ReactNode;
  minWidthClassName?: string;
};

type PlatformStatusIndicatorProps = {
  tone?: "neutral" | "success" | "warning" | "danger";
  label: string;
};

type PlatformActionButtonProps = {
  children: ReactNode;
  variant?: "primary" | "secondary" | "success";
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
  className?: string;
};

type PlatformMetricItem = {
  label: string;
  value: ReactNode;
  detail?: string;
  emphasis?: boolean;
};

type PlatformMetricStripProps = {
  items: PlatformMetricItem[];
  className?: string;
  columnsClassName?: string;
};

type PlatformStepListProps = {
  steps: Array<{
    title: string;
    description: string;
  }>;
  className?: string;
};

type PlatformDisclosureProps = {
  kicker?: string;
  title: string;
  description?: string;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
};

export function PlatformModuleTabs({
  tabs,
  activeId,
  onChange,
  dense = false,
}: PlatformModuleTabsProps) {
  const smColsClass =
    tabs.length <= 1
      ? "sm:grid-cols-1"
      : tabs.length === 2
        ? "sm:grid-cols-2"
        : tabs.length === 3
          ? "sm:grid-cols-3"
          : "sm:grid-cols-4";

  return (
    <div className="border border-white/20 bg-black/40 p-2">
      <div className={`grid w-full grid-cols-1 ${smColsClass} gap-2 items-stretch`}>
        {tabs.map((tab) => {
          const isActive = tab.id === activeId;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChange(tab.id)}
              className={`border transition-colors min-w-0 ${
                dense
                  ? "px-3 py-2 min-h-[44px] flex items-center justify-center text-center"
                  : "px-4 py-3 min-h-[96px] flex h-full flex-col justify-start gap-1.5 text-left"
              } ${
                isActive
                  ? "border-cyan-300 bg-cyan-500/20 text-cyan-100"
                  : "border-white/20 text-slate-200 hover:bg-white/5"
              }`}
            >
              <div className={dense ? "w-full text-center text-sm leading-snug break-words" : "text-sm sm:text-base leading-snug break-words"}>{tab.label}</div>
              {!dense && tab.description ? (
                <div className="mt-0.5 text-[12px] leading-relaxed text-slate-400 break-words">{tab.description}</div>
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
  maxWidthClassName = "max-w-[96vw]",
  headerAlign = "left",
}: PlatformSectionProps) {
  const centered = headerAlign === "center";
  return (
    <section className="scroll-mt-24 bg-grid">
      <div className={`mx-auto w-full ${maxWidthClassName} space-y-4 border border-white/15 p-3 sm:p-4 bg-grid`}>
        <div className="border border-white/15 bg-black/25 p-4 sm:p-5">
          <div className={centered ? "flex flex-col items-center gap-4 text-center" : "flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"}>
            <div className={centered ? "mx-auto max-w-4xl" : undefined}>
              <p className="heading-kicker mb-2">{kicker}</p>
              <h2 className="heading-section mb-2">{title}</h2>
              {description ? <p className={`text-sm text-slate-300 max-w-3xl ${centered ? "mx-auto" : ""}`}>{description}</p> : null}
            </div>
            {actions ? <div className={centered ? "flex justify-center" : "shrink-0"}>{actions}</div> : null}
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
    <div className={`min-w-0 border border-white/15 bg-black/30 p-4 ${className}`.trim()}>
      {kicker ? <p className="heading-kicker mb-2">{kicker}</p> : null}
      <h3 className="text-base sm:text-lg text-white mb-2">{title}</h3>
      <div>{children}</div>
    </div>
  );
}

export function PlatformCard({
  kicker,
  title,
  children,
  className = "",
}: PlatformPanelProps) {
  return (
    <div className={`min-w-0 border border-white/15 bg-black/30 p-4 ${className}`.trim()}>
      {kicker ? <p className="heading-kicker mb-2">{kicker}</p> : null}
      <h3 className="text-base sm:text-lg text-white mb-2">{title}</h3>
      <div>{children}</div>
    </div>
  );
}

export function PlatformPageHeader({
  kicker = "Workspace",
  title,
  description,
  actions,
}: Omit<PlatformSectionProps, "children">) {
  return (
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
  );
}

export function PlatformDataTable({
  headers,
  children,
  minWidthClassName = "min-w-[680px]",
}: PlatformDataTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className={`w-full border-collapse text-sm ${minWidthClassName}`}>
        <thead>
          <tr className="border-b border-white/20">
            {headers.map((header) => (
              <th key={header} className="text-left py-2 pr-3 text-slate-300 font-medium">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function PlatformUploadPanel({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="border border-white/15 bg-black/25 p-4">
      <p className="heading-kicker mb-2">{title}</p>
      <p className="text-sm text-slate-300 mb-3">{description}</p>
      {children}
    </div>
  );
}

export function PlatformStatusIndicator({ tone = "neutral", label }: PlatformStatusIndicatorProps) {
  const toneClass =
    tone === "success"
      ? "border-emerald-400/60 bg-emerald-500/15 text-emerald-100"
      : tone === "warning"
        ? "border-amber-400/60 bg-amber-500/15 text-amber-100"
        : tone === "danger"
          ? "border-red-400/60 bg-red-500/15 text-red-100"
          : "border-white/25 bg-white/5 text-slate-200";
  return (
    <span className={`inline-flex items-center border px-2 py-1 text-xs ${toneClass}`}>
      {label}
    </span>
  );
}

export function PlatformActionButton({
  children,
  variant = "secondary",
  onClick,
  type = "button",
  disabled,
  className = "",
}: PlatformActionButtonProps) {
  const variantClass =
    variant === "primary"
      ? "btn-premium-primary"
      : variant === "success"
        ? "btn-premium-success"
        : "btn-premium-secondary";
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`btn-premium ${variantClass} disabled:opacity-50 ${className}`.trim()}
    >
      {children}
    </button>
  );
}

export function PlatformMetricStrip({
  items,
  className = "",
  columnsClassName = "sm:grid-cols-2 xl:grid-cols-4",
}: PlatformMetricStripProps) {
  return (
    <div className={`grid grid-cols-2 gap-3 ${columnsClassName} ${className}`.trim()}>
      {items.map((item) => (
        <div
          key={item.label}
          className={`border p-3 ${
            item.emphasis
              ? "border-cyan-300/35 bg-cyan-500/10"
              : "border-white/15 bg-black/20"
          }`}
        >
          <p className={`text-xs ${item.emphasis ? "text-cyan-100" : "text-slate-400"}`}>{item.label}</p>
          <div className={`mt-1 text-2xl ${item.emphasis ? "text-cyan-100" : "text-white"}`}>{item.value}</div>
          {item.detail ? <p className="mt-1 text-xs text-slate-400">{item.detail}</p> : null}
        </div>
      ))}
    </div>
  );
}

export function PlatformStepList({ steps, className = "" }: PlatformStepListProps) {
  return (
    <ol className={`space-y-3 ${className}`.trim()}>
      {steps.map((step, index) => (
        <li key={step.title} className="grid grid-cols-[28px_minmax(0,1fr)] gap-3">
          <div className="flex h-7 w-7 items-center justify-center border border-cyan-300/35 bg-cyan-500/10 text-xs text-cyan-100">
            {index + 1}
          </div>
          <div className="space-y-1">
            <p className="text-sm text-white">{step.title}</p>
            <p className="text-sm text-slate-300">{step.description}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function PlatformDisclosure({
  kicker,
  title,
  description,
  children,
  defaultOpen = false,
  className = "",
}: PlatformDisclosureProps) {
  return (
    <details
      open={defaultOpen}
      className={`border border-white/15 bg-black/20 p-4 ${className}`.trim()}
    >
      <summary className="cursor-pointer list-none">
        <div className="flex items-start justify-between gap-4">
          <div>
            {kicker ? <p className="heading-kicker mb-2">{kicker}</p> : null}
            <h3 className="text-base sm:text-lg text-white">{title}</h3>
            {description ? <p className="mt-2 max-w-3xl text-sm text-slate-300">{description}</p> : null}
          </div>
          <span className="text-[11px] uppercase tracking-[0.14em] text-slate-400">Expand</span>
        </div>
      </summary>
      <div className="mt-4">{children}</div>
    </details>
  );
}
