/**
 * Smart redirect rules — shared (browser + server) so the visual builder's
 * preview uses exactly the same evaluation as the live redirect route.
 */

export type RuleField =
  | "country"
  | "platform"
  | "browser"
  | "os"
  | "query"
  | "utm_source"
  | "utm_medium"
  | "utm_campaign"
  | "weekday"
  | "hour"
  | "date";

export type RuleOp = "is" | "is_not" | "contains" | "between" | "before" | "after" | "exists";

export interface RuleCondition {
  field: RuleField;
  op: RuleOp;
  /** For "query" the value is `key=value` (or just `key` with op "exists"). Lists are comma separated. */
  value: string;
}

export interface LinkRule {
  id: string;
  name: string;
  enabled: boolean;
  match: "all" | "any";
  conditions: RuleCondition[];
  destination: string;
}

export interface VisitorContext {
  country: string | null;
  platform: "android" | "ios" | "tablet" | "desktop";
  browser: string;
  os: string;
  query: Record<string, string>;
  now: Date;
}

export const FIELD_LABEL: Record<RuleField, string> = {
  country: "Country (ISO code)",
  platform: "Platform",
  browser: "Browser",
  os: "Operating system",
  query: "Query parameter",
  utm_source: "utm_source",
  utm_medium: "utm_medium",
  utm_campaign: "utm_campaign",
  weekday: "Day of week (UTC)",
  hour: "Hour of day (UTC)",
  date: "Date (UTC)",
};

export const FIELD_OPS: Record<RuleField, RuleOp[]> = {
  country: ["is", "is_not"],
  platform: ["is", "is_not"],
  browser: ["is", "is_not"],
  os: ["is", "is_not"],
  query: ["is", "contains", "exists"],
  utm_source: ["is", "is_not", "contains", "exists"],
  utm_medium: ["is", "is_not", "contains", "exists"],
  utm_campaign: ["is", "is_not", "contains", "exists"],
  weekday: ["is", "is_not"],
  hour: ["between"],
  date: ["before", "after"],
};

export const OP_LABEL: Record<RuleOp, string> = {
  is: "is one of",
  is_not: "is not",
  contains: "contains",
  between: "between",
  before: "before",
  after: "after",
  exists: "is present",
};

export const MAX_RULES = 20;
export const MAX_CONDITIONS = 8;

const list = (v: string) =>
  v
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function conditionMatches(c: RuleCondition, ctx: VisitorContext): boolean {
  const value = c.value.trim();
  switch (c.field) {
    case "country":
    case "platform":
    case "browser":
    case "os": {
      const actual = (
        c.field === "country" ? (ctx.country ?? "") : String(ctx[c.field])
      ).toLowerCase();
      const hit = list(value).includes(actual);
      return c.op === "is_not" ? !hit : hit;
    }
    case "weekday": {
      const day = WEEKDAYS[ctx.now.getUTCDay()] ?? "";
      const hit = list(value).some((d) => d.slice(0, 3) === day);
      return c.op === "is_not" ? !hit : hit;
    }
    case "hour": {
      const m = /^(\d{1,2})\s*-\s*(\d{1,2})$/.exec(value);
      if (!m) return false;
      const from = Number(m[1]);
      const to = Number(m[2]);
      const h = ctx.now.getUTCHours();
      return from <= to ? h >= from && h < to : h >= from || h < to;
    }
    case "date": {
      const t = Date.parse(value);
      if (Number.isNaN(t)) return false;
      return c.op === "before" ? ctx.now.getTime() < t : ctx.now.getTime() >= t;
    }
    case "query":
    case "utm_source":
    case "utm_medium":
    case "utm_campaign": {
      let key: string = c.field;
      let expected = value;
      if (c.field === "query") {
        const idx = value.indexOf("=");
        key = (idx === -1 ? value : value.slice(0, idx)).trim();
        expected = idx === -1 ? "" : value.slice(idx + 1).trim();
      }
      const actual = ctx.query[key];
      if (c.op === "exists") return actual !== undefined;
      if (actual === undefined) return c.op === "is_not";
      const a = actual.toLowerCase();
      if (c.op === "contains") return a.includes(expected.toLowerCase());
      const hit = list(expected).includes(a);
      return c.op === "is_not" ? !hit : hit;
    }
  }
}

/** Returns the first enabled rule (in priority order) whose conditions match. */
export function evaluateRules(rules: LinkRule[], ctx: VisitorContext): LinkRule | null {
  for (const rule of rules) {
    if (!rule.enabled || rule.conditions.length === 0) continue;
    const results = rule.conditions.map((c) => conditionMatches(c, ctx));
    const ok = rule.match === "any" ? results.some(Boolean) : results.every(Boolean);
    if (ok) return rule;
  }
  return null;
}

const BOT_RE =
  /bot|crawl|spider|slurp|facebookexternalhit|embedly|preview|curl|wget|python-requests|httpclient|headless|lighthouse|monitor|scan/i;

export function parseUserAgent(ua: string) {
  const isBot = !ua || BOT_RE.test(ua);
  let os = "Other";
  if (/android/i.test(ua)) os = "Android";
  else if (/iphone|ipad|ipod/i.test(ua)) os = "iOS";
  else if (/windows/i.test(ua)) os = "Windows";
  else if (/mac os x|macintosh/i.test(ua)) os = "macOS";
  else if (/cros/i.test(ua)) os = "ChromeOS";
  else if (/linux/i.test(ua)) os = "Linux";

  let browser = "Other";
  if (/edg\//i.test(ua)) browser = "Edge";
  else if (/opr\/|opera/i.test(ua)) browser = "Opera";
  else if (/samsungbrowser/i.test(ua)) browser = "Samsung";
  else if (/firefox|fxios/i.test(ua)) browser = "Firefox";
  else if (/chrome|crios/i.test(ua)) browser = "Chrome";
  else if (/safari/i.test(ua)) browser = "Safari";

  const tablet = /ipad|tablet|(android(?!.*mobile))/i.test(ua);
  const mobile = /mobi|iphone|ipod|android/i.test(ua) && !tablet;
  const device = isBot ? "Bot" : tablet ? "Tablet" : mobile ? "Mobile" : "Desktop";
  const platform: VisitorContext["platform"] = tablet
    ? "tablet"
    : os === "Android"
      ? "android"
      : os === "iOS"
        ? "ios"
        : "desktop";
  return { isBot, os, browser, device, platform };
}

export function newRuleId() {
  return Math.random().toString(36).slice(2, 10);
}
