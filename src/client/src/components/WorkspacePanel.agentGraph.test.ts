// @vitest-environment happy-dom
import { html } from "lit";
import { afterEach, describe, expect, it } from "vitest";
import type { SessionInfo, Workspace } from "../api";
import type { QualifiedWorkspacePanelContribution } from "../plugins/types";
import { WorkspacePanel } from "./WorkspacePanel";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

describe("WorkspacePanel agent graph split", () => {
  it("keeps the selected workspace tool above a persistent agent graph", async () => {
    const panel = new WorkspacePanel();
    panel.workspace = workspace();
    // The selected fixture panel does not inspect context; set the public Lit
    // property without constructing unrelated file, terminal, and host fakes.
    Reflect.set(panel, "panelContext", {});
    panel.panels = [workspaceTool()];
    panel.sessions = [session("main")];
    panel.selectedSession = panel.sessions[0];
    document.body.append(panel);
    await panel.updateComplete;

    const split = panel.shadowRoot?.querySelector(".workspace-content-split");
    expect(split?.querySelector(".workspace-tool-pane")?.textContent).toContain("Workspace tool content");
    expect(split?.querySelector(".agent-graph-pane agent-session-graph")).not.toBeNull();
  });
});

function workspace(): Workspace {
  return {
    id: "workspace-1",
    projectId: "project-1",
    path: "/workspace",
    label: "Workspace",
    isMain: true,
    effectiveConfig: {},
  };
}

function workspaceTool(): QualifiedWorkspacePanelContribution {
  return {
    id: "core:workspace.files",
    localId: "workspace.files",
    pluginId: "core",
    title: "Files",
    render: () => html`<div>Workspace tool content</div>`,
  };
}

function session(id: string): SessionInfo {
  return {
    id,
    cwd: "/workspace",
    path: `/sessions/${id}.jsonl`,
    created: "2026-08-16T00:00:00.000Z",
    modified: "2026-08-16T00:01:00.000Z",
    messageCount: 1,
    firstMessage: `Session ${id}`,
  };
}
