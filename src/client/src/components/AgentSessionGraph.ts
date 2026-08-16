import { LitElement, css, html, svg, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import type { SessionActivity, SessionInfo, SessionStatus } from "../api";
import type { ChatLine } from "./shared";
import { isSessionActive } from "../../../shared/activity";
import {
  AGENT_GRAPH_NODE_HEIGHT,
  AGENT_GRAPH_NODE_WIDTH,
  buildAgentSessionGraph,
  isAgentChildSession,
  layoutAgentSessionGraph,
  mainAgentSessionForSelection,
  type AgentRunState,
  type AgentSessionGraphLayout,
  type PositionedAgentSessionNode,
} from "../agentSessionGraph";

const MIN_ZOOM = 0.55;
const MAX_ZOOM = 2.4;
const ZOOM_STEP = 0.2;

interface DragState {
  pointerId: number;
  clientX: number;
  clientY: number;
  panX: number;
  panY: number;
}

@customElement("agent-session-graph")
export class AgentSessionGraphElement extends LitElement {
  @property({ attribute: false }) sessions: SessionInfo[] = [];
  @property({ attribute: false }) selectedSession: SessionInfo | undefined;
  @property({ attribute: false }) messages: ChatLine[] = [];
  @property({ attribute: false }) statuses: Record<string, SessionStatus> = {};
  @property({ attribute: false }) activities: Record<string, SessionActivity> = {};
  @property({ attribute: false }) onSelectSession: (session: SessionInfo, rootSession: SessionInfo) => void = () => undefined;

  @state() private zoom = 1;
  @state() private panX = 0;
  @state() private panY = 0;
  @query("svg") private canvas?: SVGSVGElement;

  private rootSessionPath: string | undefined;
  private readonly messagesByRootPath = new Map<string, ChatLine[]>();
  private drag: DragState | undefined;
  private layout: AgentSessionGraphLayout | undefined;

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("sessions") || changed.has("selectedSession")) this.reconcileRootSession();
    const selected = this.selectedSession;
    if (selected !== undefined && selected.path === this.rootSessionPath && !isAgentChildSession(selected)) {
      this.messagesByRootPath.set(selected.path, this.messages);
    }
  }

  override render() {
    const root = this.sessions.find((session) => session.path === this.rootSessionPath);
    if (root === undefined) return this.renderEmptyState();
    const rootMessages = root.id === this.selectedSession?.id
      ? this.messages
      : this.messagesByRootPath.get(root.path) ?? [];
    const graph = buildAgentSessionGraph(this.sessions, root, rootMessages);
    const layout = layoutAgentSessionGraph(graph);
    this.layout = layout;
    const activeCount = layout.nodes.filter((node) => this.nodeState(node) === "running").length;
    const childCount = Math.max(0, layout.nodes.length - 1);
    const viewBox = this.viewBox(layout);
    return html`
      <section class="graph-shell" aria-label="Agent session graph">
        <header>
          <div class="graph-title">
            <strong>Agents</strong>
            <span>${String(childCount)} ${childCount === 1 ? "child" : "children"}${activeCount === 0 ? "" : ` · ${String(activeCount)} active`}</span>
          </div>
          <div class="zoom-controls" aria-label="Agent graph zoom controls">
            <button type="button" title="Zoom out" aria-label="Zoom out agent graph" @click=${() => { this.changeZoom(-ZOOM_STEP); }}>−</button>
            <button type="button" class="zoom-value" title="Reset view" aria-label="Reset agent graph view" @click=${() => { this.resetView(); }}>${Math.round(this.zoom * 100)}%</button>
            <button type="button" title="Zoom in" aria-label="Zoom in agent graph" @click=${() => { this.changeZoom(ZOOM_STEP); }}>+</button>
          </div>
        </header>
        <div class="canvas-frame">
          <svg
            viewBox=${viewBox}
            role="group"
            aria-label=${`Main agent and ${String(childCount)} child agent sessions`}
            @wheel=${(event: WheelEvent) => { this.onWheel(event); }}
            @pointerdown=${(event: PointerEvent) => { this.onPointerDown(event); }}
            @pointermove=${(event: PointerEvent) => { this.onPointerMove(event); }}
            @pointerup=${(event: PointerEvent) => { this.onPointerEnd(event); }}
            @pointercancel=${(event: PointerEvent) => { this.onPointerEnd(event); }}
          >
            <defs>
              <marker id="agent-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z"></path>
              </marker>
            </defs>
            <g class="edges">${layout.edges.map((edge) => this.renderEdge(layout, edge.parentSessionId, edge.childSessionId))}</g>
            <g class="nodes">${layout.nodes.map((node) => this.renderNode(node))}</g>
          </svg>
          ${layout.nodes.length === 1 ? html`<p class="empty-hint">Subagents will appear here when this session spawns them.</p>` : null}
        </div>
      </section>
    `;
  }

  private renderEmptyState() {
    return html`
      <section class="graph-shell empty" aria-label="Agent session graph">
        <header><div class="graph-title"><strong>Agents</strong></div></header>
        <div class="empty-state" role="status">
          <strong>Select a main-agent session</strong>
          <span>Its subagent sessions will appear in this graph.</span>
        </div>
      </section>
    `;
  }

  private renderEdge(layout: AgentSessionGraphLayout, parentId: string, childId: string): TemplateResult | null {
    const parent = layout.nodes.find((node) => node.session.id === parentId);
    const child = layout.nodes.find((node) => node.session.id === childId);
    if (parent === undefined || child === undefined) return null;
    const startX = parent.x + AGENT_GRAPH_NODE_WIDTH / 2;
    const startY = parent.y + AGENT_GRAPH_NODE_HEIGHT;
    const endX = child.x + AGENT_GRAPH_NODE_WIDTH / 2;
    const endY = child.y;
    const middleY = startY + (endY - startY) / 2;
    return svg`<path d=${`M ${String(startX)} ${String(startY)} C ${String(startX)} ${String(middleY)}, ${String(endX)} ${String(middleY)}, ${String(endX)} ${String(endY)}`} marker-end="url(#agent-arrow)"></path>`;
  }

  private renderNode(node: PositionedAgentSessionNode): TemplateResult {
    const state = this.nodeState(node);
    const selected = node.session.id === this.selectedSession?.id;
    const role = node.kind === "main" ? "main" : node.agent ?? (node.kind === "branch" ? "branch" : "subagent");
    const model = node.model === undefined ? undefined : shortModelName(node.model);
    const modelLine = [model, node.thinking].filter((value): value is string => value !== undefined && value !== "").join(" · ");
    const title = sessionLabel(node.session);
    const aria = [role, title, modelLine, state].filter((value) => value !== "").join(", ");
    return svg`
      <g
        class=${`agent-node ${node.kind} ${state}${selected ? " selected" : ""}`}
        transform=${`translate(${String(node.x)} ${String(node.y)})`}
        role="button"
        tabindex="0"
        aria-label=${aria}
        aria-current=${selected ? "true" : "false"}
        @pointerdown=${(event: PointerEvent) => { event.stopPropagation(); }}
        @click=${(event: MouseEvent) => { event.stopPropagation(); this.selectSession(node.session); }}
        @keydown=${(event: KeyboardEvent) => { this.onNodeKeydown(event, node.session); }}
      >
        <rect width=${String(AGENT_GRAPH_NODE_WIDTH)} height=${String(AGENT_GRAPH_NODE_HEIGHT)} rx="10" ry="10"></rect>
        <circle class="status-dot" cx="13" cy="14" r="4"></circle>
        <text class="role" x="23" y="18">${truncate(role, 20)}</text>
        <text class="title" x="12" y="39">${truncate(title, 25)}</text>
        <text class="meta" x="12" y="57">${truncate(modelLine === "" ? state : `${modelLine} · ${state}`, 30)}</text>
      </g>
    `;
  }

  private nodeState(node: PositionedAgentSessionNode): AgentRunState | "idle" {
    if (isSessionActive(this.statuses[node.session.id], this.activities[node.session.id])) return "running";
    return node.evidenceState ?? "idle";
  }

  private reconcileRootSession(): void {
    const selected = this.selectedSession;
    if (selected === undefined) {
      this.rootSessionPath = undefined;
      return;
    }
    const linkedRoot = mainAgentSessionForSelection(this.sessions, selected);
    if (linkedRoot !== undefined) {
      if (this.rootSessionPath !== linkedRoot.path) this.resetView();
      this.rootSessionPath = linkedRoot.path;
      return;
    }
    const previousRoot = this.sessions.find((session) => session.path === this.rootSessionPath);
    const previousMessages = previousRoot === undefined ? [] : this.messagesByRootPath.get(previousRoot.path) ?? [];
    const selectedBelongsToPreviousGraph = previousRoot !== undefined
      && buildAgentSessionGraph(this.sessions, previousRoot, previousMessages).nodes.some((node) => node.session.id === selected.id);
    if (selectedBelongsToPreviousGraph) return;
    this.rootSessionPath = undefined;
    this.resetView();
  }

  private viewBox(layout: AgentSessionGraphLayout): string {
    const width = layout.width / this.zoom;
    const height = layout.height / this.zoom;
    const x = (layout.width - width) / 2 - this.panX;
    const y = (layout.height - height) / 2 - this.panY;
    return `${String(x)} ${String(y)} ${String(width)} ${String(height)}`;
  }

  private changeZoom(delta: number): void {
    this.zoom = clamp(this.zoom + delta, MIN_ZOOM, MAX_ZOOM);
  }

  private resetView(): void {
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
  }

  private onWheel(event: WheelEvent): void {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      this.changeZoom(event.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP);
      return;
    }
    const layout = this.layout;
    const rect = this.canvas?.getBoundingClientRect();
    if (layout === undefined || rect === undefined || rect.width === 0 || rect.height === 0) return;
    this.panX -= event.deltaX * (layout.width / this.zoom) / rect.width;
    this.panY -= event.deltaY * (layout.height / this.zoom) / rect.height;
  }

  private onPointerDown(event: PointerEvent): void {
    if (event.button !== 0 || this.canvas === undefined) return;
    this.canvas.setPointerCapture(event.pointerId);
    this.drag = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, panX: this.panX, panY: this.panY };
  }

  private onPointerMove(event: PointerEvent): void {
    const drag = this.drag;
    const layout = this.layout;
    const rect = this.canvas?.getBoundingClientRect();
    if (drag?.pointerId !== event.pointerId || layout === undefined || rect === undefined || rect.width === 0 || rect.height === 0) return;
    this.panX = drag.panX + (event.clientX - drag.clientX) * (layout.width / this.zoom) / rect.width;
    this.panY = drag.panY + (event.clientY - drag.clientY) * (layout.height / this.zoom) / rect.height;
  }

  private onPointerEnd(event: PointerEvent): void {
    if (this.drag?.pointerId !== event.pointerId) return;
    if (this.canvas?.hasPointerCapture(event.pointerId) === true) this.canvas.releasePointerCapture(event.pointerId);
    this.drag = undefined;
  }

  private onNodeKeydown(event: KeyboardEvent, session: SessionInfo): void {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    this.selectSession(session);
  }

  private selectSession(session: SessionInfo): void {
    const root = this.sessions.find((candidate) => candidate.path === this.rootSessionPath);
    if (root !== undefined) this.onSelectSession(session, root);
  }

  static override styles = css`
    :host { display: block; height: 100%; min-height: 0; color: var(--pi-text); background: var(--pi-bg); font: 12px system-ui, sans-serif; }
    .graph-shell { height: 100%; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
    header { flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; padding: 6px 8px; border-bottom: 1px solid var(--pi-border-muted); background: var(--pi-surface); }
    .graph-title { min-width: 0; display: flex; align-items: baseline; gap: 7px; }
    .graph-title strong { color: var(--pi-text); font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
    .graph-title span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--pi-muted); }
    .zoom-controls { flex: 0 0 auto; display: inline-flex; align-items: center; }
    button { min-width: 28px; min-height: 28px; display: inline-grid; place-items: center; border: 1px solid var(--pi-border); border-right: 0; border-radius: 0; background: var(--pi-bg); color: var(--pi-text); padding: 2px 6px; cursor: pointer; font: inherit; }
    button:first-child { border-radius: 6px 0 0 6px; }
    button:last-child { border-right: 1px solid var(--pi-border); border-radius: 0 6px 6px 0; }
    button:hover, button:focus-visible { color: var(--pi-accent); background: var(--pi-selection-bg); }
    .zoom-value { min-width: 48px; color: var(--pi-muted); }
    .canvas-frame { position: relative; flex: 1 1 auto; min-height: 0; overflow: hidden; background-image: radial-gradient(circle, color-mix(in srgb, var(--pi-border) 60%, transparent) 0.8px, transparent 0.9px); background-size: 16px 16px; }
    svg { display: block; width: 100%; height: 100%; min-height: 0; touch-action: none; cursor: grab; user-select: none; }
    svg:active { cursor: grabbing; }
    .edges path { fill: none; stroke: var(--pi-border); stroke-width: 1.5; }
    marker path { fill: var(--pi-border); }
    .agent-node { cursor: pointer; outline: none; }
    .agent-node rect { fill: var(--pi-surface); stroke: var(--pi-border); stroke-width: 1.5; }
    .agent-node.main rect { fill: color-mix(in srgb, var(--pi-accent) 9%, var(--pi-surface)); stroke: var(--pi-accent-border); }
    .agent-node.running rect { stroke: var(--pi-warning-border); }
    .agent-node.failed rect { fill: color-mix(in srgb, var(--pi-danger) 8%, var(--pi-surface)); stroke: var(--pi-danger); }
    .agent-node.complete rect { stroke: var(--pi-success-border); }
    .agent-node.selected rect, .agent-node:focus-visible rect { stroke: var(--pi-accent); stroke-width: 2.5; }
    .status-dot { fill: var(--pi-muted); }
    .agent-node.running .status-dot { fill: var(--pi-warning); animation: pulse 1s ease-in-out infinite; }
    .agent-node.complete .status-dot { fill: var(--pi-success); }
    .agent-node.failed .status-dot { fill: var(--pi-danger); }
    .agent-node.paused .status-dot, .agent-node.stopped .status-dot { fill: var(--pi-warning); }
    text { pointer-events: none; dominant-baseline: alphabetic; }
    text.role { fill: var(--pi-muted); font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; }
    text.title { fill: var(--pi-text); font-size: 12px; font-weight: 600; }
    text.meta { fill: var(--pi-muted); font-size: 10px; }
    .empty-hint { position: absolute; right: 10px; bottom: 8px; left: 10px; margin: 0; color: var(--pi-muted); text-align: center; pointer-events: none; }
    .empty-state { flex: 1 1 auto; min-height: 0; display: grid; place-content: center; gap: 5px; padding: 16px; color: var(--pi-muted); text-align: center; }
    .empty-state strong { color: var(--pi-text); }
    @keyframes pulse { 0%, 100% { opacity: .45; } 50% { opacity: 1; } }
  `;
}

function sessionLabel(session: SessionInfo): string {
  if (session.name !== undefined && session.name !== "") return session.name;
  if (session.firstMessage !== "") return session.firstMessage;
  return session.id.slice(0, 12);
}

function shortModelName(model: string): string {
  const slash = model.lastIndexOf("/");
  return slash < 0 ? model : model.slice(slash + 1);
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
