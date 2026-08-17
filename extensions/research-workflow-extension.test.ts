import { describe, expect, it } from "vitest";
import {
  authorityRequestFor,
  authoritySourceForSessionManager,
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

describe("research_workflow authority provenance", () => {
  it("labels authority as direct dialog or delegated recommended-timeout policy", () => {
    const sessionManager = {
      getBranch: () => [],
      getLeafId: () => "entry-1",
      getSessionId: () => "session-1",
    };

    expect(authoritySourceForSessionManager(sessionManager)).toMatchObject({
      kind: "user",
      ref: "session:session-1#entry-1",
      authorityMode: "dialog-or-recommended-timeout-policy",
    });
  });
});

describe("research_workflow extension state transitions", () => {
  it("creates proposed work with Pi provenance", () => {
    const state = createWorkItem(emptyState());

    expect(state.activeWorkItemId).toBe("parafm.current");
    expect(state.workItems[0]).toMatchObject({
      id: "parafm.current",
      objectiveStatus: "proposed",
      source: piSource,
    });
    expect(authorityRequestFor({ action: "get" }, state)).toBeUndefined();
  });

  it("rewrites the semantic brief with current Pi provenance without changing authority", () => {
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

    expect(authorityRequestFor(params, state)).toBeUndefined();
    const updated = mutateState(state, params, laterPiSource, undefined);

    expect(updated.workItems[0]?.brief).toMatchObject({
      currentAnswer: "No improvement is established yet.",
      source: laterPiSource,
    });
    expect(updated.workItems[0]?.authoritySource).toEqual(userSource);
  });

  it("requires confirmation to change or downgrade authorized content", () => {
    const state = createWorkItem(emptyState());
    const item = state.workItems[0];
    if (item === undefined) throw new Error("expected work item");
    item.objectiveStatus = "confirmed";
    item.authoritySource = userSource;

    const changeObjective: ResearchWorkflowParameters = {
      action: "upsert_work_item",
      workItem: { id: item.id, objective: "Use a different scientific objective." },
    };
    expect(authorityRequestFor(changeObjective, state)?.message).toContain("change the confirmed research objective");

    const downgrade: ResearchWorkflowParameters = {
      action: "upsert_work_item",
      workItem: { id: item.id, objectiveStatus: "proposed" },
    };
    expect(authorityRequestFor(downgrade, state)?.message).toContain("change the confirmed research objective");
    const downgraded = mutateState(state, downgrade, piSource, userSource);
    expect(downgraded.workItems[0]?.objectiveStatus).toBe("proposed");
    expect(downgraded.workItems[0]?.authoritySource).toBeUndefined();
  });

  it("requires confirmation to change the scope of a completed work item", () => {
    const state = createWorkItem(emptyState());
    const item = state.workItems[0];
    if (item === undefined) throw new Error("expected work item");
    item.phase = "completed";
    item.authoritySource = userSource;
    const params: ResearchWorkflowParameters = {
      action: "upsert_work_item",
      workItem: { id: item.id, definitionOfDone: "Use a different completion contract." },
    };

    expect(authorityRequestFor(params, state)?.message).toContain("change the completed work item scope");
  });

  it("identifies approval as an authority transition and records its user source", () => {
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

    expect(authorityRequestFor(params, state)?.message).toContain("Approve acceptance criterion accuracy.gate");
    const updated = mutateState(state, params, piSource, userSource);
    expect(updated.workItems[0]?.acceptanceCriteria[0]).toMatchObject({
      status: "approved",
      authoritySource: userSource,
    });

    const changeApproved: ResearchWorkflowParameters = {
      action: "upsert_acceptance",
      workItemId: "parafm.current",
      criterion: { id: "accuracy.gate", predicate: "Use a different threshold." },
    };
    expect(authorityRequestFor(changeApproved, updated)?.message).toContain("Change approved acceptance criterion");

    const downgrade: ResearchWorkflowParameters = {
      action: "upsert_acceptance",
      workItemId: "parafm.current",
      criterion: { id: "accuracy.gate", status: "proposed" },
    };
    const downgraded = mutateState(updated, downgrade, piSource, userSource);
    expect(downgraded.workItems[0]?.acceptanceCriteria[0]?.authoritySource).toBeUndefined();
  });

  it("creates and updates a causal graph without an authority request", () => {
    let state = createWorkItem(emptyState());
    const graphParams: ResearchWorkflowParameters = {
      action: "upsert_causal_graph",
      causalGraph: { title: "ParaFM causal graph", status: "active" },
    };
    expect(authorityRequestFor(graphParams, state)).toBeUndefined();
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

  it("requires authority to complete the overall research idea", () => {
    const state = mutateState(createWorkItem(emptyState()), {
      action: "upsert_causal_graph",
      causalGraph: { title: "ParaFM causal graph", status: "active" },
    }, piSource, undefined);
    const complete: ResearchWorkflowParameters = { action: "upsert_causal_graph", causalGraph: { status: "completed" } };

    expect(authorityRequestFor(complete, state)?.message).toContain("overall research idea completed");
    const completed = mutateState(state, complete, piSource, userSource);
    expect(completed.causalGraph).toMatchObject({ status: "completed", authoritySource: userSource });
  });

  it("keeps decision authority separate from attention priority and protects downgrades", () => {
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

    expect(authorityRequestFor({
      action: "upsert_decision",
      workItemId: "parafm.current",
      decision: { id: "direction.choice", importance: "routine", blocking: false },
    }, state)?.message).toContain("Lower the attention level");

    expect(authorityRequestFor({
      action: "upsert_decision",
      workItemId: "parafm.current",
      decision: { id: "direction.choice", importance: "routine", blocking: false, status: "resolved", resolution: "Continue with the repair." },
    }, state)?.message).toContain("Resolve decision");

    expect(authorityRequestFor({
      action: "upsert_decision",
      workItemId: "parafm.current",
      decision: { id: "direction.choice", status: "resolved", resolution: "Continue with the repair." },
    }, state)?.message).toContain("Resolve decision");

    const routineState = mutateState(createWorkItem(emptyState()), {
      action: "upsert_decision",
      workItemId: "parafm.current",
      decision: { id: "routine.choice", question: "Record a choice?", impact: "Routine", status: "open", importance: "routine" },
    }, piSource, undefined);
    expect(authorityRequestFor({
      action: "upsert_decision",
      workItemId: "parafm.current",
      decision: { id: "routine.choice", status: "resolved", resolution: "Recorded" },
    }, routineState)?.message).toContain("Resolve decision");
  });

  it("produces state accepted by the panel parser", () => {
    const state = createWorkItem(emptyState());
    const parsed = parseResearchWorkflowStateText(JSON.stringify(state));

    expect(parsed).toMatchObject({ ok: true, state: { version: 2 } });
  });
});
