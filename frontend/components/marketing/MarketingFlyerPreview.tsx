import type { CSSProperties } from "react";
import { marketingOfferLabel } from "@/lib/marketing/engine";
import type { MarketingFlyerSnapshot } from "@/lib/marketing/types";

function asText(value: unknown): string {
  return String(value || "").trim();
}

function photoAt(snapshot: MarketingFlyerSnapshot, index: number): string | null {
  return snapshot.photos[index]?.dataUrl || null;
}

function PhotoBlock({
  src,
  label,
  large = false,
}: {
  src: string | null;
  label: string;
  large?: boolean;
}) {
  if (src) {
    return (
      <img
        src={src}
        alt={label}
        className={`w-full border border-neutral-200 object-cover ${large ? "h-[7.1in]" : "h-[2.7in]"}`}
      />
    );
  }
  return (
    <div className={`flex w-full items-center justify-center border border-dashed border-neutral-300 bg-neutral-100 text-xs uppercase tracking-[0.18em] text-neutral-500 ${large ? "h-[7.1in]" : "h-[2.7in]"}`}>
      {label}
    </div>
  );
}

function FlyerFooter({ snapshot, page }: { snapshot: MarketingFlyerSnapshot; page: number }) {
  return (
    <div className="mt-auto flex items-end justify-between gap-4 border-t border-neutral-200 pt-3 text-[9px] uppercase tracking-[0.12em] text-neutral-500">
      <span>{asText(snapshot.disclaimer) || "Information deemed reliable; tenant and landlord to verify all terms."}</span>
      <span>Page {page}</span>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-neutral-200 p-3">
      <p className="text-[9px] uppercase tracking-[0.18em] text-neutral-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-neutral-950">{value || "-"}</p>
    </div>
  );
}

export function MarketingFlyerPreview({ snapshot }: { snapshot: MarketingFlyerSnapshot }) {
  const { form, copy } = snapshot;
  const offerLabel = marketingOfferLabel(form.lease_type);
  const style = {
    "--flyer-primary": form.primary_color || "#00E5FF",
    "--flyer-secondary": form.secondary_color || "#B8F36B",
  } as CSSProperties;

  return (
    <div className="marketing-flyer-preview space-y-5" style={style}>
      <section className="marketing-flyer-page mx-auto w-full max-w-[8.5in] min-h-[11in] flex flex-col bg-white p-8 text-neutral-950 shadow-2xl shadow-black/30">
        <div className="flex items-start justify-between gap-6">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.28em]" style={{ color: "var(--flyer-primary)" }}>
              {offerLabel}
            </p>
            <h1 className="mt-4 max-w-[6.2in] text-4xl font-black leading-[0.95] tracking-[-0.04em]">
              {copy.headline || `${form.suite_number || "Suite"} at ${form.building_name || "Workspace"}`}
            </h1>
          </div>
          {snapshot.logoDataUrl ? (
            <img src={snapshot.logoDataUrl} alt="Account logo" className="max-h-16 max-w-40 object-contain" />
          ) : (
            <div className="flex h-16 w-32 items-center justify-center border border-neutral-300 text-[10px] uppercase tracking-[0.16em] text-neutral-500">
              Logo
            </div>
          )}
        </div>
        <div className="mt-7">
          <PhotoBlock src={photoAt(snapshot, 0)} label="Hero photo" large />
        </div>
        <div className="mt-6 grid grid-cols-[minmax(0,1fr)_1.8in] gap-5">
          <div>
            <p className="text-2xl font-bold leading-tight">{form.building_name || "Building name"}</p>
            <p className="mt-1 text-lg text-neutral-600">{form.address || "Property address"}</p>
          </div>
          <div className="border-l-4 pl-4" style={{ borderColor: "var(--flyer-secondary)" }}>
            <p className="text-[10px] uppercase tracking-[0.16em] text-neutral-500">Suite</p>
            <p className="text-3xl font-black">{form.suite_number || "-"}</p>
          </div>
        </div>
        <FlyerFooter snapshot={snapshot} page={1} />
      </section>

      <section className="marketing-flyer-page mx-auto w-full max-w-[8.5in] min-h-[11in] flex flex-col bg-white p-8 text-neutral-950 shadow-2xl shadow-black/30">
        <p className="text-xs font-bold uppercase tracking-[0.24em]" style={{ color: "var(--flyer-primary)" }}>Suite Details</p>
        <h2 className="mt-3 text-3xl font-black tracking-[-0.03em]">The essentials at a glance.</h2>
        <div className="mt-6 grid grid-cols-2 gap-3">
          <Detail label="RSF" value={form.rsf ? `${Number(form.rsf).toLocaleString()} RSF` : ""} />
          <Detail label="Rate" value={form.rate} />
          <Detail label="Availability" value={form.availability} />
          <Detail label="Term" value={form.term_expiration} />
          <Detail label="Floor" value={form.floor} />
          <Detail label="OPEX" value={form.opex} />
        </div>
        <div className="mt-6 grid grid-cols-2 gap-4">
          <PhotoBlock src={photoAt(snapshot, 1)} label="Interior photo" />
          <PhotoBlock src={photoAt(snapshot, 2)} label="Interior photo" />
        </div>
        <FlyerFooter snapshot={snapshot} page={2} />
      </section>

      <section className="marketing-flyer-page mx-auto w-full max-w-[8.5in] min-h-[11in] flex flex-col bg-white p-8 text-neutral-950 shadow-2xl shadow-black/30">
        <p className="text-xs font-bold uppercase tracking-[0.24em]" style={{ color: "var(--flyer-primary)" }}>Suite Features</p>
        <h2 className="mt-3 text-3xl font-black tracking-[-0.03em]">Built for fast review.</h2>
        <div className="mt-6 grid grid-cols-[1.1fr_0.9fr] gap-5">
          <ul className="space-y-3 text-base leading-7">
            {copy.suite_bullets.map((bullet) => (
              <li key={bullet} className="border-l-4 pl-4" style={{ borderColor: "var(--flyer-secondary)" }}>
                {bullet}
              </li>
            ))}
          </ul>
          <div className="grid gap-4">
            <PhotoBlock src={photoAt(snapshot, 3)} label="Suite photo" />
            <PhotoBlock src={photoAt(snapshot, 0)} label="Suite photo" />
          </div>
        </div>
        <FlyerFooter snapshot={snapshot} page={3} />
      </section>

      <section className="marketing-flyer-page mx-auto w-full max-w-[8.5in] min-h-[11in] flex flex-col bg-white p-8 text-neutral-950 shadow-2xl shadow-black/30">
        <p className="text-xs font-bold uppercase tracking-[0.24em]" style={{ color: "var(--flyer-primary)" }}>Building Features</p>
        <h2 className="mt-3 text-3xl font-black tracking-[-0.03em]">A setting that supports the deal.</h2>
        <div className="mt-6 grid grid-cols-[0.86fr_1.14fr] gap-5">
          <ul className="space-y-3 text-base leading-7">
            {copy.building_bullets.map((bullet) => (
              <li key={bullet} className="border-l-4 pl-4" style={{ borderColor: "var(--flyer-primary)" }}>
                {bullet}
              </li>
            ))}
          </ul>
          <PhotoBlock src={photoAt(snapshot, 0)} label="Building photo" large />
        </div>
        <FlyerFooter snapshot={snapshot} page={4} />
      </section>

      <section className="marketing-flyer-page mx-auto w-full max-w-[8.5in] min-h-[11in] flex flex-col bg-white p-8 text-neutral-950 shadow-2xl shadow-black/30">
        <p className="text-xs font-bold uppercase tracking-[0.24em]" style={{ color: "var(--flyer-primary)" }}>Floorplan And Contacts</p>
        <h2 className="mt-3 text-3xl font-black tracking-[-0.03em]">Review the layout, then reach out.</h2>
        <div className="mt-5 grid flex-1 grid-rows-[1fr_auto] gap-5">
          {form.include_floorplan ? (
            snapshot.floorplan?.dataUrl ? (
              <img src={snapshot.floorplan.dataUrl} alt="Floorplan" className="h-full w-full border border-neutral-200 object-contain" />
            ) : (
              <div className="flex h-full min-h-[4.8in] items-center justify-center border border-dashed border-neutral-300 bg-neutral-100 text-xs uppercase tracking-[0.18em] text-neutral-500">
                Floorplan
              </div>
            )
          ) : (
            <div className="flex h-full min-h-[4.8in] items-center justify-center border border-neutral-200 bg-neutral-50 text-sm text-neutral-500">
              Floorplan hidden
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-3">
            {[form.broker, ...form.co_brokers].filter((broker) => asText(broker.name) || asText(broker.email) || asText(broker.phone)).slice(0, 3).map((broker, index) => (
              <div key={`${broker.email}-${index}`} className="border border-neutral-200 p-3">
                <p className="font-bold text-neutral-950">{broker.name || "Broker"}</p>
                <p className="mt-2 text-xs text-neutral-600">{broker.email || "email"}</p>
                <p className="text-xs text-neutral-600">{broker.phone || "phone"}</p>
              </div>
            ))}
          </div>
        </div>
        <FlyerFooter snapshot={snapshot} page={5} />
      </section>
    </div>
  );
}
