import type { WorkspacePanelContext } from "@jmfederico/pi-web/plugin-api";
import {
  loadResearchWorkflowState,
  researchWorkflowRefreshHint,
  researchWorkflowUnavailableMessage,
  type ResearchWorkflowLoadResult,
} from "./researchWorkflowClient.js";
import {
  activeCausalPath,
  CAUSAL_NODE_HEIGHT,
  CAUSAL_NODE_WIDTH,
  layoutResearchCausalGraph,
  type ResearchCausalGraphLayout,
} from "./researchCausalGraph.js";
import {
  activeWorkItem,
  decisionRequiresAttention,
  RESEARCH_WORKFLOW_STATE_PATH,
  type CausalEdge,
  type CausalNode,
  type DecisionRecord,
  type ResearchCausalGraph,
  type ResearchWorkflowState,
} from "./researchWorkflowState.js";

export const researchWorkflowPanelTagName = "pi-web-research-workflow-panel";

const stateChangedEvent = "pi-web-research-workflow-state-changed";
const MIN_SCALE = 0.28;
const MAX_SCALE = 1.8;

type PanelState = { kind: "loading" } | ResearchWorkflowLoadResult;
const stateCache = new Map<string, PanelState>();
const refreshGenerations = new Map<string, number>();

export function defineResearchWorkflowPanelElement(): void {
  if (!customElements.get(researchWorkflowPanelTagName)) customElements.define(researchWorkflowPanelTagName, PiWebResearchWorkflowPanel);
}

export function researchWorkflowPanelBadge(context: WorkspacePanelContext): string | number | undefined {
  const state = getCachedState(context);
  if (state?.kind === "unavailable") return "!";
  if (state?.kind !== "loaded") return undefined;
  const attentionCount = criticalDecisions(state.state).length;
  return attentionCount > 0 ? attentionCount : undefined;
}

export async function refreshResearchWorkflowPanel(context: WorkspacePanelContext): Promise<void> {
  const key = cacheKeyForContext(context);
  const generation = (refreshGenerations.get(key) ?? 0) + 1;
  refreshGenerations.set(key, generation);
  stateCache.set(key, { kind: "loading" });
  const state = await loadResearchWorkflowState(context.files).catch((error: unknown): PanelState => ({
    kind: "unavailable",
    message: researchWorkflowUnavailableMessage,
    hint: researchWorkflowRefreshHint,
    detail: formatUnknownError(error),
  }));
  if (refreshGenerations.get(key) !== generation) return;
  stateCache.set(key, state);
  context.host.requestRender();
  window.dispatchEvent(new Event(stateChangedEvent));
}

class PiWebResearchWorkflowPanel extends HTMLElement {
  private contextValue: WorkspacePanelContext | undefined;
  private selectedNodeId: string | undefined;
  private hiddenNodeIds = new Set<string>();
  private readonly root: ShadowRoot;
  private layout: ResearchCausalGraphLayout | undefined;
  private panX = 28;
  private panY = 28;
  private scale = 1;
  private fittedGraphKey: string | undefined;
  private autoFit = true;
  private resizeObserver: ResizeObserver | undefined;
  private dragging: { pointerId: number; clientX: number; clientY: number } | undefined;
  private readonly onStateChanged = () => { this.render(); };

  constructor() {
    super();
    this.root = this.attachShadow({ mode: "open" });
  }

  set context(value: WorkspacePanelContext | undefined) {
    const previousKey = this.contextValue === undefined ? undefined : cacheKeyForContext(this.contextValue);
    const nextKey = value === undefined ? undefined : cacheKeyForContext(value);
    this.contextValue = value;
    if (previousKey === nextKey) return;
    this.selectedNodeId = undefined;
    this.fittedGraphKey = undefined;
    this.autoFit = true;
    this.hiddenNodeIds = nextKey === undefined ? new Set() : loadHiddenNodeIds(nextKey);
    this.render();
  }

  connectedCallback(): void {
    window.addEventListener(stateChangedEvent, this.onStateChanged);
    this.render();
  }

  disconnectedCallback(): void {
    window.removeEventListener(stateChangedEvent, this.onStateChanged);
    this.resizeObserver?.disconnect();
  }

  private render(): void {
    const focusTarget = this.captureFocusTarget();
    this.resizeObserver?.disconnect();
    const context = this.contextValue;
    if (context === undefined) {
      this.root.innerHTML = `${styles()}<section class="empty">Select a workspace.</section>`;
      return;
    }
    const state = getOrLoadState(context);
    const graph = state.kind === "loaded" ? state.state.causalGraph : undefined;
    const graphKey = graph === undefined || state.kind !== "loaded"
      ? undefined
      : `${state.state.updatedAt}:${String(graph.nodes.length)}:${String(graph.edges.length)}:${[...this.hiddenNodeIds].sort().join(",")}`;
    this.layout = graph === undefined ? undefined : layoutResearchCausalGraph(graph, this.hiddenNodeIds);
    if (graph !== undefined && this.selectedNodeId !== undefined && !graph.nodes.some((node) => node.id === this.selectedNodeId)) this.selectedNodeId = undefined;

    this.root.innerHTML = `
      ${styles()}
      <section class="toolbar">
        <div class="toolbar-title">
          <strong>${graph === undefined ? "Research Canvas" : escapeHtml(graph.title)}</strong>
          ${graph === undefined ? "" : graphStatus(graph, state.kind === "loaded" ? state.state : undefined)}
        </div>
        <div class="toolbar-actions">
          <button class="secondary" data-ask-pi>${graph === undefined ? "Build with Pi" : "Update with Pi"}</button>
          <button class="secondary icon-button" data-refresh aria-label="Refresh research canvas" title="Refresh" ${state.kind === "loading" ? "disabled" : ""}>↻</button>
        </div>
      </section>
      <section class="viewer" aria-busy="${String(state.kind === "loading")}">${this.renderState(state)}</section>
    `;
    this.bindCommonActions(context, state);
    if (state.kind === "loaded" && graph !== undefined && this.layout !== undefined) {
      this.bindCanvasActions(context, state.state, graph);
      this.observeViewport();
      this.applyTransform();
      if (graphKey !== undefined && this.fittedGraphKey !== graphKey) {
        this.fittedGraphKey = graphKey;
        this.autoFit = true;
        requestAnimationFrame(() => { this.fitCanvas(); });
      }
    }
    if (focusTarget !== undefined) this.focusAfterRender(focusTarget);
  }

  private renderState(state: PanelState): string {
    if (state.kind === "loading") return `<p class="muted loading" role="status">Loading research canvas…</p>`;
    if (state.kind === "missing") {
      return `<div class="empty-state"><strong>${escapeHtml(state.message)}</strong><p>Ask Pi to initialize the research idea and causal graph from the canonical project state.</p><p class="muted">The canvas is a deterministic view of durable state and never calls a model when opened.</p></div>`;
    }
    if (state.kind === "unavailable") {
      const detail = state.detail === undefined ? "" : `<pre>${escapeHtml(state.detail)}</pre>`;
      return `<div class="status error" role="alert"><strong>${escapeHtml(state.message)}</strong><p>${escapeHtml(state.hint)}</p>${detail}</div>`;
    }
    if (state.state.causalGraph === undefined) return renderMissingGraph(state.state);
    const graph = state.state.causalGraph;
    const layout = this.layout ?? layoutResearchCausalGraph(graph, this.hiddenNodeIds);
    const attention = criticalDecisions(state.state);
    return `
      ${attention.length === 0 ? "" : renderCriticalDecisions(attention)}
      ${renderResearchCanvas(graph, state.state, layout, this.hiddenNodeIds, this.selectedNodeId, this.panX, this.panY, this.scale)}
      ${renderOperationalIndex(state.state)}
    `;
  }

  private bindCommonActions(context: WorkspacePanelContext, state: PanelState): void {
    this.root.querySelector("button[data-refresh]")?.addEventListener("click", () => { void refreshResearchWorkflowPanel(context); });
    this.root.querySelector("button[data-ask-pi]")?.addEventListener("click", () => {
      if (state.kind !== "loaded" || state.state.causalGraph === undefined) context.prompt.insertText(researchWorkflowInitializePrompt());
      else context.prompt.insertText(researchWorkflowUpdatePrompt(state.state));
    });
  }

  private bindCanvasActions(context: WorkspacePanelContext, state: ResearchWorkflowState, graph: ResearchCausalGraph): void {
    for (const button of this.root.querySelectorAll<HTMLButtonElement>("[data-node-id]")) {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        this.selectedNodeId = button.dataset["nodeId"];
        this.render();
        this.focusAfterRender("[data-close-inspector]");
      });
    }
    this.root.querySelector("[data-close-inspector]")?.addEventListener("click", () => {
      const nodeId = this.selectedNodeId;
      this.selectedNodeId = undefined;
      this.render();
      if (nodeId !== undefined) this.focusAfterRender(`[data-node-id="${cssAttributeValue(nodeId)}"]`);
    });
    this.root.querySelector("[data-hide-node]")?.addEventListener("click", () => {
      if (this.selectedNodeId === undefined) return;
      this.hiddenNodeIds.add(this.selectedNodeId);
      this.selectedNodeId = undefined;
      this.persistHiddenNodes();
      this.render();
      this.focusAfterRender("[data-canvas-viewport]");
    });
    this.root.querySelector("[data-restore-hidden]")?.addEventListener("click", () => {
      const restoreFocusId = [...this.hiddenNodeIds][0];
      this.hiddenNodeIds.clear();
      this.persistHiddenNodes();
      this.fittedGraphKey = undefined;
      this.render();
      if (restoreFocusId !== undefined) this.focusAfterRender(`[data-node-id="${cssAttributeValue(restoreFocusId)}"]`);
    });
    this.root.querySelector("[data-restore-active]")?.addEventListener("click", () => {
      const activeNodeId = graph.activeNodeId;
      if (activeNodeId === undefined) return;
      this.hiddenNodeIds.delete(activeNodeId);
      this.persistHiddenNodes();
      this.fittedGraphKey = undefined;
      this.render();
      requestAnimationFrame(() => {
        this.focusNode(activeNodeId);
        this.root.querySelector<HTMLElement>(`[data-node-id="${cssAttributeValue(activeNodeId)}"]`)?.focus();
      });
    });
    this.root.querySelector("[data-revise-node]")?.addEventListener("click", () => {
      const node = graph.nodes.find((candidate) => candidate.id === this.selectedNodeId);
      if (node !== undefined) context.prompt.insertText(researchWorkflowCorrectionPrompt(node));
    });
    this.root.querySelector("[data-review-records]")?.addEventListener("click", () => {
      context.prompt.insertText(`Review the detailed Research Workflow records in ${RESEARCH_WORKFLOW_STATE_PATH}. Call research_workflow get first and summarize only the details I ask for. `);
    });
    this.root.querySelector("[data-zoom-in]")?.addEventListener("click", () => { this.zoomAt(1.18); });
    this.root.querySelector("[data-zoom-out]")?.addEventListener("click", () => { this.zoomAt(1 / 1.18); });
    this.root.querySelector("[data-fit]")?.addEventListener("click", () => {
      this.autoFit = true;
      this.fitCanvas();
    });
    this.root.querySelector("[data-focus-active]")?.addEventListener("click", () => {
      if (graph.activeNodeId !== undefined) this.focusNode(graph.activeNodeId);
    });

    const viewport = this.viewport();
    viewport?.addEventListener("pointerdown", (event) => {
      if (!(event.target instanceof Element) || event.target.closest("[data-node-id], .canvas-controls, .node-inspector") !== null) return;
      this.autoFit = false;
      this.dragging = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY };
      viewport.setPointerCapture(event.pointerId);
      viewport.classList.add("dragging");
    });
    viewport?.addEventListener("pointermove", (event) => {
      if (this.dragging?.pointerId !== event.pointerId) return;
      this.panX += event.clientX - this.dragging.clientX;
      this.panY += event.clientY - this.dragging.clientY;
      this.dragging = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY };
      this.applyTransform();
    });
    const endDrag = (event: PointerEvent) => {
      if (this.dragging?.pointerId !== event.pointerId) return;
      this.dragging = undefined;
      viewport?.classList.remove("dragging");
    };
    viewport?.addEventListener("pointerup", endDrag);
    viewport?.addEventListener("pointercancel", endDrag);
    viewport?.addEventListener("wheel", (event) => {
      event.preventDefault();
      this.autoFit = false;
      if (event.ctrlKey || event.metaKey) {
        const rect = viewport.getBoundingClientRect();
        this.zoomAt(event.deltaY < 0 ? 1.1 : 1 / 1.1, event.clientX - rect.left, event.clientY - rect.top);
      } else {
        this.panX -= event.deltaX;
        this.panY -= event.deltaY;
        this.applyTransform();
      }
    }, { passive: false });
    viewport?.addEventListener("dblclick", (event) => {
      if (event.target === viewport) this.fitCanvas();
    });

    const selected = graph.nodes.find((node) => node.id === this.selectedNodeId);
    const branchId = selected?.workItemId;
    if (branchId !== undefined && state.workItems.some((item) => item.id === branchId)) {
      this.root.querySelector("[data-branch-id]")?.addEventListener("click", () => {
        context.prompt.insertText(`Review research branch ${branchId}. Call research_workflow get first and keep its causal nodes synchronized. `);
      });
    }
  }

  private captureFocusTarget(): string | undefined {
    const active = this.root.activeElement;
    if (!(active instanceof HTMLElement)) return undefined;
    const nodeId = active.dataset["nodeId"];
    if (nodeId !== undefined) return `[data-node-id="${cssAttributeValue(nodeId)}"]`;
    const stableAttributes = [
      "data-ask-pi",
      "data-refresh",
      "data-close-inspector",
      "data-hide-node",
      "data-restore-hidden",
      "data-restore-active",
      "data-revise-node",
      "data-review-records",
      "data-zoom-in",
      "data-zoom-out",
      "data-fit",
      "data-focus-active",
      "data-branch-id",
      "data-canvas-viewport",
      "data-critical-summary",
      "data-operational-summary",
    ];
    const attribute = stableAttributes.find((candidate) => active.hasAttribute(candidate));
    return attribute === undefined ? undefined : `[${attribute}]`;
  }

  private observeViewport(): void {
    const viewport = this.viewport();
    if (viewport === null || typeof ResizeObserver === "undefined") return;
    this.resizeObserver = new ResizeObserver(() => {
      if (this.autoFit) this.fitCanvas();
    });
    this.resizeObserver.observe(viewport);
  }

  private focusAfterRender(selector: string): void {
    this.root.querySelector<HTMLElement>(selector)?.focus();
  }

  private viewport(): HTMLElement | null {
    return this.root.querySelector<HTMLElement>("[data-canvas-viewport]");
  }

  private applyTransform(): void {
    const world = this.root.querySelector<HTMLElement>("[data-canvas-world]");
    if (world === null) return;
    world.style.transform = `translate(${String(this.panX)}px, ${String(this.panY)}px) scale(${String(this.scale)})`;
    const value = this.root.querySelector<HTMLElement>("[data-zoom-value]");
    if (value !== null) value.textContent = `${String(Math.round(this.scale * 100))}%`;
  }

  private zoomAt(factor: number, viewportX?: number, viewportY?: number): void {
    this.autoFit = false;
    const viewport = this.viewport();
    if (viewport === null) return;
    const nextScale = clamp(this.scale * factor, MIN_SCALE, MAX_SCALE);
    const anchorX = viewportX ?? viewport.clientWidth / 2;
    const anchorY = viewportY ?? viewport.clientHeight / 2;
    const worldX = (anchorX - this.panX) / this.scale;
    const worldY = (anchorY - this.panY) / this.scale;
    this.scale = nextScale;
    this.panX = anchorX - worldX * nextScale;
    this.panY = anchorY - worldY * nextScale;
    this.applyTransform();
  }

  private fitCanvas(): void {
    const viewport = this.viewport();
    const layout = this.layout;
    if (viewport === null || layout === undefined || viewport.clientWidth === 0 || viewport.clientHeight === 0) return;
    const inset = 42;
    this.scale = clamp(Math.min((viewport.clientWidth - inset * 2) / layout.width, (viewport.clientHeight - inset * 2) / layout.height), MIN_SCALE, 1.12);
    this.panX = (viewport.clientWidth - layout.width * this.scale) / 2;
    this.panY = (viewport.clientHeight - layout.height * this.scale) / 2;
    this.applyTransform();
  }

  private focusNode(nodeId: string): void {
    this.autoFit = false;
    const viewport = this.viewport();
    const positioned = this.layout?.nodes.find((entry) => entry.node.id === nodeId);
    if (viewport === null || positioned === undefined) return;
    this.scale = clamp(Math.max(this.scale, 0.82), MIN_SCALE, MAX_SCALE);
    this.panX = viewport.clientWidth / 2 - (positioned.x + CAUSAL_NODE_WIDTH / 2) * this.scale;
    this.panY = viewport.clientHeight / 2 - (positioned.y + CAUSAL_NODE_HEIGHT / 2) * this.scale;
    this.applyTransform();
  }

  private persistHiddenNodes(): void {
    const context = this.contextValue;
    if (context === undefined) return;
    saveHiddenNodeIds(cacheKeyForContext(context), this.hiddenNodeIds);
  }
}

function getCachedState(context: WorkspacePanelContext): PanelState | undefined {
  return stateCache.get(cacheKeyForContext(context));
}

function getOrLoadState(context: WorkspacePanelContext): PanelState {
  const cached = getCachedState(context);
  if (cached !== undefined) return cached;
  const loading: PanelState = { kind: "loading" };
  stateCache.set(cacheKeyForContext(context), loading);
  void refreshResearchWorkflowPanel(context);
  return loading;
}

function cacheKeyForContext(context: WorkspacePanelContext): string {
  return `${context.machine.id}:${context.workspace.projectId}:${context.workspace.id}`;
}

export function renderResearchCanvas(
  graph: ResearchCausalGraph,
  state: ResearchWorkflowState,
  layout = layoutResearchCausalGraph(graph),
  hiddenNodeIds: ReadonlySet<string> = new Set(),
  selectedNodeId?: string,
  panX = 28,
  panY = 28,
  scale = 1,
): string {
  const activePath = activeCausalPath(graph);
  const selectedNode = graph.nodes.find((node) => node.id === selectedNodeId);
  const hiddenCount = graph.nodes.filter((node) => hiddenNodeIds.has(node.id)).length;
  return `
    <section class="canvas-shell">
      <div class="canvas-meta">
        <div><strong>${String(graph.nodes.filter((node) => node.kind === "hypothesis").length)}</strong><span>hypotheses</span></div>
        <div><strong>${String(graph.nodes.filter((node) => node.kind === "conclusion" && node.conclusion === "confirmed").length)}</strong><span>confirmed</span></div>
        <div><strong>${String(graph.nodes.filter((node) => node.kind === "conclusion" && node.conclusion === "denied").length)}</strong><span>denied</span></div>
        <div><strong>${String(graph.nodes.filter((node) => node.kind === "conclusion" && node.conclusion === "unsure").length)}</strong><span>unsure</span></div>
      </div>
      <div class="canvas-viewport" data-canvas-viewport tabindex="0" aria-label="Research causal graph canvas">
        <div class="canvas-controls" aria-label="Canvas controls">
          <button data-zoom-out title="Zoom out" aria-label="Zoom out">−</button>
          <span data-zoom-value>${String(Math.round(scale * 100))}%</span>
          <button data-zoom-in title="Zoom in" aria-label="Zoom in">+</button>
          <button data-fit>Fit</button>
          ${graph.activeNodeId === undefined ? "" : hiddenNodeIds.has(graph.activeNodeId) ? `<button data-restore-active>Restore active</button>` : `<button data-focus-active>Active</button>`}
          ${hiddenCount === 0 ? "" : `<button data-restore-hidden>Restore ${String(hiddenCount)}</button>`}
        </div>
        ${renderEdgeDescriptions(graph)}
        ${layout.nodes.length === 0 ? `<div class="canvas-empty">All nodes are hidden.</div>` : ""}
        <div class="canvas-world" data-canvas-world style="width:${String(layout.width)}px;height:${String(layout.height)}px;transform:translate(${String(panX)}px, ${String(panY)}px) scale(${String(scale)})">
          <svg class="edge-layer" viewBox="0 0 ${String(layout.width)} ${String(layout.height)}" aria-hidden="true">
            <defs><marker id="causal-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z"></path></marker></defs>
            ${layout.edges.map((entry) => `<path class="causal-edge ${entry.edge.kind} ${activePath.edgeIds.has(entry.edge.id) ? "active-path" : ""}" d="${entry.path}" marker-end="url(#causal-arrow)"></path>`).join("")}
          </svg>
          ${layout.edges.map((entry) => renderEdgeLabel(entry.edge, entry.labelX, entry.labelY)).join("")}
          ${layout.nodes.map((entry) => renderCausalNode(entry.node, entry.x, entry.y, graph, activePath.nodeIds, selectedNodeId)).join("")}
        </div>
        ${selectedNode === undefined ? "" : renderNodeInspector(selectedNode, graph, state)}
        <div class="canvas-hint">Drag to pan · Scroll to pan · Ctrl/⌘ + scroll to zoom</div>
      </div>
    </section>
  `;
}

function renderCausalNode(node: CausalNode, x: number, y: number, graph: ResearchCausalGraph, activePath: ReadonlySet<string>, selectedNodeId: string | undefined): string {
  const classes = ["causal-node", node.kind, node.status];
  if (node.id === graph.activeNodeId) classes.push("active-node");
  if (activePath.has(node.id)) classes.push("active-path");
  if (node.id === selectedNodeId) classes.push("selected");
  const describedBy = graph.edges.filter((edge) => edge.from === node.id || edge.to === node.id).map((edge) => edgeDescriptionId(edge.id)).join(" ");
  return `
    <button class="${classes.join(" ")}" data-node-id="${escapeAttr(node.id)}" style="left:${String(x)}px;top:${String(y)}px" aria-label="${escapeAttr(`${causalKindLabel(node.kind)}: ${node.title}`)}"${describedBy === "" ? "" : ` aria-describedby="${escapeAttr(describedBy)}"`}>
      <span class="node-head"><span class="node-kind">${escapeHtml(causalKindLabel(node.kind))}</span><span class="node-status">${escapeHtml(node.status)}</span></span>
      <strong>${escapeHtml(node.title)}</strong>
      <span class="node-summary">${escapeHtml(node.summary)}</span>
      ${node.conclusion === undefined ? "" : `<span class="conclusion ${node.conclusion}">Pi interpretation · ${escapeHtml(node.conclusion)}</span>`}
    </button>
  `;
}

function renderEdgeDescriptions(graph: ResearchCausalGraph): string {
  const nodeTitles = new Map(graph.nodes.map((node) => [node.id, node.title]));
  return `<ol class="visually-hidden" aria-label="Causal relationships">${graph.edges.map((edge) => {
    const relation = edge.kind === "motivates" ? `motivates: ${edge.direction ?? "next hypothesis"}` : causalEdgeLabel(edge.kind) ?? edge.kind;
    return `<li id="${escapeAttr(edgeDescriptionId(edge.id))}">${escapeHtml(nodeTitles.get(edge.from) ?? edge.from)} ${escapeHtml(relation)} ${escapeHtml(nodeTitles.get(edge.to) ?? edge.to)}</li>`;
  }).join("")}</ol>`;
}

function edgeDescriptionId(edgeId: string): string {
  return `causal-edge-description-${edgeId}`;
}

function renderEdgeLabel(edge: CausalEdge, x: number, y: number): string {
  const label = edge.kind === "motivates" ? edge.direction : causalEdgeLabel(edge.kind);
  if (label === undefined) return "";
  return `<div class="edge-label ${edge.kind}" style="left:${String(x)}px;top:${String(y)}px"><span>${escapeHtml(label)}</span></div>`;
}

function renderNodeInspector(node: CausalNode, graph: ResearchCausalGraph, state: ResearchWorkflowState): string {
  const item = node.workItemId === undefined ? undefined : state.workItems.find((candidate) => candidate.id === node.workItemId);
  const nextDirections = graph.edges.filter((edge) => edge.from === node.id && edge.kind === "motivates").flatMap((edge) => edge.direction === undefined ? [] : [edge.direction]);
  return `
    <aside class="node-inspector" aria-label="Selected causal node">
      <div class="inspector-head"><span>${escapeHtml(causalKindLabel(node.kind))}</span><button data-close-inspector aria-label="Close node details">×</button></div>
      <h3>${escapeHtml(node.title)}</h3>
      <p>${escapeHtml(node.summary)}</p>
      ${node.conclusion === undefined ? "" : `<div class="inspector-fact"><span>Conclusion</span><strong class="${node.conclusion}">Pi interpretation · ${escapeHtml(node.conclusion)}</strong></div>`}
      ${nextDirections.length === 0 ? "" : `<div class="inspector-fact"><span>Next direction</span>${nextDirections.map((direction) => `<strong>${escapeHtml(direction)}</strong>`).join("")}</div>`}
      <div class="inspector-fact"><span>Evidence links</span><strong>${String(node.evidenceRefs.length)} typed ${node.evidenceRefs.length === 1 ? "reference" : "references"}</strong></div>
      ${item === undefined ? "" : `<button class="secondary wide" data-branch-id="${escapeAttr(item.id)}">Review branch with Pi</button>`}
      <div class="inspector-actions"><button class="primary" data-revise-node>Revise with Pi</button><button class="secondary" data-hide-node>Hide locally</button></div>
    </aside>
  `;
}

function renderMissingGraph(state: ResearchWorkflowState): string {
  const item = activeWorkItem(state);
  return `
    <div class="empty-state graph-missing">
      <strong>Causal graph not generated yet.</strong>
      <p>Build a conservative DAG from existing durable records. Unsupported relationships should remain separate roots rather than being inferred.</p>
      ${item === undefined ? "" : `<div class="legacy-context"><span>Current branch</span><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.objective)}</p></div>`}
      <p class="muted">Version-1 state remains readable and will upgrade to version 2 on the first validated write.</p>
    </div>
  `;
}

function renderCriticalDecisions(decisions: DecisionRecord[]): string {
  return `
    <details class="critical-decisions" open>
      <summary data-critical-summary><strong>${String(decisions.length)} critical ${decisions.length === 1 ? "question" : "questions"} blocking safe progress</strong></summary>
      <div>${decisions.map((decision) => `<article><strong>${escapeHtml(decision.question)}</strong><p>${escapeHtml(decision.impact)}</p></article>`).join("")}</div>
    </details>
  `;
}

function renderOperationalIndex(state: ResearchWorkflowState): string {
  return `
    <details class="operational-index">
      <summary data-operational-summary><span>Operational record index</span><small>${String(state.workItems.length)} branches · details kept outside the canvas</small></summary>
      <div class="branch-index">
        ${state.workItems.map((item) => `<article><div><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.phase)}</span></div><p>${escapeHtml(item.objective)}</p><small>${String(item.runs.length)} runs · ${String(item.findings.length)} findings · ${String(item.acceptanceCriteria.length)} criteria</small></article>`).join("")}
        <button class="secondary" data-review-records>Review details with Pi</button>
      </div>
    </details>
  `;
}

function graphStatus(graph: ResearchCausalGraph, state: ResearchWorkflowState | undefined): string {
  const active = graph.nodes.find((node) => node.id === graph.activeNodeId);
  const update = state === undefined ? "" : `<span>Updated ${escapeHtml(formatTimestamp(state.updatedAt))}</span>`;
  return `<div class="graph-status"><span class="graph-state ${graph.status}">${escapeHtml(graph.status)}</span>${active === undefined ? "" : `<span>Active: ${escapeHtml(active.title)}</span>`}${update}</div>`;
}

function criticalDecisions(state: ResearchWorkflowState): DecisionRecord[] {
  return state.workItems.flatMap((item) => item.decisions.filter(decisionRequiresAttention));
}

export function researchWorkflowInitializePrompt(): string {
  return `Initialize or upgrade the Research Workflow for this workspace. Call research_workflow get first and read the canonical project status, current intent, and durable runtime evidence. Preserve existing work items and detailed records. Create causalGraph version 2 as a conservative DAG spanning the overall research idea: hypothesis -> validation -> analysis -> conclusion, followed by motivates edges to new hypotheses. Support branches and merges; never invent an unsupported causal relationship, and leave unrelated histories as separate roots. Keep graph text concise and semantic: no code, paths, job metadata, or metric tables. Use typed evidence references for completed analysis and conclusion nodes, set an explicit active node and ordered activePathEdgeIds only when one path is supported, and keep the graph status active unless I explicitly confirm completion. Continue automatically for routine reversible maintenance; create a critical blocking decision only when safe progress truly requires my scientific-direction, large-cost, missing-information, or irreversible-action choice.`;
}

export function researchWorkflowUpdatePrompt(state: ResearchWorkflowState): string {
  const graph = state.causalGraph;
  return `Review and update the Research causal canvas${graph === undefined ? "" : ` ${graph.title}`}. Call research_workflow get first, then read canonical project state and the latest runtime evidence. Maintain the DAG automatically across hypothesis, validation, analysis, conclusion, and motivated next-hypothesis nodes. Keep node summaries short and hide implementation detail, paths, job metadata, and metric tables. Preserve uncertainty and scope; a graph conclusion is a Pi interpretation, not user authority. Use typed evidence refs for completed analysis/conclusion nodes. Preserve branches and merges, update the explicit active path only when supported, and never infer missing causal links. Routine reversible choices should proceed automatically. Ask me only when safe continuation is blocked by an important scientific direction, substantial unapproved compute, required missing information, or an irreversible action.`;
}

export function researchWorkflowCorrectionPrompt(node: CausalNode): string {
  return `Correct causal node ${node.id} (${node.kind}) in the Research Workflow. Call research_workflow get first. Apply my correction with upsert_causal_node and update affected edges or the active path only when causally necessary. Preserve durable detailed records and provenance; do not invent evidence. My correction: `;
}

function causalKindLabel(kind: CausalNode["kind"]): string {
  switch (kind) {
    case "hypothesis": return "Hypothesis";
    case "validation": return "Validation";
    case "analysis": return "Analysis";
    case "conclusion": return "Conclusion";
  }
}

function causalEdgeLabel(kind: CausalEdge["kind"]): string | undefined {
  switch (kind) {
    case "tests": return "tests";
    case "produces": return "analysis";
    case "concludes": return "conclusion";
    case "motivates": return undefined;
  }
}

function hiddenStorageKey(contextKey: string): string {
  return `pi-web:research-canvas:hidden:${contextKey}`;
}

function loadHiddenNodeIds(contextKey: string): Set<string> {
  try {
    const value = localStorage.getItem(hiddenStorageKey(contextKey));
    return new Set(value === null || value === "" ? [] : value.split("\n").filter((entry) => entry !== ""));
  } catch {
    return new Set();
  }
}

function saveHiddenNodeIds(contextKey: string, ids: ReadonlySet<string>): void {
  try {
    localStorage.setItem(hiddenStorageKey(contextKey), [...ids].sort().join("\n"));
  } catch {
    // Local hiding is optional presentation state; storage failures must not affect the graph.
  }
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function escapeHtml(value: unknown): string {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeAttr(value: unknown): string {
  return escapeHtml(value).replaceAll('"', "&quot;");
}

function cssAttributeValue(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function styles(): string {
  return `
    <style>
      :host { display: contents; }
      * { box-sizing: border-box; }
      .visually-hidden { position: absolute !important; width: 1px !important; height: 1px !important; overflow: hidden !important; clip: rect(0 0 0 0) !important; clip-path: inset(50%) !important; white-space: nowrap !important; }
      button { border: 1px solid var(--pi-border); border-radius: 8px; background: var(--pi-surface); color: var(--pi-text); padding: 6px 10px; font: inherit; cursor: pointer; }
      button:hover:not(:disabled) { background: var(--pi-surface-hover); }
      button:disabled { cursor: wait; opacity: .65; }
      button:focus-visible, .canvas-viewport:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: 2px; }
      .primary { border-color: var(--pi-accent); background: var(--pi-accent); color: var(--pi-accent-contrast, white); font-weight: 650; }
      .secondary { background: var(--pi-surface); }
      .wide { width: 100%; }
      .toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 12px; border-bottom: 1px solid var(--pi-border-muted); }
      .toolbar-title { display: grid; min-width: 0; gap: 4px; }
      .toolbar-title > strong { overflow: hidden; font-size: 15px; text-overflow: ellipsis; white-space: nowrap; }
      .graph-status { display: flex; flex-wrap: wrap; align-items: center; gap: 5px 9px; color: var(--pi-muted); font-size: 11px; }
      .graph-state { border: 1px solid var(--pi-border); border-radius: 999px; padding: 1px 6px; font-weight: 650; text-transform: uppercase; }
      .graph-state.active { border-color: var(--pi-accent-border); color: var(--pi-accent); }
      .graph-state.completed { border-color: var(--pi-success-border); color: var(--pi-success); }
      .toolbar-actions { display: flex; flex: 0 0 auto; gap: 7px; }
      .icon-button { min-width: 34px; font-size: 17px; }
      .viewer { min-height: 0; overflow: auto; padding: 10px; }
      .loading, .empty { padding: 16px; }
      .canvas-shell { display: grid; gap: 8px; }
      .canvas-meta { display: flex; flex-wrap: wrap; gap: 6px; }
      .canvas-meta > div { display: flex; align-items: baseline; gap: 5px; border: 1px solid var(--pi-border-muted); border-radius: 999px; background: var(--pi-surface); padding: 4px 8px; }
      .canvas-meta strong { font-size: 12px; }
      .canvas-meta span { color: var(--pi-muted); font-size: 10px; text-transform: uppercase; }
      .canvas-viewport { position: relative; min-height: 560px; height: min(72vh, 820px); overflow: hidden; border: 1px solid var(--pi-border-muted); border-radius: 13px; background-color: var(--pi-bg); background-image: radial-gradient(circle, color-mix(in srgb, var(--pi-muted) 20%, transparent) 1px, transparent 1px); background-size: 20px 20px; cursor: grab; touch-action: none; }
      .canvas-viewport.dragging { cursor: grabbing; }
      .canvas-world { position: absolute; left: 0; top: 0; transform-origin: 0 0; will-change: transform; }
      .canvas-controls { position: absolute; z-index: 20; top: 9px; left: 9px; display: flex; align-items: center; gap: 4px; border: 1px solid var(--pi-border); border-radius: 10px; background: color-mix(in srgb, var(--pi-surface) 92%, transparent); padding: 4px; box-shadow: 0 5px 18px var(--pi-shadow-soft); }
      .canvas-controls button { min-width: 30px; padding: 4px 7px; }
      .canvas-controls span { min-width: 42px; color: var(--pi-muted); font-size: 10px; text-align: center; }
      .canvas-hint { position: absolute; z-index: 5; left: 10px; bottom: 8px; border-radius: 7px; background: color-mix(in srgb, var(--pi-bg) 84%, transparent); color: var(--pi-muted); padding: 3px 6px; font-size: 10px; pointer-events: none; }
      .canvas-empty { position: absolute; inset: 0; display: grid; place-items: center; color: var(--pi-muted); }
      .edge-layer { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
      #causal-arrow path { fill: var(--pi-border); }
      .causal-edge { fill: none; stroke: var(--pi-border); stroke-width: 2; opacity: .66; }
      .causal-edge.motivates { stroke: var(--pi-accent); stroke-dasharray: 6 5; opacity: .8; }
      .causal-edge.active-path { stroke: var(--pi-accent); stroke-width: 3; opacity: 1; }
      .edge-label { position: absolute; z-index: 2; max-width: 210px; transform: translate(-50%, -50%); pointer-events: none; }
      .edge-label span { display: -webkit-box; overflow: hidden; border: 1px solid var(--pi-border-muted); border-radius: 999px; background: var(--pi-bg); color: var(--pi-muted); padding: 3px 8px; font-size: 10px; line-height: 1.25; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
      .edge-label.motivates span { border-color: var(--pi-accent-border); color: var(--pi-accent); font-weight: 600; }
      .causal-node { position: absolute; z-index: 4; display: grid; align-content: start; gap: 7px; width: ${String(CAUSAL_NODE_WIDTH)}px; height: ${String(CAUSAL_NODE_HEIGHT)}px; overflow: hidden; border: 1px solid var(--pi-border); border-left-width: 4px; border-radius: 11px; background: var(--pi-surface); color: var(--pi-text); padding: 10px 11px; text-align: left; box-shadow: 0 6px 17px var(--pi-shadow-soft); }
      .causal-node.hypothesis { border-left-color: #8b5cf6; }
      .causal-node.validation { border-left-color: #3b82f6; }
      .causal-node.analysis { border-left-color: #f59e0b; }
      .causal-node.conclusion { border-left-color: #10b981; }
      .causal-node.abandoned { opacity: .52; }
      .causal-node.active-path { border-color: var(--pi-accent-border); }
      .causal-node.active-node { box-shadow: 0 0 0 3px color-mix(in srgb, var(--pi-accent) 22%, transparent), 0 7px 22px var(--pi-shadow-soft); }
      .causal-node.selected { outline: 3px solid color-mix(in srgb, var(--pi-accent) 42%, transparent); outline-offset: 2px; }
      .node-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
      .node-kind, .node-status { color: var(--pi-muted); font-size: 9px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
      .causal-node > strong { display: -webkit-box; overflow: hidden; font-size: 13px; line-height: 1.3; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
      .node-summary { display: -webkit-box; overflow: hidden; color: var(--pi-text-secondary); font-size: 10.5px; line-height: 1.35; -webkit-box-orient: vertical; -webkit-line-clamp: 3; }
      .conclusion { align-self: end; width: max-content; max-width: 100%; overflow: hidden; border: 1px solid var(--pi-border); border-radius: 999px; padding: 2px 6px; font-size: 9px; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
      .conclusion.confirmed, .confirmed { border-color: var(--pi-success-border); color: var(--pi-success); }
      .conclusion.denied, .denied { border-color: var(--pi-danger); color: var(--pi-danger); }
      .conclusion.unsure, .unsure { border-color: var(--pi-warning); color: var(--pi-warning); }
      .node-inspector { position: absolute; z-index: 30; top: 9px; right: 9px; display: grid; gap: 11px; width: min(330px, calc(100% - 18px)); max-height: calc(100% - 18px); overflow: auto; border: 1px solid var(--pi-border); border-radius: 12px; background: color-mix(in srgb, var(--pi-surface) 96%, transparent); padding: 13px; box-shadow: 0 12px 34px var(--pi-shadow); cursor: default; }
      .inspector-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; color: var(--pi-muted); font-size: 10px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
      .inspector-head button { border: 0; padding: 1px 5px; font-size: 18px; }
      .node-inspector h3, .node-inspector p { margin: 0; }
      .node-inspector h3 { font-size: 16px; line-height: 1.35; }
      .node-inspector p { color: var(--pi-text-secondary); font-size: 12px; line-height: 1.5; }
      .inspector-fact { display: grid; gap: 4px; border-top: 1px solid var(--pi-border-muted); padding-top: 9px; }
      .inspector-fact > span { color: var(--pi-muted); font-size: 9px; font-weight: 650; text-transform: uppercase; }
      .inspector-fact > strong { font-size: 11px; line-height: 1.4; }
      .inspector-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 7px; }
      .critical-decisions { margin-bottom: 9px; border: 1px solid var(--pi-warning); border-radius: 10px; background: color-mix(in srgb, var(--pi-warning) 7%, transparent); }
      .critical-decisions summary { cursor: pointer; padding: 10px 12px; color: var(--pi-warning); }
      .critical-decisions > div { display: grid; gap: 7px; border-top: 1px solid color-mix(in srgb, var(--pi-warning) 32%, transparent); padding: 9px; }
      .critical-decisions article { display: grid; gap: 4px; border-radius: 8px; background: var(--pi-surface); padding: 9px; }
      .critical-decisions p { margin: 0; color: var(--pi-text-secondary); font-size: 11px; }
      .operational-index { margin-top: 9px; border: 1px solid var(--pi-border-muted); border-radius: 10px; background: var(--pi-surface); }
      .operational-index > summary { display: flex; align-items: center; justify-content: space-between; gap: 9px; cursor: pointer; padding: 10px 12px; }
      .operational-index summary small { color: var(--pi-muted); }
      .branch-index { display: grid; gap: 7px; border-top: 1px solid var(--pi-border-muted); padding: 9px; }
      .branch-index article { display: grid; gap: 4px; border: 1px solid var(--pi-border-muted); border-radius: 8px; padding: 9px; }
      .branch-index article > div { display: flex; justify-content: space-between; gap: 8px; }
      .branch-index article span, .branch-index article small { color: var(--pi-muted); font-size: 10px; }
      .branch-index article p { margin: 0; color: var(--pi-text-secondary); font-size: 11px; line-height: 1.4; }
      .empty-state, .status { display: grid; gap: 8px; border: 1px dashed var(--pi-border-muted); border-radius: 12px; padding: 16px; }
      .empty-state p, .status p { margin: 0; line-height: 1.45; }
      .legacy-context { display: grid; gap: 4px; border: 1px solid var(--pi-border-muted); border-radius: 9px; background: var(--pi-surface); padding: 11px; }
      .legacy-context span { color: var(--pi-muted); font-size: 10px; text-transform: uppercase; }
      .status.error { border-style: solid; border-color: var(--pi-danger); color: var(--pi-danger); }
      .muted { color: var(--pi-muted); }
      pre { margin: 0; overflow: auto; border-radius: 7px; background: var(--pi-bg); padding: 8px; color: var(--pi-text-secondary); font: 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; white-space: pre-wrap; }
      @media (max-width: 700px) {
        .toolbar { align-items: flex-start; }
        .toolbar-actions { flex-wrap: wrap; justify-content: flex-end; }
        .canvas-viewport { min-height: 500px; height: 68vh; }
        .canvas-hint { display: none; }
        .operational-index > summary { align-items: flex-start; flex-direction: column; }
      }
    </style>
  `;
}
