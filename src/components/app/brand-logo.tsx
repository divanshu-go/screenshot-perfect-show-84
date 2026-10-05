import { cn } from "@/lib/utils";

export function BrandLogo({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center", className)} aria-label="CanaryGrid">
      <img
        src={compact ? "/canarygrid-mark.svg" : "/canarygrid-logo.svg"}
        alt=""
        className={compact ? "h-7 w-7" : "h-9 w-auto"}
      />
      {compact && <span className="sr-only">CanaryGrid</span>}
    </span>
  );
}
