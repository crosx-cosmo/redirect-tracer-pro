import { ArrowRightLeft, Clock, Flag, Link, ListOrdered, RefreshCcwDot } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { useCountUp } from "@/hooks/use-count-up";
import { cn } from "@/lib/utils";
import type { RedirectAnalysis } from "@/lib/redirect-types";
import { CopyButton } from "./CopyButton";
import { statusTone } from "./StatusBadge";

type Tone = "neutral" | "success" | "warning" | "error";

const toneText: Record<Tone, string> = {
  neutral: "text-foreground",
  success: "text-success",
  warning: "text-warning-foreground",
  error: "text-destructive",
};

const toneAccent: Record<Tone, string> = {
  neutral: "from-brand/60",
  success: "from-success/70",
  warning: "from-warning/70",
  error: "from-destructive/70",
};

function Shell({
  icon: Icon,
  label,
  tone = "neutral",
  index,
  children,
  action,
}: {
  icon: LucideIcon;
  label: string;
  tone?: Tone;
  index: number;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div
      className="panel panel-hover animate-rise stagger group overflow-hidden p-4"
      style={{ "--stagger": index } as React.CSSProperties}
    >
      <span
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r to-transparent opacity-70",
          toneAccent[tone],
        )}
      />
      <div className="flex items-center gap-2">
        <Icon className="size-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-brand" />
        <span className="truncate text-[10.5px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
          {label}
        </span>
        {action ? (
          <span className="ml-auto shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            {action}
          </span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function Counter({ value, suffix, tone }: { value: number; suffix?: string; tone: Tone }) {
  const animated = useCountUp(value);
  return (
    <p className={cn("mt-2 text-2xl font-semibold tabular-nums tracking-tight", toneText[tone])}>
      {Math.round(animated).toLocaleString()}
      {suffix ? (
        <span className="ml-1 text-sm font-medium text-muted-foreground">{suffix}</span>
      ) : null}
    </p>
  );
}

export function SummaryCards({ result }: { result: RedirectAnalysis }) {
  const raw = result.finalStatus ? statusTone(result.finalStatus) : "neutral";
  const finalTone: Tone =
    raw === "info" || raw === "neutral"
      ? "neutral"
      : raw === "success"
        ? "success"
        : raw === "error"
          ? "error"
          : "warning";

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
      <Shell icon={ListOrdered} label="Total hops" index={0}>
        <Counter value={result.totalHops} tone="neutral" />
      </Shell>
      <Shell icon={ArrowRightLeft} label="Total redirects" index={1}>
        <Counter value={result.totalRedirects} tone="neutral" />
      </Shell>
      <Shell icon={Clock} label="Response time" index={2}>
        <Counter value={result.totalResponseTimeMs} suffix="ms" tone="neutral" />
      </Shell>
      <Shell icon={Flag} label="Final status" tone={finalTone} index={3}>
        <p
          className={cn(
            "mt-2 text-2xl font-semibold tabular-nums tracking-tight",
            toneText[finalTone],
          )}
        >
          {result.finalStatus ?? "—"}
        </p>
      </Shell>
      <Shell
        icon={RefreshCcwDot}
        label="Redirect loop"
        tone={result.redirectLoop ? "error" : "success"}
        index={4}
      >
        <p
          className={cn(
            "mt-2 text-2xl font-semibold tracking-tight",
            result.redirectLoop ? toneText.error : toneText.success,
          )}
        >
          {result.redirectLoop ? "Yes" : "No"}
        </p>
      </Shell>
      <Shell
        icon={Link}
        label="Final URL"
        index={5}
        action={<CopyButton value={result.finalUrl} label="Copy final URL" className="size-6" />}
      >
        <p
          className="mt-2 truncate font-mono text-[13px] font-medium text-foreground"
          title={result.finalUrl}
        >
          {result.finalUrl}
        </p>
      </Shell>
    </div>
  );
}
