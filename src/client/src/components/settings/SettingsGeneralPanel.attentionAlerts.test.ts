// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsGeneralPanel, attentionAlertSettingsContent } from "./SettingsGeneralPanel";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

describe("attentionAlertSettingsContent", () => {
  it("distinguishes granted, requestable, blocked, and unsupported browser states", () => {
    expect(attentionAlertSettingsContent("granted")).toEqual({
      status: "Enabled",
      detail: "New warning and error events play a sound and show a browser notification.",
    });
    expect(attentionAlertSettingsContent("default")).toMatchObject({
      status: "Browser notifications not enabled",
      action: "Enable browser notifications",
    });
    expect(attentionAlertSettingsContent("denied").status).toBe("Blocked by the browser");
    expect(attentionAlertSettingsContent("unsupported").status).toBe("Unavailable");
  });
});

describe("SettingsGeneralPanel attention alerts", () => {
  it("requests browser permission from the explicit enable action", async () => {
    const onEnableAttentionAlerts = vi.fn(() => Promise.resolve());
    const panel = new SettingsGeneralPanel();
    panel.attentionAlertsPermission = "default";
    panel.onEnableAttentionAlerts = onEnableAttentionAlerts;
    document.body.append(panel);
    await panel.updateComplete;

    const root = panel.shadowRoot;
    if (root === null) throw new Error("Expected the settings panel shadow root");
    const button = Array.from(root.querySelectorAll("button"))
      .find((candidate) => candidate.textContent.trim() === "Enable browser notifications");
    if (button === undefined) throw new Error("Expected the enable browser notifications button");
    button.click();
    await panel.updateComplete;

    expect(onEnableAttentionAlerts).toHaveBeenCalledOnce();
  });
});
