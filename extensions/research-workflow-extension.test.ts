import { describe, expect, it } from "vitest";
import {
  mutateState,
  type ResearchWorkflowParameters,
} from "./research-workflow.js";
import {
  parseResearchWorkflowStateText,
  type RecordSource,
  type ResearchWorkflowState,
} from "../pi-web-plugins/research-workflow/researchWorkflowState.js";

const piSource: RecordSource = {
  kind: "pi",
  ref: "session:test-session#user-entry",
  at: "2026-08-15T20:00:00.000Z",
};
const userSource: RecordSource = {
  kind: "user",
  ref: "session:test-session#user-entry",
  at: "2026-08-15T20:00:01.000Z",
};

function emptyState(): ResearchWorkflowState {
  return { version: 2, updatedAt: "2026-08-15T20:00:00.000Z", workItems: [] };
}

function createWorkItem(state: ResearchWorkflowState): ResearchWorkflowState {
  const params: ResearchWorkflowParameters = {
    action: "upsert_work_item",
    workItem: {
      id: "parafm.current",
      title: "Evaluate the current ParaFM direction",
      objective: "Determine whether the method advances CIFAR-10 test accuracy.",
      objectiveStatus: "proposed",
      phase: "research",
      definitionOfDone: "The registered gate reaches a terminal interpretation.",
    },
  };
  return mutateState(state, params, piSource, undefined);
}

describe("research_workflow extension state transitions", () => {
  it("creates proposed work with Pi provenance", () => {
    const state = createWorkItem(emptyState());

    expect(state.activeWorkItemId).toBe("parafm.current");
    expect(state.workItems[0]).toMatchObject({
      id: "parafm.current",
      objectiveStatus: "proposed",
      source: piSource,
    });
  });

  it("rewrites the semantic brief with current Pi provenance and drops legacy authority", () => {
    const state = createWorkItem(emptyState());
    const existing = state.workItems[0];
    if (existing === undefined) throw new Error("expected work item");
    existing.objectiveStatus = "confirmed";
    existing.authoritySource = userSource;
    const laterPiSource: RecordSource = { ...piSource, at: "2026-08-15T20:02:00.000Z" };
    const params: ResearchWorkflowParameters = {
      action: "upsert_work_item",
      workItem: {
        id: "parafm.current",
        brief: {
          question: "Does the method improve CIFAR-10 accuracy?",
          currentAnswer: "No improvement is established yet.",
          confidence: "low",
          confidenceReason: "The registered run is still pending.",
          nextActionOwner: "runtime",
          nextAction: "Wait for the registered run to finish.",
          evidenceRefs: [],
        },
      },
    };

    const updated = mutateState(state, params, laterPiSource, undefined);

    expect(updated.workItems[0]?.brief).toMatchObject({
      currentAnswer: "No improvement is established yet.",
      source: laterPiSource,
    });
    expect(updated.workItems[0]?.authoritySource).toBeUndefined();
  });

  it("updates confirmed objectives automatically without retaining stale user provenance", () => {
    const state = createWorkItem(emptyState());
    const item = state.workItems[0];
    if (item === undefined) throw new Error("expected work item");
    item.objectiveStatus = "confirmed";
    item.authoritySource = userSource;

    const changeObjective: ResearchWorkflowParameters = {
      action: "upsert_work_item",
      workItem: { id: item.id, objective: "Use a different scientific objective." },
    };
    const changed = mutateState(state, changeObjective, piSource, undefined);
    expect(changed.workItems[0]?.objective).toBe("Use a different scientific objective.");
    expect(changed.workItems[0]?.authoritySource).toBeUndefined();

    const downgrade: ResearchWorkflowParameters = {
      action: "upsert_work_item",
      workItem: { id: item.id, objectiveStatus: "proposed" },
    };
    const downgraded = mutateState(state, downgrade, piSource, undefined);
    expect(downgraded.workItems[0]?.objectiveStatus).toBe("proposed");
    expect(downgraded.workItems[0]?.authoritySource).toBeUndefined();
  });

  it("updates completed work-item scope automatically", () => {
    const state = createWorkItem(emptyState());
    const item = state.workItems[0];
    if (item === undefined) throw new Error("expected work item");
    item.phase = "completed";
    item.authoritySource = userSource;
    const params: ResearchWorkflowParameters = {
      action: "upsert_work_item",
      workItem: { id: item.id, definitionOfDone: "Use a different completion contract." },
    };

    const updated = mutateState(state, params, piSource, undefined);
    expect(updated.workItems[0]?.definitionOfDone).toBe("Use a different completion contract.");
    expect(updated.workItems[0]?.authoritySource).toBeUndefined();
  });

  it("approves and changes criteria automatically", () => {
    const state = createWorkItem(emptyState());
    const params: ResearchWorkflowParameters = {
      action: "upsert_acceptance",
      workItemId: "parafm.current",
      criterion: {
        id: "accuracy.gate",
        title: "Accuracy gate",
        predicate: "CIFAR-10 test accuracy meets the registered threshold.",
        status: "approved",
      },
    };

    const updated = mutateState(state, params, piSource, undefined);
    expect(updated.workItems[0]?.acceptanceCriteria[0]).toMatchObject({ status: "approved" });
    expect(updated.workItems[0]?.acceptanceCriteria[0]?.authoritySource).toBeUndefined();

    const changeApproved: ResearchWorkflowParameters = {
      action: "upsert_acceptance",
      workItemId: "parafm.current",
      criterion: { id: "accuracy.gate", predicate: "Use a different threshold." },
    };
    const changed = mutateState(updated, changeApproved, piSource, undefined);
    expect(changed.workItems[0]?.acceptanceCriteria[0]?.predicate).toBe("Use a different threshold.");

    const downgrade: ResearchWorkflowParameters = {
      action: "upsert_acceptance",
      workItemId: "parafm.current",
      criterion: { id: "accuracy.gate", status: "proposed" },
    };
    const downgraded = mutateState(updated, downgrade, piSource, undefined);
    expect(downgraded.workItems[0]?.acceptanceCriteria[0]?.authoritySource).toBeUndefined();
  });

  it("creates and updates a causal graph without an authority request", () => {
    let state = createWorkItem(emptyState());
    const graphParams: ResearchWorkflowParameters = {
      action: "upsert_causal_graph",
      causalGraph: { title: "ParaFM causal graph", status: "active" },
    };
    state = mutateState(state, graphParams, piSource, undefined);
    state = mutateState(state, {
      action: "upsert_causal_node",
      causalNode: {
        id: "hypothesis.one",
        kind: "hypothesis",
        title: "The method improves accuracy",
        summary: "Test the current scientific direction.",
        status: "active",
        workItemId: "parafm.current",
        evidenceRefs: [],
      },
    }, piSource, undefined);
    state = mutateState(state, {
      action: "upsert_causal_graph",
      causalGraph: { activeNodeId: "hypothesis.one", activePathEdgeIds: [] },
    }, piSource, undefined);

    expect(state.causalGraph).toMatchObject({
      title: "ParaFM causal graph",
      activeNodeId: "hypothesis.one",
      activePathEdgeIds: [],
      nodes: [{ id: "hypothesis.one", kind: "hypothesis" }],
    });
    expect(parseResearchWorkflowStateText(JSON.stringify(state))).toMatchObject({ ok: true });
  });

  it("replaces an accumulated causal graph in one validated mutation", () => {
    let state = createWorkItem(emptyState());
    state = mutateState(state, {
      action: "upsert_causal_graph",
      causalGraph: { title: "Legacy graph", status: "active" },
    }, piSource, undefined);
    state = mutateState(state, {
      action: "upsert_causal_node",
      causalNode: {
        id: "legacy.hypothesis",
        kind: "hypothesis",
        title: "Legacy hypothesis",
        summary: "Retired projection state.",
        status: "completed",
        evidenceRefs: [],
      },
    }, piSource, undefined);

    const replaced = mutateState(state, {
      action: "replace_causal_graph",
      causalGraphReplacement: {
        title: "Current decision path",
        status: "completed",
        activePathEdgeIds: [],
        nodes: [{
          id: "current.hypothesis",
          kind: "hypothesis",
          title: "Current hypothesis",
          summary: "Keep only the current causal projection.",
          status: "completed",
          evidenceRefs: [],
        }],
        edges: [],
      },
    }, piSource, undefined);

    expect(replaced.causalGraph).toMatchObject({
      title: "Current decision path",
      status: "completed",
      activePathEdgeIds: [],
      nodes: [{ id: "current.hypothesis", source: piSource }],
      edges: [],
      source: piSource,
    });
    expect(replaced.causalGraph?.nodes.find((node) => node.id === "legacy.hypothesis")).toBeUndefined();
    expect(replaced.causalGraph?.authoritySource).toBeUndefined();
    expect(parseResearchWorkflowStateText(JSON.stringify(replaced))).toMatchObject({ ok: true });
  });

  it("completes the overall research idea automatically", () => {
    const state = mutateState(createWorkItem(emptyState()), {
      action: "upsert_causal_graph",
      causalGraph: { title: "ParaFM causal graph", status: "active" },
    }, piSource, undefined);
    const completed = mutateState(state, {
      action: "upsert_causal_graph",
      causalGraph: { status: "completed" },
    }, piSource, undefined);

    expect(completed.causalGraph).toMatchObject({ status: "completed" });
    expect(completed.causalGraph?.authoritySource).toBeUndefined();
    expect(parseResearchWorkflowStateText(JSON.stringify(completed))).toMatchObject({ ok: true });

    if (completed.causalGraph === undefined) throw new Error("expected graph");
    completed.causalGraph.authoritySource = userSource;
    const retitled = mutateState(completed, {
      action: "upsert_causal_graph",
      causalGraph: { title: "Automatically revised graph" },
    }, piSource, undefined);
    expect(retitled.causalGraph?.authoritySource).toBeUndefined();

    if (retitled.causalGraph === undefined) throw new Error("expected graph");
    retitled.causalGraph.authoritySource = userSource;
    const extended = mutateState(retitled, {
      action: "upsert_causal_node",
      causalNode: {
        id: "hypothesis.terminal",
        kind: "hypothesis",
        title: "Terminal hypothesis",
        summary: "Retained for completed-history context.",
        status: "completed",
        evidenceRefs: [],
      },
    }, piSource, undefined);
    expect(extended.causalGraph?.authoritySource).toBeUndefined();
    expect(parseResearchWorkflowStateText(JSON.stringify(extended))).toMatchObject({ ok: true });
  });

  it("updates and resolves critical decisions automatically", () => {
    let state = createWorkItem(emptyState());
    state = mutateState(state, {
      action: "upsert_decision",
      workItemId: "parafm.current",
      decision: {
        id: "direction.choice",
        kind: "ambiguity",
        question: "Which scientific direction should continue?",
        impact: "Safe progress is blocked.",
        status: "open",
        importance: "critical",
        blocking: true,
      },
    }, piSource, undefined);
    state = mutateState(state, {
      action: "upsert_decision",
      workItemId: "parafm.current",
      decision: {
        id: "direction.choice",
        question: "Choose the corrected scientific direction?",
        importance: "routine",
        blocking: false,
        status: "resolved",
        resolution: "Continue with the repair.",
      },
    }, piSource, undefined);

    expect(state.workItems[0]?.decisions[0]).toMatchObject({
      question: "Choose the corrected scientific direction?",
      importance: "routine",
      blocking: false,
      status: "resolved",
      resolution: "Continue with the repair.",
    });
    expect(state.workItems[0]?.decisions[0]?.authoritySource).toBeUndefined();
  });

  it("promotes and revises findings automatically", () => {
    let state = createWorkItem(emptyState());
    state = mutateState(state, {
      action: "upsert_finding",
      workItemId: "parafm.current",
      finding: { id: "result.one", summary: "Initial interpretation", status: "provisional", evidenceRefs: [] },
    }, piSource, undefined);
    const accept: ResearchWorkflowParameters = {
      action: "upsert_finding",
      workItemId: "parafm.current",
      finding: { id: "result.one", status: "accepted", summary: "Evidence supports the scoped conclusion." },
    };

    state = mutateState(state, accept, piSource, undefined);
    expect(state.workItems[0]?.findings[0]).toMatchObject({ status: "accepted", summary: "Evidence supports the scoped conclusion." });
    expect(state.workItems[0]?.findings[0]?.authoritySource).toBeUndefined();
  });

  it("removes durable records automatically", () => {
    const removed = mutateState(createWorkItem(emptyState()), {
      action: "remove",
      recordType: "work-item",
      recordId: "parafm.current",
    }, piSource, undefined);

    expect(removed.workItems).toHaveLength(0);
    expect(removed.activeWorkItemId).toBeUndefined();
  });

  it("produces state accepted by the panel parser", () => {
    const state = createWorkItem(emptyState());
    const parsed = parseResearchWorkflowStateText(JSON.stringify(state));

    expect(parsed).toMatchObject({ ok: true, state: { version: 2 } });
  });
});
