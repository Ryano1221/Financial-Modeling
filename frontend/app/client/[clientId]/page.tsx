import { ClientWorkspacePage } from "@/components/workspace/ClientWorkspacePage";

interface ClientByIdPageProps {
  params: Promise<{
    clientId: string;
  }>;
}

export default async function ClientByIdPage({ params }: ClientByIdPageProps) {
  const resolvedParams = await params;
  return <ClientWorkspacePage routeClientId={decodeURIComponent(resolvedParams.clientId)} />;
}
