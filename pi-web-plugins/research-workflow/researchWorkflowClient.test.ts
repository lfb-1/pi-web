import { describe, expect, it, vi } from "vitest";
import { loadResearchWorkflowState, type ResearchWorkflowFileReader } from "./researchWorkflowClient.js";
import { RESEARCH_WORKFLOW_STATE_PATH } from "./researchWorkflowState.js";

const emptyState = JSON.stringify({
  version: 1,
  updatedAt: "2026-08-15T20:00:00.000Z",
  workItems: [],
});

describe("research workflow client", () => {
  it("loads the state through the public workspace file helper", async () => {
    const readFile = vi.fn<ResearchWorkflowFileReader["readFile"]>(() => Promise.resolve({ content: emptyState, truncated: false, binary: false }));

    await expect(loadResearchWorkflowState({ readFile })).resolves.toMatchObject({ kind: "loaded", path: RESEARCH_WORKFLOW_STATE_PATH });
    expect(readFile).toHaveBeenCalledWith(RESEARCH_WORKFLOW_STATE_PATH);
  });

  it("treats a missing state file as an uninitialized workflow", async () => {
    const files: ResearchWorkflowFileReader = { readFile: () => Promise.reject(new Error("Path does not exist")) };

    await expect(loadResearchWorkflowState(files)).resolves.toMatchObject({
      kind: "missing",
      message: "No research workflow state exists for this workspace.",
    });
  });

  it("reports invalid state without changing it", async () => {
    const files: ResearchWorkflowFileReader = {
      readFile: () => Promise.resolve({ content: JSON.stringify({ version: 2, workItems: [] }), truncated: false, binary: false }),
    };

    await expect(loadResearchWorkflowState(files)).resolves.toMatchObject({
      kind: "unavailable",
      detail: "state.version must be 1",
    });
  });

  it("rejects binary and truncated state files", async () => {
    const binary: ResearchWorkflowFileReader = {
      readFile: () => Promise.resolve({ content: "", truncated: false, binary: true }),
    };
    const truncated: ResearchWorkflowFileReader = {
      readFile: () => Promise.resolve({ content: emptyState, truncated: true, binary: false }),
    };

    const binaryResult = await loadResearchWorkflowState(binary);
    const truncatedResult = await loadResearchWorkflowState(truncated);
    expect(binaryResult.kind).toBe("unavailable");
    expect(truncatedResult.kind).toBe("unavailable");
    if (binaryResult.kind === "unavailable") expect(binaryResult.detail).toContain("text file");
    if (truncatedResult.kind === "unavailable") expect(truncatedResult.detail).toContain("truncated");
  });
});
