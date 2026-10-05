import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-md border border-dashed px-6 py-14 text-center">
      {icon && <div className="mb-3 text-muted-foreground">{icon}</div>}
      <h3 className="text-sm font-medium">{title}</h3>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground" role="status">
      <Loader2 className="h-4 w-4 animate-spin" /> {label}…
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm">
      <div className="flex gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        <span>{message}</span>
      </div>
      {onRetry && <Button size="sm" variant="outline" onClick={onRetry}>Retry</Button>}
    </div>
  );
}

const tone: Record<string, string> = {
  passed: "bg-success/12 text-success border-success/30",
  verified: "bg-success/12 text-success border-success/30",
  healthy: "bg-success/12 text-success border-success/30",
  failed: "bg-destructive/10 text-destructive border-destructive/30",
  error: "bg-destructive/10 text-destructive border-destructive/30",
  blocked: "bg-destructive/10 text-destructive border-destructive/30",
  critical: "bg-destructive/10 text-destructive border-destructive/30",
  open: "bg-destructive/10 text-destructive border-destructive/30",
  waived: "bg-warning/15 text-warning-foreground border-warning/40 dark:text-warning",
  high: "bg-warning/15 text-warning-foreground border-warning/40 dark:text-warning",
  expiring: "bg-warning/15 text-warning-foreground border-warning/40 dark:text-warning",
  acknowledged: "bg-warning/15 text-warning-foreground border-warning/40 dark:text-warning",
  running: "bg-info/10 text-info border-info/30",
  planning: "bg-info/10 text-info border-info/30",
  queued: "bg-info/10 text-info border-info/30",
  medium: "bg-info/10 text-info border-info/30",
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-wide", tone[status] ?? "bg-muted text-muted-foreground border-border", className)}>
      {status}
    </span>
  );
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <code className={cn("font-mono text-xs", className)}>{children}</code>;
}

export function ConfigRequired({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-md border border-warning/40 bg-warning/8 p-4 text-sm">
      <p className="font-medium">{title}</p>
      <div className="mt-1 text-muted-foreground">{children}</div>
    </div>
  );
}
