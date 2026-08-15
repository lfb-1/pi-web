import type { WorkspacePanelContext } from "@jmfederico/pi-web/plugin-api";
import {
  loadResearchWorkflowState,
  researchWorkflowRefreshHint,
  researchWorkflowUnavailableMessage,
  type ResearchWorkflowLoadResult,
} from "./researchWorkflowClient.js";
import {
  activeWorkItem,
  RESEARCH_WORKFLOW_STATE_PATH,
  type AcceptanceCriterion,
  type ArtifactRecord,
  type DecisionRecord,
  type FindingRecord,
  type RecordSource,
  type ResearchWorkItem,
  type RunRecord,
} from "./researchWorkflowState.js";

export const researchWorkflowPanelTagName = "pi-web-research-workflow-panel";

const stateChangedEvent = "pi-web-research-workflow-state-changed";

type PanelState = { kind: "loading" } | ResearchWorkflowLoadResult;
const stateCache = new Map<string, PanelState>();

export function defineResearchWorkflowPanelElement(): void {
  if (!customElements.get(researchWorkflowPanelTagName)) {
    customElements.define(researchWorkflowPanelTagName, PiWebResearchWorkflowPanel);
  }
}

export function researchWorkflowPanelBadge(context: WorkspacePanelContext): string | number | undefined {
  const state = getCachedState(context);
  if (state?.kind === "unavailable") return "!";
  if (state?.kind !== "loaded") return undefined;
  const item = activeWorkItem(state.state);
  if (item === undefined) return undefined;
  const attentionCount = item.decisions.filter((decision) => decision.status === "open").length
    + item.runs.filter((run) => run.status === "failed").length;
  return attentionCount > 0 ? attentionCount : undefined;
}

export async function refreshResearchWorkflowPanel(context: WorkspacePanelContext): Promise<void> {
  const key = cacheKeyForContext(context);
  stateCache.set(key, { kind: "loading" });
  const state = await loadResearchWorkflowState(context.files).catch((error: unknown): PanelState => ({
    kind: "unavailable",
    message: researchWorkflowUnavailableMessage,
    hint: researchWorkflowRefreshHint,
    detail: formatUnknownError(error),
  }));
  stateCache.set(key, state);
  context.host.requestRender();
  window.dispatchEvent(new Event(stateChangedEvent));
}

class PiWebResearchWorkflowPanel extends HTMLElement {
  private contextValue: WorkspacePanelContext | undefined;
  private selectedWorkItemId: string | undefined;
  private readonly root: ShadowRoot;
  private readonly onStateChanged = () => {
    this.render();
  };

  constructor() {
    super();
    this.root = this.attachShadow({ mode: "open" });
  }

  set context(value: WorkspacePanelContext | undefined) {
    const previousKey = this.contextValue === undefined ? undefined : cacheKeyForContext(this.contextValue);
    const nextKey = value === undefined ? undefined : cacheKeyForContext(value);
    this.contextValue = value;
    if (previousKey === nextKey) return;
    this.selectedWorkItemId = undefined;
    this.render();
  }

  connectedCallback(): void {
    window.addEventListener(stateChangedEvent, this.onStateChanged);
    this.render();
  }

  disconnectedCallback(): void {
    window.removeEventListener(stateChangedEvent, this.onStateChanged);
  }

  private render(): void {
    const context = this.contextValue;
    if (context === undefined) {
      this.root.innerHTML = `${styles()}<section class="empty">Select a workspace.</section>`;
      return;
    }

    const state = getOrLoadState(context);
    this.root.innerHTML = `
      ${styles()}
      <section class="toolbar">
        <div>
          <strong>Research Workflow</strong>
          <span class="path">${escapeHtml(RESEARCH_WORKFLOW_STATE_PATH)}</span>
        </div>
        <div class="toolbar-actions">
          <button class="secondary" data-ask-pi>${state.kind === "missing" ? "Ask Pi to initialize" : "Ask Pi to update"}</button>
          <button class="secondary" data-refresh ${state.kind === "loading" ? "disabled" : ""}>Refresh</button>
        </div>
      </section>
      <section class="viewer">${this.renderState(state)}</section>
    `;

    this.root.querySelector("button[data-refresh]")?.addEventListener("click", () => {
      void refreshResearchWorkflowPanel(context);
    });
    this.root.querySelector("button[data-ask-pi]")?.addEventListener("click", () => {
      context.prompt.insertText(state.kind === "missing" ? initializePrompt() : updatePrompt(this.selectedItem(state)));
    });
    this.root.querySelector("select[data-work-item]")?.addEventListener("change", (event) => {
      const target = event.currentTarget;
      if (!(target instanceof HTMLSelectElement)) return;
      this.selectedWorkItemId = target.value;
      this.render();
    });
  }

  private renderState(state: PanelState): string {
    if (state.kind === "loading") return `<p class="muted">Loading ${escapeHtml(RESEARCH_WORKFLOW_STATE_PATH)}…</p>`;
    if (state.kind === "missing") {
      return `<div class="empty-state"><strong>${escapeHtml(state.message)}</strong><p>${escapeHtml(state.hint)}</p><p class="muted">The panel renders validated state; it does not infer approved content from chat.</p></div>`;
    }
    if (state.kind === "unavailable") {
      const detail = state.detail === undefined ? "" : `<pre>${escapeHtml(state.detail)}</pre>`;
      return `<div class="status error"><strong>${escapeHtml(state.message)}</strong><p>${escapeHtml(state.hint)}</p>${detail}</div>`;
    }
    if (state.state.workItems.length === 0) {
      return `<div class="empty-state"><strong>No research work items.</strong><p>Ask Pi to create a proposed work item from the current project objective.</p></div>`;
    }

    const item = this.selectedItem(state) ?? activeWorkItem(state.state);
    if (item === undefined) return `<div class="empty-state">No research work items.</div>`;
    this.selectedWorkItemId = item.id;
    return `${renderWorkItemPicker(state.state.workItems, item.id)}${renderWorkItem(item, state.state.updatedAt)}`;
  }

  private selectedItem(state: PanelState): ResearchWorkItem | undefined {
    if (state.kind !== "loaded") return undefined;
    if (this.selectedWorkItemId !== undefined) {
      const selected = state.state.workItems.find((item) => item.id === this.selectedWorkItemId);
      if (selected !== undefined) return selected;
    }
    return activeWorkItem(state.state);
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

function renderWorkItemPicker(items: ResearchWorkItem[], selectedId: string): string {
  if (items.length === 1) return "";
  return `<label class="work-item-picker"><span>Work item</span><select data-work-item>${items.map((item) => `<option value="${escapeAttr(item.id)}" ${item.id === selectedId ? "selected" : ""}>${escapeHtml(item.title)}</option>`).join("")}</select></label>`;
}

function renderWorkItem(item: ResearchWorkItem, updatedAt: string): string {
  const openDecisions = item.decisions.filter((decision) => decision.status === "open").length;
  const activeRuns = item.runs.filter((run) => ["queued", "running", "waiting"].includes(run.status)).length;
  const passedCriteria = item.acceptanceCriteria.filter((criterion) => criterion.result === "passed").length;
  return `
    <article class="work-item">
      <header class="objective-header">
        <div class="eyebrow">${escapeHtml(item.id)}</div>
        <div class="title-row"><h2>${escapeHtml(item.title)}</h2>${chip(item.phase, "phase")}</div>
        <div class="objective-copy">
          <span class="section-label">Objective</span>
          <p>${escapeHtml(item.objective)}</p>
          ${chip(item.objectiveStatus, item.objectiveStatus)}
        </div>
        ${item.rationale === undefined ? "" : `<div class="secondary-copy"><span class="section-label">Rationale</span><p>${escapeHtml(item.rationale)}</p></div>`}
        <div class="secondary-copy"><span class="section-label">Definition of done</span><p>${escapeHtml(item.definitionOfDone)}</p></div>
        ${renderSource(item.source)}
        ${renderAuthoritySource(item.authoritySource)}
      </header>

      <section class="metrics">
        ${metric("Open decisions", openDecisions, openDecisions > 0 ? "attention" : "")}
        ${metric("Active runs", activeRuns, activeRuns > 0 ? "active" : "")}
        ${metric("Criteria passed", `${String(passedCriteria)}/${String(item.acceptanceCriteria.length)}`, "")}
        ${metric("Updated", formatTimestamp(updatedAt), "")}
      </section>

      ${section("Acceptance criteria", renderCriteria(item.acceptanceCriteria), item.acceptanceCriteria.length)}
      ${section("Decisions", renderDecisions(item.decisions), item.decisions.length)}
      ${section("Runs", renderRuns(item.runs), item.runs.length)}
      ${section("Findings", renderFindings(item.findings), item.findings.length)}
      ${section("Artifacts and evidence", renderArtifacts(item.artifacts), item.artifacts.length)}
      ${renderLinks(item)}
    </article>
  `;
}

function renderCriteria(criteria: AcceptanceCriterion[]): string {
  if (criteria.length === 0) return emptyRows("No acceptance criteria recorded.");
  return criteria.map((criterion) => `
    <article class="record">
      <div class="record-heading"><strong>${escapeHtml(criterion.title)}</strong><span>${chip(criterion.status, criterion.status)}${chip(criterion.result, criterion.result)}</span></div>
      <p>${escapeHtml(criterion.predicate)}</p>
      ${criterion.note === undefined ? "" : `<p class="muted">${escapeHtml(criterion.note)}</p>`}
      ${renderRefs("Evidence", criterion.evidenceRefs)}
      ${renderSource(criterion.source)}
      ${renderAuthoritySource(criterion.authoritySource)}
    </article>
  `).join("");
}

function renderDecisions(decisions: DecisionRecord[]): string {
  if (decisions.length === 0) return emptyRows("No decision requests recorded.");
  return decisions.map((decision) => `
    <article class="record ${decision.status === "open" ? "attention-record" : ""}">
      <div class="record-heading"><strong>${escapeHtml(decision.question)}</strong><span>${chip(decision.kind, "kind")}${chip(decision.status, decision.status)}</span></div>
      <p><span class="section-label">Impact</span> ${escapeHtml(decision.impact)}</p>
      ${decision.resolution === undefined ? "" : `<p><span class="section-label">Resolution</span> ${escapeHtml(decision.resolution)}</p>`}
      ${renderSource(decision.source)}
      ${renderAuthoritySource(decision.authoritySource)}
    </article>
  `).join("");
}

function renderRuns(runs: RunRecord[]): string {
  if (runs.length === 0) return emptyRows("No runs recorded.");
  return runs.map((run) => `
    <article class="record">
      <div class="record-heading"><strong>${escapeHtml(run.purpose)}</strong><span>${chip(run.kind, "kind")}${chip(run.status, run.status)}</span></div>
      <div class="record-grid">
        <span><span class="section-label">ID</span> ${escapeHtml(run.id)}</span>
        ${run.jobId === undefined ? "" : `<span><span class="section-label">Job</span> ${escapeHtml(run.jobId)}</span>`}
        ${run.startedAt === undefined ? "" : `<span><span class="section-label">Started</span> ${escapeHtml(formatTimestamp(run.startedAt))}</span>`}
        ${run.finishedAt === undefined ? "" : `<span><span class="section-label">Finished</span> ${escapeHtml(formatTimestamp(run.finishedAt))}</span>`}
      </div>
      ${run.acceptanceResults.length === 0 ? "" : `<div class="subrecords">${run.acceptanceResults.map((result) => `<span>${escapeHtml(result.criterionId)} ${chip(result.status, result.status)}</span>`).join("")}</div>`}
      ${renderRefs("Artifacts", run.artifactRefs)}
      ${renderSource(run.source)}
    </article>
  `).join("");
}

function renderFindings(findings: FindingRecord[]): string {
  if (findings.length === 0) return emptyRows("No findings recorded.");
  return findings.map((finding) => `
    <article class="record">
      <div class="record-heading"><strong>${escapeHtml(finding.summary)}</strong>${chip(finding.status, finding.status)}</div>
      ${renderRefs("Evidence", finding.evidenceRefs)}
      ${renderSource(finding.source)}
      ${renderAuthoritySource(finding.authoritySource)}
    </article>
  `).join("");
}

function renderArtifacts(artifacts: ArtifactRecord[]): string {
  if (artifacts.length === 0) return emptyRows("No artifacts recorded.");
  return artifacts.map((artifact) => `
    <article class="record compact-record">
      <div class="record-heading"><strong>${escapeHtml(artifact.label)}</strong>${chip(artifact.kind, "kind")}</div>
      ${artifact.path === undefined ? "" : `<code>${escapeHtml(artifact.path)}</code>`}
      ${artifact.url === undefined ? "" : `<code>${escapeHtml(artifact.url)}</code>`}
      ${renderSource(artifact.source)}
    </article>
  `).join("");
}

function renderLinks(item: ResearchWorkItem): string {
  if (item.sessions.length === 0 && item.workspaces.length === 0) return "";
  return `
    <section class="workflow-section">
      <div class="section-heading"><h3>Linked runtime</h3><span>${String(item.sessions.length + item.workspaces.length)}</span></div>
      <div class="link-grid">
        ${item.sessions.map((session) => `<span>${chip("session", "kind")} ${escapeHtml(session.label ?? session.id)}</span>`).join("")}
        ${item.workspaces.map((workspace) => `<span>${chip("workspace", "kind")} ${escapeHtml(workspace.label ?? workspace.id)}</span>`).join("")}
      </div>
    </section>
  `;
}

function section(title: string, content: string, count: number): string {
  return `<section class="workflow-section"><div class="section-heading"><h3>${escapeHtml(title)}</h3><span>${String(count)}</span></div><div class="records">${content}</div></section>`;
}

function metric(label: string, value: string | number, emphasis: string): string {
  return `<div class="metric ${escapeAttr(emphasis)}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function chip(text: string, kind: string): string {
  return `<span class="chip ${escapeAttr(kind)}">${escapeHtml(text)}</span>`;
}

function renderSource(source: RecordSource): string {
  return `<div class="source">Source: ${chip(source.kind, `source-${source.kind}`)} <span title="${escapeAttr(source.ref)}">${escapeHtml(source.ref)}</span> · ${escapeHtml(formatTimestamp(source.at))}</div>`;
}

function renderAuthoritySource(source: RecordSource | undefined): string {
  if (source === undefined) return "";
  return `<div class="source authority-source">Authority: ${chip(source.kind, `source-${source.kind}`)} <span title="${escapeAttr(source.ref)}">${escapeHtml(source.ref)}</span> · ${escapeHtml(formatTimestamp(source.at))}</div>`;
}

function renderRefs(label: string, refs: string[]): string {
  if (refs.length === 0) return "";
  return `<div class="refs"><span class="section-label">${escapeHtml(label)}</span>${refs.map((ref) => `<code>${escapeHtml(ref)}</code>`).join("")}</div>`;
}

function emptyRows(message: string): string {
  return `<p class="muted empty-row">${escapeHtml(message)}</p>`;
}

function initializePrompt(): string {
  return "Initialize the Research Workflow for this workspace. Read the canonical project status and current user intent, then use the research_workflow tool to create a proposed work item with objective, definition of done, acceptance criteria, open decisions, and relevant runtime references. Keep inferred content proposed until I confirm it.";
}

function updatePrompt(item: ResearchWorkItem | undefined): string {
  const target = item === undefined ? "the active research work item" : `research work item ${item.id}`;
  return `Review ${target} against the current conversation, canonical project state, and runtime evidence. Use the research_workflow tool to update only records supported by evidence. Keep interpretations provisional and request confirmation for authority-bearing transitions.`;
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

function styles(): string {
  return `
    <style>
      :host { display: contents; }
      * { box-sizing: border-box; }
      .toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 12px; border-bottom: 1px solid var(--pi-border-muted); }
      .toolbar > div:first-child { display: grid; min-width: 0; gap: 2px; }
      .path { overflow: hidden; color: var(--pi-muted); font: 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; text-overflow: ellipsis; white-space: nowrap; }
      .toolbar-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
      .viewer { min-height: 0; overflow: auto; padding: 14px; }
      button, select { border: 1px solid var(--pi-border); border-radius: 7px; background: var(--pi-surface); color: var(--pi-text); font: inherit; }
      button { cursor: pointer; padding: 6px 10px; }
      button:disabled { cursor: wait; opacity: 0.65; }
      select { min-width: min(100%, 280px); padding: 7px 28px 7px 9px; }
      .work-item-picker { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; color: var(--pi-muted); }
      .work-item { display: grid; gap: 14px; }
      .objective-header { display: grid; gap: 10px; border: 1px solid var(--pi-accent-border); border-radius: 12px; background: var(--pi-bg-overlay-soft); padding: 16px; }
      .eyebrow, .section-label { color: var(--pi-muted); font-size: 11px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; }
      .title-row, .record-heading, .section-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
      h2, h3, p { margin: 0; }
      h2 { font-size: 19px; line-height: 1.25; }
      h3 { font-size: 14px; }
      .objective-copy, .secondary-copy { display: grid; gap: 5px; }
      .objective-copy p { color: var(--pi-text); font-size: 15px; line-height: 1.5; }
      .secondary-copy p, .record p { color: var(--pi-text-secondary); line-height: 1.45; }
      .metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
      .metric { display: grid; gap: 4px; border: 1px solid var(--pi-border-muted); border-radius: 9px; background: var(--pi-surface); padding: 10px; }
      .metric span { color: var(--pi-muted); font-size: 11px; }
      .metric strong { font-size: 14px; }
      .metric.attention { border-color: var(--pi-warning); }
      .metric.active { border-color: var(--pi-accent-border); }
      .workflow-section { display: grid; gap: 8px; }
      .section-heading { align-items: center; border-bottom: 1px solid var(--pi-border-muted); padding: 0 2px 7px; }
      .section-heading > span { color: var(--pi-muted); font-size: 12px; }
      .records { display: grid; gap: 8px; }
      .record { display: grid; gap: 8px; border: 1px solid var(--pi-border-muted); border-radius: 10px; background: var(--pi-surface); padding: 12px; }
      .attention-record { border-color: var(--pi-warning); }
      .record-heading > span { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 5px; }
      .record-grid, .link-grid { display: flex; flex-wrap: wrap; gap: 8px 14px; color: var(--pi-text-secondary); font-size: 12px; }
      .subrecords, .refs { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
      .chip { display: inline-flex; align-items: center; border: 1px solid var(--pi-border); border-radius: 999px; background: var(--pi-bg); color: var(--pi-text-secondary); padding: 2px 7px; font-size: 10px; font-weight: 600; line-height: 1.4; }
      .chip.confirmed, .chip.approved, .chip.accepted, .chip.passed, .chip.succeeded, .chip.resolved { border-color: var(--pi-success-border); color: var(--pi-success); }
      .chip.proposed, .chip.provisional, .chip.pending, .chip.open, .chip.awaiting-approval, .chip.waiting { border-color: var(--pi-warning); color: var(--pi-warning); }
      .chip.failed, .chip.rejected, .chip.blocked, .chip.cancelled { border-color: var(--pi-danger); color: var(--pi-danger); }
      .chip.running, .chip.executing, .chip.reviewing-results { border-color: var(--pi-accent-border); color: var(--pi-accent); }
      .source { overflow: hidden; color: var(--pi-muted); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
      code, pre { border: 1px solid var(--pi-border-muted); border-radius: 6px; background: var(--pi-bg); color: var(--pi-text-secondary); font: 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
      code { overflow: hidden; padding: 3px 6px; text-overflow: ellipsis; white-space: nowrap; }
      pre { margin: 8px 0 0; overflow: auto; padding: 8px; white-space: pre-wrap; }
      .compact-record code { display: block; }
      .empty-state, .status { border: 1px dashed var(--pi-border-muted); border-radius: 10px; padding: 14px; }
      .empty-state { display: grid; gap: 7px; color: var(--pi-muted); }
      .status.error { border-style: solid; border-color: var(--pi-danger); color: var(--pi-danger); }
      .muted { color: var(--pi-muted); }
      .empty-row { padding: 8px 2px; }
      .empty { padding: 16px; color: var(--pi-muted); }
      @media (max-width: 900px) { .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
      @media (max-width: 620px) {
        .toolbar { align-items: flex-start; }
        .metrics { grid-template-columns: 1fr 1fr; }
        .title-row, .record-heading { align-items: flex-start; flex-direction: column; }
        .record-heading > span { justify-content: flex-start; }
      }
    </style>
  `;
}
