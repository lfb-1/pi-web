import { describe, expect, it, vi } from "vitest";
import { EXPERIMENT_HISTORY_PATH } from "./experimentHistory.js";
import { loadExperimentHistory, type ExperimentHistoryFileReader } from "./experimentHistoryClient.js";

const emptyFile = { content: '{"version":1,"experiments":[]}', truncated: false, binary: false };

describe("experiment history loading", () => {
  it("reads only the visualization index, never retired research workflow files", async () => {
    const readFile = vi.fn<ExperimentHistoryFileReader["readFile"]>().mockResolvedValue(emptyFile);
    await expect(loadExperimentHistory({ readFile })).resolves.toEqual({ kind: "loaded", history: { version: 1, experiments: [] } });
    expect(readFile.mock.calls).toEqual([[EXPERIMENT_HISTORY_PATH]]);
  });

  it("shows missing without migrating legacy files", async () => {
    const readFile = vi.fn<ExperimentHistoryFileReader["readFile"]>().mockRejectedValue(new Error("Path does not exist"));
    await expect(loadExperimentHistory({ readFile })).resolves.toEqual({ kind: "missing" });
    expect(readFile).toHaveBeenCalledTimes(1);
  });

  it.each([new Error("Permission denied"), "Network offline"])("keeps read failures distinct from an empty history", async (error) => {
    const readFile = vi.fn<ExperimentHistoryFileReader["readFile"]>().mockRejectedValue(error);
    await expect(loadExperimentHistory({ readFile })).resolves.toMatchObject({ kind: "unavailable", detail: error instanceof Error ? error.message : error });
  });

  it.each([{ ...emptyFile, truncated: true }, { ...emptyFile, binary: true }, { ...emptyFile, content: "invalid" }])("rejects incomplete or invalid files", async (file) => {
    await expect(loadExperimentHistory({ readFile: () => Promise.resolve(file) })).resolves.toMatchObject({ kind: "unavailable" });
  });
});
