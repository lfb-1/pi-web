import { parseResearchWorkflowStateText, RESEARCH_WORKFLOW_STATE_PATH, type ResearchWorkflowState } from "./researchWorkflowState.js";

export const researchWorkflowMissingMessage = "No research workflow state exists for this workspace.";
export const researchWorkflowMissingHint = "Ask Pi to initialize the current research objective and acceptance criteria.";
export const researchWorkflowUnavailableMessage = "Could not load Research Workflow state.";
export const researchWorkflowRefreshHint = `Fix ${RESEARCH_WORKFLOW_STATE_PATH}, then click Refresh.`;

const missingWorkspaceFileError = "Path does not exist";

export interface ResearchWorkflowFileReader {
  readFile(path: string): Promise<{ content: string; truncated: boolean; binary: boolean }>;
}

export type ResearchWorkflowLoadResult =
  | { kind: "loaded"; state: ResearchWorkflowState; path: string }
  | { kind: "missing"; message: string; hint: string }
  | { kind: "unavailable"; message: string; hint: string; detail?: string };

export async function loadResearchWorkflowState(files: ResearchWorkflowFileReader): Promise<ResearchWorkflowLoadResult> {
  let file: Awaited<ReturnType<ResearchWorkflowFileReader["readFile"]>>;
  try {
    file = await files.readFile(RESEARCH_WORKFLOW_STATE_PATH);
  } catch (error) {
    if (errorMessage(error) === missingWorkspaceFileError) return missing();
    return unavailable(`Unable to read ${RESEARCH_WORKFLOW_STATE_PATH}: ${formatUnknownError(error)}`);
  }

  if (file.binary) return unavailable(`${RESEARCH_WORKFLOW_STATE_PATH} must be a text file`);
  if (file.truncated) return unavailable(`${RESEARCH_WORKFLOW_STATE_PATH} is too large and was truncated`);

  const parsed = parseResearchWorkflowStateText(file.content);
  if (!parsed.ok) return unavailable(parsed.error);
  return { kind: "loaded", state: parsed.state, path: RESEARCH_WORKFLOW_STATE_PATH };
}

function missing(): ResearchWorkflowLoadResult {
  return { kind: "missing", message: researchWorkflowMissingMessage, hint: researchWorkflowMissingHint };
}

function unavailable(detail: string): ResearchWorkflowLoadResult {
  return {
    kind: "unavailable",
    message: researchWorkflowUnavailableMessage,
    hint: researchWorkflowRefreshHint,
    detail,
  };
}

function errorMessage(error: unknown): string | undefined {
  return error instanceof Error ? error.message : undefined;
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
