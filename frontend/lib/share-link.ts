export function encodeSharePayload<T>(payload: T): string {
  if (typeof window === "undefined") return "";
  const json = JSON.stringify(payload);
  return window.btoa(unescape(encodeURIComponent(json)));
}

export function decodeSharePayload<T>(encoded: string): T | null {
  try {
    if (typeof window === "undefined") return null;
    const json = decodeURIComponent(escape(window.atob(encoded)));
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

export function buildShareUrl(pathname: string, encodedPayload: string): string {
  if (typeof window === "undefined") return "";
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${window.location.origin}${path}?data=${encodeURIComponent(encodedPayload)}`;
}
