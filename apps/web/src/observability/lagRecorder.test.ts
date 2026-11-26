import { describe, expect, it } from "vite-plus/test";

import { lagRouteOf, longFrameAttributes, slowInputAttributes } from "./lagRecorder";

const context = { route: "thread", composerFocused: true, visible: true } as const;

describe("longFrameAttributes", () => {
  it("names the slowest scripts first with their bundle position and forced layout", () => {
    const attributes = longFrameAttributes(
      {
        startTime: 1000,
        duration: 240,
        blockingDuration: 190,
        renderStart: 1180,
        styleAndLayoutStart: 1200,
        firstUIEventTimestamp: 995,
        scripts: [
          { duration: 30, invokerType: "event-listener", invoker: "INPUT#composer.onkeydown" },
          {
            duration: 150,
            invokerType: "user-callback",
            invoker: "MessagePort.onmessage",
            sourceURL: "http://127.0.0.1:3773/assets/index-AbC123.js?v=1",
            sourceFunctionName: "performWorkUntilDeadline",
            sourceCharPosition: 4821,
            forcedStyleAndLayoutDuration: 40,
          },
        ],
      },
      context,
    );
    expect(attributes).toMatchObject({
      "lag.kind": "frame",
      "lag.durationMs": 240,
      "lag.blockingMs": 190,
      "lag.scriptMs": 180,
      "lag.forcedLayoutMs": 40,
      "lag.renderMs": 60,
      "lag.styleLayoutMs": 40,
      "lag.afterInput": true,
      "lag.route": "thread",
      "lag.script.0.ms": 150,
      "lag.script.0.url": "assets/index-AbC123.js",
      "lag.script.0.fn": "performWorkUntilDeadline",
      "lag.script.0.pos": 4821,
      "lag.script.0.forcedLayoutMs": 40,
      "lag.script.1.invoker": "event-listener INPUT#composer.onkeydown",
    });
    expect(attributes).not.toHaveProperty("lag.script.1.url");
  });

  it("keeps at most five scripts", () => {
    const scripts = Array.from({ length: 8 }, (_, index) => ({ duration: index + 1 }));
    const attributes = longFrameAttributes({ startTime: 0, duration: 120, scripts }, context);
    expect(attributes["lag.scriptCount"]).toBe(8);
    expect(attributes).toHaveProperty("lag.script.4.ms", 4);
    expect(attributes).not.toHaveProperty("lag.script.5.ms");
  });
});

describe("slowInputAttributes", () => {
  it("splits an input's wait into delay, handlers, and presentation", () => {
    expect(
      slowInputAttributes(
        {
          name: "keydown",
          startTime: 100,
          duration: 320,
          processingStart: 340,
          processingEnd: 360,
        },
        context,
      ),
    ).toMatchObject({
      "lag.kind": "input",
      "lag.event": "keydown",
      "lag.inputDelayMs": 240,
      "lag.handlerMs": 20,
      "lag.presentationMs": 60,
    });
  });
});

describe("lagRouteOf", () => {
  it("tells threads and drafts from app pages", () => {
    expect(lagRouteOf("/env-1/thread-1")).toBe("thread");
    expect(lagRouteOf("/draft/abc")).toBe("draft");
    expect(lagRouteOf("/settings/general")).toBe("other");
    expect(lagRouteOf("/board")).toBe("other");
  });
});
