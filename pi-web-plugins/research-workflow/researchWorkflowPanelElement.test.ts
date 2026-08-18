// @vitest-environment happy-dom

import type { WorkspacePanelContext } from "@jmfederico/pi-web/plugin-api";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CAUSAL_CONCLUSION_NODE_HEIGHT, CAUSAL_NODE_HEIGHT, CAUSAL_NODE_WIDTH, layoutResearchCausalGraph } from "./researchCausalGraph.js";
import {
  defineResearchWorkflowPanelElement,
  focusedCanvasTransform,
  refreshResearchWorkflowPanel,
  renderResearchCanvas,
  researchWorkflowCorrectionPrompt,
  researchWorkflowInitializePrompt,
  researchWorkflowUpdatePrompt,
} from "./researchWorkflowPanelElement.js";
import type { RecordSource, ResearchCausalGraph, ResearchWorkflowState } from "./researchWorkflowState.js";

const source: RecordSource = { kind: "pi", ref: "session:s-1#entry-1", at: "2026-08-17T00:00:00.000Z" };

function state(): ResearchWorkflowState {
  return {
    version: 2,
    updatedAt: "2026-08-17T00:01:00.000Z",
    activeWorkItemId: "branch.one",
    causalGraph: graph(),
    workItems: [{
      id: "branch.one",
      title: "Evaluate the first hypothesis",
      objective: "Determine whether the method improves accuracy.",
      objectiveStatus: "proposed",
      phase: "reviewing-results",
      definitionOfDone: "Reach a scoped interpretation.",
      acceptanceCriteria: [],
      decisions: [],
      runs: [],
      artifacts: [{ id: "raw.report", label: "Detailed report", kind: "report", path: "results/private/RESULT.json", source }],
      findings: [{ id: "result.one", summary: "The method did not improve accuracy.", status: "provisional", evidenceRefs: ["raw.report"], source }],
      sessions: [],
      workspaces: [],
      source,
    }],
  };
}

function graph(): ResearchCausalGraph {
  return {
    title: "Accuracy research idea",
    status: "active",
    activeNodeId: "hypothesis.next",
    activePathEdgeIds: ["edge.tests", "edge.produces", "edge.concludes", "edge.motivates"],
    nodes: [
      { id: "hypothesis.one", kind: "hypothesis", title: "The method improves accuracy", summary: "Test the primary scientific claim.", status: "completed", workItemId: "branch.one", evidenceRefs: [], source },
      { id: "validation.one", kind: "validation", title: "Registered comparison", summary: "Compare the treatment and control.", status: "completed", workItemId: "branch.one", evidenceRefs: [], source },
      { id: "analysis.one", kind: "analysis", title: "No improvement", summary: "The scoped comparison did not show a gain.", status: "completed", workItemId: "branch.one", evidenceRefs: ["branch.one/finding:result.one"], source },
      { id: "conclusion.one", kind: "conclusion", title: "Primary hypothesis denied", summary: "The registered configuration did not pass.", status: "completed", conclusion: "denied", workItemId: "branch.one", evidenceRefs: ["branch.one/finding:result.one"], source },
      { id: "conclusion.parallel", kind: "conclusion", title: "Parallel branch unsure", summary: "Evidence remains insufficient.", status: "completed", conclusion: "unsure", workItemId: "branch.one", evidenceRefs: ["branch.one/finding:result.one"], source },
      { id: "hypothesis.next", kind: "hypothesis", title: "A narrower mechanism may work", summary: "Test a revised mechanism.", status: "active", workItemId: "branch.one", evidenceRefs: [], source },
    ],
    edges: [
      { id: "edge.tests", from: "hypothesis.one", to: "validation.one", kind: "tests", source },
      { id: "edge.produces", from: "validation.one", to: "analysis.one", kind: "produces", source },
      { id: "edge.concludes", from: "analysis.one", to: "conclusion.one", kind: "concludes", source },
      { id: "edge.motivates", from: "conclusion.one", to: "hypothesis.next", kind: "motivates", direction: "Narrow the mechanism instead of repeating the failed setup.", source },
      { id: "edge.merge", from: "conclusion.parallel", to: "hypothesis.next", kind: "motivates", direction: "Resolve both branches with one targeted hypothesis.", source },
    ],
    source,
  };
}

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

describe("Research causal canvas", () => {
  it("renders hypotheses, concise analysis, conclusions, and next directions without operational detail", () => {
    const workflow = state();
    const causalGraph = workflow.causalGraph;
    if (causalGraph === undefined) throw new Error("expected graph");
    const rendered = renderResearchCanvas(causalGraph, workflow, layoutResearchCausalGraph(causalGraph));
    const container = document.createElement("div");
    container.innerHTML = rendered;

    expect(rendered).toContain("The method improves accuracy");
    expect(rendered).toContain("No improvement");
    expect(rendered).toContain("Pi interpretation · denied");
    expect(rendered).toContain("Narrow the mechanism instead of repeating the failed setup.");
    expect(rendered).not.toContain("results/private/RESULT.json");
    expect(rendered).not.toContain("raw.report");
    expect(container.querySelectorAll(".iteration-row")).toHaveLength(3);
    expect(container.querySelector(".stage-legend")?.textContent).toContain("Hypothesis");
    expect(container.querySelector("[data-fit]")?.textContent).toBe("Overview");
    expect(container.querySelector<HTMLElement>("[data-node-id='conclusion.one']")?.style.height).toBe(`${String(CAUSAL_CONCLUSION_NODE_HEIGHT)}px`);
    expect(container.querySelector<HTMLElement>("[data-node-id='hypothesis.one']")?.style.height).toBe(`${String(CAUSAL_NODE_HEIGHT)}px`);
  });

  it("keeps the focused node fully visible in a narrow viewport", () => {
    const causalGraph = graph();
    const layout = layoutResearchCausalGraph(causalGraph);
    for (const nodeId of ["hypothesis.next", "conclusion.one"]) {
      const positioned = layout.nodes.find((entry) => entry.node.id === nodeId);
      if (positioned === undefined) throw new Error(`missing ${nodeId}`);
      const transform = focusedCanvasTransform(layout, positioned, 400, 600);
      const left = positioned.x * transform.scale + transform.panX;
      const right = (positioned.x + CAUSAL_NODE_WIDTH) * transform.scale + transform.panX;
      expect(left).toBeGreaterThanOrEqual(12);
      expect(right).toBeLessThanOrEqual(388);
    }
  });

  it("marks only the explicit active path when a merge has another parent", () => {
    const workflow = state();
    const causalGraph = workflow.causalGraph;
    if (causalGraph === undefined) throw new Error("expected graph");
    const container = document.createElement("div");
    container.innerHTML = renderResearchCanvas(causalGraph, workflow);

    expect(container.querySelector("[data-node-id='conclusion.one']")?.classList.contains("active-path")).toBe(true);
    expect(container.querySelector("[data-node-id='conclusion.parallel']")?.classList.contains("active-path")).toBe(false);
    expect(container.querySelector("[data-node-id='hypothesis.next']")?.classList.contains("active-node")).toBe(true);
  });

  it("shows a concise correction surface for the selected node", () => {
    const workflow = state();
    const causalGraph = workflow.causalGraph;
    if (causalGraph === undefined) throw new Error("expected graph");
    const rendered = renderResearchCanvas(causalGraph, workflow, undefined, new Set(), "conclusion.one");

    expect(rendered).toContain("Revise with Pi");
    expect(rendered).toContain("Hide locally");
    expect(rendered).toContain("1 typed reference");
    const conclusion = causalGraph.nodes.find((node) => node.id === "conclusion.one");
    if (conclusion === undefined) throw new Error("expected conclusion node");
    expect(researchWorkflowCorrectionPrompt(conclusion)).toContain("upsert_causal_node");
    const activeHidden = renderResearchCanvas(causalGraph, workflow, undefined, new Set(["hypothesis.next"]));
    expect(activeHidden).toContain("Restore active");
  });

  it("prompts Pi to maintain a conservative graph automatically and ask only for critical blockers", () => {
    const initialize = researchWorkflowInitializePrompt();
    const update = researchWorkflowUpdatePrompt(state());

    expect(initialize).toContain("conservative DAG");
    expect(initialize).toContain("never invent an unsupported causal relationship");
    expect(update).toContain("Maintain the DAG automatically");
    expect(update).toContain("Every schema-valid workflow record change proceeds automatically");
    expect(initialize).not.toContain("explicitly confirm completion");
  });

  it("keeps the newest state when concurrent refreshes finish out of order", async () => {
    const olderState = structuredClone(state());
    const newerState = structuredClone(state());
    if (olderState.causalGraph === undefined || newerState.causalGraph === undefined) throw new Error("expected graphs");
    olderState.causalGraph.title = "Older graph";
    newerState.causalGraph.title = "Newer graph";
    const older = deferredFile();
    const newer = deferredFile();
    let callCount = 0;
    const context = panelContext(vi.fn(), () => {
      callCount += 1;
      return callCount === 1 ? older.promise : newer.promise;
    }, "workspace-refresh-race");

    const olderRefresh = refreshResearchWorkflowPanel(context);
    const newerRefresh = refreshResearchWorkflowPanel(context);
    newer.resolve(fileResponse(newerState));
    await newerRefresh;
    older.resolve(fileResponse(olderState));
    await olderRefresh;

    defineResearchWorkflowPanelElement();
    const element = document.createElement("pi-web-research-workflow-panel");
    Reflect.set(element, "context", context);
    document.body.append(element);
    await vi.waitFor(() => { expect(element.shadowRoot?.querySelector(".toolbar-title > strong")?.textContent).toBe("Newer graph"); });
  });

  it("restores control focus after a refresh rerenders the canvas", async () => {
    defineResearchWorkflowPanelElement();
    const context = panelContext(vi.fn(), undefined, "workspace-focus-refresh");
    const element = document.createElement("pi-web-research-workflow-panel");
    Reflect.set(element, "context", context);
    document.body.append(element);
    await vi.waitFor(() => { expect(element.shadowRoot?.querySelector("[data-refresh]:not([disabled])")).not.toBeNull(); });
    const refresh = element.shadowRoot?.querySelector<HTMLButtonElement>("[data-refresh]");
    refresh?.focus();
    expect(element.shadowRoot?.activeElement).toBe(refresh);

    await refreshResearchWorkflowPanel(context);

    await vi.waitFor(() => { expect(element.shadowRoot?.activeElement?.hasAttribute("data-refresh")).toBe(true); });
  });

  it("lets the user select, revise, hide, and restore a graph node", async () => {
    defineResearchWorkflowPanelElement();
    const insertText = vi.fn();
    const element = document.createElement("pi-web-research-workflow-panel");
    Reflect.set(element, "context", panelContext(insertText));
    document.body.append(element);

    await vi.waitFor(() => {
      const root = element.shadowRoot;
      expect(root?.querySelector("[data-node-id='conclusion.one']")).not.toBeNull();
    });
    const root = element.shadowRoot;
    const node = root?.querySelector<HTMLButtonElement>("[data-node-id='conclusion.one']");
    node?.click();
    root?.querySelector<HTMLButtonElement>("[data-revise-node]")?.click();
    expect(insertText).toHaveBeenCalledWith(expect.stringContaining("Correct causal node conclusion.one"));

    root?.querySelector<HTMLButtonElement>("[data-hide-node]")?.click();
    expect(root?.querySelector("[data-node-id='conclusion.one']")).toBeNull();
    const restore = root?.querySelector<HTMLButtonElement>("[data-restore-hidden]");
    expect(restore?.textContent).toContain("Restore 1");
    restore?.click();
    expect(root?.querySelector("[data-node-id='conclusion.one']")).not.toBeNull();
  });
});

type PanelFileReader = WorkspacePanelContext["files"]["readFile"];
type PanelFileResponse = Awaited<ReturnType<PanelFileReader>>;

function panelContext(
  insertText: (text: string) => void,
  readFile: PanelFileReader = () => Promise.resolve(fileResponse(state())),
  workspaceId = "workspace-canvas-test",
): WorkspacePanelContext {
  const noop = () => undefined;
  const rejected = () => Promise.reject(new Error("not used"));
  return {
    machine: { id: "local", name: "Local", kind: "local" },
    workspace: { id: workspaceId, projectId: "project-1", path: "/work/research", label: "research", isMain: true },
    state: {},
    files: {
      readFile,
      listFiles: rejected,
      writeFile: rejected,
      deleteFile: rejected,
      moveFile: rejected,
    },
    host: { requestRender: noop },
    prompt: { insertText, getText: () => "", getSelection: () => null },
    terminal: { open: noop, runCommand: rejected },
  };
}

function fileResponse(workflow: ResearchWorkflowState): PanelFileResponse {
  return {
    path: ".pi-web/research-workflow-v2.json",
    encoding: "utf8",
    size: 1,
    modifiedAt: "2026-08-17T00:01:00.000Z",
    content: JSON.stringify(workflow),
    truncated: false,
    binary: false,
  };
}

function deferredFile(): { promise: Promise<PanelFileResponse>; resolve: (value: PanelFileResponse) => void } {
  let resolver: ((value: PanelFileResponse) => void) | undefined;
  const promise = new Promise<PanelFileResponse>((resolvePromise) => { resolver = resolvePromise; });
  return {
    promise,
    resolve: (value) => {
      if (resolver === undefined) throw new Error("deferred file resolver is unavailable");
      resolver(value);
    },
  };
}
