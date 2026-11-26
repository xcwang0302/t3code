import * as NodeVM from "node:vm";

import { describe, expect, it, vi } from "vite-plus/test";

import { sendPageCommand, toKeyboardInputEvents } from "./GuestInput.ts";

const makeGuest = ({
  focused,
  focusedDocument = true,
  frameSessions = new Map<string, string>(),
}: {
  readonly focused: boolean;
  /** Whether focus sits in a document the page's own process reaches. */
  readonly focusedDocument?: boolean;
  readonly frameSessions?: ReadonlyMap<string, string>;
}) => {
  const sendCommand = vi.fn(
    async (method: string, params?: { expression?: string }, sessionId?: string) => {
      if (method === "DOM.describeNode") return { node: { frameId: "cross-site-frame" } };
      if (method !== "Runtime.evaluate") return {};
      if (params?.expression?.includes("execCommand")) return { result: { value: true } };
      // The top document's focus ends at a frame element it cannot enter.
      return sessionId === undefined && !focusedDocument
        ? { result: { objectId: "frame-element" } }
        : { result: {} };
    },
  );
  const webContents = {
    focusedFrame: focused ? {} : null,
    insertText: vi.fn(async () => {}),
    sendInputEvent: vi.fn(),
    reload: vi.fn(),
    reloadIgnoringCache: vi.fn(),
  };
  return {
    webContents,
    sendCommand,
    send: (method: string, params: Record<string, unknown>) =>
      sendPageCommand(
        webContents as unknown as Electron.WebContents,
        { sendCommand } as unknown as Electron.Debugger,
        method,
        params,
        undefined,
        frameSessions,
      ),
  };
};

describe("preview guest input", () => {
  it("types into an unfocused guest's own page, not the app's focused field", async () => {
    const guest = makeGuest({ focused: false });
    await guest.send("Input.insertText", { text: "pairing-code" });
    expect(guest.webContents.insertText).toHaveBeenCalledWith("pairing-code");
    expect(guest.sendCommand).not.toHaveBeenCalledWith("Input.insertText", expect.anything());
  });

  it("stops the guest navigation without stopping its embedder", async () => {
    let guestLoading = true;
    let hostLoading = true;
    const guest = {
      stop: () => {
        guestLoading = false;
      },
    };
    const debuggee = {
      sendCommand: async () => {
        hostLoading = false;
        return {};
      },
    };
    await sendPageCommand(
      guest as unknown as Electron.WebContents,
      debuggee as unknown as Electron.Debugger,
      "Page.stopLoading",
      {},
    );
    expect(guestLoading).toBe(false);
    expect(hostLoading).toBe(true);
  });

  it.each([
    {
      sessionId: undefined,
      method: "Input.dispatchMouseEvent",
      type: "mousePressed",
      outcome: "restore",
    },
    {
      sessionId: "child-frame",
      method: "Input.dispatchMouseEvent",
      type: "mousePressed",
      outcome: "restore",
    },
    {
      sessionId: undefined,
      method: "Input.dispatchTouchEvent",
      type: "touchStart",
      outcome: "restore",
    },
    {
      sessionId: undefined,
      method: "Input.dispatchMouseEvent",
      type: "mousePressed",
      outcome: "other-field",
    },
    {
      sessionId: undefined,
      method: "Input.dispatchMouseEvent",
      type: "mousePressed",
      outcome: "removed",
    },
    {
      sessionId: undefined,
      method: "Input.dispatchMouseEvent",
      type: "mousePressed",
      outcome: "failure",
    },
  ])(
    "preserves host focus for $method in $sessionId with $outcome",
    async ({ sessionId, method, type, outcome }) => {
      const document = { activeElement: {} as object };
      const composer = {
        isConnected: true,
        focus: () => {
          document.activeElement = composer;
        },
      };
      const preview = { tagName: "WEBVIEW", getWebContentsId: () => 7 };
      const otherField = { tagName: "INPUT" };
      document.activeElement = composer;
      const context = NodeVM.createContext({ document });
      const host = {
        isDestroyed: () => false,
        executeJavaScript: async (script: string) => NodeVM.runInContext(script, context),
      };
      const guest = { id: 7, focusedFrame: null, hostWebContents: host };
      const debuggee = {
        sendCommand: async () => {
          document.activeElement = outcome === "other-field" ? otherField : preview;
          if (outcome === "removed") composer.isConnected = false;
          if (outcome === "failure") throw new Error("Pointer failed");
          return {};
        },
      };
      const result = sendPageCommand(
        guest as unknown as Electron.WebContents,
        debuggee as unknown as Electron.Debugger,
        method,
        { type, x: 10, y: 10, button: "left" },
        sessionId,
      );
      if (outcome === "failure") await expect(result).rejects.toThrow("Pointer failed");
      else await result;
      expect(document.activeElement).toBe(
        outcome === "other-field" ? otherField : outcome === "removed" ? preview : composer,
      );
      expect(Object.keys(context)).toEqual(["document"]);
    },
  );

  it.each([{ userClicksStuckTab: false }, { userClicksStuckTab: true }])(
    "keeps the right focus when a sibling press finishes beside a stuck one, user clicks: $userClicksStuckTab",
    async ({ userClicksStuckTab }) => {
      const document = { activeElement: {} as object };
      const composer = {
        isConnected: true,
        focus: () => {
          document.activeElement = composer;
        },
      };
      document.activeElement = composer;
      const context = NodeVM.createContext({ document });
      const host = {
        isDestroyed: () => false,
        executeJavaScript: async (script: string) => NodeVM.runInContext(script, context),
      };
      const previews = new Map(
        [7, 8].map((id) => [id, { tagName: "WEBVIEW", getWebContentsId: () => id }]),
      );
      const stuckPressFocused = Promise.withResolvers<void>();
      const stuckPressEnds = Promise.withResolvers<void>();
      const press = (id: number) => {
        const debuggee = {
          sendCommand: async () => {
            document.activeElement = previews.get(id)!;
            if (id === 7) {
              stuckPressFocused.resolve();
              await stuckPressEnds.promise;
            } else if (userClicksStuckTab) {
              document.activeElement = previews.get(7)!;
            }
            return {};
          },
        };
        return sendPageCommand(
          { id, focusedFrame: null, hostWebContents: host } as unknown as Electron.WebContents,
          debuggee as unknown as Electron.Debugger,
          "Input.dispatchMouseEvent",
          { type: "mousePressed", x: 10, y: 10, button: "left" },
        );
      };
      // A press held open, as by a page's confirm() on mousedown, must not block or win focus.
      const stuck = press(7);
      await stuckPressFocused.promise;
      await press(8);
      const expected = userClicksStuckTab ? previews.get(7) : composer;
      expect(document.activeElement).toBe(expected);
      stuckPressEnds.resolve();
      await stuck;
      expect(Object.keys(context)).toEqual(["document"]);
    },
  );

  it.each([
    {
      method: "Input.dispatchMouseEvent",
      press: "mousePressed",
      release: "mouseReleased",
      failPress: false,
    },
    {
      method: "Input.dispatchTouchEvent",
      press: "touchStart",
      release: "touchEnd",
      failPress: false,
    },
    {
      method: "Input.dispatchMouseEvent",
      press: "mousePressed",
      release: "mouseReleased",
      failPress: true,
    },
  ])(
    "keeps $method releases behind presses waiting for host focus, failed press: $failPress",
    async ({ method, press, release, failPress }) => {
      const captureStarted = Promise.withResolvers<void>();
      const finishCapture = Promise.withResolvers<void>();
      const events: Array<unknown> = [];
      const guest = {
        id: 7,
        focusedFrame: null,
        hostWebContents: {
          isDestroyed: () => false,
          executeJavaScript: async () => {
            captureStarted.resolve();
            await finishCapture.promise;
          },
        },
      };
      const debuggee = {
        sendCommand: async (_method: string, params: Record<string, unknown>) => {
          events.push(params["type"]);
          if (failPress && params["type"] === press) throw new Error("Press failed");
          return {};
        },
      };
      const send = (type: string) =>
        sendPageCommand(
          guest as unknown as Electron.WebContents,
          debuggee as unknown as Electron.Debugger,
          method,
          { type },
        );
      const pressed = send(press);
      await captureStarted.promise;
      const released = send(release);
      finishCapture.resolve();
      const results = await Promise.allSettled([pressed, released]);
      expect(results.map((result) => result.status)).toEqual([
        failPress ? "rejected" : "fulfilled",
        "fulfilled",
      ]);
      expect(events).toEqual([press, release]);
    },
  );

  it("refuses input when a cross-site frame without a known session holds the unfocused page's focus", async () => {
    const guest = makeGuest({ focused: false, focusedDocument: false });
    await expect(guest.send("Input.insertText", { text: "secret" })).rejects.toThrow(
      /cross-site frame/,
    );
    expect(guest.webContents.insertText).not.toHaveBeenCalled();
  });

  it("edits a focused cross-site frame in its own session, never as input the app could take", async () => {
    const guest = makeGuest({
      focused: false,
      focusedDocument: false,
      frameSessions: new Map([["cross-site-frame", "frame-session"]]),
    });
    const edits = () =>
      guest.sendCommand.mock.calls.flatMap(([method, params, sessionId]) => {
        const command = /execCommand\(("\w+"), false, (".*?")\)/.exec(params?.expression ?? "");
        return method === "Runtime.evaluate" && command
          ? [[sessionId, JSON.parse(command[1]!), JSON.parse(command[2]!)]]
          : [];
      });

    await guest.send("Input.insertText", { text: 'secret "quoted"' });
    // ControlOrMeta+A, then Backspace, as Playwright presses them.
    await guest.send("Input.dispatchKeyEvent", {
      type: "rawKeyDown",
      key: "Control",
      modifiers: 2,
    });
    await guest.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "a", modifiers: 2 });
    await guest.send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", modifiers: 2 });
    await guest.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Backspace" });
    await guest.send("Input.dispatchKeyEvent", { type: "keyDown", key: "x", text: "x" });
    await expect(
      guest.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", text: "\r" }),
    ).rejects.toThrow(/only text, Backspace, Delete and select-all/);

    expect(edits()).toEqual([
      ["frame-session", "insertText", 'secret "quoted"'],
      ["frame-session", "selectAll", ""],
      ["frame-session", "delete", ""],
      ["frame-session", "insertText", "x"],
    ]);
    expect(guest.webContents.insertText).not.toHaveBeenCalled();
    expect(guest.webContents.sendInputEvent).not.toHaveBeenCalled();
    expect(guest.sendCommand.mock.calls.map(([method]) => method)).not.toContain(
      "Input.insertText",
    );
  });
});

describe("preview guest pointer routing", () => {
  it("sends a press over a cross-site frame to its session, and its release after it", async () => {
    const sent: Array<[string, Record<string, unknown>, string | undefined]> = [];
    const debuggee = {
      sendCommand: async (
        method: string,
        params: Record<string, unknown> & { expression?: string },
        sessionId?: string,
      ) => {
        sent.push([method, params, sessionId]);
        if (method === "DOM.describeNode") return { node: { frameId: "cross-site-frame" } };
        if (method !== "Runtime.evaluate" || sessionId !== undefined) return {};
        // The page's document finds the frame element; its content starts at (10, 100).
        const point = /\(([\d.]+), ([\d.]+), true\)$/.exec(params.expression ?? "");
        return point
          ? { result: { value: [Number(point[1]) - 10, Number(point[2]) - 100] } }
          : { result: { objectId: "frame-element" } };
      },
    };
    const send = (type: string, x: number, y: number) =>
      sendPageCommand(
        { focusedFrame: {} } as unknown as Electron.WebContents,
        debuggee as unknown as Electron.Debugger,
        "Input.dispatchMouseEvent",
        { type, x, y, button: "left" },
        undefined,
        new Map([["cross-site-frame", "frame-session"]]),
      );

    await send("mousePressed", 60, 150);
    // Released outside the frame, as a drag ends; the frame that took the press still gets it.
    await send("mouseReleased", 500, 500);
    expect(sent.filter(([method]) => method === "Input.dispatchMouseEvent")).toEqual([
      [
        "Input.dispatchMouseEvent",
        { type: "mousePressed", x: 50, y: 50, button: "left" },
        "frame-session",
      ],
      [
        "Input.dispatchMouseEvent",
        { type: "mouseReleased", x: 490, y: 400, button: "left" },
        "frame-session",
      ],
    ]);
  });
});

describe("CDP key events as Electron input", () => {
  it("sends a key's text as char events after its key down", () => {
    expect(toKeyboardInputEvents({ type: "keyDown", key: "Enter", text: "\r" })).toEqual([
      { type: "rawKeyDown", keyCode: "Enter", modifiers: [] },
      { type: "char", keyCode: "\r", modifiers: [] },
    ]);
    expect(toKeyboardInputEvents({ type: "keyDown", key: "é", text: "é", modifiers: 8 })).toEqual([
      { type: "rawKeyDown", keyCode: "é", modifiers: ["shift"] },
      { type: "char", keyCode: "é", modifiers: ["shift"] },
    ]);
  });

  // regression: #18556 agent typing in a preview tab landed in the app instead of the guest
  it("names arrows and function keys as Electron accelerators", () => {
    expect(toKeyboardInputEvents({ type: "keyUp", key: "ArrowLeft", modifiers: 3 })).toEqual([
      { type: "keyUp", keyCode: "Left", modifiers: ["alt", "control"] },
    ]);
    expect(toKeyboardInputEvents({ type: "rawKeyDown", key: "F12" })).toEqual([
      { type: "rawKeyDown", keyCode: "F12", modifiers: [] },
    ]);
    expect(toKeyboardInputEvents({ type: "rawKeyDown", key: "AudioVolumeUp" })).toEqual([]);
  });
});
