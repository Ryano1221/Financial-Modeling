import Link from "next/link";

export default function ExamplePage() {
  return (
    <div className="min-h-screen text-white pt-24 pb-14">
      <div className="app-container">
        <Link href="/" className="text-slate-400 hover:text-slate-100 transition">
          ← Back
        </Link>

        <h1 className="heading-display mt-8 mb-6">
          Example Lease Financial Analysis
        </h1>

        <p className="body-lead mb-12 max-w-3xl">
          This is a fully branded, institutional-grade financial analysis
          generated from a raw lease document. Clean formatting. Executive
          summary. Structured risk analysis. Ready for client delivery.
        </p>

        <div className="rounded-3xl overflow-hidden shadow-[0_40px_100px_rgba(0,0,0,0.6)] border border-slate-300/25 bg-slate-900/40">
          <iframe
            title="Example lease financial analysis PDF"
            src="/example-report.pdf#view=FitH"
            className="w-full h-[900px] bg-white"
          />
        </div>
        <p className="mt-4 text-sm text-slate-400">
          If the preview is blank, click Open PDF.
        </p>
        <a
          href="/example-report.pdf"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex mt-4 btn-premium btn-premium-primary"
        >
          Open PDF
        </a>
      </div>
    </div>
  );
}
