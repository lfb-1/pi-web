import { describe, expect, it } from "vitest";
import { activeWorkItem, parseResearchWorkflowStateText, type ResearchWorkflowState } from "./researchWorkflowState.js";

const source: { kind: "pi"; ref: string; at: string } = {
  kind: "pi",
  ref: "session:s-1#entry-1",
  at: "2026-08-15T20:00:00.000Z",
};

function validState(): ResearchWorkflowState {
  return {
    version: 1,
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

describe("research workflow state", () => {
  it("parses a valid state and resolves its active work item", () => {
    const parsed = parseResearchWorkflowStateText(JSON.stringify(validState()));

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(activeWorkItem(parsed.state)?.id).toBe("parafm.current");
    expect(parsed.state.workItems[0]?.acceptanceCriteria[0]?.result).toBe("pending");
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
});
