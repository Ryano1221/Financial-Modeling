import Link from "next/link";

export default function ExamplePage() {
  return (
    <div className="min-h-screen bg-black text-white px-8 py-24">
      <div className="max-w-6xl mx-auto">
        <Link href="/" className="text-zinc-500 hover:text-white transition">
          ← Back
        </Link>

        <h1 className="text-5xl md:text-6xl font-bold tracking-tight mt-8 mb-6">
          Example Lease Financial Analysis
        </h1>

        <p className="text-zinc-400 text-lg mb-12 max-w-3xl">
          This is a fully branded, institutional-grade financial analysis
          generated from a raw lease document. Clean formatting. Executive
          summary. Structured risk analysis. Ready for client delivery.
        </p>

        <div className="rounded-3xl overflow-hidden shadow-[0_40px_100px_rgba(0,0,0,0.6)] border border-zinc-800">
          <iframe
            title="Example lease financial analysis PDF"
            src="/example-report.pdf#view=FitH"
            className="w-full h-[900px] bg-white"
          />
        </div>
        <p className="mt-4 text-sm text-zinc-500">
          If the preview is blank, click Open PDF.
        </p>
        <a
          href="/example-report.pdf"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block mt-4 px-6 py-3 bg-white text-black font-medium rounded-full hover:bg-zinc-200 transition-colors"
        >
          Open PDF
        </a>
      </div>
    </div>
  );
}
