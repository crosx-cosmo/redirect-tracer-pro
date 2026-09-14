import { AlertTriangle, CheckCircle2, Info, ShieldAlert } from "lucide-react";
import type { CSSProperties } from "react";

import { cn } from "@/lib/utils";
import type { AnalysisIssue } from "@/lib/redirect-types";

const config = {
  error: {
    icon: ShieldAlert,
    className: "border-destructive/30 bg-destructive/8 text-destructive",
  },
  warning: {
    icon: AlertTriangle,
    className: "border-warning/40 bg-warning/10 text-warning-foreground",
  },
  info: { icon: Info, className: "border-info/30 bg-info/8 text-info" },
} as const;

export function IssueList({ issues }: { issues: AnalysisIssue[] }) {
  if (!issues.length) {
    return (
      <p className="animate-rise flex items-center gap-2 rounded-xl border border-success/30 bg-success/8 px-3 py-2.5 text-sm font-medium text-success">
        <CheckCircle2 className="size-4 shrink-0" />
        No issues detected in this chain.
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {issues.map((issue, i) => {
        const { icon: Icon, className } = config[issue.level];
        return (
          <li
            key={issue.id}
            className={cn(
              "animate-rise stagger-fast flex gap-2.5 rounded-xl border px-3 py-2.5 text-sm transition-colors",
              className,
            )}
            style={{ "--stagger": i } as CSSProperties}
          >
            <Icon className="mt-0.5 size-4 shrink-0" />
            <div className="min-w-0">
              <p className="font-semibold">{issue.title}</p>
              <p className="break-words text-xs opacity-85">{issue.detail}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
