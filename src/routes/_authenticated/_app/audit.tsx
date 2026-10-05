import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, EmptyState } from "@/components/app/ui-bits";

export const Route = createFileRoute("/_authenticated/_app/audit")({
  head: () => ({ meta: [{ title: "Audit Log — CanaryGrid" }] }),
  component: PAudit,
});

function PAudit() {
  return (
    <div className="space-y-6">
      <PageHeader title="Audit Log" />
      <EmptyState title="Not built yet" body="This screen is planned for the next build phase." />
    </div>
  );
}
