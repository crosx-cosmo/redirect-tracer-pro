export type IssueLevel = "error" | "warning" | "info";

/** How the analyzer moved (or failed to move) from one URL to the next. */
export type HopMechanism =
  | "http-redirect"
  | "javascript-redirect"
  | "meta-refresh"
  | "browser-navigation"
  | "final-response"
  | "blocked"
  | "unresolved"
  | "error";

export interface RedirectHop {
  index: number;
  url: string;
  protocol: "http" | "https" | "other";
  status: number;
  statusText: string;
  redirectType: string;
  responseTimeMs: number;
  location: string | null;
  resolvedLocation: string | null;
  server: string | null;
  ip: string | null;
  headers: Record<string, string>;
  params: Record<string, string>;
  /** Mechanism that produced the next hop (or ended the chain). */
  mechanism?: HopMechanism;
  /** Human label shown on the hop card, e.g. "JavaScript Redirect". */
  mechanismLabel?: string;
  /** Precise technique, e.g. "location.replace()" or "meta refresh (0s)". */
  mechanismDetail?: string | null;
  /** Source fragment the detection was based on. */
  evidence?: string | null;
  /** Unified destination for this hop, whatever the mechanism was. */
  nextUrl?: string | null;
  /** Exact reason the chain could not continue from this hop. */
  blockedReason?: string | null;
  /** IP addresses the hostname resolved to during the safety check. */
  addresses?: string[];
}

export interface AnalysisIssue {
  id: string;
  level: IssueLevel;
  title: string;
  detail: string;
  hopIndex?: number;
}

export interface SeoInfo {
  finalStatus: number | null;
  https: boolean;
  canonical: string | null;
  metaRobots: string | null;
  chainLength: number;
}

export type ParamChangeKind = "added" | "removed" | "modified";

export interface ParamChange {
  param: string;
  kind: ParamChangeKind;
  from: string | null;
  to: string | null;
  tracking: boolean;
}

export interface HopParamDiff {
  fromIndex: number;
  toIndex: number;
  fromUrl: string;
  toUrl: string;
  changes: ParamChange[];
}

export interface TrackingReport {
  diffs: HopParamDiff[];
  startParams: Record<string, string>;
  finalParams: Record<string, string>;
  lostTrackingParams: string[];
  keptTrackingParams: string[];
}

export interface RedirectAnalysis {
  startUrl: string;
  hops: RedirectHop[];
  finalUrl: string;
  finalStatus: number | null;
  totalHops: number;
  totalRedirects: number;
  totalResponseTimeMs: number;
  redirectLoop: boolean;
  seo: SeoInfo;
  issues: AnalysisIssue[];
  tracking: TrackingReport;
  source: "live" | "demo";
  analyzedAt: string;
  error: string | null;
  /** Why tracing stopped: "final-response" | "blocked" | "loop" | ... */
  terminationReason?: string;
  /** Plain-language explanation of the termination. */
  terminationDetail?: string | null;
  /** True when the final destination is confirmed (no unfollowable hop left). */
  finalDestinationConfirmed?: boolean;
  /** Set when the headless-browser fallback was used for at least one hop. */
  browserFallbackUsed?: boolean;
  /** Reason the browser fallback could not run, when it was needed. */
  browserFallbackNote?: string | null;
}
