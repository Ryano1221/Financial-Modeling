"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { AuthPanel } from "@/components/AuthPanel";

function SignUpContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  return (
    <AuthPanel
      initialMode="signup"
      onAuthed={() => {
        const redirectTo = searchParams.get("redirect_to");
        router.push(redirectTo && redirectTo.startsWith("/") ? redirectTo : "/");
      }}
    />
  );
}

export default function SignUpPage() {
  return (
    <Suspense fallback={null}>
      <SignUpContent />
    </Suspense>
  );
}
