import { LitElement, css, html, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import type { SessionActivity, SessionInfo, SessionStatus, Workspace } from "../api";
import type { QualifiedContributionId, QualifiedWorkspacePanelContribution, WorkspacePanelContext } from "../plugins/types";
import { workspacePanelStyles, type ChatLine } from "./shared";
import "./AgentSessionGraph";

export interface WorkspacePanelEmptyState {
  title: string;
  body?: string;
}

type WorkspacePanelBadge = string | number | TemplateResult | undefined;

@customElement("workspace-panel")
export class WorkspacePanel extends LitElement {
  @property({ attribute: false }) workspace: Workspace | undefined;
  @property({ attribute: false }) panelContext: WorkspacePanelContext | undefined;
  @property({ attribute: false }) emptyState: WorkspacePanelEmptyState | undefined;
  @property() tool: QualifiedContributionId = "core:workspace.files";
  @property({ attribute: false }) panels: QualifiedWorkspacePanelContribution[] = [];
  @property({ attribute: false }) sessions: SessionInfo[] = [];
  @property({ attribute: false }) selectedSession: SessionInfo | undefined;
  @property({ attribute: false }) messages: ChatLine[] = [];
  @property({ attribute: false }) sessionStatuses: Record<string, SessionStatus> = {};
  @property({ attribute: false }) sessionActivities: Record<string, SessionActivity> = {};
  @property({ type: Boolean }) hideToolTabs = false;
  @property({ attribute: false }) onSelectTool: (tool: QualifiedContributionId) => void = () => undefined;
  @property({ attribute: false }) onSelectSession: (session: SessionInfo, rootSession: SessionInfo) => void = () => undefined;
  @query(".workspace-header-strip") private workspaceHeaderStrip?: HTMLElement | null;
  @state() private workspaceHeaderCanScrollLeft = false;
  @state() private workspaceHeaderCanScrollRight = false;
  @state() private agentsExpanded = false;

  private observedWorkspaceHeaderStrip: HTMLElement | undefined;
  private workspaceHeaderResizeObserver: ResizeObserver | undefined;
  private readonly onWorkspaceHeaderScroll = () => {
    this.updateWorkspaceHeaderScrollState();
  };

  override firstUpdated(): void {
    this.observeWorkspaceHeaderStrip();
    this.updateWorkspaceHeaderScrollState();
  }

  override updated(changed: PropertyValues<this>): void {
    this.observeWorkspaceHeaderStrip();
    this.updateWorkspaceHeaderScrollState();
    const previousWorkspace = changed.get("workspace");
    if (previousWorkspace !== undefined && previousWorkspace.id !== this.workspace?.id && this.agentsExpanded) this.agentsExpanded = false;
  }

  override disconnectedCallback(): void {
    this.workspaceHeaderResizeObserver?.disconnect();
    this.workspaceHeaderResizeObserver = undefined;
    this.observedWorkspaceHeaderStrip = undefined;
    super.disconnectedCallback();
  }

  override render() {
    const workspace = this.workspace;
    if (workspace === undefined) return this.renderEmptyState(this.emptyState ?? {
      title: "Select a workspace",
      body: "Choose a workspace to use its tools.",
    });
    const context = this.panelContext;
    if (context === undefined) return this.renderEmptyState({
      title: "Workspace tools unavailable",
      body: "Try selecting the workspace again.",
    });
    const visiblePanels = this.panels;
    const selectedPanel = visiblePanels.find((panel) => panel.id === this.tool) ?? visiblePanels[0];
    return html`
      ${this.hideToolTabs ? null : html`
        <header>
          <div class=${this.workspaceHeaderFrameClass()}>
            <div class="workspace-header-strip" @scroll=${this.onWorkspaceHeaderScroll}>
              <div class="tabs">
                ${visiblePanels.map((panel) => {
                  const selected = selectedPanel?.id === panel.id;
                  const badge = panel.badge?.(context);
                  const ariaLabel = this.panelTabAriaLabel(panel, badge);
                  return html`
                    <button class=${this.panelTabClass(panel, selected)} title=${ariaLabel} aria-label=${ariaLabel} aria-pressed=${String(selected)} @click=${() => { this.onSelectTool(panel.id); }}>
                      ${this.renderPanelTabContent(panel, badge)}
                    </button>
                  `;
                })}
              </div>
            </div>
          </div>
        </header>
      `}
      <div class=${`workspace-content-split ${this.agentsExpanded ? "agents-expanded" : "agents-collapsed"}`}>
        <div class="workspace-tool-pane">
          ${selectedPanel === undefined ? this.renderEmptyState({
            title: "No workspace tools available",
            body: "No tools are available for this workspace.",
          }) : html`
            <div class="panel-content">
              ${selectedPanel.render(context)}
            </div>
          `}
        </div>
        <div class="agent-graph-pane">
          ${this.agentsExpanded ? html`
            <agent-session-graph
              .sessions=${this.sessions}
              .selectedSession=${this.selectedSession}
              .messages=${this.messages}
              .statuses=${this.sessionStatuses}
              .activities=${this.sessionActivities}
              .onSelectSession=${this.onSelectSession}
              .showCollapseControl=${true}
              .onCollapse=${() => { this.agentsExpanded = false; }}
            ></agent-session-graph>
          ` : html`
            <button class="agent-graph-expand" type="button" aria-expanded="false" @click=${() => { this.agentsExpanded = true; }}>
              <span class="expand-chevron" aria-hidden="true">⌃</span>
              <strong>Agents</strong>
              <span>Show panel</span>
            </button>
          `}
        </div>
      </div>
    `;
  }

  private panelTabClass(panel: QualifiedWorkspacePanelContribution, selected: boolean): string {
    return [
      ...(panel.icon === undefined ? [] : ["icon-tab"]),
      ...(selected ? ["selected"] : []),
    ].join(" ");
  }

  private panelTabAriaLabel(panel: QualifiedWorkspacePanelContribution, badge: WorkspacePanelBadge): string {
    if (typeof badge !== "string" && typeof badge !== "number") return panel.title;
    const trimmedBadge = String(badge).trim();
    return trimmedBadge === "" ? panel.title : `${panel.title}, ${trimmedBadge}`;
  }

  private renderPanelTabContent(panel: QualifiedWorkspacePanelContribution, badge: WorkspacePanelBadge): TemplateResult {
    return html`
      ${panel.icon === undefined ? null : html`<span class="tab-custom-icon" aria-hidden="true">${panel.icon}</span>`}
      <span class="tab-label">${panel.title}</span>
      ${this.isEmptyBadge(badge) ? null : html`<span class="tab-badge">${badge}</span>`}
    `;
  }

  private isEmptyBadge(badge: WorkspacePanelBadge): boolean {
    return badge === undefined || badge === "";
  }

  private renderEmptyState(state: WorkspacePanelEmptyState): TemplateResult {
    return html`
      <section class="empty-state" role="status">
        <h2>${state.title}</h2>
        ${state.body === undefined ? null : html`<p>${state.body}</p>`}
      </section>
    `;
  }

  private workspaceHeaderFrameClass(): string {
    return `workspace-header-scroll-frame${this.workspaceHeaderCanScrollLeft ? " can-scroll-left" : ""}${this.workspaceHeaderCanScrollRight ? " can-scroll-right" : ""}`;
  }

  private observeWorkspaceHeaderStrip(): void {
    const strip = this.workspaceHeaderStripElement();
    if (this.observedWorkspaceHeaderStrip === strip) return;
    this.workspaceHeaderResizeObserver?.disconnect();
    this.observedWorkspaceHeaderStrip = strip;
    this.workspaceHeaderResizeObserver = undefined;
    if (strip === undefined || typeof ResizeObserver === "undefined") return;
    this.workspaceHeaderResizeObserver = new ResizeObserver(() => {
      this.updateWorkspaceHeaderScrollState();
    });
    this.workspaceHeaderResizeObserver.observe(strip);
  }

  private updateWorkspaceHeaderScrollState(): void {
    const strip = this.workspaceHeaderStripElement();
    const maxScrollLeft = strip === undefined ? 0 : Math.max(0, strip.scrollWidth - strip.clientWidth);
    const canScrollLeft = strip !== undefined && strip.scrollLeft > 1;
    const canScrollRight = strip !== undefined && maxScrollLeft - strip.scrollLeft > 1;
    if (this.workspaceHeaderCanScrollLeft !== canScrollLeft) this.workspaceHeaderCanScrollLeft = canScrollLeft;
    if (this.workspaceHeaderCanScrollRight !== canScrollRight) this.workspaceHeaderCanScrollRight = canScrollRight;
  }

  private workspaceHeaderStripElement(): HTMLElement | undefined {
    const strip = this.workspaceHeaderStrip;
    return strip instanceof HTMLElement ? strip : undefined;
  }

  static override styles = [workspacePanelStyles, css`
    :host { overflow: hidden; }
    .workspace-content-split { flex: 1 1 auto; min-height: 0; display: grid; grid-template-rows: minmax(0, 1fr) 38px; overflow: hidden; }
    .workspace-content-split.agents-expanded { grid-template-rows: minmax(140px, 56%) minmax(160px, 44%); }
    .workspace-tool-pane { min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
    .workspace-tool-pane > .empty-state { flex: 1 1 auto; }
    .agent-graph-pane { min-height: 0; display: flex; flex-direction: column; overflow: hidden; border-top: 1px solid var(--pi-border); }
    .agent-graph-expand { flex: 1 1 auto; width: 100%; display: flex; align-items: center; gap: 7px; border: 0; background: var(--pi-surface); color: var(--pi-text); padding: 0 10px; cursor: pointer; font: inherit; text-align: left; }
    .agent-graph-expand:hover, .agent-graph-expand:focus-visible { background: var(--pi-surface-hover); color: var(--pi-accent); }
    .agent-graph-expand strong { font-size: 11px; letter-spacing: .04em; text-transform: uppercase; }
    .agent-graph-expand > span:last-child { margin-left: auto; color: var(--pi-muted); font-size: 10px; }
    .expand-chevron { color: var(--pi-muted); }
    agent-session-graph { height: 100%; }
  `];
}
