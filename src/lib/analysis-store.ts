/**
 * Persists completed analyses to Supabase (public, anonymous — no login).
 *
 * Saving must never break or delay the analyzer UI, so failures are only
 * logged. When a save succeeds, the returned ids power shareable links.
 */
import { supabase } from "./supabase";
import type { RedirectAnalysis } from "./redirect-types";

/** Stable key for an analysis result, used to match it to its saved row. */
export function analysisKey(result: RedirectAnalysis): string {
  return `${result.startUrl}@${result.analyzedAt}`;
}

/** Map of analysisKey -> saved row id. */
export type ShareIdMap = Record<string, string>;

export async function saveAnalyses(results: RedirectAnalysis[]): Promise<ShareIdMap> {
  const savable = results.filter((r) => r.source === "live");
  if (!savable.length) return {};

  const rows = savable.map((r) => ({
    start_url: r.startUrl,
    final_url: r.finalUrl,
    final_status: r.finalStatus,
    total_hops: r.totalHops,
    total_redirects: r.totalRedirects,
    total_response_time_ms: Math.round(r.totalResponseTimeMs),
    redirect_loop: r.redirectLoop,
    issue_count: r.issues.length,
    result: r,
  }));

  const { data, error } = await supabase.from("redirect_analyses").insert(rows).select("id");
  if (error) {
    console.warn("[analysis-store] save failed:", error.message);
    return {};
  }

  const map: ShareIdMap = {};
  (data ?? []).forEach((row, i) => {
    const source = savable[i];
    if (source && row?.id) map[analysisKey(source)] = String(row.id);
  });
  return map;
}

export function saveAnalysesInBackground(results: RedirectAnalysis[]): void {
  void saveAnalyses(results).catch((err) => console.warn("[analysis-store] save failed:", err));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Loads one saved analysis by its share id. */
export async function loadSharedAnalysis(id: string): Promise<RedirectAnalysis | null> {
  // A malformed id is simply "not found" — never a hard error for the reader.
  if (!UUID_RE.test(id)) return null;

  const { data, error } = await supabase
    .from("redirect_analyses")
    .select("result")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.result as RedirectAnalysis | undefined) ?? null;
}
