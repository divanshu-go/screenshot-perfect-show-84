import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, EmptyState } from "@/components/app/ui-bits";

export const Route = createFileRoute("/_authenticated/_app/journeys")({
  head: () => ({ meta: [{ title: "Journeys — CanaryGrid" }] }),
  component: PJourneys,
});

function PJourneys() {
  return (
    <div className="space-y-6">
      <PageHeader title="Journeys" />
      <EmptyState title="Not built yet" body="This screen is planned for the next build phase." />
    </div>
  );
}
