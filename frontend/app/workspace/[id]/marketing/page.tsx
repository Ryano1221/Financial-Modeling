import { redirect } from "next/navigation";

export default async function WorkspaceMarketingRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/?module=marketing&workspace=${encodeURIComponent(id)}`);
}
