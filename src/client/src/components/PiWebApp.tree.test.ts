import type { TemplateResult } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionInfo, SessionTreeForkResult, SessionTreeNavigateResult, SessionTreeSnapshot, SessionTreeSummaryChoice } from "../api";
import { initialAppState, type AppState } from "../appState";
import { SessionController } from "../controllers/sessionController";
// This node-environment test uses the shared, type-guarded template inspection
// escape hatch only to verify PiWebApp's navigator callback boundary.
import { templateValueAfterMarker } from "../templateInspection.testSupport";
import { PiWebApp } from "./PiWebApp";

type NavigateHandler = (targetId: string, summaryChoice: SessionTreeSummaryChoice) => Promise<SessionTreeNavigateResult>;
type ForkHandler = (entryId: string) => Promise<SessionTreeForkResult>;
type AbortHandler = () => Promise<void>;
type CancelHandler = () => void;
type RenderSessionTreeNavigator = (this: PiWebApp, state: AppState) => TemplateResult | null;
type RenderChatView = (this: PiWebApp, state: AppState, session: SessionInfo) => TemplateResult;
type ResponseForkHandler = (entryId: string) => Promise<void>;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("PiWebApp session tree wiring", () => {
  it("routes navigation, cancellation, abort, and prompt focus through SessionController", async () => {
    const app = createApp();
    const state = setAppTree(app, tree());
    const controller = appSessionController(app);
    const navigateTree = vi.spyOn(controller, "navigateTree")
      .mockResolvedValueOnce({ cancelled: false, editorText: "edit" })
      .mockResolvedValueOnce({ cancelled: true, aborted: true });
    const abortTreeNavigation = vi.spyOn(controller, "abortTreeNavigation").mockResolvedValue(undefined);
    const closeTreeDialog = vi.spyOn(controller, "closeTreeDialog").mockReturnValue(undefined);
    const focusChatComposer = vi.fn(() => Promise.resolve());
    if (!Reflect.set(app, "focusChatComposer", focusChatComposer)) throw new Error("Could not replace prompt focus boundary");

    const rendered = renderSessionTreeNavigator(app, state);
    const onNavigate = navigatorNavigateHandler(rendered);
    const onAbort = navigatorAbortHandler(rendered);
    const onCancel = navigatorCancelHandler(rendered);

    await expect(onNavigate("side", { mode: "none" })).resolves.toEqual({ cancelled: false, editorText: "edit" });
    expect(navigateTree).toHaveBeenNthCalledWith(1, "side", { mode: "none" });
    expect(focusChatComposer).toHaveBeenCalledOnce();

    await expect(onNavigate("root", { mode: "default" })).resolves.toEqual({ cancelled: true, aborted: true });
    expect(focusChatComposer).toHaveBeenCalledOnce();

    await onAbort();
    expect(abortTreeNavigation).toHaveBeenCalledOnce();

    onCancel();
    expect(closeTreeDialog).toHaveBeenCalledOnce();
    expect(focusChatComposer).toHaveBeenCalledTimes(2);
  });

  it("routes fork requests through SessionController and propagates results and failures", async () => {
    const app = createApp();
    const state = setAppTree(app, tree());
    const controller = appSessionController(app);
    const forkFromTree = vi.spyOn(controller, "forkFromTree")
      .mockResolvedValueOnce({ cancelled: true })
      .mockResolvedValueOnce({ cancelled: false, session: { ...session(), id: "session-fork" } })
      .mockRejectedValueOnce(new Error("Stop current activity before forking."));
    const onFork = navigatorForkHandler(renderSessionTreeNavigator(app, state));

    await expect(onFork("side")).resolves.toEqual({ cancelled: true });
    expect(forkFromTree).toHaveBeenNthCalledWith(1, "side");

    await expect(onFork("root")).resolves.toMatchObject({ cancelled: false, session: { id: "session-fork" } });
    expect(forkFromTree).toHaveBeenNthCalledWith(2, "root");

    await expect(onFork("failure")).rejects.toThrow("Stop current activity before forking.");
    expect(forkFromTree).toHaveBeenNthCalledWith(3, "failure");
  });

  it("routes assistant response forks through SessionController", async () => {
    const app = createApp();
    const state = setAppTree(app, tree());
    const selected = state.selectedSession;
    if (selected === undefined) throw new Error("Expected a selected session");
    const controller = appSessionController(app);
    const forkFromMessage = vi.spyOn(controller, "forkFromMessage").mockResolvedValue({
      cancelled: false,
      session: { ...selected, id: "session-fork", parentSessionPath: selected.path, parentSessionRelation: "fork" },
    });
    const onForkMessage = chatResponseForkHandler(renderChatView(app, state, selected));

    await onForkMessage("assistant-9");

    expect(forkFromMessage).toHaveBeenCalledExactlyOnceWith("assistant-9");
  });

  it("hides response forks for archived sessions and subagent chats", () => {
    const app = createApp();
    const state = setAppTree(app, tree());
    const selected = state.selectedSession;
    if (selected === undefined) throw new Error("Expected a selected session");
    const subagent: SessionInfo = {
      ...selected,
      id: "subagent-1",
      path: "/tmp/subagent-1.jsonl",
      parentSessionPath: selected.path,
      parentSessionRelation: "subagent",
    };
    const archived: SessionInfo = { ...selected, archived: true, archivedAt: "2026-08-16T00:00:00.000Z" };

    expect(templateValueAfterMarker(renderChatView(app, { ...state, selectedSession: subagent }, subagent), ".onForkMessage=")).toBeUndefined();
    expect(templateValueAfterMarker(renderChatView(app, { ...state, selectedSession: archived }, archived), ".onForkMessage=")).toBeUndefined();
  });

  it("does not steal focus after the user selects another session during navigation", async () => {
    const app = createApp();
    const state = setAppTree(app, tree());
    const controller = appSessionController(app);
    const result = deferred<SessionTreeNavigateResult>();
    vi.spyOn(controller, "navigateTree").mockReturnValue(result.promise);
    const focusChatComposer = vi.fn(() => Promise.resolve());
    if (!Reflect.set(app, "focusChatComposer", focusChatComposer)) throw new Error("Could not replace prompt focus boundary");
    const onNavigate = navigatorNavigateHandler(renderSessionTreeNavigator(app, state));

    const navigation = onNavigate("side", { mode: "none" });
    const otherSession = state.selectedSession === undefined ? undefined : { ...state.selectedSession, id: "session-2" };
    if (!Reflect.set(app, "state", { ...state, selectedSession: otherSession })) throw new Error("Could not change selected session");
    result.resolve({ cancelled: false });
    await navigation;

    expect(focusChatComposer).not.toHaveBeenCalled();
  });
});

function createApp(): PiWebApp {
  const storage = {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  };
  vi.stubGlobal("window", { location: { search: "" }, localStorage: storage });
  return new PiWebApp();
}

function setAppTree(app: PiWebApp, treeSnapshot: SessionTreeSnapshot): AppState {
  const selectedSession = {
    ...session(),
    id: "session-1",
  };
  const state = { ...initialAppState(), selectedSession, sessions: [selectedSession], treeDialog: treeSnapshot };
  if (!Reflect.set(app, "state", state)) throw new Error("Could not set PiWebApp tree state");
  return state;
}

function session() {
  return {
    path: "/tmp/session-1.jsonl",
    cwd: "/repo",
    created: "2026-01-01T00:00:00.000Z",
    modified: "2026-01-01T00:00:00.000Z",
    messageCount: 2,
    firstMessage: "Initial prompt",
  };
}

function renderSessionTreeNavigator(app: PiWebApp, state: AppState): TemplateResult {
  const method: unknown = Reflect.get(app, "renderSessionTreeNavigator");
  if (!isRenderSessionTreeNavigator(method)) throw new Error("PiWebApp.renderSessionTreeNavigator was unavailable");
  const rendered = method.call(app, state);
  if (rendered === null) throw new Error("Expected a rendered session tree navigator");
  return rendered;
}

function renderChatView(app: PiWebApp, state: AppState, selected: SessionInfo): TemplateResult {
  const method: unknown = Reflect.get(app, "renderChatView");
  if (!isRenderChatView(method)) throw new Error("PiWebApp.renderChatView was unavailable");
  return method.call(app, state, selected);
}

function chatResponseForkHandler(template: TemplateResult): ResponseForkHandler {
  const value = templateValueAfterMarker(template, ".onForkMessage=");
  if (!isResponseForkHandler(value)) throw new Error("Chat response fork callback was unavailable");
  return value;
}

function appSessionController(app: PiWebApp): SessionController {
  const controller: unknown = Reflect.get(app, "sessions");
  if (!(controller instanceof SessionController)) throw new Error("PiWebApp SessionController was unavailable");
  return controller;
}

function navigatorNavigateHandler(template: TemplateResult): NavigateHandler {
  const value = templateValueAfterMarker(template, ".onNavigate=");
  if (!isNavigateHandler(value)) throw new Error("Session tree navigate callback was unavailable");
  return value;
}

function navigatorForkHandler(template: TemplateResult): ForkHandler {
  const value = templateValueAfterMarker(template, ".onFork=");
  if (!isForkHandler(value)) throw new Error("Session tree fork callback was unavailable");
  return value;
}

function navigatorAbortHandler(template: TemplateResult): AbortHandler {
  const value = templateValueAfterMarker(template, ".onAbort=");
  if (!isAbortHandler(value)) throw new Error("Session tree abort callback was unavailable");
  return value;
}

function navigatorCancelHandler(template: TemplateResult): CancelHandler {
  const value = templateValueAfterMarker(template, ".onCancel=");
  if (!isCancelHandler(value)) throw new Error("Session tree cancel callback was unavailable");
  return value;
}

function isRenderSessionTreeNavigator(value: unknown): value is RenderSessionTreeNavigator {
  return typeof value === "function";
}

function isRenderChatView(value: unknown): value is RenderChatView {
  return typeof value === "function";
}

function isResponseForkHandler(value: unknown): value is ResponseForkHandler {
  return typeof value === "function";
}

function isNavigateHandler(value: unknown): value is NavigateHandler {
  return typeof value === "function";
}

function isForkHandler(value: unknown): value is ForkHandler {
  return typeof value === "function";
}

function isAbortHandler(value: unknown): value is AbortHandler {
  return typeof value === "function";
}

function isCancelHandler(value: unknown): value is CancelHandler {
  return typeof value === "function";
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

function tree(): SessionTreeSnapshot {
  return {
    nodes: [
      { id: "root", parentId: null, kind: "user", summary: "Initial prompt" },
      { id: "side", parentId: "root", kind: "assistant", summary: "Side branch" },
    ],
    activeLeafId: "side",
    activePathIds: ["root", "side"],
  };
}
