import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, EmptyState } from "@/components/app/ui-bits";

export const Route = createFileRoute("/_authenticated/_app/clusters")({
  head: () => ({ meta: [{ title: "Failure Clusters — CanaryGrid" }] }),
  component: PClusters,
});

function PClusters() {
  return (
    <div className="space-y-6">
      <PageHeader title="Failure Clusters" />
      <EmptyState title="Not built yet" body="This screen is planned for the next build phase." />
    </div>
  );
}
