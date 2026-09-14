import { Radar, RotateCcw, ServerCrash, Sparkles } from "lucide-react";
import type { CSSProperties } from "react";

import { Skeleton } from "@/components/ui/skeleton";

export function LoadingState() {
  return (
    <section className="panel animate-reveal space-y-4 overflow-hidden p-4 sm:p-6">
      <div className="flex items-center gap-2.5 text-sm font-medium text-muted-foreground">
        <span className="animate-pulse-ring grid size-7 place-items-center rounded-full bg-brand/12">
          <Radar className="size-4 animate-spin text-brand" />
        </span>
        Following the redirect chain…
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="animate-rise stagger-fast relative overflow-hidden rounded-xl border border-hairline bg-surface-muted p-4"
            style={{ "--stagger": i } as CSSProperties}
          >
            <Skeleton className="h-3 w-20 rounded-full" />
            <Skeleton className="mt-3 h-6 w-14 rounded-md" />
            <span className="animate-shimmer absolute inset-0" />
          </div>
        ))}
      </div>
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="animate-rise stagger relative h-28 overflow-hidden rounded-xl border border-hairline bg-surface-muted"
            style={{ "--stagger": i } as CSSProperties}
          >
            <span className="animate-shimmer absolute inset-0" />
          </div>
        ))}
      </div>
    </section>
  );
}

export function EmptyState() {
  return (
    <section className="animate-reveal relative overflow-hidden rounded-2xl border border-dashed border-hairline bg-surface/70 p-8 text-center">
      <div className="relative">
        <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-brand-gradient shadow-glow">
          <Radar className="size-6 text-brand-foreground" />
        </div>
        <h2 className="mt-4 text-base font-semibold text-foreground">No analysis yet</h2>
        <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-muted-foreground">
          Paste a URL above to trace every hop, status code, timing and tracking parameter in the
          redirect chain — or load demo data to explore the interface.
        </p>
        <p className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface px-3 py-1 text-[11px] font-medium text-muted-foreground">
          <Sparkles className="size-3 text-brand" />
          Real requests run server-side
        </p>
      </div>
    </section>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <section className="animate-reveal rounded-2xl border border-destructive/30 bg-destructive/8 p-6 text-center">
      <div className="mx-auto grid size-11 place-items-center rounded-xl border border-destructive/25 bg-destructive/10">
        <ServerCrash className="size-5 text-destructive" />
      </div>
      <h2 className="mt-3 text-base font-semibold text-destructive">Analysis failed</h2>
      <p className="mx-auto mt-1.5 max-w-md break-words text-sm text-destructive/85">{message}</p>
      <p className="mt-3 inline-flex items-center gap-1.5 text-[11px] font-medium text-destructive/70">
        <RotateCcw className="size-3" />
        Check the URL and try again
      </p>
    </section>
  );
}
