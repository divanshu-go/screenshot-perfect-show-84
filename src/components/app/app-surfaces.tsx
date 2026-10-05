import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Panel({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("overflow-hidden rounded-lg border bg-card", className)}>
      <header className="border-b px-4 py-3">
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function StatStrip({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <section className="grid border-y sm:grid-cols-2 lg:grid-cols-4">
      {items.map((item) => (
        <div
          key={item.label}
          className="border-b py-4 pr-4 sm:border-b-0 sm:border-r sm:pl-4 first:pl-0 last:border-r-0"
        >
          <p className="text-xs text-muted-foreground">{item.label}</p>
          <div className="mt-1 text-xl font-semibold tracking-tight tabular-nums">{item.value}</div>
        </div>
      ))}
    </section>
  );
}

export function DataTable({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border bg-card [&_tbody_tr:hover>td]:bg-muted/40">
      <table className="w-full min-w-[680px] text-left text-sm">{children}</table>
    </div>
  );
}

export const tableHeaderClass =
  "border-b bg-muted/30 px-4 py-2.5 text-xs font-medium text-muted-foreground";
export const tableCellClass = "border-b px-4 py-3 align-top transition-colors";
