export const AUTH_SESSION_COOKIE = "thecremodel_authenticated";

function normalizePathname(pathname: string | null | undefined): string {
  const normalized = String(pathname || "").trim();
  if (!normalized) return "/";
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

const PUBLIC_PATHS = new Set([
  "/",
  "/sign-in",
  "/sign-up",
]);

export function isPublicAppPath(pathname: string | null | undefined): boolean {
  const normalized = normalizePathname(pathname);
  if (PUBLIC_PATHS.has(normalized)) return true;
  return false;
}

export function shouldRedirectSignedOutVisitor(
  pathname: string | null | undefined,
  moduleParam: string | null | undefined,
): boolean {
  const normalizedPathname = normalizePathname(pathname);
  const normalizedModuleParam = String(moduleParam || "").trim();

  if (normalizedPathname === "/") {
    return normalizedModuleParam.length > 0;
  }

  return !isPublicAppPath(normalizedPathname);
}
