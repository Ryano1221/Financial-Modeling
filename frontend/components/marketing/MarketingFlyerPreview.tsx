import type { CSSProperties, ReactNode } from "react";
import { marketingOfferLabel } from "@/lib/marketing/engine";
import type { MarketingFlyerSnapshot, MarketingLayoutStyle } from "@/lib/marketing/types";

function asText(value: unknown): string {
  return String(value || "").trim();
}

function photoAt(snapshot: MarketingFlyerSnapshot, index: number): string | null {
  return snapshot.photos[index]?.dataUrl || null;
}

function rsfLabel(value: string): string {
  const rsf = Number(String(value || "").replace(/,/g, ""));
  return Number.isFinite(rsf) && rsf > 0 ? `${Math.round(rsf).toLocaleString()} RSF` : value;
}

function styleConfig(layout: MarketingLayoutStyle) {
  if (layout === "Classic") {
    return {
      page: "bg-[#fbfaf7] text-[#1f2933] font-serif border border-[#c9bfae]",
      kicker: "text-[var(--flyer-primary)]",
      title: "font-serif font-bold",
      panel: "border border-[#c9bfae] bg-white",
      image: "border border-[#c9bfae]",
      footer: "border-[#c9bfae] text-[#667085]",
      bullet: "before:bg-[var(--flyer-primary)]",
    };
  }
  if (layout === "Minimal") {
    return {
      page: "bg-white text-neutral-950",
      kicker: "text-neutral-500",
      title: "font-sans font-semibold",
      panel: "border border-neutral-200 bg-neutral-50",
      image: "border border-neutral-200",
      footer: "border-neutral-200 text-neutral-500",
      bullet: "before:bg-[var(--flyer-primary)]",
    };
  }
  return {
    page: "bg-[#f3f7fa] text-[#07141f]",
    kicker: "text-[var(--flyer-primary)]",
    title: "font-sans font-black",
    panel: "border border-slate-200 bg-white shadow-sm",
    image: "border border-slate-200",
    footer: "border-slate-200 text-slate-500",
    bullet: "before:bg-[var(--flyer-secondary)]",
  };
}

function Page({
  snapshot,
  page,
  children,
}: {
  snapshot: MarketingFlyerSnapshot;
  page: number;
  children: ReactNode;
}) {
  const cfg = styleConfig(snapshot.form.layout_style);
  return (
    <section className={`marketing-flyer-page mx-auto flex min-h-[11in] w-full max-w-[8.5in] flex-col overflow-hidden p-8 shadow-2xl shadow-black/30 ${cfg.page}`}>
      {children}
      <div className={`mt-auto flex items-end justify-between gap-4 border-t pt-3 text-[9px] ${cfg.footer}`}>
        <span>{asText(snapshot.disclaimer) || "Information deemed reliable; tenant and landlord to verify all terms."}</span>
        <span>Page {page}</span>
      </div>
    </section>
  );
}

function PhotoBlock({
  snapshot,
  src,
  label,
  className = "",
  contain = false,
}: {
  snapshot: MarketingFlyerSnapshot;
  src: string | null;
  label: string;
  className?: string;
  contain?: boolean;
}) {
  const cfg = styleConfig(snapshot.form.layout_style);
  if (src) {
    return (
      <img
        src={src}
        alt={label}
        className={`w-full bg-white ${contain ? "object-contain" : "object-cover"} ${cfg.image} ${className}`}
      />
    );
  }
  return (
    <div className={`flex w-full items-center justify-center border border-dashed bg-white/70 text-xs text-neutral-500 ${className}`}>
      {label}
    </div>
  );
}

function Kicker({ snapshot, children }: { snapshot: MarketingFlyerSnapshot; children: ReactNode }) {
  const cfg = styleConfig(snapshot.form.layout_style);
  return <p className={`text-xs font-bold uppercase ${cfg.kicker}`}>{children}</p>;
}

function Detail({ snapshot, label, value }: { snapshot: MarketingFlyerSnapshot; label: string; value: string }) {
  const cfg = styleConfig(snapshot.form.layout_style);
  return (
    <div className={`p-3 ${cfg.panel}`}>
      <p className="text-[10px] font-semibold uppercase text-neutral-500">{label}</p>
      <p className="mt-1 text-sm font-bold">{value || "-"}</p>
    </div>
  );
}

function BulletList({ snapshot, bullets, mode }: { snapshot: MarketingFlyerSnapshot; bullets: string[]; mode: "suite" | "building" }) {
  const cfg = styleConfig(snapshot.form.layout_style);
  return (
    <ul className="space-y-3 text-sm leading-6">
      {bullets.map((bullet) => (
        <li key={`${mode}-${bullet}`} className={`relative pl-5 before:absolute before:left-0 before:top-2 before:h-2 before:w-2 ${cfg.bullet}`}>
          {bullet}
        </li>
      ))}
    </ul>
  );
}

export function MarketingFlyerPreview({ snapshot }: { snapshot: MarketingFlyerSnapshot }) {
  const { form, copy } = snapshot;
  const offerLabel = marketingOfferLabel(form.lease_type);
  const cfg = styleConfig(form.layout_style);
  const style = {
    "--flyer-primary": form.primary_color || "#00E5FF",
    "--flyer-secondary": form.secondary_color || "#B8F36B",
  } as CSSProperties;
  const isModern = form.layout_style === "Modern";
  const isMinimal = form.layout_style === "Minimal";

  return (
    <div className="marketing-flyer-preview space-y-5" style={style}>
      <Page snapshot={snapshot} page={1}>
        {isModern ? (
          <>
            <PhotoBlock snapshot={snapshot} src={photoAt(snapshot, 0)} label="Hero photo" className="-m-8 mb-0 h-[6in] w-[calc(100%+4rem)] border-0" />
            <div className="-mx-8 bg-[#07141f] p-8 text-white">
              <div className="flex items-start justify-between gap-5">
                <div>
                  <Kicker snapshot={snapshot}>{offerLabel}</Kicker>
                  <h1 className={`mt-4 max-w-[5.8in] text-4xl leading-tight ${cfg.title}`}>
                    {copy.headline || `${form.suite_number || "Suite"} at ${form.building_name || "Workspace"}`}
                  </h1>
                </div>
                {snapshot.logoDataUrl ? <img src={snapshot.logoDataUrl} alt="Account logo" className="max-h-14 max-w-36 object-contain" /> : null}
              </div>
              <div className="mt-6 grid grid-cols-[minmax(0,1fr)_1.6in] gap-4">
                <div>
                  <p className="text-xl font-bold">{form.building_name || "Building name"}</p>
                  <p className="mt-1 text-sm text-white/70">{form.address || "Property address"}</p>
                </div>
                <div className="border-l-4 border-[var(--flyer-secondary)] pl-4">
                  <p className="text-xs uppercase text-white/60">Suite</p>
                  <p className="text-2xl font-black">{form.suite_number || "-"}</p>
                </div>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-start justify-between gap-6">
              <div>
                <Kicker snapshot={snapshot}>{offerLabel}</Kicker>
                <h1 className={`mt-4 max-w-[6in] text-4xl leading-tight ${cfg.title}`}>
                  {copy.headline || `${form.suite_number || "Suite"} at ${form.building_name || "Workspace"}`}
                </h1>
              </div>
              {snapshot.logoDataUrl ? <img src={snapshot.logoDataUrl} alt="Account logo" className="max-h-16 max-w-40 object-contain" /> : null}
            </div>
            <div className={isMinimal ? "mt-10" : "mt-7"}>
              <PhotoBlock snapshot={snapshot} src={photoAt(snapshot, 0)} label="Hero photo" className="h-[5.8in]" />
            </div>
            <div className="mt-6 grid grid-cols-[minmax(0,1fr)_1.8in] gap-5">
              <div>
                <p className="text-2xl font-bold leading-tight">{form.building_name || "Building name"}</p>
                <p className="mt-1 text-lg text-neutral-600">{form.address || "Property address"}</p>
              </div>
              <div className="border-l-4 border-[var(--flyer-primary)] pl-4">
                <p className="text-[10px] uppercase text-neutral-500">Suite</p>
                <p className="text-3xl font-black">{form.suite_number || "-"}</p>
              </div>
            </div>
          </>
        )}
      </Page>

      <Page snapshot={snapshot} page={2}>
        <Kicker snapshot={snapshot}>Suite Details</Kicker>
        <h2 className={`mt-3 text-3xl leading-tight ${cfg.title}`}>The essentials at a glance.</h2>
        <div className="mt-6 grid grid-cols-3 gap-3">
          <Detail snapshot={snapshot} label="RSF" value={rsfLabel(form.rsf)} />
          <Detail snapshot={snapshot} label="Rate" value={form.rate} />
          <Detail snapshot={snapshot} label="Availability" value={form.availability} />
          <Detail snapshot={snapshot} label="Term" value={form.term_expiration} />
          <Detail snapshot={snapshot} label="Floor" value={form.floor} />
          <Detail snapshot={snapshot} label="OPEX" value={form.opex} />
        </div>
        <div className="mt-7 grid grid-cols-2 gap-4">
          <PhotoBlock snapshot={snapshot} src={photoAt(snapshot, 1)} label="Interior photo" className="h-[3in]" />
          <PhotoBlock snapshot={snapshot} src={photoAt(snapshot, 2)} label="Interior photo" className="h-[3in]" />
        </div>
      </Page>

      <Page snapshot={snapshot} page={3}>
        <Kicker snapshot={snapshot}>Suite Features</Kicker>
        <h2 className={`mt-3 text-3xl leading-tight ${cfg.title}`}>Space highlights</h2>
        <div className="mt-7 grid grid-cols-[1fr_2.85in] gap-6">
          <BulletList snapshot={snapshot} bullets={copy.suite_bullets} mode="suite" />
          <PhotoBlock snapshot={snapshot} src={photoAt(snapshot, 3)} label="Suite photo" className="h-[5.6in]" />
        </div>
      </Page>

      <Page snapshot={snapshot} page={4}>
        <Kicker snapshot={snapshot}>Building Features</Kicker>
        <h2 className={`mt-3 text-3xl leading-tight ${cfg.title}`}>Building advantages</h2>
        <div className="mt-7 grid grid-cols-[1fr_2.85in] gap-6">
          <BulletList snapshot={snapshot} bullets={copy.building_bullets} mode="building" />
          <PhotoBlock snapshot={snapshot} src={photoAt(snapshot, 0)} label="Building photo" className="h-[5.6in]" />
        </div>
      </Page>

      <Page snapshot={snapshot} page={5}>
        <Kicker snapshot={snapshot}>Floorplan And Contacts</Kicker>
        <h2 className={`mt-3 text-3xl leading-tight ${cfg.title}`}>Review the layout, then reach out.</h2>
        <div className="mt-5 grid flex-1 grid-rows-[1fr_auto] gap-5">
          {form.include_floorplan ? (
            <PhotoBlock snapshot={snapshot} src={snapshot.floorplan?.dataUrl || null} label="Floorplan" className="h-[4.8in]" contain />
          ) : (
            <div className="flex h-[4.8in] items-center justify-center border border-neutral-200 bg-neutral-50 text-sm text-neutral-500">
              Floorplan hidden
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-3">
            {[form.broker, ...form.co_brokers].filter((broker) => asText(broker.name) || asText(broker.email) || asText(broker.phone)).slice(0, 3).map((broker, index) => (
              <div key={`${broker.email}-${index}`} className={`p-3 ${isModern ? "bg-[#07141f] text-white" : cfg.panel}`}>
                <p className="font-bold">{broker.name || "Broker"}</p>
                <p className={isModern ? "mt-2 text-xs text-white/70" : "mt-2 text-xs text-neutral-600"}>{broker.email || "email"}</p>
                <p className={isModern ? "text-xs text-white/70" : "text-xs text-neutral-600"}>{broker.phone || "phone"}</p>
              </div>
            ))}
          </div>
        </div>
      </Page>
    </div>
  );
}
