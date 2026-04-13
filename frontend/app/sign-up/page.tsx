"use client";

import { useRouter } from "next/navigation";
import { AuthPanel } from "@/components/AuthPanel";

export default function SignUpPage() {
  const router = useRouter();

  return (
    <AuthPanel
      initialMode="signup"
      onAuthed={() => {
        router.push("/");
      }}
    />
  );
}
