export const EXPERIMENT_HISTORY_PATH = ".pi-web/experiment-history.json";

export interface ExperimentHistoryEntry {
  id: string;
  purpose: string;
  wandbUrl?: string;
  githubUrl?: string;
  worktree?: string;
  conclusion?: string;
}

export interface ExperimentHistory {
  version: 1;
  experiments: ExperimentHistoryEntry[];
}

export type ParseExperimentHistoryResult =
  | { ok: true; history: ExperimentHistory }
  | { ok: false; error: string };

export function parseExperimentHistory(text: string): ParseExperimentHistoryResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, error: "Experiment history must contain valid JSON." };
  }
  if (!isRecord(value) || value["version"] !== 1 || !Array.isArray(value["experiments"])) {
    return { ok: false, error: "Expected version: 1 and an experiments array." };
  }
  const experiments: ExperimentHistoryEntry[] = [];
  const ids = new Set<string>();
  const rows: unknown[] = value["experiments"];
  for (const [index, row] of rows.entries()) {
    const at = `experiments[${String(index)}]`;
    if (!isRecord(row) || !nonemptyText(row["id"]) || !nonemptyText(row["purpose"])) {
      return { ok: false, error: `${at} requires non-empty id and purpose strings.` };
    }
    const id = row["id"].trim();
    if (ids.has(id)) return { ok: false, error: `${at} duplicates experiment id: ${id}` };
    ids.add(id);
    const entry: ExperimentHistoryEntry = { id, purpose: row["purpose"].trim() };
    for (const field of ["wandbUrl", "githubUrl", "worktree", "conclusion"] as const) {
      const content = row[field];
      if (content === undefined || content === null) continue;
      if (typeof content !== "string") return { ok: false, error: `${at}.${field} must be a string or null.` };
      const trimmed = content.trim();
      if (trimmed === "") continue;
      if ((field === "wandbUrl" || field === "githubUrl") && !isWebUrl(trimmed)) {
        return { ok: false, error: `${at}.${field} must be an absolute HTTP(S) URL without credentials.` };
      }
      entry[field] = trimmed;
    }
    experiments.push(entry);
  }
  return { ok: true, history: { version: 1, experiments } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonemptyText(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isWebUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return /^https?:\/\//iu.test(value) && ["http:", "https:"].includes(url.protocol)
      && url.username === "" && url.password === "";
  } catch {
    return false;
  }
}
