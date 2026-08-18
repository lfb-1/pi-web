import { describe, expect, it } from "vitest";
import { activeWorkItem, decisionRequiresAttention, parseResearchWorkflowStateText, type ResearchWorkflowState } from "./researchWorkflowState.js";

const source: { kind: "pi"; ref: string; at: string } = {
  kind: "pi",
  ref: "session:s-1#entry-1",
  at: "2026-08-15T20:00:00.000Z",
};

function validState(): ResearchWorkflowState {
  return {
    version: 2,
    updatedAt: "2026-08-15T20:01:00.000Z",
    activeWorkItemId: "parafm.current",
    workItems: [
      {
        id: "parafm.current",
        title: "Validate the current ParaFM direction",
        objective: "Determine whether the current method advances CIFAR-10 test accuracy.",
        objectiveStatus: "proposed",
        phase: "research",
        definitionOfDone: "The registered accuracy gate has a terminal result and interpretation.",
        brief: {
          question: "Does the current method improve CIFAR-10 accuracy?",
          currentAnswer: "No improvement is established yet.",
          confidence: "low",
          confidenceReason: "The registered accuracy gate is still pending.",
          nextActionOwner: "runtime",
          nextAction: "Wait for the registered run to finish.",
          evidenceRefs: ["accuracy.gate"],
          source,
        },
        acceptanceCriteria: [
          {
            id: "accuracy.gate",
            title: "Accuracy gate",
            predicate: "CIFAR-10 test accuracy meets the registered threshold.",
            status: "proposed",
            result: "pending",
            evidenceRefs: [],
            source,
          },
        ],
        decisions: [],
        runs: [],
        artifacts: [],
        findings: [],
        sessions: [],
        workspaces: [],
        source,
      },
    ],
  };
}

function stateWithGraph(): ResearchWorkflowState {
  const state = validState();
  state.causalGraph = {
    title: "ParaFM research idea",
    status: "active",
    activeNodeId: "hypothesis.next",
    activePathEdgeIds: ["edge.tests", "edge.produces", "edge.concludes", "edge.motivates"],
    nodes: [
      { id: "hypothesis.first", kind: "hypothesis", title: "Current method improves accuracy", summary: "Test the current scientific direction.", status: "completed", workItemId: "parafm.current", evidenceRefs: [], source },
      { id: "validation.first", kind: "validation", title: "Registered accuracy comparison", summary: "Compare the registered treatment and control.", status: "completed", workItemId: "parafm.current", evidenceRefs: ["parafm.current/criterion:accuracy.gate"], source },
      { id: "analysis.first", kind: "analysis", title: "No improvement observed", summary: "The registered criterion did not show an accuracy gain.", status: "completed", workItemId: "parafm.current", evidenceRefs: ["parafm.current/criterion:accuracy.gate"], source },
      { id: "conclusion.first", kind: "conclusion", title: "Current hypothesis denied", summary: "The scoped method did not pass its accuracy gate.", status: "completed", conclusion: "denied", workItemId: "parafm.current", evidenceRefs: ["parafm.current/criterion:accuracy.gate"], source },
      { id: "conclusion.parallel", kind: "conclusion", title: "Parallel branch is unsure", summary: "A second branch remains inconclusive.", status: "completed", conclusion: "unsure", workItemId: "parafm.current", evidenceRefs: ["parafm.current/criterion:accuracy.gate"], source },
      { id: "hypothesis.next", kind: "hypothesis", title: "Test the revised mechanism", summary: "Follow the analysis with a narrower hypothesis.", status: "active", workItemId: "parafm.current", evidenceRefs: [], source },
    ],
    edges: [
      { id: "edge.tests", from: "hypothesis.first", to: "validation.first", kind: "tests", source },
      { id: "edge.produces", from: "validation.first", to: "analysis.first", kind: "produces", source },
      { id: "edge.concludes", from: "analysis.first", to: "conclusion.first", kind: "concludes", source },
      { id: "edge.motivates", from: "conclusion.first", to: "hypothesis.next", kind: "motivates", direction: "Narrow the mechanism and retest.", source },
      { id: "edge.merges", from: "conclusion.parallel", to: "hypothesis.next", kind: "motivates", direction: "Resolve the remaining uncertainty in the same next test.", source },
    ],
    source,
  };
  return state;
}

describe("research workflow state", () => {
  it("parses a valid state and resolves its active work item", () => {
    const parsed = parseResearchWorkflowStateText(JSON.stringify(validState()));

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(activeWorkItem(parsed.state)?.id).toBe("parafm.current");
    expect(parsed.state.workItems[0]?.acceptanceCriteria[0]?.result).toBe("pending");
  });

  it("preserves the conservative authority-dialog provenance mode", () => {
    const state = validState();
    const item = state.workItems[0];
    if (item === undefined) throw new Error("expected work item");
    item.objectiveStatus = "confirmed";
    item.authoritySource = {
      kind: "user",
      ref: "session:s-1#entry-1",
      at: "2026-08-15T20:00:00.000Z",
      authorityMode: "dialog-or-recommended-timeout-policy",
    };

    const parsed = parseResearchWorkflowStateText(JSON.stringify(state));

    expect(parsed).toMatchObject({
      ok: true,
      state: { workItems: [{ authoritySource: { authorityMode: "dialog-or-recommended-timeout-policy" } }] },
    });
  });

  it("rejects authority-dialog mode on a non-user source", () => {
    const state = validState();
    const item = state.workItems[0];
    if (item === undefined) throw new Error("expected work item");
    item.source = { ...source, authorityMode: "dialog-or-recommended-timeout-policy" };

    const parsed = parseResearchWorkflowStateText(JSON.stringify(state));

    expect(parsed).toMatchObject({ ok: false });
    if (!parsed.ok) expect(parsed.error).toContain("requires source kind user");
  });

  it("keeps states without a semantic brief compatible", () => {
    const state = validState();
    if (state.workItems[0] !== undefined) delete state.workItems[0].brief;

    const parsed = parseResearchWorkflowStateText(JSON.stringify(state));

    expect(parsed).toMatchObject({ ok: true });
  });

  it("rejects an invalid or overlong semantic brief", () => {
    const invalidConfidence = validState();
    const invalidBrief = invalidConfidence.workItems[0]?.brief;
    if (invalidBrief !== undefined) Reflect.set(invalidBrief, "confidence", "certain");
    expect(parseResearchWorkflowStateText(JSON.stringify(invalidConfidence))).toMatchObject({ ok: false });

    const overlongQuestion = validState();
    const overlongBrief = overlongQuestion.workItems[0]?.brief;
    if (overlongBrief !== undefined) overlongBrief.question = "x".repeat(241);
    const parsed = parseResearchWorkflowStateText(JSON.stringify(overlongQuestion));
    expect(parsed).toMatchObject({ ok: false });
    if (!parsed.ok) expect(parsed.error).toContain("at most 240 characters");
  });

  it("rejects semantic-brief sources that do not resolve to detailed records", () => {
    const state = validState();
    const brief = state.workItems[0]?.brief;
    if (brief !== undefined) brief.evidenceRefs = ["/unlabeled/raw/path"];

    const parsed = parseResearchWorkflowStateText(JSON.stringify(state));

    expect(parsed).toMatchObject({ ok: false });
    if (!parsed.ok) expect(parsed.error).toContain("references missing record /unlabeled/raw/path");
  });

  it("rejects an active work item reference that does not exist", () => {
    const state = validState();
    state.activeWorkItemId = "missing.item";

    expect(parseResearchWorkflowStateText(JSON.stringify(state))).toEqual({
      ok: false,
      error: "state.activeWorkItemId references missing work item missing.item",
    });
  });

  it("rejects resolved decisions without a resolution", () => {
    const state = validState();
    state.workItems[0]?.decisions.push({
      id: "decision.one",
      kind: "ambiguity",
      question: "Which dataset split should be used?",
      impact: "The choice changes the reported result.",
      status: "resolved",
      source,
    });

    const parsed = parseResearchWorkflowStateText(JSON.stringify(state));
    expect(parsed).toMatchObject({ ok: false });
    if (!parsed.ok) expect(parsed.error).toContain("resolution is required");
  });

  it("rejects duplicate child record ids", () => {
    const state = validState();
    const criterion = state.workItems[0]?.acceptanceCriteria[0];
    if (criterion !== undefined) state.workItems[0]?.acceptanceCriteria.push({ ...criterion });

    const parsed = parseResearchWorkflowStateText(JSON.stringify(state));
    expect(parsed).toMatchObject({ ok: false });
    if (!parsed.ok) expect(parsed.error).toContain("duplicate id accuracy.gate");
  });

  it("rejects malformed timestamps and identifiers", () => {
    const state = validState();
    if (state.workItems[0] !== undefined) {
      state.workItems[0].id = "Bad ID";
      state.workItems[0].source = { ...source, at: "not-a-time" };
    }

    const parsed = parseResearchWorkflowStateText(JSON.stringify(state));
    expect(parsed).toMatchObject({ ok: false });
  });

  it("migrates version-1 state in memory without inventing a causal graph", () => {
    const current = validState();
    const legacy = { ...current, version: 1 };

    const parsed = parseResearchWorkflowStateText(JSON.stringify(legacy));

    expect(parsed).toMatchObject({ ok: true, state: { version: 2 } });
    if (parsed.ok) expect(parsed.state.causalGraph).toBeUndefined();
  });

  it("parses a branched and merged causal DAG with a persisted active path", () => {
    const parsed = parseResearchWorkflowStateText(JSON.stringify(stateWithGraph()));

    expect(parsed).toMatchObject({
      ok: true,
      state: {
        causalGraph: {
          activeNodeId: "hypothesis.next",
          activePathEdgeIds: ["edge.tests", "edge.produces", "edge.concludes", "edge.motivates"],
        },
      },
    });
  });

  it("rejects invalid stage edges, cycles, active paths, and unresolved typed evidence", () => {
    const invalidStage = stateWithGraph();
    const firstEdge = invalidStage.causalGraph?.edges[0];
    if (firstEdge !== undefined) firstEdge.kind = "produces";
    expect(parseResearchWorkflowStateText(JSON.stringify(invalidStage))).toMatchObject({ ok: false });

    const cycle = stateWithGraph();
    cycle.causalGraph?.nodes.push(
      { id: "validation.next", kind: "validation", title: "Next validation", summary: "Validate the next hypothesis.", status: "completed", evidenceRefs: [], source },
      { id: "analysis.next", kind: "analysis", title: "Next analysis", summary: "Interpret the next validation.", status: "completed", evidenceRefs: ["parafm.current/criterion:accuracy.gate"], source },
      { id: "conclusion.next", kind: "conclusion", title: "Next conclusion", summary: "Close the next cycle.", status: "completed", conclusion: "unsure", evidenceRefs: ["parafm.current/criterion:accuracy.gate"], source },
    );
    cycle.causalGraph?.edges.push(
      { id: "edge.tests.next", from: "hypothesis.next", to: "validation.next", kind: "tests", source },
      { id: "edge.produces.next", from: "validation.next", to: "analysis.next", kind: "produces", source },
      { id: "edge.concludes.next", from: "analysis.next", to: "conclusion.next", kind: "concludes", source },
      { id: "edge.cycle", from: "conclusion.next", to: "hypothesis.first", kind: "motivates", direction: "Repeat the original hypothesis.", source },
    );
    const cycleParsed = parseResearchWorkflowStateText(JSON.stringify(cycle));
    expect(cycleParsed).toMatchObject({ ok: false });
    if (!cycleParsed.ok) expect(cycleParsed.error).toContain("directed acyclic graph");

    const invalidPath = stateWithGraph();
    if (invalidPath.causalGraph !== undefined) invalidPath.causalGraph.activePathEdgeIds = ["edge.merges", "edge.tests"];
    expect(parseResearchWorkflowStateText(JSON.stringify(invalidPath))).toMatchObject({ ok: false });

    const invalidEvidence = stateWithGraph();
    const analysis = invalidEvidence.causalGraph?.nodes.find((node) => node.id === "analysis.first");
    if (analysis !== undefined) analysis.evidenceRefs = ["parafm.current/run:missing"];
    const evidenceParsed = parseResearchWorkflowStateText(JSON.stringify(invalidEvidence));
    expect(evidenceParsed).toMatchObject({ ok: false });
    if (!evidenceParsed.ok) expect(evidenceParsed.error).toContain("missing run missing");
  });

  it("rejects completion while the graph still has active work", () => {
    const state = stateWithGraph();
    const graph = state.causalGraph;
    if (graph === undefined) throw new Error("expected graph");
    graph.status = "completed";
    graph.authoritySource = { kind: "user", ref: "session:s-1#entry-2", at: "2026-08-17T00:00:00.000Z" };

    const parsed = parseResearchWorkflowStateText(JSON.stringify(state));

    expect(parsed).toMatchObject({ ok: false });
    if (!parsed.ok) expect(parsed.error).toContain("unfinished node");
  });

  it("accepts automated overall graph completion without authority provenance", () => {
    const state = stateWithGraph();
    const graph = state.causalGraph;
    if (graph === undefined) throw new Error("expected graph");
    graph.status = "completed";
    delete graph.activeNodeId;
    graph.activePathEdgeIds = [];
    for (const node of graph.nodes) node.status = "completed";
    delete graph.authoritySource;

    const parsed = parseResearchWorkflowStateText(JSON.stringify(state));

    expect(parsed).toMatchObject({ ok: true, state: { causalGraph: { status: "completed" } } });
  });

  it("only marks open blocking or critical decisions for attention", () => {
    const base = { id: "decision.one", kind: "ambiguity" as const, question: "Choose?", impact: "Direction", status: "open" as const, source };
    expect(decisionRequiresAttention(base)).toBe(false);
    expect(decisionRequiresAttention({ ...base, importance: "critical" })).toBe(true);
    expect(decisionRequiresAttention({ ...base, blocking: true })).toBe(true);
    expect(decisionRequiresAttention({ ...base, importance: "critical", status: "resolved", resolution: "Done" })).toBe(false);
  });
});
