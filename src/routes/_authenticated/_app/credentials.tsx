import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, EmptyState } from "@/components/app/ui-bits";

export const Route = createFileRoute("/_authenticated/_app/credentials")({
  head: () => ({ meta: [{ title: "Credentials — CanaryGrid" }] }),
  component: PCredentials,
});

function PCredentials() {
  return (
    <div className="space-y-6">
      <PageHeader title="Credentials" />
      <EmptyState title="Not built yet" body="This screen is planned for the next build phase." />
    </div>
  );
}
