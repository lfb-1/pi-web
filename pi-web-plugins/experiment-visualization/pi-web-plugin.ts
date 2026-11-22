import type { PiWebPlugin } from "@jmfederico/pi-web/plugin-api";
import {
  defineExperimentHistoryPanelElement,
  refreshExperimentHistoryPanel,
} from "./experimentHistoryPanelElement.js";

const plugin = {
  apiVersion: 4,
  name: "Experiment Visualization",
  activate: ({ runtimePluginId, html, svg }) => {
    defineExperimentHistoryPanelElement();

    return {
      contributions: {
        actions: [
          {
            id: "workspace.open-experiment-visualization",
            title: "Open Experiment Visualization",
            description: "View experiment purposes, W&B runs, GitHub worktrees, and brief conclusions.",
            group: "Visualization",
            enabled: (context) => context.state.selectedWorkspace !== undefined,
            run: (context) => {
              if (context.state.selectedWorkspace === undefined) return;
              context.selectWorkspaceTool(`${runtimePluginId}:workspace.experiment-visualization`);
            },
          },
        ],
        workspacePanels: [
          {
            id: "workspace.experiment-visualization",
            title: "Visualization",
            icon: svg`
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 3v18h18"></path>
                <path d="m7 14 4-5 4 3 5-7"></path>
              </svg>
            `,
            order: 30,
            onInvalidate: (context) => refreshExperimentHistoryPanel(context),
            render: (context) => html`<pi-web-experiment-history-panel .context=${context}></pi-web-experiment-history-panel>`,
          },
        ],
      },
    };
  },
} satisfies PiWebPlugin;

export default plugin;
