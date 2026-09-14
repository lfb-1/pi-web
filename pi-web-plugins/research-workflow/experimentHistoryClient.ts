import { EXPERIMENT_HISTORY_PATH, parseExperimentHistory, type ExperimentHistory } from "./experimentHistory.js";

export interface ExperimentHistoryFileReader {
  readFile(path: string): Promise<{ content: string; truncated: boolean; binary: boolean }>;
}

export type ExperimentHistoryLoadResult =
  | { kind: "loaded"; history: ExperimentHistory }
  | { kind: "missing" }
  | { kind: "unavailable"; detail: string };

export async function loadExperimentHistory(files: ExperimentHistoryFileReader): Promise<ExperimentHistoryLoadResult> {
  let file: Awaited<ReturnType<ExperimentHistoryFileReader["readFile"]>>;
  try {
    file = await files.readFile(EXPERIMENT_HISTORY_PATH);
  } catch (error) {
    if (error instanceof Error && error.message === "Path does not exist") return { kind: "missing" };
    return { kind: "unavailable", detail: error instanceof Error ? error.message : String(error) };
  }
  if (file.binary) return { kind: "unavailable", detail: `${EXPERIMENT_HISTORY_PATH} must be a text file.` };
  if (file.truncated) return { kind: "unavailable", detail: `${EXPERIMENT_HISTORY_PATH} is too large and was truncated.` };
  const parsed = parseExperimentHistory(file.content);
  return parsed.ok ? { kind: "loaded", history: parsed.history } : { kind: "unavailable", detail: parsed.error };
}
