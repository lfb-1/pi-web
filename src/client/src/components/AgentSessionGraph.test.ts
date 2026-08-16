// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionInfo } from "../api";
import { AgentSessionGraphElement } from "./AgentSessionGraph";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

describe("AgentSessionGraphElement", () => {
  it("renders the main/child graph and switches sessions from a node", async () => {
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

    const nodes = graph.shadowRoot?.querySelectorAll<SVGGElement>(".agent-node");
    expect(nodes).toHaveLength(2);
    nodes?.[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
    expect(select).toHaveBeenCalledWith(child, main);
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
    expect(text).toContain("Session child-b");
    expect(text).not.toContain("Session main-a");
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
    expect(graph.shadowRoot?.textContent).toContain("Subagents will appear here");
  });
});

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
