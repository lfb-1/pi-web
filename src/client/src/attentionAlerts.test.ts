import { describe, expect, it, vi } from "vitest";
import { BrowserAttentionAlerts, type AttentionAlert, type AttentionAlertBrowser, type AttentionAlertPermission } from "./attentionAlerts";

const warning: AttentionAlert = {
  id: "local:/repo:session-1:warning-1",
  title: "Pi Web needs attention",
  message: "A background task needs a decision.",
  severity: "warning",
};

function browser(permission: AttentionAlertPermission = "granted") {
  const playSound = vi.fn(() => undefined);
  const showNotification = vi.fn(() => undefined);
  return {
    permission: () => permission,
    requestPermission: () => Promise.resolve(permission),
    playSound,
    showNotification,
  } satisfies AttentionAlertBrowser;
}

describe("BrowserAttentionAlerts", () => {
  it("plays one sound and shows one browser notification for a new alert", () => {
    const fakeBrowser = browser();
    const alerts = new BrowserAttentionAlerts(fakeBrowser);

    alerts.alert(warning);
    alerts.alert(warning);

    expect(fakeBrowser.playSound).toHaveBeenCalledOnce();
    expect(fakeBrowser.showNotification).toHaveBeenCalledExactlyOnceWith(warning);
  });

  it("still plays the sound when browser notification permission is unavailable", () => {
    const fakeBrowser = browser("default");
    const alerts = new BrowserAttentionAlerts(fakeBrowser);

    alerts.alert(warning);

    expect(fakeBrowser.playSound).toHaveBeenCalledOnce();
    expect(fakeBrowser.showNotification).not.toHaveBeenCalled();
  });

  it("requests permission through the injected browser boundary", async () => {
    const fakeBrowser = browser("granted");
    const requestPermission = vi.spyOn(fakeBrowser, "requestPermission");
    const alerts = new BrowserAttentionAlerts(fakeBrowser);

    await expect(alerts.requestPermission()).resolves.toBe("granted");
    expect(requestPermission).toHaveBeenCalledOnce();
  });
});
