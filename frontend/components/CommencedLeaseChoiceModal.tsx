"use client";

interface CommencedLeaseChoiceModalProps {
  open: boolean;
  onChooseRemaining: () => void;
  onChooseFull: () => void;
}

export function CommencedLeaseChoiceModal({
  open,
  onChooseRemaining,
  onChooseFull,
}: CommencedLeaseChoiceModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-[2px]" />
      <div className="relative w-full max-w-xl border border-slate-300/25 bg-slate-950/95 p-5 sm:p-6">
        <p className="heading-kicker mb-2">Existing obligation</p>
        <h3 className="heading-section mb-3">Lease has already commenced</h3>
        <p className="text-sm text-slate-200 mb-5 leading-relaxed">
          Choose how this scenario should be modeled.
        </p>
        <div className="space-y-2 text-sm text-slate-300 mb-6">
          <p>
            <span className="font-semibold text-white">Remaining obligation only:</span>{" "}
            model from next full month forward.
          </p>
          <p>
            <span className="font-semibold text-white">Full original term:</span>{" "}
            model the entire original lease term.
          </p>
        </div>
        <div className="flex flex-wrap gap-3 justify-end">
          <button
            type="button"
            onClick={onChooseFull}
            className="btn-premium btn-premium-secondary min-w-[180px]"
          >
            Full original term
          </button>
          <button
            type="button"
            onClick={onChooseRemaining}
            className="btn-premium btn-premium-primary min-w-[220px]"
          >
            Remaining obligation only
          </button>
        </div>
      </div>
    </div>
  );
}
