/**
 * Client-side redirect detection.
 *
 * Parses an HTML document (as text — nothing is executed here) and reports the
 * first navigation instruction it contains: a meta refresh, an HTTP `Refresh`
 * header equivalent, or a JavaScript location assignment. Detection is
 * deliberately conservative: a candidate is only reported when a concrete
 * destination URL can be extracted from it.
 */

export type ClientRedirectKind = "meta-refresh" | "javascript-redirect";

export interface ClientRedirectSignal {
  kind: ClientRedirectKind;
  /** e.g. "location.replace()", "meta refresh (0s)" */
  method: string;
  /** Raw source fragment the destination was taken from. */
  evidence: string;
  /** Destination exactly as written in the document (may be relative). */
  rawTarget: string;
  delaySeconds: number | null;
}

/** Signal that a page looks like it navigates but no static URL could be read. */
export interface DynamicRedirectHint {
  method: string;
  evidence: string;
}

function clean(value: string): string {
  return value
    .trim()
    .replace(/^["'`]|["'`]$/g, "")
    .trim();
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#38;/g, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'");
}

function snippet(value: string, max = 160): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

export function parseRefreshValue(content: string): { url: string; delay: number } | null {
  const match = content.match(/^\s*([\d.]+)?\s*;?\s*url\s*=\s*(.+)$/i);
  if (match?.[2]) {
    return { url: decodeEntities(clean(match[2])), delay: Number(match[1] ?? 0) || 0 };
  }
  // "Refresh: 0; https://example.com" (no url= key)
  const loose = content.match(/^\s*([\d.]+)\s*;\s*(\S+)\s*$/);
  if (loose?.[2]) return { url: decodeEntities(clean(loose[2])), delay: Number(loose[1]) || 0 };
  return null;
}

/** Base64 payloads such as `location.href = atob("aHR0cHM6...")`. */
function decodeAtob(html: string): ClientRedirectSignal | null {
  const re = /atob\(\s*["'`]([A-Za-z0-9+/=]{12,})["'`]\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    const encoded = match[1]!;
    let decoded = "";
    try {
      decoded = atob(encoded);
    } catch {
      continue;
    }
    if (/^https?:\/\/\S+$/i.test(decoded.trim())) {
      const around = html.slice(
        Math.max(0, match.index - 160),
        match.index + match[0].length + 160,
      );
      if (!/location|href|replace|assign|open/i.test(around)) continue;
      return {
        kind: "javascript-redirect",
        method: "obfuscated location assignment (base64)",
        evidence: snippet(around),
        rawTarget: decoded.trim(),
        delaySeconds: null,
      };
    }
  }
  return null;
}

const JS_PATTERNS: Array<{ re: RegExp; method: string }> = [
  {
    re: /(?:window|document|top|self|parent)?\.?location\s*\.\s*replace\s*\(\s*(["'`])([^"'`]+)\1/i,
    method: "location.replace()",
  },
  {
    re: /(?:window|document|top|self|parent)?\.?location\s*\.\s*assign\s*\(\s*(["'`])([^"'`]+)\1/i,
    method: "location.assign()",
  },
  {
    re: /(?:window|document|top|self|parent)\s*\.\s*location\s*\.\s*href\s*=\s*(["'`])([^"'`]+)\1/i,
    method: "window.location.href",
  },
  {
    re: /(?:window|document|top|self|parent)\s*\.\s*location\s*=\s*(["'`])([^"'`]+)\1/i,
    method: "window.location",
  },
  { re: /\blocation\s*\.\s*href\s*=\s*(["'`])([^"'`]+)\1/i, method: "location.href" },
  { re: /\bdocument\s*\.\s*location\s*=\s*(["'`])([^"'`]+)\1/i, method: "document.location" },
  {
    re: /\blocation\s*\.\s*(?:assign|replace)\s*\(\s*(["'`])([^"'`]+)\1/i,
    method: "location navigation",
  },
  { re: /\bwindow\s*\.\s*open\s*\(\s*(["'`])(https?:\/\/[^"'`]+)\1/i, method: "window.open()" },
];

const DYNAMIC_HINTS: Array<{ re: RegExp; method: string }> = [
  {
    re: /location\s*\.\s*(?:replace|assign)\s*\(\s*[A-Za-z_$]/,
    method: "location.replace()/assign() with a computed value",
  },
  {
    re: /location(?:\s*\.\s*href)?\s*=\s*[A-Za-z_$][\w$.[\]]*\s*[;\n]/,
    method: "location assignment from a variable",
  },
  {
    re: /history\s*\.\s*(?:pushState|replaceState)\s*\(/,
    method: "history.pushState()/replaceState()",
  },
  { re: /\.submit\s*\(\s*\)/, method: "auto-submitted form" },
];

export function detectClientRedirect(html: string): {
  signal: ClientRedirectSignal | null;
  hint: DynamicRedirectHint | null;
} {
  const head = html.slice(0, 400_000);

  // 1. Meta refresh
  const metaTags = head.match(/<meta[^>]+http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi) ?? [];
  for (const tag of metaTags) {
    const content = tag.match(/content\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!content) continue;
    const parsed = parseRefreshValue(content);
    if (parsed?.url) {
      return {
        signal: {
          kind: "meta-refresh",
          method: `meta refresh (${parsed.delay}s)`,
          evidence: snippet(tag),
          rawTarget: parsed.url,
          delaySeconds: parsed.delay,
        },
        hint: null,
      };
    }
  }

  // 2. Static JavaScript location assignments (read, never executed)
  const scripts = head.match(/<script[\s\S]*?<\/script>/gi) ?? [];
  const inlineHandlers = head.match(/on(?:load|click)\s*=\s*["'][^"']+["']/gi) ?? [];
  const jsSources = [...scripts, ...inlineHandlers];
  const jsBlob = jsSources.join("\n");

  for (const { re, method } of JS_PATTERNS) {
    const match = jsBlob.match(re);
    const target = match?.[2];
    if (target && !/^javascript:/i.test(target) && target.trim() !== "") {
      return {
        signal: {
          kind: "javascript-redirect",
          method,
          evidence: snippet(match![0]),
          rawTarget: decodeEntities(clean(target)),
          delaySeconds: null,
        },
        hint: null,
      };
    }
  }

  const obfuscated = decodeAtob(jsBlob);
  if (obfuscated) return { signal: obfuscated, hint: null };

  for (const { re, method } of DYNAMIC_HINTS) {
    const match = jsBlob.match(re);
    if (match) return { signal: null, hint: { method, evidence: snippet(match[0]) } };
  }

  return { signal: null, hint: null };
}

export function extractPageMeta(html: string) {
  const canonical =
    html
      .match(/<link[^>]+rel=["']canonical["'][^>]*>/i)?.[0]
      ?.match(/href=["']([^"']+)["']/i)?.[1] ?? null;
  const metaRobots =
    html
      .match(/<meta[^>]+name=["']robots["'][^>]*>/i)?.[0]
      ?.match(/content=["']([^"']*)["']/i)?.[1] ?? null;
  const title = html.match(/<title[^>]*>([\s\S]{0,300}?)<\/title>/i)?.[1]?.trim() ?? null;
  return { canonical, metaRobots, title };
}

/**
 * True when a page looks like a thin interstitial/redirector rather than real
 * content. Used to avoid flagging ordinary script-heavy pages (Google, SPAs)
 * as unresolved client-side redirects.
 */
export function looksLikeRedirector(html: string): boolean {
  if (html.length > 60_000) return false;
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length < 1200;
}
