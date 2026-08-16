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
  type ResearchBrief,
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
    const selectedItem = this.selectedItem(state);
    const askPiLabel = state.kind === "missing" ? "Ask Pi to initialize" : selectedItem?.brief === undefined ? "Ask Pi to summarize" : "Ask Pi to refresh summary";
    this.root.innerHTML = `
      ${styles()}
      <section class="toolbar">
        <div>
          <strong>Research Workflow</strong>
          <span class="path">${escapeHtml(RESEARCH_WORKFLOW_STATE_PATH)}</span>
        </div>
        <div class="toolbar-actions">
          <button class="secondary" data-ask-pi>${askPiLabel}</button>
          <button class="secondary" data-refresh ${state.kind === "loading" ? "disabled" : ""}>Refresh</button>
        </div>
      </section>
      <section class="viewer" aria-live="polite" aria-busy="${String(state.kind === "loading")}">${this.renderState(state)}</section>
    `;

    this.root.querySelector("button[data-refresh]")?.addEventListener("click", () => {
      void refreshResearchWorkflowPanel(context);
    });
    this.root.querySelector("button[data-ask-pi]")?.addEventListener("click", () => {
      context.prompt.insertText(state.kind === "missing" ? researchWorkflowInitializePrompt() : researchWorkflowUpdatePrompt(this.selectedItem(state)));
    });
    this.root.querySelector("select[data-work-item]")?.addEventListener("change", (event) => {
      const target = event.currentTarget;
      if (!(target instanceof HTMLSelectElement)) return;
      this.selectedWorkItemId = target.value;
      this.render();
    });
  }

  private renderState(state: PanelState): string {
    if (state.kind === "loading") return `<p class="muted" role="status">Loading ${escapeHtml(RESEARCH_WORKFLOW_STATE_PATH)}…</p>`;
    if (state.kind === "missing") {
      return `<div class="empty-state"><strong>${escapeHtml(state.message)}</strong><p>${escapeHtml(state.hint)}</p><p class="muted">The panel renders validated state; it does not infer approved content from chat.</p></div>`;
    }
    if (state.kind === "unavailable") {
      const detail = state.detail === undefined ? "" : `<pre>${escapeHtml(state.detail)}</pre>`;
      return `<div class="status error" role="alert"><strong>${escapeHtml(state.message)}</strong><p>${escapeHtml(state.hint)}</p>${detail}</div>`;
    }
    if (state.state.workItems.length === 0) {
      return `<div class="empty-state"><strong>No research work items.</strong><p>Ask Pi to create a proposed work item from the current project objective.</p></div>`;
    }

    const item = this.selectedItem(state) ?? activeWorkItem(state.state);
    if (item === undefined) return `<div class="empty-state">No research work items.</div>`;
    this.selectedWorkItemId = item.id;
    return `${renderWorkItemPicker(state.state.workItems, item.id)}${renderResearchWorkItem(item, state.state.updatedAt)}`;
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

export function renderResearchWorkItem(item: ResearchWorkItem, updatedAt: string): string {
  const openDecisions = item.decisions.filter((decision) => decision.status === "open");
  const decisionHistory = item.decisions.filter((decision) => decision.status !== "open");
  const explanation = `
    <div class="detail-copy"><span class="section-label">Objective</span><p>${escapeHtml(item.objective)}</p>${chip(item.objectiveStatus, item.objectiveStatus)}</div>
    ${item.rationale === undefined ? "" : `<div class="detail-copy"><span class="section-label">Rationale</span><p>${escapeHtml(item.rationale)}</p></div>`}
    <div class="detail-copy"><span class="section-label">Definition of done</span><p>${escapeHtml(item.definitionOfDone)}</p></div>
    ${item.findings.length === 0 ? emptyRows("No findings recorded.") : `<div class="records">${renderFindings(item.findings)}</div>`}
  `;
  const checksAndDecisions = `${renderCriteria(item.acceptanceCriteria)}${decisionHistory.length === 0 ? "" : renderDecisions(decisionHistory)}`;
  const evidenceAndProvenance = `${renderArtifacts(item.artifacts)}${renderSource(item.source)}${renderAuthoritySource(item.authoritySource)}`;
  return `
    <article class="work-item">
      <header class="work-item-header">
        <div class="eyebrow">${escapeHtml(item.id)}</div>
        <div class="title-row"><h2>${escapeHtml(item.title)}</h2><span>${chip(item.phase, "phase")}</span></div>
        <div class="updated">Updated ${escapeHtml(formatTimestamp(updatedAt))}</div>
      </header>

      ${item.brief === undefined ? renderMissingBrief(item) : renderSemanticBrief(item.brief, item)}
      ${openDecisions.length === 0 ? "" : detailsSection("Needs your decision", renderDecisions(openDecisions), openDecisions.length, true, "attention-section")}
      ${detailsSection("Why this is the current answer", explanation, item.findings.length + 1)}
      ${detailsSection("Checks and decision history", checksAndDecisions, item.acceptanceCriteria.length + decisionHistory.length)}
      ${detailsSection("Runs", renderRuns(item.runs), item.runs.length)}
      ${detailsSection("Evidence and provenance", evidenceAndProvenance, item.artifacts.length)}
      ${renderLinks(item)}
    </article>
  `;
}

function renderSemanticBrief(brief: ResearchBrief, item: ResearchWorkItem): string {
  return `
    <section class="executive-brief">
      <div class="brief-question">
        <span class="section-label">Research question</span>
        <p>${escapeHtml(brief.question)}</p>
      </div>
      <div class="answer-card">
        <div class="answer-heading"><span class="section-label">Current answer</span>${chip(`${brief.confidence} confidence`, `confidence-${brief.confidence}`)}</div>
        <p>${escapeHtml(brief.currentAnswer)}</p>
        <div class="confidence-reason"><strong>Why this confidence</strong><span>${escapeHtml(brief.confidenceReason)}</span></div>
      </div>
      <div class="brief-grid">
        ${briefFact("Why work is blocked", brief.blockedBecause ?? "No blocker recorded in the semantic brief.", brief.blockedBecause === undefined ? "neutral" : "blocked")}
        ${briefFact("Next action", brief.nextAction, `owner-${brief.nextActionOwner}`, chip(brief.nextActionOwner, `owner-${brief.nextActionOwner}`))}
        ${briefFact("What changed", brief.recentChange ?? "No recent material change recorded.", "recent")}
      </div>
      ${renderBriefSources(brief.evidenceRefs, item)}
      ${renderSource(brief.source)}
    </section>
  `;
}

function renderMissingBrief(item: ResearchWorkItem): string {
  return `
    <section class="executive-brief missing-brief">
      <div class="brief-question"><span class="section-label">Research question</span><p>${escapeHtml(item.objective)}</p></div>
      <div class="semantic-missing"><strong>Plain-language summary not generated yet.</strong><p>Ask Pi to summarize the current evidence, blocker, and next action.</p></div>
    </section>
  `;
}

function briefFact(label: string, content: string, className: string, trailing = ""): string {
  return `<div class="brief-fact ${escapeAttr(className)}"><div><span class="section-label">${escapeHtml(label)}</span>${trailing}</div><p>${escapeHtml(content)}</p></div>`;
}

function renderBriefSources(refs: string[], item: ResearchWorkItem): string {
  if (refs.length === 0) return `<p class="brief-source-count">No supporting sources linked.</p>`;
  return `
    <details class="brief-sources">
      <summary>Based on ${String(refs.length)} ${refs.length === 1 ? "source" : "sources"}</summary>
      <div class="source-list">${refs.map((ref) => `<span title="${escapeAttr(ref)}">${escapeHtml(sourceLabel(ref, item))}</span>`).join("")}</div>
    </details>
  `;
}

function sourceLabel(ref: string, item: ResearchWorkItem): string {
  const artifact = item.artifacts.find((candidate) => candidate.id === ref);
  if (artifact !== undefined) return artifact.label;
  const decisionId = ref.startsWith("decision:") ? ref.slice("decision:".length) : ref;
  const decision = item.decisions.find((candidate) => candidate.id === decisionId);
  if (decision !== undefined) return decision.status === "resolved" && decision.resolution !== undefined ? `Decision: ${decision.resolution}` : `Decision: ${decision.question}`;
  const criterion = item.acceptanceCriteria.find((candidate) => candidate.id === ref);
  if (criterion !== undefined) return criterion.title;
  const run = item.runs.find((candidate) => candidate.id === ref);
  if (run !== undefined) return run.jobId === undefined ? run.purpose : `Job ${run.jobId}: ${run.purpose}`;
  return ref;
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
  const content = `
    <div class="link-grid">
      ${item.sessions.map((session) => `<span>${chip("session", "kind")} ${escapeHtml(session.label ?? session.id)}</span>`).join("")}
      ${item.workspaces.map((workspace) => `<span>${chip("workspace", "kind")} ${escapeHtml(workspace.label ?? workspace.id)}</span>`).join("")}
    </div>
  `;
  return detailsSection("Linked runtime", content, item.sessions.length + item.workspaces.length);
}

function detailsSection(title: string, content: string, count: number, open = false, className = ""): string {
  return `
    <details class="workflow-section ${escapeAttr(className)}"${open ? " open" : ""}>
      <summary><h3>${escapeHtml(title)}</h3><span>${String(count)}</span></summary>
      <div class="section-body">${content}</div>
    </details>
  `;
}

function chip(text: string, kind: string): string {
  return `<span class="chip ${escapeAttr(kind)}">${escapeHtml(text)}</span>`;
}

function renderSource(source: RecordSource): string {
  return `
    <details class="provenance">
      <summary>Recorded by ${escapeHtml(source.kind)} · ${escapeHtml(formatTimestamp(source.at))}</summary>
      <code>${escapeHtml(source.ref)}</code>
    </details>
  `;
}

function renderAuthoritySource(source: RecordSource | undefined): string {
  if (source === undefined) return "";
  return `
    <details class="provenance authority-source">
      <summary>Confirmed by ${escapeHtml(source.kind)}${source.authorityMode === undefined ? "" : " · direct or recommended-timeout policy"} · ${escapeHtml(formatTimestamp(source.at))}</summary>
      <code>${escapeHtml(source.ref)}</code>
    </details>
  `;
}

function renderRefs(label: string, refs: string[]): string {
  if (refs.length === 0) return "";
  return `<div class="refs"><span class="section-label">${escapeHtml(label)}</span>${refs.map((ref) => `<code>${escapeHtml(ref)}</code>`).join("")}</div>`;
}

function emptyRows(message: string): string {
  return `<p class="muted empty-row">${escapeHtml(message)}</p>`;
}

export function researchWorkflowInitializePrompt(): string {
  return "Initialize the Research Workflow for this workspace. First read the canonical project status, current user intent, and relevant runtime evidence. Use research_workflow to create a proposed work item with objective, definition of done, acceptance criteria, open decisions, and runtime references. Then write workItem.brief as a plain-language semantic synthesis: one research question, a direct current answer of at most three short sentences, confidence with both support and limitations, the direct blocker when present, one concrete next action with its owner, one recent material change when present, and supporting evidenceRefs. Do not copy long source passages or put paths and session ids in the prose. Keep inferred content proposed or provisional until I confirm it.";
}

export function researchWorkflowUpdatePrompt(item: ResearchWorkItem | undefined): string {
  const target = item === undefined ? "the active research work item" : `research work item ${item.id}`;
  return `Review ${target}. Call research_workflow get first, then read the canonical project state, relevant source files and runtime artifacts, and the latest user decisions. Update only records supported by evidence. Rewrite workItem.brief for a human reader instead of copying source text: use one plain-language research question; lead with the current answer in at most three short sentences; explain confidence using both support and the main limitation; state only the direct blocker; give one concrete next action and owner; record one material recent change or omit it. Brief evidenceRefs must use existing labeled artifact, criterion, decision, or run ids; create an artifact record before citing an external path or URL. Preserve provisional qualifications and request confirmation for authority-bearing transitions.`;
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
      .work-item { display: grid; gap: 12px; max-width: 980px; margin: 0 auto; }
      .work-item-header { display: grid; gap: 5px; padding: 2px 2px 4px; }
      .eyebrow, .section-label { color: var(--pi-muted); font-size: 11px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; }
      .title-row, .record-heading, .answer-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
      .title-row > span, .answer-heading > span { display: flex; flex-wrap: wrap; gap: 5px; }
      .updated { color: var(--pi-muted); font-size: 11px; }
      h2, h3, p { margin: 0; }
      h2 { font-size: 20px; line-height: 1.25; }
      h3 { font-size: 14px; }
      .executive-brief { display: grid; gap: 14px; border: 1px solid var(--pi-accent-border); border-radius: 14px; background: var(--pi-bg-overlay-soft); padding: 18px; }
      .brief-question { display: grid; gap: 6px; }
      .brief-question p { color: var(--pi-text); font-size: 17px; font-weight: 600; line-height: 1.45; }
      .answer-card { display: grid; gap: 9px; border-left: 3px solid var(--pi-accent-border); background: var(--pi-surface); padding: 13px 14px; }
      .answer-card > p { color: var(--pi-text); font-size: 15px; line-height: 1.55; }
      .confidence-reason { display: grid; gap: 3px; color: var(--pi-text-secondary); font-size: 12px; line-height: 1.45; }
      .brief-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; }
      .brief-fact { display: grid; align-content: start; gap: 7px; border: 1px solid var(--pi-border-muted); border-radius: 10px; background: var(--pi-surface); padding: 12px; }
      .brief-fact > div { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
      .brief-fact p, .detail-copy p, .record p { color: var(--pi-text-secondary); line-height: 1.5; }
      .brief-fact.blocked { border-color: var(--pi-danger); }
      .brief-fact.recent { grid-column: 1 / -1; }
      .semantic-missing { display: grid; gap: 5px; border: 1px dashed var(--pi-warning); border-radius: 10px; padding: 12px; color: var(--pi-warning); }
      .brief-source-count { color: var(--pi-muted); font-size: 11px; }
      .brief-sources, .provenance { color: var(--pi-muted); font-size: 11px; }
      .brief-sources > summary, .provenance > summary { cursor: pointer; }
      .source-list { display: flex; flex-wrap: wrap; gap: 6px; padding-top: 8px; }
      .source-list > span { border: 1px solid var(--pi-border-muted); border-radius: 999px; background: var(--pi-bg); color: var(--pi-text-secondary); padding: 4px 8px; }
      .workflow-section { border: 1px solid var(--pi-border-muted); border-radius: 10px; background: var(--pi-surface); }
      .workflow-section > summary { display: flex; align-items: center; justify-content: space-between; gap: 10px; cursor: pointer; padding: 11px 12px; list-style-position: inside; }
      .workflow-section > summary > span { color: var(--pi-muted); font-size: 12px; }
      .workflow-section[open] > summary { border-bottom: 1px solid var(--pi-border-muted); }
      .attention-section { border-color: var(--pi-warning); }
      .section-body { display: grid; gap: 9px; padding: 10px; }
      .detail-copy { display: grid; gap: 5px; padding: 4px 2px; }
      .records { display: grid; gap: 8px; }
      .record { display: grid; gap: 8px; border: 1px solid var(--pi-border-muted); border-radius: 9px; background: var(--pi-bg-overlay-soft); padding: 11px; }
      .attention-record { border-color: var(--pi-warning); }
      .record-heading > span { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 5px; }
      .record-grid, .link-grid { display: flex; flex-wrap: wrap; gap: 8px 14px; color: var(--pi-text-secondary); font-size: 12px; }
      .subrecords, .refs { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
      .chip { display: inline-flex; align-items: center; border: 1px solid var(--pi-border); border-radius: 999px; background: var(--pi-bg); color: var(--pi-text-secondary); padding: 2px 7px; font-size: 10px; font-weight: 600; line-height: 1.4; }
      .chip.confirmed, .chip.approved, .chip.accepted, .chip.passed, .chip.succeeded, .chip.resolved, .chip.confidence-high { border-color: var(--pi-success-border); color: var(--pi-success); }
      .chip.proposed, .chip.provisional, .chip.pending, .chip.open, .chip.awaiting-approval, .chip.waiting, .chip.confidence-medium, .chip.owner-user { border-color: var(--pi-warning); color: var(--pi-warning); }
      .chip.failed, .chip.rejected, .chip.blocked, .chip.cancelled, .chip.confidence-low { border-color: var(--pi-danger); color: var(--pi-danger); }
      .chip.running, .chip.executing, .chip.reviewing-results, .chip.owner-pi, .chip.owner-runtime { border-color: var(--pi-accent-border); color: var(--pi-accent); }
      .provenance { overflow: hidden; padding-top: 2px; }
      .provenance code { display: block; margin-top: 6px; }
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
      @media (max-width: 700px) {
        .toolbar { align-items: flex-start; }
        .brief-grid { grid-template-columns: 1fr; }
        .brief-fact.recent { grid-column: auto; }
        .title-row, .record-heading, .answer-heading { align-items: flex-start; flex-direction: column; }
        .record-heading > span { justify-content: flex-start; }
      }
    </style>
  `;
}
