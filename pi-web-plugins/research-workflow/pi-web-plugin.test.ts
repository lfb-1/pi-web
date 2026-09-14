// @vitest-environment happy-dom

import { html, svg } from "lit";
import { describe, expect, it, vi } from "vitest";
import type { PluginRuntimeContext } from "@jmfederico/pi-web/plugin-api";
import plugin from "./pi-web-plugin.js";

function contributions() {
  return plugin.activate({
    apiVersion: 2,
    pluginId: "research-workflow",
    runtimePluginId: "research-workflow",
    html,
    svg,
  }).contributions;
}

describe("Experiment Visualization plugin", () => {
  it("replaces Research with one Visualization panel while preserving its route", () => {
    const panel = contributions().workspacePanels?.find((candidate) => candidate.id === "workspace.research-workflow");

    expect(contributions().workspacePanels).toHaveLength(1);
    expect(panel?.title).toBe("Visualization");
    expect(panel?.order).toBe(30);
    expect(panel?.onInvalidate).toBeTypeOf("function");
  });

  it("opens Visualization from the action palette", async () => {
    const action = contributions().actions?.find((candidate) => candidate.id === "workspace.open-research-workflow");
    const selectWorkspaceTool = vi.fn();
    const context = runtimeContext({
      state: {
        selectedWorkspace: {
          id: "workspace-1",
          projectId: "project-1",
          path: "/work/research",
          label: "research",
          isMain: true,
        },
      },
      selectWorkspaceTool,
    });

    expect(action?.title).toBe("Open Experiment Visualization");
    await action?.run(context);

    expect(selectWorkspaceTool).toHaveBeenCalledWith("research-workflow:workspace.research-workflow");
  });
});

function runtimeContext(patch: Partial<PluginRuntimeContext> = {}): PluginRuntimeContext {
  const noop = () => undefined;
  return {
    state: {},
    prompt: { insertText: noop, getText: () => "", getSelection: () => null },
    openActionPalette: noop,
    focusPrompt: noop,
    addProject: noop,
    configureAuth: noop,
    logoutAuth: noop,
    openThemePicker: noop,
    selectMainView: noop,
    selectWorkspaceTool: noop,
    openTerminal: noop,
    refreshFiles: noop,
    refreshWorkspacePanels: noop,
    refreshAppData: noop,
    reloadPage: noop,
    startSession: noop,
    archiveSession: noop,
    stopActiveWork: noop,
    ...patch,
  };
}
