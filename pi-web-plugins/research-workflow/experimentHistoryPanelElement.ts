import type { WorkspacePanelContext } from "@jmfederico/pi-web/plugin-api";
import { EXPERIMENT_HISTORY_PATH, type ExperimentHistoryEntry } from "./experimentHistory.js";
import { loadExperimentHistory, type ExperimentHistoryLoadResult } from "./experimentHistoryClient.js";

export const experimentHistoryPanelTagName = "pi-web-experiment-history-panel";
type PanelState = { kind: "loading" } | ExperimentHistoryLoadResult;
const connectedPanels = new Set<PiWebExperimentHistoryPanel>();

export function defineExperimentHistoryPanelElement(): void {
  if (!customElements.get(experimentHistoryPanelTagName)) customElements.define(experimentHistoryPanelTagName, PiWebExperimentHistoryPanel);
}

export async function refreshExperimentHistoryPanel(context: WorkspacePanelContext): Promise<void> {
  await Promise.all([...connectedPanels]
    .filter((panel) => panel.contextKey === contextKey(context))
    .map((panel) => panel.load()));
}

class PiWebExperimentHistoryPanel extends HTMLElement {
  private contextValue: WorkspacePanelContext | undefined;
  private state: PanelState = { kind: "loading" };
  private generation = 0;
  private archivedExpanded = false;
  private readonly root = this.attachShadow({ mode: "open" });

  get contextKey(): string | undefined {
    return this.contextValue === undefined ? undefined : contextKey(this.contextValue);
  }

  set context(value: WorkspacePanelContext | undefined) {
    const previousKey = this.contextKey;
    this.contextValue = value;
    if (previousKey === this.contextKey) return;
    this.generation += 1;
    this.archivedExpanded = false;
    this.state = { kind: "loading" };
    if (this.isConnected) void this.load();
  }

  connectedCallback(): void {
    connectedPanels.add(this);
    void this.load();
  }

  disconnectedCallback(): void {
    connectedPanels.delete(this);
    this.generation += 1;
    this.archivedExpanded = false;
    this.state = { kind: "loading" };
  }

  async load(): Promise<void> {
    const context = this.contextValue;
    const generation = ++this.generation;
    if (this.state.kind === "loaded") this.archivedExpanded = this.root.querySelector<HTMLDetailsElement>("details[data-archive]")?.open ?? false;
    this.state = { kind: "loading" };
    this.render();
    if (context === undefined) return;
    const state = await loadExperimentHistory(context.files);
    if (this.generation !== generation || !this.isConnected) return;
    this.state = state;
    this.render();
  }

  private render(): void {
    const focusedAction = this.root.activeElement instanceof HTMLElement ? this.root.activeElement.dataset["action"] : undefined;
    const context = this.contextValue;
    if (context === undefined) {
      this.root.innerHTML = `${styles}<p class="notice">Select a workspace to view experiment history.</p>`;
      return;
    }
    this.root.innerHTML = `${styles}
      <section class="toolbar">
        <strong>Experiment history</strong>
        <div class="actions">
          <button data-action="update">Update with Pi</button>
          <button data-action="refresh" aria-label="Refresh experiment history" ${this.state.kind === "loading" ? "disabled" : ""}>Refresh</button>
        </div>
      </section>
      <section class="viewer" aria-busy="${String(this.state.kind === "loading")}">${renderState(this.state, this.archivedExpanded)}</section>
    `;
    this.root.querySelector('[data-action="refresh"]')?.addEventListener("click", () => { void this.load(); });
    this.root.querySelector('[data-action="update"]')?.addEventListener("click", () => {
      this.contextValue?.prompt.insertText(experimentHistoryUpdatePrompt());
    });
    const archive = this.root.querySelector<HTMLDetailsElement>("details[data-archive]");
    archive?.addEventListener("toggle", () => {
      if (archive.isConnected) this.archivedExpanded = archive.open;
    });
    if (focusedAction !== undefined) this.root.querySelector<HTMLElement>(`[data-action="${focusedAction}"]`)?.focus();
  }
}

function contextKey(context: WorkspacePanelContext): string {
  return JSON.stringify([context.machine.id, context.workspace.projectId, context.workspace.id, context.workspace.path]);
}

function renderState(state: PanelState, archivedExpanded: boolean): string {
  if (state.kind === "loading") return '<p class="notice muted" role="status">Loading experiment history…</p>';
  if (state.kind === "unavailable") return `
    <div class="notice error" role="alert"><strong>Could not load experiment history.</strong>
      <p>${escapeHtml(state.detail)}</p><p>Check <code>${EXPERIMENT_HISTORY_PATH}</code>, then click Refresh.</p>
    </div>`;
  const entries = state.kind === "loaded" ? state.history.experiments : [];
  const active = entries.filter((entry) => entry.archived !== true);
  const archived = entries.filter((entry) => entry.archived === true);
  const emptyMessage = entries.length === 0
    ? "No experiments recorded yet. Use “Update with Pi” to populate history from project records."
    : "No active experiments. Expand the archive below to view history.";
  return `
    <section data-active>${renderTable(active, "Active experiments", emptyMessage)}</section>
    ${archived.length === 0 ? "" : `
      <details class="archive" data-archive ${archivedExpanded ? "open" : ""}>
        <summary data-action="archive">Archived experiments (${String(archived.length)})</summary>
        ${renderTable(archived, "Archived experiments", "")}
      </details>`}
    <p class="source muted">Source: <code>${EXPERIMENT_HISTORY_PATH}</code> · Refresh to load changes.</p>`;
}

function renderTable(entries: ExperimentHistoryEntry[], title: string, emptyMessage: string): string {
  return `<div class="table-scroll" tabindex="0" role="region" aria-label="${title} table">
    <table>
      <caption>${title} (${String(entries.length)})</caption>
      <colgroup><col class="purpose"><col class="wandb"><col class="github"><col class="conclusion"></colgroup>
      <thead><tr><th scope="col">Experiment purpose</th><th scope="col">W&amp;B link</th><th scope="col">GitHub worktree</th><th scope="col">Brief conclusion</th></tr></thead>
      <tbody>${entries.length === 0
        ? `<tr><td colspan="4" class="notice muted">${escapeHtml(emptyMessage)}</td></tr>`
        : entries.map(renderExperiment).join("")}</tbody>
    </table>
  </div>`;
}

function renderExperiment(entry: ExperimentHistoryEntry): string {
  return `<tr>
    <th scope="row"><div class="text">${escapeHtml(entry.purpose)}</div><small class="muted">${escapeHtml(entry.id)}</small></th>
    <td>${renderLink(entry.wandbUrl, "W&B")}</td>
    <td>${renderLink(entry.githubUrl, "GitHub")}${entry.worktree === undefined ? "" : `<small class="worktree muted">${escapeHtml(entry.worktree)}</small>`}</td>
    <td class="text">${entry.conclusion === undefined ? '<span class="muted">No conclusion recorded</span>' : escapeHtml(entry.conclusion)}</td>
  </tr>`;
}

function renderLink(url: string | undefined, service: string): string {
  if (url === undefined) return '<span class="muted">Not recorded</span>';
  return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" aria-label="${service}: ${escapeHtml(url)}">${escapeHtml(url)}</a>`;
}

export function experimentHistoryUpdatePrompt(): string {
  return `Update the experiment visualization index ${EXPERIMENT_HISTORY_PATH} for this workspace. First read the existing index if present, then verify historical experiments against canonical project registrations, results and Git evidence. Use normal file tools, not research_workflow; do not read or migrate retired research-workflow state. Preserve existing entries and stable ids, and add or update one entry per experiment/arm/attempt as appropriate. The JSON shape is {"version":1,"experiments":[{"id":"experiment-id","purpose":"One sentence describing what was tested","wandbUrl":null,"githubUrl":null,"worktree":null,"conclusion":null,"archived":false}]}. Set archived:false for current active work and archived:true for inactive historical experiments (including stopped or incomplete work). Preserve existing explicit archive choices unless the user or current project evidence supports changing them; never infer active status solely from a missing conclusion. Archiving controls display only, not scientific completion or authorization. Put newer experiments first within each group. wandbUrl must be an actual recorded W&B run/dashboard URL; githubUrl must point to the experiment's GitHub branch or fixed commit, not the currently selected branch by assumption. worktree is optional display text for its code worktree/branch. Use null for missing links or conclusions; never invent a URL, measurement or outcome. Keep conclusions brief and scoped to accepted evidence; label incomplete runs explicitly when supported. This file is a display index, not scientific authority or execution authorization. Do not launch experiments or upload artifacts. Report any records that could not be verified.`;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

const styles = `<style>
  :host { display: flex; flex-direction: column; min-height: 0; min-width: 0; height: 100%; color: var(--pi-text); }
  * { box-sizing: border-box; }
  .toolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 12px; border-bottom: 1px solid var(--pi-border-muted); }
  .actions { display: flex; gap: 8px; }
  button { border: 1px solid var(--pi-border); border-radius: 7px; background: var(--pi-surface); color: var(--pi-text); padding: 6px 10px; font: inherit; cursor: pointer; }
  button:hover:not(:disabled) { background: var(--pi-surface-hover); }
  button:disabled { opacity: .6; cursor: wait; }
  button:focus-visible, a:focus-visible, summary:focus-visible, .table-scroll:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: 2px; }
  .viewer { overflow: auto; min-height: 0; padding: 12px; }
  .table-scroll { overflow: auto; border: 1px solid var(--pi-border-muted); border-radius: 8px; }
  .archive { margin-top: 14px; border: 1px solid var(--pi-border-muted); border-radius: 8px; }
  .archive > summary { padding: 12px; cursor: pointer; color: var(--pi-muted); font-weight: 600; }
  .archive > summary:hover { background: var(--pi-surface-hover); color: var(--pi-text); }
  .archive > .table-scroll { border: 0; border-radius: 0; }
  table { width: 100%; min-width: 680px; border-collapse: collapse; table-layout: fixed; font-size: 13px; line-height: 1.5; }
  caption { text-align: left; padding: 10px 12px; color: var(--pi-muted); }
  col.purpose { width: 30%; } col.wandb { width: 20%; } col.github { width: 25%; } col.conclusion { width: 25%; }
  th, td { padding: 12px; text-align: left; vertical-align: top; border-top: 1px solid var(--pi-border-muted); overflow-wrap: anywhere; }
  thead th { background: var(--pi-surface); font-weight: 650; }
  tbody th { font-weight: 500; }
  tbody tr:hover { background: var(--pi-surface-hover); }
  .text { white-space: pre-wrap; }
  small { display: block; margin-top: 6px; font-size: 11px; font-weight: normal; }
  .worktree, code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  a { color: var(--pi-accent); text-decoration: underline; text-underline-offset: 3px; }
  .notice { padding: 16px; line-height: 1.5; overflow-wrap: anywhere; }
  .muted { color: var(--pi-muted); }
  .source { font-size: 11px; overflow-wrap: anywhere; }
  .error { border: 1px solid var(--pi-danger); border-radius: 8px; color: var(--pi-danger); }
</style>`;
