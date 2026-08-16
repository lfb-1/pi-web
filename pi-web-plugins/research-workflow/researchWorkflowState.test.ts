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

  it("keeps legacy states without a semantic brief compatible", () => {
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
});
