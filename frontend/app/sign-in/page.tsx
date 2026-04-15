"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { AuthPanel } from "@/components/AuthPanel";

function SignInContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  return (
    <AuthPanel
      initialMode="signin"
      onAuthed={() => {
        const redirectTo = searchParams.get("redirect_to");
        router.push(redirectTo && redirectTo.startsWith("/") ? redirectTo : "/");
      }}
    />
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInContent />
    </Suspense>
  );
}
