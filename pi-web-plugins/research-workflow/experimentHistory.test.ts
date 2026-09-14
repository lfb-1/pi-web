import { describe, expect, it } from "vitest";
import { parseExperimentHistory } from "./experimentHistory.js";

function history(entries: unknown[]) {
  return JSON.stringify({ version: 1, experiments: entries });
}

const entry = { id: "run-1", purpose: "Test transfer", wandbUrl: "https://wandb.ai/team/project/runs/abc", githubUrl: "https://github.com/owner/repo/tree/task/test", worktree: "../repo-test", conclusion: "No transfer in this configuration." };

describe("experiment history format", () => {
  it("preserves historical rows and file order", () => {
    expect(parseExperimentHistory(history([entry, { id: "run-2", purpose: "Compare capacity" }]))).toEqual({
      ok: true, history: { version: 1, experiments: [entry, { id: "run-2", purpose: "Compare capacity" }] },
    });
  });

  it("keeps absent, null and empty fields unknown rather than inventing links or results", () => {
    expect(parseExperimentHistory(history([{ id: "run-1", purpose: "Test transfer", wandbUrl: null, githubUrl: "", conclusion: "  " }]))).toEqual({
      ok: true, history: { version: 1, experiments: [{ id: "run-1", purpose: "Test transfer" }] },
    });
    expect(parseExperimentHistory(history([]))).toEqual({ ok: true, history: { version: 1, experiments: [] } });
  });

  it.each(["not json", "null", "[]", '{"version":2,"experiments":[]}', '{"version":1,"experiments":{}}'])("rejects malformed history: %s", (text) => {
    expect(parseExperimentHistory(text).ok).toBe(false);
  });

  it.each([
    [null], [{ id: "run-1" }], [{ id: " ", purpose: "test" }],
    [entry, entry], [entry, { ...entry, id: " run-1 " }], [{ ...entry, conclusion: 2 }],
  ])("rejects invalid rows and duplicate ids", (...entries) => {
    expect(parseExperimentHistory(history(entries)).ok).toBe(false);
  });

  it.each(["javascript:alert(1)", "data:text/html,hello", "file:///tmp/test", "//github.com/owner/repo", "https://user:secret@github.com/owner/repo", "https:github.com/owner/repo", "not a URL"])("rejects unsafe or non-absolute links: %s", (url) => {
    for (const field of ["wandbUrl", "githubUrl"]) {
      const parsed = parseExperimentHistory(history([{ ...entry, [field]: url }]));
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.error).toContain(field);
    }
  });

  it("supports self-hosted W&B and GitHub Enterprise URLs", () => {
    expect(parseExperimentHistory(history([{ ...entry, wandbUrl: "http://wandb.internal/team/project/runs/a", githubUrl: "https://git.internal/owner/repo/commit/abc" }])).ok).toBe(true);
  });
});
