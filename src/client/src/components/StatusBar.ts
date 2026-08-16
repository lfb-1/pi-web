import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { SessionStatus } from "../api";
import { renderSessionWarningIcon, statusBarStyles } from "./shared";

export interface StatusBarWarningControlContent {
  countText: string;
  accessibleLabel: string;
}

export function statusBarWarningControlContent(count: number, expanded: boolean): StatusBarWarningControlContent | undefined {
  if (!Number.isInteger(count) || count <= 0) return undefined;
  const warningText = `${String(count)} ${count === 1 ? "warning" : "warnings"}`;
  return {
    countText: String(count),
    accessibleLabel: expanded ? `Minimise ${warningText}` : `Show ${warningText} in the warning area`,
  };
}

@customElement("status-bar")
export class StatusBar extends LitElement {
  @property({ attribute: false }) status?: SessionStatus;
  @property({ type: Number }) warningCount = 0;
  @property({ type: Boolean }) warningsExpanded = false;
  @property({ attribute: false }) onToggleWarnings?: () => void;

  private readonly handleToggleWarnings = (): void => {
    this.onToggleWarnings?.();
  };

  override render() {
    const status = this.status;
    if (status === undefined) return html`<div class="bar muted">No session status yet</div>`;
    const warningControl = statusBarWarningControlContent(this.warningCount, this.warningsExpanded);
    const showWarningControl = warningControl !== undefined && this.onToggleWarnings !== undefined;
    if (!showWarningControl && status.pendingMessageCount === 0) return null;
    return html`
      <div class="bar">
        ${warningControl === undefined || this.onToggleWarnings === undefined ? null : html`
          <button
            type="button"
            class="warning-toggle"
            title=${warningControl.accessibleLabel}
            aria-label=${warningControl.accessibleLabel}
            aria-expanded=${String(this.warningsExpanded)}
            @click=${this.handleToggleWarnings}
          >
            ${renderSessionWarningIcon("warning", "warning-toggle-icon")}
            <span>${warningControl.countText}</span>
          </button>
        `}
        ${status.pendingMessageCount > 0 ? html`<span>${String(status.pendingMessageCount)} queued</span>` : null}
      </div>
    `;
  }

  static override styles = statusBarStyles;
}
