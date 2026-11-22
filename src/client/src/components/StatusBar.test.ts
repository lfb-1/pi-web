// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";
import type { SessionStatus } from "../api";
import { localization } from "../localization/browser";
import { StatusBar, statusBarMessages as messages } from "./StatusBar";

const releases: (() => void)[] = [];
afterEach(async () => {
  document.body.replaceChildren();
  localStorage.clear();
  releases.splice(0).forEach((release) => { release(); });
  await localization.setPreferences({ language: "en", formatLocale: "en" });
});

it("shows only the localized queued count; usage, context and cost stay hidden (fork)", async () => {
  releases.push(localization.registerCatalog({ id: "status-bar-test", namespace: "core.statusBar", locale: "de", load: () => Promise.resolve({
    empty: "Noch kein Status", queued: "{count, plural, one {# vorgemerkt} other {# vorgemerkt}}",
  }) }));
  const bar = new StatusBar();
  document.body.append(bar);
  const snapshot = status();
  for (const language of ["de", "en"]) {
    await localization.setPreferences({ language, formatLocale: "de-DE" });
    bar.status = undefined;
    await bar.updateComplete;
    expect(bar.shadowRoot?.textContent).toContain(messages.t("empty"));
    bar.status = snapshot;
    await bar.updateComplete;
    expect(bar.shadowRoot?.textContent).toContain(messages.t("queued", { count: 1200 }));
    expect(bar.shadowRoot?.querySelector(".context")).toBeNull();
    expect(bar.shadowRoot?.textContent).not.toContain(new Intl.NumberFormat("de-DE", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(snapshot.cost));
    bar.status = { ...snapshot, pendingMessageCount: 0 };
    await bar.updateComplete;
    expect(bar.shadowRoot?.querySelector(".bar")).toBeNull();
  }

});

function status(): SessionStatus {
  return {
    sessionId: "session-1", isStreaming: true, isCompacting: false, isBashRunning: false,
    pendingMessageCount: 1200, queuedMessages: [],
    tokens: { input: 1234, output: 5678, cacheRead: 0, cacheWrite: 0, total: 6912 }, cost: 12.34,
  };
}
