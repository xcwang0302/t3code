import { recordTimedSpan } from "./clientTracer";

/**
 * Fork: records frames and inputs the user waited on, so a lag reported later can be traced
 * without a manual profile. Each one becomes a client span in the local server trace.
 */

/** A frame or input at least this long is recorded. */
const LAG_THRESHOLD_MS = 100;
/** At most this many lag spans a minute, so a stuck page cannot flood the trace. */
const MAX_SPANS_PER_MINUTE = 60;
const MAX_SCRIPTS = 5;
const MAX_TEXT = 160;

/** The fields of a `long-animation-frame` script entry this records. */
export interface LongFrameScript {
  readonly duration: number;
  readonly invoker?: string;
  readonly invokerType?: string;
  readonly sourceURL?: string;
  readonly sourceFunctionName?: string;
  readonly sourceCharPosition?: number;
  readonly forcedStyleAndLayoutDuration?: number;
  readonly pauseDuration?: number;
}

/** The fields of a `long-animation-frame` entry this records. */
export interface LongFrame {
  readonly startTime: number;
  readonly duration: number;
  readonly blockingDuration?: number;
  readonly renderStart?: number;
  readonly styleAndLayoutStart?: number;
  readonly firstUIEventTimestamp?: number;
  readonly scripts?: ReadonlyArray<LongFrameScript>;
}

/** The fields of an Event Timing entry this records. */
export interface SlowInput {
  readonly name: string;
  readonly startTime: number;
  readonly duration: number;
  readonly processingStart: number;
  readonly processingEnd: number;
  readonly interactionId?: number;
}

export interface LagContext {
  readonly route: "thread" | "draft" | "other";
  readonly composerFocused: boolean;
  readonly visible: boolean;
}

type Attributes = Record<string, string | number | boolean>;

const round = (value: number) => Math.round(value * 10) / 10;
const clip = (value: string) => (value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT)}…` : value);
// Keeps the bundle file name, which with the build's sourcemaps finds the source.
const shortUrl = (url: string) => url.replace(/^[a-z]+:\/\/[^/]+\//i, "").replace(/[?#].*$/, "");

const contextAttributes = (context: LagContext): Attributes => ({
  "lag.route": context.route,
  "lag.composerFocused": context.composerFocused,
  "lag.visible": context.visible,
});

export function longFrameAttributes(frame: LongFrame, context: LagContext): Attributes {
  const end = frame.startTime + frame.duration;
  const scripts = [...(frame.scripts ?? [])].sort((a, b) => b.duration - a.duration);
  const attributes: Attributes = {
    "lag.kind": "frame",
    "lag.durationMs": round(frame.duration),
    "lag.blockingMs": round(frame.blockingDuration ?? 0),
    "lag.scriptMs": round(scripts.reduce((sum, script) => sum + script.duration, 0)),
    "lag.forcedLayoutMs": round(
      scripts.reduce((sum, script) => sum + (script.forcedStyleAndLayoutDuration ?? 0), 0),
    ),
    "lag.renderMs": frame.renderStart ? round(end - frame.renderStart) : 0,
    "lag.styleLayoutMs": frame.styleAndLayoutStart ? round(end - frame.styleAndLayoutStart) : 0,
    "lag.afterInput": (frame.firstUIEventTimestamp ?? 0) > 0,
    "lag.scriptCount": scripts.length,
    ...contextAttributes(context),
  };
  scripts.slice(0, MAX_SCRIPTS).forEach((script, index) => {
    const prefix = `lag.script.${index}`;
    attributes[`${prefix}.ms`] = round(script.duration);
    attributes[`${prefix}.invoker`] = clip(
      [script.invokerType, script.invoker].filter(Boolean).join(" "),
    );
    if (script.sourceURL) attributes[`${prefix}.url`] = clip(shortUrl(script.sourceURL));
    if (script.sourceFunctionName) attributes[`${prefix}.fn`] = clip(script.sourceFunctionName);
    if (script.sourceCharPosition !== undefined && script.sourceCharPosition >= 0) {
      attributes[`${prefix}.pos`] = script.sourceCharPosition;
    }
    if (script.forcedStyleAndLayoutDuration) {
      attributes[`${prefix}.forcedLayoutMs`] = round(script.forcedStyleAndLayoutDuration);
    }
    if (script.pauseDuration) attributes[`${prefix}.pauseMs`] = round(script.pauseDuration);
  });
  return attributes;
}

export function slowInputAttributes(input: SlowInput, context: LagContext): Attributes {
  return {
    "lag.kind": "input",
    "lag.event": input.name,
    "lag.durationMs": round(input.duration),
    // Waiting for the main thread before any handler ran: the time other work held the input.
    "lag.inputDelayMs": round(input.processingStart - input.startTime),
    "lag.handlerMs": round(input.processingEnd - input.processingStart),
    // From the handlers to the next paint, which is when the typed text shows. The browser rounds
    // `duration` to 8 ms, so a fast paint can come out slightly negative.
    "lag.presentationMs": Math.max(
      0,
      round(input.startTime + input.duration - input.processingEnd),
    ),
    "lag.interactionId": input.interactionId ?? 0,
    ...contextAttributes(context),
  };
}

export function lagRouteOf(pathname: string): LagContext["route"] {
  if (pathname.startsWith("/draft/")) return "draft";
  const parts = pathname.split("/").filter(Boolean);
  const pages = new Set(["settings", "board", "issues", "pull-requests", "workflows", "projects"]);
  return parts.length === 2 && !pages.has(parts[0]!) ? "thread" : "other";
}

function currentContext(): LagContext {
  const active = document.activeElement;
  return {
    route: lagRouteOf(location.pathname),
    composerFocused: active?.closest?.('[data-testid="composer-editor"]') != null,
    visible: document.visibilityState === "visible",
  };
}

// The DOM typings lack Event Timing's `durationThreshold`, which Chromium supports.
const eventObserverInit: PerformanceObserverInit & { readonly durationThreshold: number } = {
  type: "event",
  durationThreshold: LAG_THRESHOLD_MS,
  buffered: true,
};

let started = false;

/** Starts observing once; a browser without the entry types records nothing. */
export function startLagRecorder(): void {
  if (started || typeof PerformanceObserver === "undefined") return;
  started = true;
  const supported = PerformanceObserver.supportedEntryTypes ?? [];
  let windowStart = 0;
  let windowCount = 0;
  const admit = () => {
    const now = performance.now();
    if (now - windowStart > 60_000) {
      windowStart = now;
      windowCount = 0;
    }
    windowCount += 1;
    return windowCount <= MAX_SPANS_PER_MINUTE;
  };
  const epoch = (time: number) => performance.timeOrigin + time;

  if (supported.includes("long-animation-frame")) {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as unknown as ReadonlyArray<LongFrame>) {
        if (entry.duration < LAG_THRESHOLD_MS || !admit()) continue;
        recordTimedSpan(
          "web.lag.frame",
          epoch(entry.startTime),
          epoch(entry.startTime + entry.duration),
          longFrameAttributes(entry, currentContext()),
        );
      }
    }).observe({ type: "long-animation-frame", buffered: true });
  }
  if (supported.includes("event")) {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as unknown as ReadonlyArray<SlowInput>) {
        if (entry.duration < LAG_THRESHOLD_MS || !admit()) continue;
        recordTimedSpan(
          "web.lag.input",
          epoch(entry.startTime),
          epoch(entry.startTime + entry.duration),
          slowInputAttributes(entry, currentContext()),
        );
      }
    }).observe(eventObserverInit);
  }
}
