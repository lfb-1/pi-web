import { describe, expect, it } from "vitest";
import {
  authorityRequestFor,
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
  return { version: 1, updatedAt: "2026-08-15T20:00:00.000Z", workItems: [] };
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
    expect(authorityRequestFor({ action: "get" }, state)).toBeUndefined();
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
  });

  it("produces state accepted by the panel parser", () => {
    const state = createWorkItem(emptyState());
    const parsed = parseResearchWorkflowStateText(JSON.stringify(state));

    expect(parsed).toMatchObject({ ok: true });
  });
});
