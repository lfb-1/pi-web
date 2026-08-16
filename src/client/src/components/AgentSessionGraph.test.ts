// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionInfo } from "../api";
import type { ChatLine } from "./shared";
import { AgentSessionGraphElement } from "./AgentSessionGraph";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

describe("AgentSessionGraphElement", () => {
  it("folds subagents by default and unfolds them from their main node", async () => {
    const main = session("main", { path: "/sessions/main.jsonl" });
    const child = session("child", {
      path: "/sessions/child.jsonl",
      parentSessionPath: main.path,
      name: "subagent-reviewer-aabbccdd-1",
    });
    const select = vi.fn<(session: SessionInfo, rootSession: SessionInfo) => void>();
    const graph = new AgentSessionGraphElement();
    graph.sessions = [main, child];
    graph.selectedSession = main;
    graph.onSelectSession = select;
    document.body.append(graph);
    await graph.updateComplete;

    expect(graph.shadowRoot?.querySelectorAll(".agent-node")).toHaveLength(1);
    const mainNode = graph.shadowRoot?.querySelector<SVGGElement>(".agent-node.main");
    expect(mainNode?.getAttribute("aria-expanded")).toBe("false");
    mainNode?.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
    await graph.updateComplete;

    const nodes = graph.shadowRoot?.querySelectorAll<SVGGElement>(".agent-node");
    expect(nodes).toHaveLength(2);
    expect(mainNode?.getAttribute("aria-expanded")).toBe("true");
    nodes?.[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
    expect(select).toHaveBeenNthCalledWith(1, main, main);
    expect(select).toHaveBeenNthCalledWith(2, child, main);
  });

  it("switches graph roots when a child from another main session becomes selected", async () => {
    const mainA = session("main-a", { path: "/sessions/main-a.jsonl" });
    const childA = session("child-a", { path: "/sessions/child-a.jsonl", parentSessionPath: mainA.path });
    const mainB = session("main-b", { path: "/sessions/main-b.jsonl" });
    const childB = session("child-b", { path: "/sessions/child-b.jsonl", parentSessionPath: mainB.path });
    const graph = new AgentSessionGraphElement();
    graph.sessions = [mainA, childA, mainB, childB];
    graph.selectedSession = mainA;
    document.body.append(graph);
    await graph.updateComplete;

    graph.selectedSession = childB;
    await graph.updateComplete;

    const text = graph.shadowRoot?.querySelector("svg")?.textContent ?? "";
    expect(text).toContain("Session main-b");
    expect(text).toContain("1 subagent · folded");
    expect(text).not.toContain("Session child-b");
    expect(text).not.toContain("Session main-a");
  });

  it("keeps forked mains visible and unfolds each fork's own subagents", async () => {
    const main = session("main", { path: "/sessions/main.jsonl" });
    const fork = session("fork", {
      path: "/sessions/fork.jsonl",
      parentSessionPath: main.path,
      parentSessionRelation: "fork",
      name: "Main — Fork 1",
    });
    const child = session("fork-child", {
      path: "/sessions/fork-child.jsonl",
      parentSessionPath: fork.path,
      parentSessionRelation: "subagent",
      name: "subagent-worker-11223344-1",
    });
    const select = vi.fn<(session: SessionInfo, rootSession: SessionInfo) => void>();
    const graph = new AgentSessionGraphElement();
    graph.sessions = [main, fork, child];
    graph.selectedSession = main;
    graph.onSelectSession = select;
    document.body.append(graph);
    await graph.updateComplete;

    expect(graph.shadowRoot?.querySelectorAll(".agent-node")).toHaveLength(2);
    const forkNode = graph.shadowRoot?.querySelector<SVGGElement>(".agent-node.main-fork");
    forkNode?.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
    await graph.updateComplete;

    expect(graph.shadowRoot?.querySelectorAll(".agent-node")).toHaveLength(3);
    expect(forkNode?.getAttribute("aria-expanded")).toBe("true");
    expect(select).toHaveBeenCalledWith(fork, main);
  });

  it("does not mix cached subagent evidence across main lineages", async () => {
    const mainA = session("main-a", { path: "/sessions/main-a.jsonl" });
    const childA = session("child-a", { path: "/sessions/child-a.jsonl", name: "subagent-worker-aabbccdd-1" });
    const mainB = session("main-b", { path: "/sessions/main-b.jsonl" });
    const graph = new AgentSessionGraphElement();
    graph.sessions = [mainA, childA, mainB];
    graph.selectedSession = mainA;
    graph.messages = [subagentResult(childA.path)];
    document.body.append(graph);
    await graph.updateComplete;
    expect(graph.shadowRoot?.textContent).toContain("1 subagent");

    graph.selectedSession = mainB;
    graph.messages = [];
    await graph.updateComplete;

    expect(graph.shadowRoot?.textContent).toContain("1 main · 0 subagents");
    expect(graph.shadowRoot?.textContent).not.toContain("Session child-a");
  });

  it("does not promote an unlinked subagent session to a main agent on cold load", async () => {
    const orphan = session("orphan", { name: "subagent-worker-6370b6c4-1" });
    const graph = new AgentSessionGraphElement();
    graph.sessions = [orphan];
    graph.selectedSession = orphan;
    document.body.append(graph);
    await graph.updateComplete;

    expect(graph.shadowRoot?.textContent).toContain("Select a main-agent session");
    expect(graph.shadowRoot?.querySelector(".agent-node")).toBeNull();
  });

  it("provides zoom controls and keeps details off the canvas", async () => {
    const main = session("main");
    const graph = new AgentSessionGraphElement();
    graph.sessions = [main];
    graph.selectedSession = main;
    document.body.append(graph);
    await graph.updateComplete;

    const zoomIn = graph.shadowRoot?.querySelector<HTMLButtonElement>('button[aria-label="Zoom in agent graph"]');
    zoomIn?.click();
    await graph.updateComplete;

    expect(graph.shadowRoot?.querySelector(".zoom-value")?.textContent).toBe("120%");
    expect(graph.shadowRoot?.querySelector("details")).toBeNull();
    expect(graph.shadowRoot?.textContent).toContain("Subagents and main-session forks will appear here");
  });
});

function subagentResult(sessionFile: string): ChatLine {
  return {
    role: "tool",
    parts: [{
      type: "toolExecution",
      toolCallId: "subagent-1",
      toolName: "subagent",
      summary: "workflow",
      status: "success",
      details: { results: [{ agent: "worker", runId: "aabbccdd", sessionFile, status: "completed" }] },
    }],
  };
}

function session(id: string, overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id,
    cwd: "/workspace",
    path: `/sessions/${id}.jsonl`,
    created: "2026-08-16T00:00:00.000Z",
    modified: "2026-08-16T00:01:00.000Z",
    messageCount: 1,
    firstMessage: `Session ${id}`,
    ...overrides,
  };
}
