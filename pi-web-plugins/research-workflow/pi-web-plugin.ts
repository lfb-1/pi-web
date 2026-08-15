import type { PiWebPlugin } from "@jmfederico/pi-web/plugin-api";
import {
  defineResearchWorkflowPanelElement,
  refreshResearchWorkflowPanel,
  researchWorkflowPanelBadge,
} from "./researchWorkflowPanelElement.js";

const plugin: PiWebPlugin = {
  apiVersion: 2,
  name: "Research Workflow",
  activate: ({ runtimePluginId, html, svg }) => {
    defineResearchWorkflowPanelElement();

    return {
      contributions: {
        actions: [
          {
            id: "workspace.open-research-workflow",
            title: "Open Research Workflow",
            description: "Open the objective, decisions, runs, findings, and evidence for this workspace.",
            group: "Research",
            enabled: (context) => context.state.selectedWorkspace !== undefined,
            run: (context) => {
              if (context.state.selectedWorkspace === undefined) return;
              context.selectWorkspaceTool(`${runtimePluginId}:workspace.research-workflow`);
            },
          },
        ],
        workspacePanels: [
          {
            id: "workspace.research-workflow",
            title: "Research",
            icon: svg`
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M9 3h6"></path>
                <path d="M10 9 6 20h12L14 9"></path>
                <path d="M8.5 14h7"></path>
              </svg>
            `,
            order: 30,
            badge: (context) => researchWorkflowPanelBadge(context),
            onInvalidate: (context) => refreshResearchWorkflowPanel(context),
            render: (context) => html`<pi-web-research-workflow-panel .context=${context}></pi-web-research-workflow-panel>`,
          },
        ],
      },
    };
  },
};

export default plugin;
