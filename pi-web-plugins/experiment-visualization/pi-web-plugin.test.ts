// @vitest-environment happy-dom

import { html, svg } from "lit";
import { describe, expect, it, vi } from "vitest";
import type { PluginRuntimeContext } from "@jmfederico/pi-web/plugin-api";
import plugin from "./pi-web-plugin.js";

function contributions() {
  return plugin.activate({
    apiVersion: 2,
    pluginId: "experiment-visualization",
    runtimePluginId: "experiment-visualization",
    html,
    svg,
  }).contributions;
}

describe("Experiment Visualization plugin", () => {
  it("contributes one independent Visualization panel", () => {
    const panel = contributions().workspacePanels?.find((candidate) => candidate.id === "workspace.experiment-visualization");

    expect(contributions().workspacePanels).toHaveLength(1);
    expect(panel?.title).toBe("Visualization");
    expect(panel?.order).toBe(30);
    expect(panel?.onInvalidate).toBeTypeOf("function");
  });

  it("opens Visualization from the action palette", async () => {
    const action = contributions().actions?.find((candidate) => candidate.id === "workspace.open-experiment-visualization");
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

    expect(selectWorkspaceTool).toHaveBeenCalledWith("experiment-visualization:workspace.experiment-visualization");
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
