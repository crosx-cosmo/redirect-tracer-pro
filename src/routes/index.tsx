import { useMutation } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Activity, Braces, ShieldCheck } from "lucide-react";

import { CROSX_LOGO_URL } from "@/lib/brand";
import { useState } from "react";
import { toast } from "sonner";

import { ExportBar } from "@/components/analyzer/ExportBar";
import { ReportView } from "@/components/analyzer/ReportView";
import { EmptyState, ErrorState, LoadingState } from "@/components/analyzer/States";
import { UrlInputPanel } from "@/components/analyzer/UrlInputPanel";
import { InstallAppButton } from "@/components/InstallAppButton";
import { ThemeToggle } from "@/components/ThemeToggle";

import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { analysisKey, type ShareIdMap } from "@/lib/analysis-store";
import { activeBackend, analyzeUrls, demoAnalysis } from "@/lib/redirect-service";
import type { RedirectAnalysis } from "@/lib/redirect-types";

const TITLE = "Redirect & URL Trace Engine — Every Hop, HTTP or JavaScript";
const DESCRIPTION =
  "Trace any URL end to end: HTTP 301/302/307/308 redirects, meta refresh, JavaScript navigation, cloaked affiliate hops, loops, dead ends and tracking parameter loss.";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://redirect-tracer-pro.lovable.app/" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "https://redirect-tracer-pro.lovable.app/" }],
  }),

  component: AnalyzerPage,
});

function AnalyzerPage() {
  const [results, setResults] = useState<RedirectAnalysis[]>([]);
  const [shareIds, setShareIds] = useState<ShareIdMap>({});

  const mutation = useMutation({
    mutationFn: (urls: string[]) => analyzeUrls(urls),
    onSuccess: ({ results: data, shareIds: ids }) => {
      setResults(data);
      setShareIds(ids);
      toast.success(`Analyzed ${data.length} URL${data.length === 1 ? "" : "s"}`);
    },
    onError: (error: Error) => toast.error(error.message || "Analysis failed"),
  });

  return (
    <div className="bg-hero min-h-screen">
      <header className="app-safe-top sticky top-0 z-30 border-b border-hairline bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3 sm:gap-4 sm:px-6">

          <a href="/" aria-label="CROSX home" className="flex shrink-0 items-center">
            <img
              src={CROSX_LOGO_URL}
              alt="CROSX Advertising & Marketing Agency"
              decoding="async"
              loading="eager"
              className="h-6 w-auto max-w-[130px] object-contain object-left sm:h-7 sm:max-w-[160px]"
            />
          </a>
          <span aria-hidden="true" className="h-6 w-px shrink-0 bg-hairline" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[14.5px] font-semibold leading-tight tracking-tight text-foreground sm:text-[15.5px]">
              Redirect Chain Analyzer
            </h1>
            <p className="hidden truncate text-[11px] leading-tight text-muted-foreground sm:block">
              Universal redirect + URL tracing for SEO and affiliate links
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge
                  variant="outline"
                  className="hidden gap-1.5 border-hairline bg-surface/80 py-1 font-medium text-muted-foreground sm:flex"
                >
                  <ShieldCheck className="size-3 text-success" />
                  {activeBackend() === "external" ? "External API" : "Live server tracing"}
                </Badge>
              </TooltipTrigger>
              <TooltipContent>Requests are performed server-side, never in the browser</TooltipContent>
            </Tooltip>
            <Button asChild variant="subtle" size="sm">
              <a href="/api-docs">
                <Braces className="size-3.5" />
                <span className="hidden sm:inline">API</span>
              </a>
            </Button>
            <InstallAppButton />
            <ThemeToggle />

          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-5 px-4 py-7 sm:px-6 sm:py-10">
        <section className="animate-reveal">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface/80 px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-[0.09em] text-muted-foreground shadow-soft">
            <span className="size-1.5 rounded-full bg-success" />
            Redirect forensics
          </span>
          <h2 className="mt-3 text-[26px] font-semibold leading-[1.12] tracking-tight text-foreground sm:text-4xl">
            Trace every hop{" "}
            <span className="text-gradient-brand">before it costs you a conversion</span>
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-[15px]">
            Real requests run server-side and follow every mechanism: HTTP redirects, meta refresh,
            JavaScript navigation and cloaked affiliate hops — with status codes, timings, headers,
            protocol changes and query-parameter diffs for each hop.
          </p>
        </section>

        <UrlInputPanel
          loading={mutation.isPending}
          onAnalyze={(urls) => mutation.mutate(urls)}
          onClear={() => {
            setResults([]);
            setShareIds({});
            mutation.reset();
          }}
          onDemo={() => {
            mutation.reset();
            setShareIds({});
            setResults(demoAnalysis());
            toast.message("Demo data loaded", {
              description: "Illustrative chain, not a live request.",
            });
          }}
        />

        {mutation.isPending ? <LoadingState /> : null}

        {!mutation.isPending && mutation.isError ? (
          <ErrorState message={(mutation.error as Error)?.message ?? "Unknown error"} />
        ) : null}

        {!mutation.isPending && !mutation.isError && results.length === 0 ? <EmptyState /> : null}

        {!mutation.isPending && results.length > 1 ? (
          <div className="panel animate-rise grid grid-cols-1 items-center gap-3 p-3 sm:flex sm:justify-between">
            <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
              <Activity className="size-4 shrink-0 text-brand" />
              {results.length} chains analyzed
            </span>
            <ExportBar results={results} />
          </div>
        ) : null}

        {!mutation.isPending
          ? results.map((result) => (
              <ReportView
                key={`${result.startUrl}-${result.analyzedAt}`}
                result={result}
                shareId={shareIds[analysisKey(result)]}
              />
            ))
          : null}

        <footer className="border-t border-hairline pt-4 text-center font-mono text-[11px] text-muted-foreground">
          Requests run server-side behind SSRF protection, with a 20-hop limit, a 15 s per-hop timeout and a 55 s overall budget. Hops that cannot be safely followed are reported with the exact reason.
        </footer>
      </main>
    </div>
  );
}
