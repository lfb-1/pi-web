import { describe, expect, it } from "vitest";
import type { SessionInfo } from "./api";
import type { ChatLine } from "./components/shared";
import {
  buildAgentSessionGraph,
  collectAgentRunEvidence,
  isAgentChildSession,
  layoutAgentSessionGraph,
  mainAgentSessionForSelection,
  mainAgentSessions,
  subagentSessionIdentity,
} from "./agentSessionGraph";

describe("agent session classification", () => {
  it("recognizes pi-subagents names and keeps only main sessions in navigation", () => {
    const main = session("main");
    const fork = session("fork", { parentSessionPath: main.path });
    const subagent = session("worker", { name: "subagent-worker-6370b6c4-1" });

    expect(subagentSessionIdentity(subagent)).toEqual({ agent: "worker", runKey: "6370b6c4" });
    expect(isAgentChildSession(fork)).toBe(true);
    expect(isAgentChildSession(subagent)).toBe(true);
    expect(mainAgentSessions([main, fork, subagent])).toEqual([main]);
    expect(mainAgentSessionForSelection([main, fork, subagent], fork)).toEqual(main);
  });

  it("requires the complete generated name and supports hyphenated agents with UUID runs", () => {
    const ordinary = session("ordinary", { name: "review-the-subagent-output" });
    const incomplete = session("incomplete", { name: "subagent-notes" });
    const generated = session("generated", { name: "subagent-code-reviewer-6015cb66-50db-459b-bece-39702fc44e59-1" });

    expect(subagentSessionIdentity(ordinary)).toBeUndefined();
    expect(subagentSessionIdentity(incomplete)).toBeUndefined();
    expect(isAgentChildSession(incomplete)).toBe(false);
    expect(subagentSessionIdentity(generated)).toEqual({ agent: "code-reviewer", runKey: "6015cb66" });
  });
});

describe("subagent run evidence", () => {
  it("extracts structured session, model, thinking, and state fields", () => {
    const evidence = collectAgentRunEvidence([subagentResult({
      results: [{
        agent: "worker",
        runId: "6370b6c4",
        sessionFile: "/sessions/worker.jsonl",
        model: "openai-codex/gpt-5.6-luna:max",
        exitCode: 0,
      }],
    })]);

    expect(evidence).toEqual([expect.objectContaining({
      agent: "worker",
      runId: "6370b6c4",
      sessionPath: "/sessions/worker.jsonl",
      model: "openai-codex/gpt-5.6-luna:max",
      state: "complete",
    })]);
  });
});

describe("agent session graph", () => {
  it("combines parent-session links with fresh subagent session evidence", () => {
    const main = session("main", { path: "/sessions/main.jsonl" });
    const forkedReviewer = session("reviewer", {
      path: "/sessions/reviewer.jsonl",
      parentSessionPath: main.path,
      name: "subagent-reviewer-aabbccdd-1",
    });
    const freshWorker = session("worker", {
      path: "/sessions/worker.jsonl",
      name: "subagent-worker-6370b6c4-1",
    });
    const unrelated = session("other", { path: "/sessions/other.jsonl" });
    const graph = buildAgentSessionGraph([main, forkedReviewer, freshWorker, unrelated], main, [subagentResult({
      results: [{
        agent: "worker",
        runId: "6370b6c4",
        sessionFile: freshWorker.path,
        model: "openai-codex/gpt-5.6-luna:max",
        status: "completed",
      }],
    })]);

    expect(graph.nodes.map((node) => node.session.id)).toEqual(["main", "reviewer", "worker"]);
    expect(graph.nodes.find((node) => node.session.id === "worker")).toMatchObject({
      parentSessionId: "main",
      kind: "subagent",
      agent: "worker",
      model: "openai-codex/gpt-5.6-luna",
      thinking: "max",
      evidenceState: "complete",
    });
    expect(graph.nodes.find((node) => node.session.id === "reviewer")).toMatchObject({ parentSessionId: "main" });
  });

  it("lays out descendants below their parent and returns matching edges", () => {
    const main = session("main", { path: "/sessions/main.jsonl" });
    const child = session("child", { path: "/sessions/child.jsonl", parentSessionPath: main.path });
    const grandchild = session("grandchild", { path: "/sessions/grandchild.jsonl", parentSessionPath: child.path });
    const layout = layoutAgentSessionGraph(buildAgentSessionGraph([main, child, grandchild], main, []));
    const byId = new Map(layout.nodes.map((node) => [node.session.id, node]));

    expect(byId.get("child")?.y).toBeGreaterThan(byId.get("main")?.y ?? 0);
    expect(byId.get("grandchild")?.y).toBeGreaterThan(byId.get("child")?.y ?? 0);
    expect(layout.edges).toEqual([
      { parentSessionId: "main", childSessionId: "child" },
      { parentSessionId: "child", childSessionId: "grandchild" },
    ]);
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

function subagentResult(details: unknown): ChatLine {
  return {
    role: "tool",
    parts: [{
      type: "toolExecution",
      toolCallId: "subagent-1",
      toolName: "subagent",
      summary: "workflow",
      status: "success",
      resultText: "Workflow completed.",
      details,
    }],
  };
}
