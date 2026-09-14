import {
  ArrowRight,
  CheckCircle2,
  MinusCircle,
  PencilLine,
  PlusCircle,
  TriangleAlert,
} from "lucide-react";
import type { CSSProperties } from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ParamChangeKind, RedirectAnalysis } from "@/lib/redirect-types";

const kindMeta: Record<
  ParamChangeKind,
  { icon: typeof PlusCircle; label: string; className: string }
> = {
  added: { icon: PlusCircle, label: "Added", className: "text-success" },
  removed: { icon: MinusCircle, label: "Removed", className: "text-destructive" },
  modified: { icon: PencilLine, label: "Modified", className: "text-warning-foreground" },
};

function ParamPills({ params, empty }: { params: Record<string, string>; empty: string }) {
  const entries = Object.entries(params);
  if (!entries.length) return <p className="text-xs text-muted-foreground">{empty}</p>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {entries.map(([key, value], i) => (
        <Badge
          key={key}
          variant="secondary"
          className="animate-node stagger-fast max-w-full border border-hairline font-mono text-[10.5px] font-medium"
          style={{ "--stagger": i } as CSSProperties}
        >
          <span className="truncate">
            {key}={value || "∅"}
          </span>
        </Badge>
      ))}
    </div>
  );
}

export function TrackingTab({ result }: { result: RedirectAnalysis }) {
  const { tracking } = result;
  return (
    <div className="space-y-4">
      {tracking.lostTrackingParams.length ? (
        <div className="animate-rise flex gap-2.5 rounded-xl border border-destructive/30 bg-destructive/8 p-3.5 text-sm text-destructive">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <div className="min-w-0">
            <p className="font-semibold">Tracking parameters lost in the chain</p>
            <p className="break-all font-mono text-xs opacity-90">
              {tracking.lostTrackingParams.join(", ")}
            </p>
          </div>
        </div>
      ) : (
        <div className="animate-rise flex items-center gap-2 rounded-xl border border-success/30 bg-success/8 p-3.5 text-sm font-medium text-success">
          <CheckCircle2 className="size-4 shrink-0" />
          All start tracking parameters survived the chain.
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="panel animate-rise stagger p-4" style={{ "--stagger": 1 } as CSSProperties}>
          <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
            Start parameters
          </p>
          <ParamPills params={tracking.startParams} empty="No query parameters on the start URL." />
        </div>
        <div className="panel animate-rise stagger p-4" style={{ "--stagger": 2 } as CSSProperties}>
          <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
            Final parameters
          </p>
          <ParamPills params={tracking.finalParams} empty="No query parameters on the final URL." />
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">Parameter changes per hop</h3>
        {tracking.diffs.length === 0 ? (
          <p className="rounded-xl border border-hairline bg-surface-muted px-3 py-2.5 text-sm text-muted-foreground">
            No query-parameter changes detected between hops.
          </p>
        ) : (
          tracking.diffs.map((diff, i) => (
            <div
              key={`${diff.fromIndex}-${diff.toIndex}`}
              className="panel panel-hover animate-rise stagger p-4"
              style={{ "--stagger": i } as CSSProperties}
            >
              <p className="flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                Hop {diff.fromIndex + 1} <ArrowRight className="size-3" /> Hop {diff.toIndex + 1}
              </p>
              <ul className="mt-2.5 space-y-1.5">
                {diff.changes.map((change) => {
                  const meta = kindMeta[change.kind];
                  const Icon = meta.icon;
                  return (
                    <li key={change.param} className="flex items-start gap-2 text-xs">
                      <Icon className={cn("mt-0.5 size-3.5 shrink-0", meta.className)} />
                      <div className="min-w-0">
                        <p className="font-mono font-semibold text-foreground">
                          {change.param}
                          {change.tracking ? (
                            <Badge
                              variant="outline"
                              className="ml-1.5 border-brand/30 bg-brand/8 text-[9.5px] text-brand"
                            >
                              tracking
                            </Badge>
                          ) : null}
                        </p>
                        <p className="break-all font-mono text-muted-foreground">
                          {change.kind === "added"
                            ? `+ ${change.to}`
                            : change.kind === "removed"
                              ? `− ${change.from}`
                              : `${change.from} → ${change.to}`}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
