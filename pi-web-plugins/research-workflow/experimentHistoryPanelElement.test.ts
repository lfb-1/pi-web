// @vitest-environment happy-dom

import type { WorkspacePanelContext } from "@jmfederico/pi-web/plugin-api";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineExperimentHistoryPanelElement, experimentHistoryPanelTagName, refreshExperimentHistoryPanel } from "./experimentHistoryPanelElement.js";
import { EXPERIMENT_HISTORY_PATH, type ExperimentHistoryEntry } from "./experimentHistory.js";

type Panel = HTMLElement & { context: WorkspacePanelContext | undefined };
type ReadFile = WorkspacePanelContext["files"]["readFile"];
const example: ExperimentHistoryEntry = {
  id: "capacity-control", purpose: "Does more capacity improve transfer?", wandbUrl: "https://wandb.ai/team/project/runs/abc",
  githubUrl: "https://github.com/owner/repo/tree/task/capacity", worktree: "../repo-capacity", conclusion: "No held-out improvement under this budget.",
};

function file(entries: ExperimentHistoryEntry[] = [example]): Awaited<ReturnType<ReadFile>> {
  const content = JSON.stringify({ version: 1, experiments: entries });
  return { path: EXPERIMENT_HISTORY_PATH, content, encoding: "utf8", size: content.length, modifiedAt: "2026-09-10T12:00:00Z", binary: false, truncated: false };
}

function context(readFile: ReadFile = () => Promise.resolve(file()), machineId = "local", workspaceId = "workspace-1") {
  return {
    machine: { id: machineId, name: machineId, kind: machineId === "local" ? "local" : "remote" },
    workspace: { id: workspaceId, projectId: "project-1", path: "/work/project", label: "project", isMain: true },
    files: { readFile, listFiles: vi.fn(), writeFile: vi.fn(), deleteFile: vi.fn(), moveFile: vi.fn() },
    prompt: { insertText: vi.fn(), getText: () => "", getSelection: () => null },
    terminal: { open: vi.fn(), runCommand: vi.fn() },
    host: { requestRender: vi.fn() },
  } satisfies WorkspacePanelContext;
}

function isPanel(element: HTMLElement): element is Panel {
  return element.localName === experimentHistoryPanelTagName && "context" in element;
}

function mount(ctx: WorkspacePanelContext): Panel {
  defineExperimentHistoryPanelElement();
  const panel = document.createElement(experimentHistoryPanelTagName);
  if (!isPanel(panel)) throw new Error("Expected experiment history custom element");
  panel.context = ctx;
  document.body.append(panel);
  return panel;
}

function shadow(panel: Panel): ShadowRoot {
  if (panel.shadowRoot === null) throw new Error("Expected open shadow root");
  return panel.shadowRoot;
}

function requiredElement(parent: ParentNode, selector: string): HTMLElement {
  const element = parent.querySelector<HTMLElement>(selector);
  if (element === null) throw new Error(`Missing ${selector}`);
  return element;
}

function deferredFile() {
  let resolve: ((value: Awaited<ReturnType<ReadFile>>) => void) | undefined;
  const promise = new Promise<Awaited<ReturnType<ReadFile>>>((done) => { resolve = done; });
  if (resolve === undefined) throw new Error("Promise executor did not initialize");
  return { promise, resolve };
}

afterEach(() => { document.body.replaceChildren(); });

describe("experiment Visualization table", () => {
  it("renders exactly the four requested columns, real external links and concise conclusions", async () => {
    const ctx = context();
    const panel = mount(ctx);
    await refreshExperimentHistoryPanel(ctx);
    const root = shadow(panel);
    expect([...root.querySelectorAll("thead th")].map((cell) => cell.textContent)).toEqual(["Experiment purpose", "W&B link", "GitHub worktree", "Brief conclusion"]);
    const row = requiredElement(root, "tbody tr");
    expect(row.children).toHaveLength(4);
    expect(row.children[0]?.textContent).toContain(example.purpose);
    expect(row.children[2]?.textContent).toContain(example.worktree);
    expect(row.children[3]?.textContent).toBe(example.conclusion);
    const links = [...row.querySelectorAll("a")];
    expect(links.map((link) => link.href)).toEqual([example.wandbUrl, example.githubUrl]);
    for (const link of links) {
      expect(link.target).toBe("_blank");
      expect(link.rel).toBe("noopener noreferrer");
    }
    expect(root.querySelector("canvas, svg, .canvas-viewport")).toBeNull();
    expect(ctx.files.writeFile).not.toHaveBeenCalled();
    expect(ctx.terminal.runCommand).not.toHaveBeenCalled();
  });

  it("renders missing fields without inferring outcomes", async () => {
    const ctx = context(() => Promise.resolve(file([{ id: "no-links", purpose: "Historical run" }])));
    const panel = mount(ctx);
    await refreshExperimentHistoryPanel(ctx);
    expect(shadow(panel).querySelectorAll("tbody a")).toHaveLength(0);
    expect(shadow(panel).textContent).toContain("Not recorded");
    expect(shadow(panel).textContent).toContain("No conclusion recorded");
  });

  it("escapes experiment text and attribute values", async () => {
    const purpose = '<img src=x onerror="alert(1)">';
    const ctx = context(() => Promise.resolve(file([{ ...example, purpose, conclusion: "<script>bad()</script>", worktree: '<b>test</b>', wandbUrl: 'https://wandb.ai/a?name=" onclick="bad' }])));
    const panel = mount(ctx);
    await refreshExperimentHistoryPanel(ctx);
    const root = shadow(panel);
    expect(root.querySelector("tbody")?.textContent).toContain(purpose);
    expect(root.querySelector("img, script, b, [onclick]")).toBeNull();
    expect(root.querySelector("tbody a")?.getAttribute("href")).toBe('https://wandb.ai/a?name=" onclick="bad');
  });

  it.each(["missing", "empty"])("keeps the four headers and explains a %s history", async (kind) => {
    const ctx = context(() => kind === "missing" ? Promise.reject(new Error("Path does not exist")) : Promise.resolve(file([])));
    const panel = mount(ctx);
    await refreshExperimentHistoryPanel(ctx);
    expect(shadow(panel).querySelectorAll("thead th")).toHaveLength(4);
    expect(shadow(panel).textContent).toContain("No experiments recorded yet");
    expect(shadow(panel).querySelector("[role=alert]")).toBeNull();
  });

  it("shows errors and recovers when Refresh is clicked", async () => {
    const readFile = vi.fn<ReadFile>().mockRejectedValue(new Error("Permission denied"));
    const ctx = context(readFile);
    const panel = mount(ctx);
    await refreshExperimentHistoryPanel(ctx);
    expect(shadow(panel).querySelector("[role=alert]")?.textContent).toContain("Permission denied");
    readFile.mockResolvedValue(file());
    requiredElement(shadow(panel), '[data-action="refresh"]').click();
    await vi.waitFor(() => { expect(shadow(panel).querySelector("tbody")?.textContent).toContain(example.purpose); });
    expect(shadow(panel).querySelector("[role=alert]")).toBeNull();
  });

  it("inserts a factual index-update prompt only on an explicit click", async () => {
    const ctx = context();
    const panel = mount(ctx);
    await refreshExperimentHistoryPanel(ctx);
    expect(ctx.prompt.insertText).not.toHaveBeenCalled();
    requiredElement(shadow(panel), '[data-action="update"]').click();
    expect(ctx.prompt.insertText).toHaveBeenCalledWith(expect.stringContaining(EXPERIMENT_HISTORY_PATH));
    expect(ctx.prompt.insertText).toHaveBeenCalledWith(expect.stringContaining("never invent a URL"));
    expect(ctx.prompt.insertText).toHaveBeenCalledWith(expect.stringContaining("do not read or migrate retired"));
    expect(ctx.terminal.runCommand).not.toHaveBeenCalled();
  });

  it("uses the current prompt editor after changing sessions within one workspace", async () => {
    const first = context();
    const panel = mount(first);
    await refreshExperimentHistoryPanel(first);
    const next = context();
    panel.context = next;
    requiredElement(shadow(panel), '[data-action="update"]').click();
    expect(first.prompt.insertText).not.toHaveBeenCalled();
    expect(next.prompt.insertText).toHaveBeenCalledOnce();
  });

  it("keeps the latest refresh when reads finish out of order", async () => {
    const readFile = vi.fn<ReadFile>().mockResolvedValue(file());
    const ctx = context(readFile);
    const panel = mount(ctx);
    await refreshExperimentHistoryPanel(ctx);
    const older = deferredFile();
    const newer = deferredFile();
    readFile.mockImplementationOnce(() => older.promise).mockImplementationOnce(() => newer.promise);
    const first = refreshExperimentHistoryPanel(ctx);
    const second = refreshExperimentHistoryPanel(ctx);
    newer.resolve(file([{ id: "new", purpose: "Newer experiment" }]));
    await second;
    older.resolve(file([{ id: "old", purpose: "Older experiment" }]));
    await first;
    expect(shadow(panel).querySelector("tbody")?.textContent).toContain("Newer experiment");
    expect(shadow(panel).querySelector("tbody")?.textContent).not.toContain("Older experiment");
  });

  it("isolates machines and ignores pending results after a workspace switch or disconnect", async () => {
    const pending = deferredFile();
    const local = context(() => pending.promise);
    const panel = mount(local);
    const first = refreshExperimentHistoryPanel(local);
    const remoteRead = vi.fn<ReadFile>().mockResolvedValue(file([{ id: "remote", purpose: "Remote experiment" }]));
    const remote = context(remoteRead, "remote");
    panel.context = remote;
    await refreshExperimentHistoryPanel(remote);
    const calls = remoteRead.mock.calls.length;
    await refreshExperimentHistoryPanel(local);
    expect(remoteRead).toHaveBeenCalledTimes(calls);
    pending.resolve(file([{ id: "local", purpose: "Local experiment" }]));
    await first;
    expect(shadow(panel).querySelector("tbody")?.textContent).toContain("Remote experiment");
    expect(shadow(panel).querySelector("tbody")?.textContent).not.toContain("Local experiment");
    panel.remove();
    await refreshExperimentHistoryPanel(remote);
    expect(remoteRead).toHaveBeenCalledTimes(calls);
  });
});
