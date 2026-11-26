// CDP input follows shared window focus; send directly to unfocused guests to avoid typing into the app.

const FOCUS_ROUTED_INPUT = new Set([
  "Input.insertText",
  "Input.dispatchKeyEvent",
  "Input.imeSetComposition",
]);

/** Direct input reaches only the main-frame process; insertText crashes when a cross-site frame has focus. */
const FOCUSED_DOCUMENT = `(() => {
  let doc = document;
  for (;;) {
    const active = doc.activeElement;
    if (active?.tagName !== "IFRAME" && active?.tagName !== "FRAME") return doc;
    if (!active.contentDocument) return null;
    doc = active.contentDocument;
  }
})()`;

/** Electron runs editing commands only for CDP keys; exclude clipboard commands to preserve the user's clipboard. */
const EDITING_COMMANDS = new Set(["selectAll", "undo", "redo"]);

/** The focused frame element whose document this session cannot reach, or null. */
const FOCUSED_CROSS_SITE_FRAME = `(() => {
  let doc = document;
  for (;;) {
    const active = doc.activeElement;
    if (active?.tagName !== "IFRAME" && active?.tagName !== "FRAME") return null;
    if (!active.contentDocument) return active;
    doc = active.contentDocument;
  }
})()`;

const CROSS_SITE_FOCUS_MESSAGE =
  "The page's focus is inside a cross-site frame the preview cannot reach while it lacks focus. Ask the user to click the field in the preview, then retry.";
const CROSS_SITE_KEY_MESSAGE =
  "The page's focus is inside a cross-site frame, which takes only text, Backspace, Delete and select-all while the preview lacks focus.";

/** Keys a cross-site frame takes as editing commands; modifiers alone do nothing there. */
const CROSS_SITE_KEY_COMMANDS: Record<string, string> = {
  Backspace: "delete",
  Delete: "forwardDelete",
};
const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta"]);

const ARROW_KEYS: Record<string, string> = {
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
};
const NAMED_KEYS = new Set([
  "Backspace",
  "Tab",
  "Enter",
  "Escape",
  "Delete",
  "Insert",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Shift",
  "Control",
  "Alt",
  "Meta",
  "CapsLock",
  "NumLock",
  "ScrollLock",
  "PrintScreen",
]);
const MODIFIER_BITS = [
  [1, "alt"],
  [2, "control"],
  [4, "meta"],
  [8, "shift"],
] as const;

const keyCodeFor = (key: string) => {
  if ([...key].length === 1) return key;
  if (ARROW_KEYS[key]) return ARROW_KEYS[key];
  return NAMED_KEYS.has(key) || /^F(?:[1-9]|1\d|2[0-4])$/u.test(key) ? key : null;
};

/** Electron derives text from keyCode, so typed text needs separate char events. */
export const toKeyboardInputEvents = (
  params: Record<string, unknown>,
): Array<Electron.KeyboardInputEvent> => {
  const bits = typeof params["modifiers"] === "number" ? params["modifiers"] : 0;
  const modifiers = MODIFIER_BITS.flatMap(([bit, name]) => (bits & bit ? [name] : []));
  const text = typeof params["text"] === "string" ? params["text"] : "";
  const chars = [...text].map((char) => ({ type: "char" as const, keyCode: char, modifiers }));
  const keyCode = keyCodeFor(typeof params["key"] === "string" ? params["key"] : "");
  switch (params["type"]) {
    case "keyDown":
      return [...(keyCode ? [{ type: "rawKeyDown" as const, keyCode, modifiers }] : []), ...chars];
    case "rawKeyDown":
    case "keyUp":
      return keyCode ? [{ type: params["type"], keyCode, modifiers }] : [];
    case "char":
      return chars;
    default:
      return [];
  }
};

const evaluate = async (debuggee: Electron.Debugger, expression: string, sessionId?: string) => {
  const reply = (await debuggee.sendCommand(
    "Runtime.evaluate",
    { expression, returnByValue: true },
    sessionId,
  )) as { readonly result?: { readonly value?: unknown } };
  return reply.result?.value;
};

/** The debugger session Chromium attached for each cross-site frame, by frame id. */
export type FrameSessions = ReadonlyMap<string, string>;

/** The session Chromium attached for the frame element a remote object names, if known. */
const frameElementSession = async (
  debuggee: Electron.Debugger,
  objectId: string,
  sessionId: string | undefined,
  frameSessions: FrameSessions,
) => {
  const described = (await debuggee
    .sendCommand("DOM.describeNode", { objectId }, sessionId)
    .finally(
      () =>
        void debuggee.sendCommand("Runtime.releaseObject", { objectId }, sessionId).catch(() => {}),
    )) as { readonly node?: { readonly frameId?: string } };
  const frameId = described.node?.frameId;
  return frameId === undefined ? undefined : frameSessions.get(frameId);
};

/**
 * The session whose document holds focus: undefined for the page's own process, or null
 * for a cross-site frame without a known session.
 */
const focusedSession = async (
  debuggee: Electron.Debugger,
  frameSessions: FrameSessions,
): Promise<string | null | undefined> => {
  let sessionId: string | undefined;
  // Each cross-site hop enters a frame of another site; a page nests only a few.
  for (let hop = 0; hop < 8; hop += 1) {
    const reply = (await debuggee.sendCommand(
      "Runtime.evaluate",
      { expression: FOCUSED_CROSS_SITE_FRAME },
      sessionId,
    )) as { readonly result?: { readonly objectId?: string } };
    const objectId = reply.result?.objectId;
    if (objectId === undefined) return sessionId;
    const child = await frameElementSession(debuggee, objectId, sessionId, frameSessions);
    if (child === undefined) return null;
    sessionId = child;
  }
  return null;
};

/**
 * Direct input reaches only the main-frame process, and CDP input to an unfocused guest lands in
 * the app, so a cross-site frame is edited in its own session the way typing would edit it.
 */
const editCrossSiteFrame = async (
  debuggee: Electron.Debugger,
  sessionId: string,
  method: string,
  params: Record<string, unknown>,
) => {
  const text = typeof params["text"] === "string" ? params["text"] : "";
  const key = typeof params["key"] === "string" ? params["key"] : "";
  const modifiers = typeof params["modifiers"] === "number" ? params["modifiers"] : 0;
  let command: string;
  if (
    method === "Input.insertText" ||
    (method === "Input.dispatchKeyEvent" && params["type"] === "char")
  ) {
    command = "insertText";
  } else if (method !== "Input.dispatchKeyEvent") {
    throw new Error(CROSS_SITE_KEY_MESSAGE);
  } else if (params["type"] === "keyUp" || MODIFIER_KEYS.has(key)) {
    return {};
  } else if (modifiers & 6 && key.toLowerCase() === "a") {
    command = "selectAll";
  } else if (CROSS_SITE_KEY_COMMANDS[key]) {
    command = CROSS_SITE_KEY_COMMANDS[key];
  } else if ([...key].length === 1 && text !== "" && !(modifiers & 7)) {
    command = "insertText";
  } else {
    throw new Error(CROSS_SITE_KEY_MESSAGE);
  }
  if (command === "insertText" && text === "") return {};
  const done = await evaluate(
    debuggee,
    `(() => { const doc = ${FOCUSED_DOCUMENT}; return doc?.execCommand(${JSON.stringify(command)}, false, ${JSON.stringify(text)}) === true; })()`,
    sessionId,
  );
  // Only text can fail to land; deleting nothing is not an error.
  if (command === "insertText" && done !== true) throw new Error(CROSS_SITE_FOCUS_MESSAGE);
  return {};
};

/** Host focus shared by the presses in flight in one window, so a later press keeps the field an earlier one saved. */
const HOST_FOCUS = "globalThis.__t3PreviewFocus";

/** A CDP pointer press focuses the guest's native view even with focus emulation enabled. */
const sendPointerPress = async (
  webContents: Electron.WebContents,
  debuggee: Electron.Debugger,
  method: string,
  params: Record<string, unknown>,
  sessionId: string | undefined,
) => {
  const host = webContents.hostWebContents;
  if (!host || host.isDestroyed() || webContents.focusedFrame) {
    return debuggee.sendCommand(method, params, sessionId);
  }
  // Focus in a webview with a press in flight came from that press, so keep the earlier save.
  await host.executeJavaScript(`(() => {
    const state = (${HOST_FOCUS} ??= { saved: null, presses: [] });
    const active = document.activeElement;
    let pressed = false;
    try {
      pressed = active?.tagName === "WEBVIEW" && state.presses.includes(active.getWebContentsId());
    } catch {}
    if (!pressed) {
      state.saved = active && active !== document.body && active.tagName !== "WEBVIEW" ? active : null;
    }
    state.presses.push(${webContents.id});
  })()`);
  try {
    return await debuggee.sendCommand(method, params, sessionId);
  } finally {
    if (!host.isDestroyed()) {
      // Membership check: a host reload starts a new state without this press.
      await host.executeJavaScript(`(() => {
        const state = ${HOST_FOCUS};
        const index = state ? state.presses.indexOf(${webContents.id}) : -1;
        if (index < 0) return;
        state.presses.splice(index, 1);
        if (state.presses.length === 0) delete ${HOST_FOCUS};
        const current = document.activeElement;
        try {
          if (state.saved?.isConnected && current?.tagName === "WEBVIEW" &&
              current.getWebContentsId() === ${webContents.id}) state.saved.focus({ preventScroll: true });
        } catch {}
      })()`);
    }
  }
};

/**
 * The cross-site frame element under a point or, with `point` set, that point in the frame's
 * own coordinates. Same-site frames are entered, since their documents share the session.
 */
const FRAME_AT_POINT = `function (x, y, point) {
  let doc = document;
  for (;;) {
    const hit = doc.elementFromPoint(x, y);
    if (hit?.tagName !== "IFRAME" && hit?.tagName !== "FRAME") return null;
    const box = hit.getBoundingClientRect();
    const style = getComputedStyle(hit);
    x -= box.left + hit.clientLeft + parseFloat(style.paddingLeft);
    y -= box.top + hit.clientTop + parseFloat(style.paddingTop);
    if (!hit.contentDocument) return point ? [x, y] : hit;
    doc = hit.contentDocument;
  }
}`;

/** Where pointer events for a cross-site frame go, and how far its origin sits from the page's. */
interface PointerRoute {
  readonly sessionId: string;
  readonly dx: number;
  readonly dy: number;
}

/**
 * A guest painted behind the app or in a minimized window takes a CDP press over a cross-site
 * frame on the frame element itself, so the frame never sees it; it goes to the frame's session.
 */
const routePointer = async (
  debuggee: Electron.Debugger,
  frameSessions: FrameSessions,
  x: number,
  y: number,
): Promise<PointerRoute | undefined> => {
  let route: PointerRoute | undefined;
  let sessionId: string | undefined;
  let local: ReadonlyArray<number> = [x, y];
  // Each hop enters a frame of another site; a page nests only a few.
  for (let hop = 0; hop < 8; hop += 1) {
    const call = `(${FRAME_AT_POINT})(${local[0]}, ${local[1]}, `;
    const reply = (await debuggee.sendCommand(
      "Runtime.evaluate",
      { expression: `${call}false)` },
      sessionId,
    )) as { readonly result?: { readonly objectId?: string } };
    const objectId = reply.result?.objectId;
    if (objectId === undefined) break;
    const point = await evaluate(debuggee, `${call}true)`, sessionId);
    const child = await frameElementSession(debuggee, objectId, sessionId, frameSessions);
    if (child === undefined || !Array.isArray(point)) break;
    sessionId = child;
    local = point as ReadonlyArray<number>;
    route = { sessionId, dx: x - local[0]!, dy: y - local[1]! };
  }
  return route;
};

/** The route a held button keeps, so its release reaches the frame that took the press. */
const pointerCaptures = new WeakMap<Electron.WebContents, PointerRoute | null>();

const routeMouseEvent = async (
  webContents: Electron.WebContents,
  debuggee: Electron.Debugger,
  params: Record<string, unknown>,
  frameSessions: FrameSessions,
) => {
  const { x, y, type } = params;
  if (frameSessions.size === 0 || typeof x !== "number" || typeof y !== "number") return undefined;
  const route = pointerCaptures.has(webContents)
    ? (pointerCaptures.get(webContents) ?? undefined)
    : await routePointer(debuggee, frameSessions, x, y);
  if (type === "mousePressed") pointerCaptures.set(webContents, route ?? null);
  else if (type === "mouseReleased") pointerCaptures.delete(webContents);
  return route === undefined ? undefined : { route, x, y };
};

const pointerCommands = new WeakMap<Electron.WebContents, Promise<unknown>>();

/** Focus capture crosses processes; later pointer events must not overtake the press. */
const sendPointerCommand = async (
  webContents: Electron.WebContents,
  debuggee: Electron.Debugger,
  method: string,
  params: Record<string, unknown>,
  sessionId: string | undefined,
  frameSessions: FrameSessions,
) => {
  const previous = pointerCommands.get(webContents) ?? Promise.resolve();
  const current = previous
    .catch(() => {})
    .then(async () => {
      const routed =
        method === "Input.dispatchMouseEvent" && sessionId === undefined
          ? await routeMouseEvent(webContents, debuggee, params, frameSessions)
          : undefined;
      const target = routed?.route.sessionId ?? sessionId;
      const sent = routed
        ? { ...params, x: routed.x - routed.route.dx, y: routed.y - routed.route.dy }
        : params;
      return params["type"] === "mousePressed" || params["type"] === "touchStart"
        ? sendPointerPress(webContents, debuggee, method, sent, target)
        : debuggee.sendCommand(method, sent, target);
    });
  pointerCommands.set(webContents, current);
  try {
    return await current;
  } finally {
    if (pointerCommands.get(webContents) === current) pointerCommands.delete(webContents);
  }
};

/** Sends one command to the guest's page, keeping reloads and input inside it. */
export const sendPageCommand = async (
  webContents: Electron.WebContents,
  debuggee: Electron.Debugger,
  method: string,
  params: Record<string, unknown>,
  sessionId?: string,
  frameSessions: FrameSessions = new Map(),
): Promise<unknown> => {
  if (method === "Input.dispatchMouseEvent" || method === "Input.dispatchTouchEvent") {
    return sendPointerCommand(webContents, debuggee, method, params, sessionId, frameSessions);
  }
  if (sessionId !== undefined) return debuggee.sendCommand(method, params, sessionId);
  // Electron's debugger routes Page.reload on a webview to its embedder window.
  if (method === "Page.reload") {
    if (params["ignoreCache"] === true) webContents.reloadIgnoringCache();
    else webContents.reload();
    return {};
  }
  if (method === "Page.stopLoading") {
    webContents.stop();
    return {};
  }
  if (!FOCUS_ROUTED_INPUT.has(method) || webContents.focusedFrame) {
    return debuggee.sendCommand(method, params);
  }
  const focused = await focusedSession(debuggee, frameSessions);
  if (focused === null) throw new Error(CROSS_SITE_FOCUS_MESSAGE);
  if (focused !== undefined) return editCrossSiteFrame(debuggee, focused, method, params);
  switch (method) {
    case "Input.insertText":
      await webContents.insertText(typeof params["text"] === "string" ? params["text"] : "");
      return {};
    case "Input.dispatchKeyEvent": {
      for (const event of toKeyboardInputEvents(params)) webContents.sendInputEvent(event);
      const commands = Array.isArray(params["commands"])
        ? params["commands"].filter((command) => EDITING_COMMANDS.has(command))
        : [];
      // Runs after the page handles the keys, so the reply also waits for them.
      await evaluate(
        debuggee,
        `(() => { const doc = ${FOCUSED_DOCUMENT}; for (const name of ${JSON.stringify(commands)}) doc?.execCommand(name); return 0; })()`,
      );
      return {};
    }
    default:
      throw new Error(`${method} needs the preview to have focus.`);
  }
};
