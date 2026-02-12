"use client";

import { useCallback, useState } from "react";
import { baseUrl } from "@/lib/api";

const HEALTH_RETRIES = 3;
const HEALTH_RETRY_DELAY_MS = 500;

async function fetchHealthWithRetry(url: string): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= HEALTH_RETRIES; attempt++) {
    try {
      const res = await fetch(`${url}/health`, { method: "GET" });
      return res;
    } catch (e) {
      lastError = e;
      if (attempt < HEALTH_RETRIES) {
        await new Promise((r) => setTimeout(r, HEALTH_RETRY_DELAY_MS));
      }
    }
  }
  throw lastError;
}

export function Diagnostics() {
  const [status, setStatus] = useState<"idle" | "checking" | "connected" | "error">("idle");
  const [errorText, setErrorText] = useState<string | null>(null);

  const testConnection = useCallback(async () => {
    setStatus("checking");
    setErrorText(null);
    const url = baseUrl;
    try {
      const res = await fetchHealthWithRetry(url);
      if (res.ok) {
        setStatus("connected");
        return;
      }
      setStatus("error");
      const body = await res.text();
      try {
        const json = JSON.parse(body);
        const detail = json.detail != null ? String(json.detail) : body || res.statusText;
        setErrorText(`HTTP ${res.status}: ${detail}`);
      } catch {
        setErrorText(`HTTP ${res.status}${body ? `: ${body}` : ` ${res.statusText}`}`);
      }
    } catch (e) {
      setStatus("error");
      const message = e instanceof Error ? e.message : String(e);
      setErrorText(
        `${message} (attempted ${url}). Is backend running? Start with: cd backend && uvicorn main:app --reload --port 8010`
      );
    }
  }, []);

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
      <p className="text-xs uppercase tracking-widest text-zinc-500 font-medium mb-2">Diagnostics</p>
      <p className="text-xs text-zinc-500 mb-2 font-mono break-all">
        Backend URL: {baseUrl}
      </p>
      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={testConnection}
          disabled={status === "checking"}
          className="rounded-full border border-white/20 bg-white/5 px-4 py-2 text-sm font-medium text-white hover:bg-white/10 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-[#3b82f6] focus:ring-offset-2 focus:ring-offset-[#0a0a0b]"
        >
          {status === "checking" ? "Checking…" : "Test backend connection"}
        </button>
        {status === "connected" && (
          <span className="text-sm text-emerald-400 font-medium">Connected</span>
        )}
        {status === "error" && (
          <span className="text-sm text-red-400 font-medium">Not reachable</span>
        )}
      </div>
      {errorText && (
        <p className="mt-2 text-xs text-red-300 font-mono break-words bg-red-500/10 border border-red-500/20 p-2 rounded-lg">
          {errorText}
        </p>
      )}
    </div>
  );
}
