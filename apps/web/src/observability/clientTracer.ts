import * as Context from "effect/Context";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Tracer from "effect/Tracer";

import { randomUUID } from "../lib/utils";

/** `service.instance.id` for this page load, shared by every resource the UI exports. */
export const serviceInstanceId = randomUUID();

let delegate: Tracer.Tracer | null = null;

export function setDelegate(next: Tracer.Tracer | null): void {
  delegate = next;
}

export function hasDelegate(): boolean {
  return delegate !== null;
}

const nanosFromEpochMs = (ms: number): bigint => BigInt(Math.round(ms * 1_000_000));

/**
 * Fork: exports a span for something the browser timed after the fact, such as a long frame.
 * Dropped until an exporter is configured, since the timing has already happened.
 */
export function recordTimedSpan(
  name: string,
  startEpochMs: number,
  endEpochMs: number,
  attributes: Readonly<Record<string, string | number | boolean>>,
): void {
  if (delegate === null) return;
  const span = delegate.span({
    name,
    parent: Option.none(),
    annotations: Context.empty(),
    links: [],
    startTime: nanosFromEpochMs(startEpochMs),
    kind: "internal",
    root: true,
    sampled: true,
  });
  for (const [key, value] of Object.entries(attributes)) span.attribute(key, value);
  span.end(nanosFromEpochMs(endEpochMs), Exit.void);
}

// Install before exporters exist so spans reach whichever exporter is configured later.
export const layer = Layer.succeed(
  Tracer.Tracer,
  Tracer.make({
    span(options) {
      return delegate?.span(options) ?? new Tracer.NativeSpan(options);
    },
  }),
);
