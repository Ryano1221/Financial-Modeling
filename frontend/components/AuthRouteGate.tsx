"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useClientWorkspace } from "@/components/workspace/ClientWorkspaceProvider";
import { shouldRedirectSignedOutVisitor } from "@/lib/auth-access";

export function AuthRouteGate() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { ready, isAuthenticated } = useClientWorkspace();

  useEffect(() => {
    if (!ready || isAuthenticated) return;
    if (!shouldRedirectSignedOutVisitor(pathname, searchParams?.get("module"))) return;
    router.replace("/");
  }, [isAuthenticated, pathname, ready, router, searchParams]);

  return null;
}
