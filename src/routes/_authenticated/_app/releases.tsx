import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, EmptyState } from "@/components/app/ui-bits";

export const Route = createFileRoute("/_authenticated/_app/releases")({
  head: () => ({ meta: [{ title: "Releases — CanaryGrid" }] }),
  component: PReleases,
});

function PReleases() {
  return (
    <div className="space-y-6">
      <PageHeader title="Releases" />
      <EmptyState title="Not built yet" body="This screen is planned for the next build phase." />
    </div>
  );
}
