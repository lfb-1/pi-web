import { stylesheetIntegrationCapability } from "../plugins/styles";
import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { SessionStatus } from "../api";
import { statusBarStyles } from "./shared";
import { localization, LocalizationController } from "../localization/browser";
import definitions from "./statusBar.messages";

export const statusBarMessages = localization.registerMessages("core.statusBar", definitions);

@customElement("status-bar")
export class StatusBar extends LitElement {
  constructor() {
    super();
    stylesheetIntegrationCapability.createController(this);
    new LocalizationController(this);
  }

  @property({ attribute: false }) status: SessionStatus | undefined;

  override render() {
    const status = this.status;
    if (status === undefined) return html`<div class="bar muted">${statusBarMessages.t("empty")}</div>`;
    // Fork: the chat footer shows only queued prompts; token, context and cost totals stay hidden.
    if (status.pendingMessageCount === 0) return null;
    return html`
      <div class="bar">
        <span>${statusBarMessages.t("queued", { count: status.pendingMessageCount })}</span>
      </div>
    `;
  }

  static override styles = statusBarStyles;
}
