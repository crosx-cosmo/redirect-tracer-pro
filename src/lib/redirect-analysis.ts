import type {
  AnalysisIssue,
  HopParamDiff,
  ParamChange,
  RedirectAnalysis,
  RedirectHop,
  SeoInfo,
  TrackingReport,
} from "./redirect-types";

export const MAX_HOPS = 20;
export const SLOW_HOP_MS = 1500;

const TRACKING_PARAMS = new Set([
  "click_id",
  "clickid",
  "aff_id",
  "affid",
  "affiliate_id",
  "offer_id",
  "transaction_id",
  "gclid",
  "fbclid",
  "msclkid",
  ...Array.from({ length: 10 }, (_, i) => `sub${i + 1}`),
]);

export function isTrackingParam(name: string): boolean {
  const key = name.toLowerCase();
  return TRACKING_PARAMS.has(key) || key.startsWith("utm_");
}

export function redirectTypeLabel(status: number): string {
  switch (status) {
    case 301:
      return "Permanent Redirect";
    case 302:
      return "Found (Temporary)";
    case 303:
      return "See Other";
    case 307:
      return "Temporary Redirect";
    case 308:
      return "Permanent Redirect";
    default:
      if (status >= 300 && status < 400) return "Redirect";
      if (status >= 200 && status < 300) return "Success";
      if (status >= 400 && status < 500) return "Client Error";
      if (status >= 500) return "Server Error";
      return "Unknown";
  }
}

export function isRedirect(status: number): boolean {
  return status >= 300 && status < 400;
}

/** Mechanisms that move the chain forward, whatever the status code was. */
const REDIRECTING_MECHANISMS = new Set([
  "http-redirect",
  "javascript-redirect",
  "meta-refresh",
  "browser-navigation",
]);

/** True when this hop hands off to another URL (HTTP or client-side). */
export function hopRedirects(hop: RedirectHop): boolean {
  if (hop.mechanism) return REDIRECTING_MECHANISMS.has(hop.mechanism);
  return isRedirect(hop.status);
}

export function countRedirects(hops: RedirectHop[]): number {
  return hops.filter(hopRedirects).length;
}

export function protocolOf(url: string): "http" | "https" | "other" {
  if (url.startsWith("https:")) return "https";
  if (url.startsWith("http:")) return "http";
  return "other";
}

export function paramsOf(url: string): Record<string, string> {
  try {
    const out: Record<string, string> = {};
    new URL(url).searchParams.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  } catch {
    return {};
  }
}

export function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export function diffParams(from: RedirectHop, to: RedirectHop): HopParamDiff {
  const changes: ParamChange[] = [];
  const keys = new Set([...Object.keys(from.params), ...Object.keys(to.params)]);
  for (const key of Array.from(keys).sort()) {
    const before = from.params[key] ?? null;
    const after = to.params[key] ?? null;
    if (before === after) continue;
    const kind = before === null ? "added" : after === null ? "removed" : "modified";
    changes.push({ param: key, kind, from: before, to: after, tracking: isTrackingParam(key) });
  }
  return {
    fromIndex: from.index,
    toIndex: to.index,
    fromUrl: from.url,
    toUrl: to.url,
    changes,
  };
}

export function buildTrackingReport(hops: RedirectHop[]): TrackingReport {
  const diffs: HopParamDiff[] = [];
  for (let i = 1; i < hops.length; i += 1) {
    const diff = diffParams(hops[i - 1]!, hops[i]!);
    if (diff.changes.length) diffs.push(diff);
  }
  const startParams = hops[0]?.params ?? {};
  const finalParams = hops[hops.length - 1]?.params ?? {};
  const startTracking = Object.keys(startParams).filter(isTrackingParam);
  const lostTrackingParams = startTracking.filter((k) => !(k in finalParams));
  const keptTrackingParams = startTracking.filter((k) => k in finalParams);
  return { diffs, startParams, finalParams, lostTrackingParams, keptTrackingParams };
}

export function buildIssues(
  hops: RedirectHop[],
  opts: {
    redirectLoop: boolean;
    truncated: boolean;
    tracking: TrackingReport;
    error?: string | null;
  },
): AnalysisIssue[] {
  const issues: AnalysisIssue[] = [];
  const push = (i: AnalysisIssue) => issues.push(i);

  if (opts.error) {
    push({ id: "request-failed", level: "error", title: "Request failed", detail: opts.error });
  }
  if (opts.redirectLoop) {
    push({
      id: "loop",
      level: "error",
      title: "Redirect loop detected",
      detail: "A URL in this chain redirects back to a URL already visited.",
    });
  }
  if (opts.truncated) {
    push({
      id: "too-many",
      level: "error",
      title: "Too many redirects",
      detail: `The chain exceeded the limit of ${MAX_HOPS} hops.`,
    });
  }

  hops.forEach((hop) => {
    if (hop.mechanism === "blocked") {
      push({
        id: `blocked-${hop.index}`,
        level: "error",
        title: "Destination blocked for safety",
        detail:
          hop.blockedReason ?? "This destination failed the safety check and was not requested.",
        hopIndex: hop.index,
      });
    }
    if (hop.mechanism === "unresolved") {
      push({
        id: `unresolved-${hop.index}`,
        level: "warning",
        title: "Client-side redirect could not be followed",
        detail:
          hop.blockedReason ??
          "A navigation was detected but its destination could not be resolved.",
        hopIndex: hop.index,
      });
    }
    if (hop.mechanism === "javascript-redirect" || hop.mechanism === "meta-refresh") {
      push({
        id: `client-redirect-${hop.index}`,
        level: "info",
        title:
          hop.mechanism === "meta-refresh"
            ? "Meta refresh redirect"
            : "JavaScript redirect inside a 200 response",
        detail: `${hop.url} → ${hop.nextUrl ?? "unknown"}${hop.mechanismDetail ? ` (${hop.mechanismDetail})` : ""}`,
        hopIndex: hop.index,
      });
    }
    if (hop.mechanism === "browser-navigation") {
      push({
        id: `browser-nav-${hop.index}`,
        level: "info",
        title: "Resolved with a headless browser",
        detail: `${hop.url} navigated to ${hop.nextUrl ?? "unknown"} only after scripts ran.`,
        hopIndex: hop.index,
      });
    }

    if (isRedirect(hop.status) && !hop.location) {
      push({
        id: `missing-location-${hop.index}`,
        level: "error",
        title: "Missing Location header",
        detail: `Hop ${hop.index + 1} returned ${hop.status} without a Location header (broken redirect).`,
        hopIndex: hop.index,
      });
    }
    if (hop.status >= 500) {
      push({
        id: `server-error-${hop.index}`,
        level: "error",
        title: `${hop.status} server error`,
        detail: `${hop.url} responded with ${hop.status} ${hop.statusText}.`,
        hopIndex: hop.index,
      });
    } else if (hop.status >= 400) {
      push({
        id: `client-error-${hop.index}`,
        level: "error",
        title: `${hop.status} client error`,
        detail: `${hop.url} responded with ${hop.status} ${hop.statusText}.`,
        hopIndex: hop.index,
      });
    }
    if (hop.responseTimeMs > SLOW_HOP_MS) {
      push({
        id: `slow-${hop.index}`,
        level: "warning",
        title: "Slow redirect",
        detail: `Hop ${hop.index + 1} took ${hop.responseTimeMs} ms.`,
        hopIndex: hop.index,
      });
    }
    if (isRedirect(hop.status)) {
      push({
        id: `status-${hop.index}`,
        level: "info",
        title: `${hop.status} ${redirectTypeLabel(hop.status)}`,
        detail: `${hop.url} → ${hop.resolvedLocation ?? hop.location ?? "unknown"}`,
        hopIndex: hop.index,
      });
    }
    const next = hops[hop.index + 1];
    if (next) {
      if (hop.protocol === "http" && next.protocol === "https") {
        push({
          id: `upgrade-${hop.index}`,
          level: "info",
          title: "HTTP → HTTPS upgrade",
          detail: `Hop ${hop.index + 1} upgrades the connection to HTTPS.`,
          hopIndex: hop.index,
        });
      }
      if (hop.protocol === "https" && next.protocol === "http") {
        push({
          id: `downgrade-${hop.index}`,
          level: "error",
          title: "HTTPS → HTTP downgrade",
          detail: `Hop ${hop.index + 1} drops from HTTPS to insecure HTTP.`,
          hopIndex: hop.index,
        });
      }
    }
  });

  const redirects = countRedirects(hops);
  if (redirects >= 3 && !opts.truncated) {
    push({
      id: "long-chain",
      level: "warning",
      title: "Long redirect chain",
      detail: `${redirects} redirects before the final response. Aim for one hop maximum.`,
    });
  }

  if (opts.tracking.lostTrackingParams.length) {
    push({
      id: "tracking-lost",
      level: "warning",
      title: "Tracking parameters lost",
      detail: `Dropped during the chain: ${opts.tracking.lostTrackingParams.join(", ")}.`,
    });
  }

  return issues;
}

export function buildSeo(
  hops: RedirectHop[],
  page: { canonical: string | null; metaRobots: string | null },
): SeoInfo {
  const final = hops[hops.length - 1];
  return {
    finalStatus: final?.status ?? null,
    https: final ? final.protocol === "https" : false,
    canonical: page.canonical,
    metaRobots: page.metaRobots,
    chainLength: countRedirects(hops),
  };
}

export function assemble(params: {
  startUrl: string;
  hops: RedirectHop[];
  redirectLoop: boolean;
  truncated: boolean;
  page: { canonical: string | null; metaRobots: string | null };
  source: "live" | "demo";
  error?: string | null;
}): RedirectAnalysis {
  const { hops } = params;
  const tracking = buildTrackingReport(hops);
  const final = hops[hops.length - 1];
  return {
    startUrl: params.startUrl,
    hops,
    finalUrl: final?.url ?? params.startUrl,
    finalStatus: final?.status ?? null,
    totalHops: hops.length,
    totalRedirects: countRedirects(hops),
    totalResponseTimeMs: hops.reduce((sum, h) => sum + h.responseTimeMs, 0),
    redirectLoop: params.redirectLoop,
    seo: buildSeo(hops, params.page),
    issues: buildIssues(hops, {
      redirectLoop: params.redirectLoop,
      truncated: params.truncated,
      tracking,
      error: params.error ?? null,
    }),
    tracking,
    source: params.source,
    analyzedAt: new Date().toISOString(),
    error: params.error ?? null,
  };
}
