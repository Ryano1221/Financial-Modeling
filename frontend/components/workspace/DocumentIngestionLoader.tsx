"use client";

type DocumentIngestionLoaderProps = {
  status?: string;
  detail?: string;
  compact?: boolean;
};

export function DocumentIngestionLoader({
  status = "Ingesting documents into Document Center...",
  detail = "Classifying files, building previews, and indexing them to the active client library.",
  compact = false,
}: DocumentIngestionLoaderProps) {
  return (
    <div className={`document-ingestion-loader ${compact ? "document-ingestion-loader-compact" : ""}`}>
      <div className="document-ingestion-loader-graphic" aria-hidden="true">
        <div className="document-ingestion-loader-lane">
          <div className="document-ingestion-loader-doc document-ingestion-loader-doc-a" />
          <div className="document-ingestion-loader-doc document-ingestion-loader-doc-b" />
          <div className="document-ingestion-loader-doc document-ingestion-loader-doc-c" />
        </div>
        <div className="document-ingestion-loader-core">
          <div className="document-ingestion-loader-core-frame">
            <div className="document-ingestion-loader-core-scan" />
            <div className="document-ingestion-loader-core-grid" />
          </div>
        </div>
      </div>

      <div className="document-ingestion-loader-copy">
        <p className="heading-kicker mb-2">Document Intake Active</p>
        <p className="document-ingestion-loader-status">{status}</p>
        <p className="document-ingestion-loader-detail">{detail}</p>
      </div>
    </div>
  );
}
