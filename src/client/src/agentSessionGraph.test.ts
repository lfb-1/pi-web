import { describe, expect, it } from "vitest";
import type { SessionInfo } from "./api";
import type { ChatLine } from "./components/shared";
import {
  buildAgentSessionGraph,
  collectAgentRunEvidence,
  isAgentChildSession,
  layoutAgentSessionGraph,
  mainAgentLineageRoot,
  mainAgentSessionForSelection,
  mainAgentSessions,
  subagentCountsByMain,
  subagentSessionIdentity,
  visibleAgentSessionGraph,
} from "./agentSessionGraph";

describe("agent session classification", () => {
  it("keeps marked main forks in navigation while filtering subagents", () => {
    const main = session("main");
    const fork = session("fork", { parentSessionPath: main.path, parentSessionRelation: "fork", name: "Main — Fork 1" });
    const subagent = session("worker", { parentSessionPath: fork.path, name: "subagent-worker-6370b6c4-1" });
    const legacySubagent = session("legacy", { parentSessionPath: main.path, name: "Legacy tracked child" });

    expect(subagentSessionIdentity(subagent)).toEqual({ agent: "worker", runKey: "6370b6c4" });
    expect(isAgentChildSession(fork)).toBe(false);
    expect(isAgentChildSession(subagent)).toBe(true);
    expect(isAgentChildSession(legacySubagent)).toBe(true);
    expect(mainAgentSessions([main, fork, subagent, legacySubagent])).toEqual([main, fork]);
    expect(mainAgentSessionForSelection([main, fork, subagent], fork)).toEqual(fork);
    expect(mainAgentSessionForSelection([main, fork, subagent], subagent)).toEqual(fork);
    expect(mainAgentLineageRoot([main, fork, subagent], subagent)).toEqual(main);
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

  it("shows the main-fork lineage while folding subagents under their owning main", () => {
    const main = session("main", { path: "/sessions/main.jsonl" });
    const fork = session("fork", {
      path: "/sessions/fork.jsonl",
      parentSessionPath: main.path,
      parentSessionRelation: "fork",
      name: "Main — Fork 1",
    });
    const mainWorker = session("main-worker", {
      path: "/sessions/main-worker.jsonl",
      parentSessionPath: main.path,
      parentSessionRelation: "subagent",
      name: "subagent-worker-aabbccdd-1",
    });
    const forkReviewer = session("fork-reviewer", {
      path: "/sessions/fork-reviewer.jsonl",
      parentSessionPath: fork.path,
      parentSessionRelation: "subagent",
      name: "subagent-reviewer-11223344-1",
    });
    const graph = buildAgentSessionGraph([main, fork, mainWorker, forkReviewer], main, []);

    expect(graph.nodes.find((node) => node.session.id === "fork")?.kind).toBe("main-fork");
    expect(Object.fromEntries(subagentCountsByMain(graph))).toEqual({ main: 1, fork: 1 });
    expect(visibleAgentSessionGraph(graph, new Set()).nodes.map((node) => node.session.id)).toEqual(["main", "fork"]);
    expect(visibleAgentSessionGraph(graph, new Set(["main"])).nodes.map((node) => node.session.id)).toEqual(["main", "fork", "main-worker"]);
    expect(visibleAgentSessionGraph(graph, new Set(["fork"])).nodes.map((node) => node.session.id)).toEqual(["main", "fork", "fork-reviewer"]);
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
