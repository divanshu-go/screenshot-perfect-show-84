import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, EmptyState } from "@/components/app/ui-bits";

export const Route = createFileRoute("/_authenticated/_app/coverage")({
  head: () => ({ meta: [{ title: "Coverage — CanaryGrid" }] }),
  component: PCoverage,
});

function PCoverage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Coverage" />
      <EmptyState title="Not built yet" body="This screen is planned for the next build phase." />
    </div>
  );
}
