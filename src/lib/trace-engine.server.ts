/**
 * Universal redirect + URL trace engine (server-only).
 *
 * Traces a URL through every redirect mechanism it can safely follow:
 *  - HTTP 301/302/303/307/308 (and any 3xx with a Location header)
 *  - HTTP `Refresh` response header
 *  - HTML meta refresh
 *  - JavaScript location navigation found in the returned document
 *  - Computed/dynamic navigation, via an isolated headless-browser fallback
 *
 * Guarantees:
 *  - every destination passes the SSRF guard before a request is made
 *  - hard caps on hops, per-hop time and total analysis time
 *  - loops and dead ends are detected and reported
 *  - when a hop cannot be followed, the exact reason is attached to it
 */
import {
  assemble,
  isRedirect,
  normalizeUrl,
  paramsOf,
  protocolOf,
  redirectTypeLabel,
} from "./redirect-analysis";
import {
  detectClientRedirect,
  extractPageMeta,
  looksLikeRedirector,
  parseRefreshValue,
} from "./trace-detect";
import { assertSafeUrl } from "./trace-ssrf.server";
import { browserFallbackConfigured, traceWithBrowser } from "./trace-browser.server";
import type { HopMechanism, RedirectAnalysis, RedirectHop } from "./redirect-types";

export const MAX_HOPS = 20;
export const PER_HOP_TIMEOUT_MS = 15_000;
export const OVERALL_TIMEOUT_MS = 55_000;
const MAX_BODY_BYTES = 2_000_000;

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 RedirectChainAnalyzer/2.0";

export const MECHANISM_LABEL: Record<HopMechanism, string> = {
  "http-redirect": "HTTP Redirect",
  "javascript-redirect": "JavaScript Redirect",
  "meta-refresh": "Meta Refresh",
  "browser-navigation": "Browser Navigation",
  "final-response": "Final Response",
  blocked: "Blocked",
  unresolved: "Not Followed",
  error: "Request Failed",
};

function headersToObject(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

function canonicalKey(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.toString();
  } catch {
    return url;
  }
}

function resolveAgainst(base: string, target: string): string | null {
  try {
    return new URL(target, base).toString();
  } catch {
    return null;
  }
}

interface HopDraft extends RedirectHop {
  mechanism: HopMechanism;
  mechanismLabel: string;
  mechanismDetail: string | null;
  evidence: string | null;
  nextUrl: string | null;
  blockedReason: string | null;
  addresses: string[];
}

function makeHop(
  partial: Partial<HopDraft> & { index: number; url: string; mechanism: HopMechanism },
): HopDraft {
  return {
    index: partial.index,
    url: partial.url,
    protocol: protocolOf(partial.url),
    status: partial.status ?? 0,
    statusText: partial.statusText ?? "",
    redirectType: partial.redirectType ?? MECHANISM_LABEL[partial.mechanism],
    responseTimeMs: partial.responseTimeMs ?? 0,
    location: partial.location ?? null,
    resolvedLocation: partial.resolvedLocation ?? null,
    server: partial.server ?? null,
    ip: partial.ip ?? null,
    headers: partial.headers ?? {},
    params: paramsOf(partial.url),
    mechanism: partial.mechanism,
    mechanismLabel: MECHANISM_LABEL[partial.mechanism],
    mechanismDetail: partial.mechanismDetail ?? null,
    evidence: partial.evidence ?? null,
    nextUrl: partial.nextUrl ?? null,
    blockedReason: partial.blockedReason ?? null,
    addresses: partial.addresses ?? [],
  };
}

export async function traceUrl(rawUrl: string): Promise<RedirectAnalysis> {
  const startUrl = normalizeUrl(rawUrl);
  const deadline = Date.now() + OVERALL_TIMEOUT_MS;
  const hops: HopDraft[] = [];
  const seen = new Set<string>();

  let current = startUrl;
  let redirectLoop = false;
  let truncated = false;
  let error: string | null = null;
  let terminationReason = "final-response";
  let terminationDetail: string | null = null;
  let finalDestinationConfirmed = true;
  let browserFallbackUsed = false;
  let browserFallbackNote: string | null = null;
  let page: { canonical: string | null; metaRobots: string | null } = {
    canonical: null,
    metaRobots: null,
  };

  try {
    new URL(startUrl);
  } catch {
    return finish({
      startUrl: rawUrl,
      hops,
      redirectLoop: false,
      truncated: false,
      page,
      error: "That does not look like a valid URL.",
      terminationReason: "invalid-url",
      terminationDetail: "The value entered could not be parsed as a URL.",
      finalDestinationConfirmed: false,
      browserFallbackUsed,
      browserFallbackNote,
    });
  }

  for (let i = 0; i < MAX_HOPS; i += 1) {
    const remaining = deadline - Date.now();
    if (remaining <= 1000) {
      terminationReason = "timeout";
      terminationDetail = `The overall analysis budget of ${Math.round(OVERALL_TIMEOUT_MS / 1000)}s was reached before the chain ended.`;
      finalDestinationConfirmed = false;
      break;
    }

    const key = canonicalKey(current);
    if (seen.has(key)) {
      redirectLoop = true;
      terminationReason = "loop";
      terminationDetail = `The chain returned to ${current}, which was already visited.`;
      finalDestinationConfirmed = false;
      break;
    }
    seen.add(key);

    // --- Safety gate: every destination is validated before it is requested.
    const verdict = await assertSafeUrl(current, Math.min(5000, remaining));
    if (!verdict.ok) {
      hops.push(
        makeHop({
          index: i,
          url: current,
          mechanism: "blocked",
          blockedReason: verdict.reason,
          mechanismDetail: verdict.reason,
          redirectType: "Blocked destination",
        }),
      );
      terminationReason = "blocked";
      terminationDetail = verdict.reason;
      finalDestinationConfirmed = false;
      break;
    }

    const hopTimeout = Math.min(PER_HOP_TIMEOUT_MS, deadline - Date.now());
    const started = Date.now();
    let response: Response;
    try {
      response = await fetch(current, {
        method: "GET",
        redirect: "manual",
        headers: {
          "user-agent": USER_AGENT,
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "en-US,en;q=0.9",
        },
        signal: AbortSignal.timeout(Math.max(1000, hopTimeout)),
      });
    } catch (e) {
      const message =
        e instanceof Error && e.name === "TimeoutError"
          ? `No response within ${Math.round(hopTimeout / 1000)}s (per-hop timeout).`
          : e instanceof Error
            ? e.message
            : "Request failed.";
      hops.push(
        makeHop({
          index: i,
          url: current,
          mechanism: "error",
          responseTimeMs: Date.now() - started,
          blockedReason: message,
          mechanismDetail: message,
          redirectType: "Request failed",
          addresses: verdict.addresses,
        }),
      );
      error = message;
      terminationReason = "request-failed";
      terminationDetail = message;
      finalDestinationConfirmed = false;
      break;
    }

    const responseTimeMs = Date.now() - started;
    const headers = headersToObject(response.headers);
    const base = {
      index: i,
      url: current,
      status: response.status,
      statusText: response.statusText || "",
      responseTimeMs,
      headers,
      server: response.headers.get("server"),
      ip:
        response.headers.get("x-served-by") ??
        response.headers.get("x-amz-cf-pop") ??
        response.headers.get("cf-ray") ??
        verdict.addresses[0] ??
        null,
      addresses: verdict.addresses,
    };

    // --- 1. HTTP Location redirect
    const location = response.headers.get("location");
    if (isRedirect(response.status)) {
      const resolved = location ? resolveAgainst(current, location) : null;
      hops.push(
        makeHop({
          ...base,
          mechanism: "http-redirect",
          redirectType: redirectTypeLabel(response.status),
          location,
          resolvedLocation: resolved,
          nextUrl: resolved,
          mechanismDetail: `${response.status} ${redirectTypeLabel(response.status)}`,
          blockedReason: resolved
            ? null
            : location
              ? `The Location header "${location}" is not a valid URL.`
              : "This redirect has no Location header (dead end).",
        }),
      );
      await response.body?.cancel().catch(() => {});
      if (!resolved) {
        terminationReason = "dead-end";
        terminationDetail = hops[hops.length - 1]!.blockedReason;
        finalDestinationConfirmed = false;
        break;
      }
      current = resolved;
      if (i === MAX_HOPS - 1) {
        truncated = true;
        terminationReason = "max-hops";
        terminationDetail = `Stopped after the maximum of ${MAX_HOPS} hops.`;
        finalDestinationConfirmed = false;
      }
      continue;
    }

    // --- 2. HTTP Refresh header (non-3xx client-side redirect)
    const refreshHeader = response.headers.get("refresh");
    const refresh = refreshHeader ? parseRefreshValue(refreshHeader) : null;
    if (refresh?.url) {
      const resolved = resolveAgainst(current, refresh.url);
      hops.push(
        makeHop({
          ...base,
          mechanism: "meta-refresh",
          redirectType: "Refresh header",
          location: refresh.url,
          resolvedLocation: resolved,
          nextUrl: resolved,
          mechanismDetail: `HTTP Refresh header (${refresh.delay}s)`,
          evidence: refreshHeader,
          blockedReason: resolved ? null : `Refresh target "${refresh.url}" is not a valid URL.`,
        }),
      );
      await response.body?.cancel().catch(() => {});
      if (!resolved) {
        terminationReason = "dead-end";
        finalDestinationConfirmed = false;
        break;
      }
      current = resolved;
      continue;
    }

    // --- 3. Inspect the body for client-side navigation
    const contentType = response.headers.get("content-type") ?? "";
    const contentLength = Number(response.headers.get("content-length") ?? "0");
    let html = "";
    if (contentType.includes("html") && contentLength <= MAX_BODY_BYTES) {
      try {
        html = (await response.text()).slice(0, 500_000);
      } catch {
        html = "";
      }
    } else {
      await response.body?.cancel().catch(() => {});
    }

    if (html) {
      const meta = extractPageMeta(html);
      page = { canonical: meta.canonical, metaRobots: meta.metaRobots };
    }

    const detection = html ? detectClientRedirect(html) : { signal: null, hint: null };

    if (detection.signal) {
      const resolved = resolveAgainst(current, detection.signal.rawTarget);
      const mechanism: HopMechanism =
        detection.signal.kind === "meta-refresh" ? "meta-refresh" : "javascript-redirect";
      hops.push(
        makeHop({
          ...base,
          mechanism,
          redirectType: MECHANISM_LABEL[mechanism],
          location: detection.signal.rawTarget,
          resolvedLocation: resolved,
          nextUrl: resolved,
          mechanismDetail: `${response.status} response containing ${detection.signal.method}`,
          evidence: detection.signal.evidence,
          blockedReason: resolved
            ? null
            : `The detected destination "${detection.signal.rawTarget}" is not a valid URL.`,
        }),
      );
      if (!resolved) {
        terminationReason = "dead-end";
        terminationDetail = `A ${detection.signal.method} navigation was found but its destination could not be resolved.`;
        finalDestinationConfirmed = false;
        break;
      }
      current = resolved;
      if (i === MAX_HOPS - 1) {
        truncated = true;
        terminationReason = "max-hops";
        finalDestinationConfirmed = false;
      }
      continue;
    }

    if (detection.hint && looksLikeRedirector(html)) {
      // Dynamic navigation: only a real browser can resolve it.
      const browserBudget = Math.min(30_000, deadline - Date.now());
      const rendered =
        browserBudget > 5000
          ? await traceWithBrowser(current, browserBudget)
          : {
              ok: false as const,
              reason: "Not enough time left in the analysis budget to run the headless browser.",
              finalUrl: null,
              navigations: [],
              elapsedMs: 0,
            };

      if (
        rendered.ok &&
        rendered.finalUrl &&
        canonicalKey(rendered.finalUrl) !== canonicalKey(current)
      ) {
        browserFallbackUsed = true;
        hops.push(
          makeHop({
            ...base,
            mechanism: "browser-navigation",
            redirectType: "Browser Navigation",
            location: rendered.finalUrl,
            resolvedLocation: rendered.finalUrl,
            nextUrl: rendered.finalUrl,
            mechanismDetail: `${detection.hint.method}, resolved in an isolated headless browser (${rendered.elapsedMs} ms)`,
            evidence: detection.hint.evidence,
          }),
        );
        current = rendered.finalUrl;
        continue;
      }

      const reason = rendered.ok
        ? "The isolated browser loaded the page without navigating anywhere else, so this is treated as the final destination."
        : rendered.reason;
      if (!rendered.ok) {
        browserFallbackNote = reason;
        finalDestinationConfirmed = false;
        terminationReason = browserFallbackConfigured() ? "browser-failed" : "browser-unavailable";
        terminationDetail = reason;
      }
      hops.push(
        makeHop({
          ...base,
          mechanism: rendered.ok ? "final-response" : "unresolved",
          redirectType: rendered.ok ? "Final Response" : "Client-side redirect not followed",
          mechanismDetail: `Page contains ${detection.hint.method}`,
          evidence: detection.hint.evidence,
          blockedReason: rendered.ok ? null : reason,
        }),
      );
      break;
    }

    // --- 4. Genuine final response
    hops.push(
      makeHop({
        ...base,
        mechanism: response.status >= 400 ? "error" : "final-response",
        redirectType: redirectTypeLabel(response.status),
        mechanismDetail:
          response.status >= 400
            ? `${response.status} ${redirectTypeLabel(response.status)} — chain ends with an error response`
            : "No further redirect found (HTTP, meta refresh or JavaScript).",
      }),
    );
    if (response.status >= 400) {
      terminationReason = "error-response";
      terminationDetail = `The chain ends on a ${response.status} response.`;
      finalDestinationConfirmed = false;
    }
    break;
  }

  return finish({
    startUrl,
    hops,
    redirectLoop,
    truncated,
    page,
    error,
    terminationReason,
    terminationDetail,
    finalDestinationConfirmed,
    browserFallbackUsed,
    browserFallbackNote,
  });
}

function finish(input: {
  startUrl: string;
  hops: RedirectHop[];
  redirectLoop: boolean;
  truncated: boolean;
  page: { canonical: string | null; metaRobots: string | null };
  error: string | null;
  terminationReason: string;
  terminationDetail: string | null;
  finalDestinationConfirmed: boolean;
  browserFallbackUsed: boolean;
  browserFallbackNote: string | null;
}): RedirectAnalysis {
  const analysis = assemble({
    startUrl: input.startUrl,
    hops: input.hops,
    redirectLoop: input.redirectLoop,
    truncated: input.truncated,
    page: input.page,
    source: "live",
    error: input.error,
  });
  return {
    ...analysis,
    terminationReason: input.terminationReason,
    terminationDetail: input.terminationDetail,
    finalDestinationConfirmed: input.finalDestinationConfirmed,
    browserFallbackUsed: input.browserFallbackUsed,
    browserFallbackNote: input.browserFallbackNote,
  };
}
