"use client";

import { useRouter } from "next/navigation";
import { AuthPanel } from "@/components/AuthPanel";

export default function SignInPage() {
  const router = useRouter();

  return (
    <AuthPanel
      initialMode="signin"
      onAuthed={() => {
        router.push("/");
      }}
    />
  );
}
