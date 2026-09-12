import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, FileSearch } from "lucide-react";

import { CROSX_LOGO_URL } from "@/lib/brand";
import { ReportView } from "@/components/analyzer/ReportView";
import { ErrorState, LoadingState } from "@/components/analyzer/States";
import { InstallAppButton } from "@/components/InstallAppButton";
import { ThemeToggle } from "@/components/ThemeToggle";
import { loadSharedAnalysis } from "@/lib/analysis-store";

const TITLE = "Shared Redirect Report — Redirect Chain Analyzer";
const DESCRIPTION =
  "Open a saved redirect chain report: every hop, status code, response header, SEO signal and tracking parameter diff.";

export const Route = createFileRoute("/r/$id")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SharedReportPage,
});

function SharedReportPage() {
  const { id } = Route.useParams();
  const query = useQuery({
    queryKey: ["shared-analysis", id],
    queryFn: () => loadSharedAnalysis(id),
    retry: false,
  });

  return (
    <div className="bg-hero min-h-screen">
      <header className="app-safe-top sticky top-0 z-30 border-b border-hairline bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3 sm:gap-4 sm:px-6">

          <Link to="/" aria-label="CROSX home" className="flex shrink-0 items-center">
            <img
              src={CROSX_LOGO_URL}
              alt="CROSX Advertising & Marketing Agency"
              decoding="async"
              loading="eager"
              className="h-6 w-auto max-w-[130px] object-contain object-left sm:h-7 sm:max-w-[160px]"
            />
          </Link>
          <span aria-hidden="true" className="h-6 w-px shrink-0 bg-hairline" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[14.5px] font-semibold leading-tight tracking-tight text-foreground sm:text-[15.5px]">
              Shared report
            </h1>
            <p className="hidden truncate text-[11px] leading-tight text-muted-foreground sm:block">
              Saved redirect chain, headers and tracking diffs
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <InstallAppButton />
            <ThemeToggle />
          </div>

        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-5 px-4 py-7 sm:px-6 sm:py-10">
        <Link
          to="/"
          className="press inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface/80 px-3 py-1.5 text-[11.5px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Analyze a new URL
        </Link>

        {query.isPending ? <LoadingState /> : null}

        {query.isError ? (
          <ErrorState message={(query.error as Error)?.message ?? "Could not load this report"} />
        ) : null}

        {!query.isPending && !query.isError && !query.data ? (
          <section className="animate-reveal rounded-2xl border border-dashed border-hairline bg-surface/70 p-8 text-center">
            <div className="mx-auto grid size-12 place-items-center rounded-xl bg-brand-gradient shadow-glow">
              <FileSearch className="size-6 text-brand-foreground" />
            </div>
            <h2 className="mt-4 text-base font-semibold text-foreground">Report not found</h2>
            <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-muted-foreground">
              This link is invalid or the saved report is no longer available.
            </p>
          </section>
        ) : null}

        {query.data ? <ReportView result={query.data} shareId={id} /> : null}
      </main>
    </div>
  );
}
