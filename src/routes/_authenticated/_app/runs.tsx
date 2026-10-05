import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, EmptyState } from "@/components/app/ui-bits";

export const Route = createFileRoute("/_authenticated/_app/runs")({
  head: () => ({ meta: [{ title: "Runs — CanaryGrid" }] }),
  component: PRuns,
});

function PRuns() {
  return (
    <div className="space-y-6">
      <PageHeader title="Runs" />
      <EmptyState title="Not built yet" body="This screen is planned for the next build phase." />
    </div>
  );
}
