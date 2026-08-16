export const RESEARCH_WORKFLOW_STATE_PATH = ".pi-web/research-workflow.json";

export const workflowPhases = [
  "research",
  "planning",
  "awaiting-approval",
  "executing",
  "waiting",
  "reviewing-results",
  "completed",
  "blocked",
] as const;

export type WorkflowPhase = (typeof workflowPhases)[number];
export type SourceKind = "pi" | "user" | "runtime" | "repository" | "monitor";
export type AuthorityMode = "dialog-or-recommended-timeout-policy";
export type ObjectiveStatus = "proposed" | "confirmed";
export type CriterionStatus = "proposed" | "approved";
export type CriterionResult = "pending" | "passed" | "failed" | "not-run";
export type DecisionKind = "config-approval" | "ambiguity" | "result-acceptance" | "follow-up-compute" | "other";
export type DecisionStatus = "open" | "resolved" | "void";
export type RunKind = "pi-session" | "subsession" | "terminal" | "slurm" | "external";
export type RunStatus = "queued" | "running" | "waiting" | "succeeded" | "failed" | "cancelled";
export type FindingStatus = "provisional" | "accepted" | "rejected";
export type BriefConfidence = "low" | "medium" | "high";
export type NextActionOwner = "user" | "pi" | "runtime" | "none";

export interface RecordSource {
  kind: SourceKind;
  ref: string;
  at: string;
  /** Present on authority sources when direct selection and delegated timeout share the host dialog channel. */
  authorityMode?: AuthorityMode;
}

export interface ReferenceRecord {
  id: string;
  label?: string;
  source: RecordSource;
}

export interface AcceptanceCriterion {
  id: string;
  title: string;
  predicate: string;
  status: CriterionStatus;
  result: CriterionResult;
  note?: string;
  evidenceRefs: string[];
  source: RecordSource;
  authoritySource?: RecordSource;
}

export interface DecisionRecord {
  id: string;
  kind: DecisionKind;
  question: string;
  impact: string;
  status: DecisionStatus;
  resolution?: string;
  source: RecordSource;
  authoritySource?: RecordSource;
}

export interface AcceptanceResult {
  criterionId: string;
  status: CriterionResult;
  note?: string;
  evidenceRefs: string[];
}

export interface RunRecord {
  id: string;
  kind: RunKind;
  status: RunStatus;
  purpose: string;
  jobId?: string;
  startedAt?: string;
  finishedAt?: string;
  acceptanceResults: AcceptanceResult[];
  artifactRefs: string[];
  source: RecordSource;
}

export interface ArtifactRecord {
  id: string;
  label: string;
  kind: "file" | "log" | "checkpoint" | "metric" | "report" | "url" | "other";
  path?: string;
  url?: string;
  source: RecordSource;
}

export interface FindingRecord {
  id: string;
  summary: string;
  status: FindingStatus;
  evidenceRefs: string[];
  source: RecordSource;
  authoritySource?: RecordSource;
}

export interface ResearchBrief {
  question: string;
  currentAnswer: string;
  confidence: BriefConfidence;
  confidenceReason: string;
  blockedBecause?: string;
  nextActionOwner: NextActionOwner;
  nextAction: string;
  recentChange?: string;
  evidenceRefs: string[];
  source: RecordSource;
}

export interface ResearchWorkItem {
  id: string;
  title: string;
  objective: string;
  objectiveStatus: ObjectiveStatus;
  rationale?: string;
  phase: WorkflowPhase;
  definitionOfDone: string;
  brief?: ResearchBrief;
  acceptanceCriteria: AcceptanceCriterion[];
  decisions: DecisionRecord[];
  runs: RunRecord[];
  artifacts: ArtifactRecord[];
  findings: FindingRecord[];
  sessions: ReferenceRecord[];
  workspaces: ReferenceRecord[];
  source: RecordSource;
  authoritySource?: RecordSource;
}

export interface ResearchWorkflowState {
  version: 1;
  updatedAt: string;
  activeWorkItemId?: string;
  workItems: ResearchWorkItem[];
}

export type ParseResearchWorkflowStateResult =
  | { ok: true; state: ResearchWorkflowState }
  | { ok: false; error: string };

const idPattern = /^[a-z][a-z0-9.-]*$/u;
export const sourceKinds = ["pi", "user", "runtime", "repository", "monitor"] as const;
export const authorityModes = ["dialog-or-recommended-timeout-policy"] as const;
export const objectiveStatuses = ["proposed", "confirmed"] as const;
export const criterionStatuses = ["proposed", "approved"] as const;
export const criterionResults = ["pending", "passed", "failed", "not-run"] as const;
export const decisionKinds = ["config-approval", "ambiguity", "result-acceptance", "follow-up-compute", "other"] as const;
export const decisionStatuses = ["open", "resolved", "void"] as const;
export const runKinds = ["pi-session", "subsession", "terminal", "slurm", "external"] as const;
export const runStatuses = ["queued", "running", "waiting", "succeeded", "failed", "cancelled"] as const;
export const artifactKinds = ["file", "log", "checkpoint", "metric", "report", "url", "other"] as const;
export const findingStatuses = ["provisional", "accepted", "rejected"] as const;
export const briefConfidences = ["low", "medium", "high"] as const;
export const nextActionOwners = ["user", "pi", "runtime", "none"] as const;

export function parseResearchWorkflowStateText(text: string): ParseResearchWorkflowStateResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return { ok: false, error: `Invalid JSON: ${formatUnknownError(error)}` };
  }

  try {
    return { ok: true, state: parseState(value) };
  } catch (error) {
    return { ok: false, error: formatUnknownError(error) };
  }
}

export function activeWorkItem(state: ResearchWorkflowState): ResearchWorkItem | undefined {
  if (state.activeWorkItemId !== undefined) {
    const active = state.workItems.find((item) => item.id === state.activeWorkItemId);
    if (active !== undefined) return active;
  }
  return state.workItems[0];
}

function parseState(value: unknown): ResearchWorkflowState {
  const record = objectValue(value, "state");
  if (record["version"] !== 1) throw new Error("state.version must be 1");
  const updatedAt = timestampValue(record["updatedAt"], "state.updatedAt");
  const workItems = arrayValue(record["workItems"], "state.workItems").map((item, index) => parseWorkItem(item, `state.workItems[${String(index)}]`));
  requireUniqueIds(workItems, "state.workItems");
  const activeWorkItemId = optionalIdValue(record["activeWorkItemId"], "state.activeWorkItemId");
  if (activeWorkItemId !== undefined && !workItems.some((item) => item.id === activeWorkItemId)) {
    throw new Error(`state.activeWorkItemId references missing work item ${activeWorkItemId}`);
  }
  return activeWorkItemId === undefined
    ? { version: 1, updatedAt, workItems }
    : { version: 1, updatedAt, activeWorkItemId, workItems };
}

function parseWorkItem(value: unknown, path: string): ResearchWorkItem {
  const record = objectValue(value, path);
  const acceptanceCriteria = parseArray(record["acceptanceCriteria"], `${path}.acceptanceCriteria`, parseAcceptanceCriterion);
  const decisions = parseArray(record["decisions"], `${path}.decisions`, parseDecision);
  const runs = parseArray(record["runs"], `${path}.runs`, parseRun);
  const artifacts = parseArray(record["artifacts"], `${path}.artifacts`, parseArtifact);
  const findings = parseArray(record["findings"], `${path}.findings`, parseFinding);
  const sessions = parseArray(record["sessions"], `${path}.sessions`, parseReference);
  const workspaces = parseArray(record["workspaces"], `${path}.workspaces`, parseReference);
  for (const [name, values] of Object.entries({ acceptanceCriteria, decisions, runs, artifacts, findings, sessions, workspaces })) {
    requireUniqueIds(values, `${path}.${name}`);
  }
  const rationale = optionalNonEmptyString(record["rationale"], `${path}.rationale`);
  const brief = optionalBrief(record["brief"], `${path}.brief`);
  const authoritySource = optionalSource(record["authoritySource"], `${path}.authoritySource`);
  const item: ResearchWorkItem = {
    id: idValue(record["id"], `${path}.id`),
    title: nonEmptyString(record["title"], `${path}.title`),
    objective: nonEmptyString(record["objective"], `${path}.objective`),
    objectiveStatus: enumValue(record["objectiveStatus"], objectiveStatuses, `${path}.objectiveStatus`),
    ...(rationale === undefined ? {} : { rationale }),
    phase: enumValue(record["phase"], workflowPhases, `${path}.phase`),
    definitionOfDone: nonEmptyString(record["definitionOfDone"], `${path}.definitionOfDone`),
    ...(brief === undefined ? {} : { brief }),
    acceptanceCriteria,
    decisions,
    runs,
    artifacts,
    findings,
    sessions,
    workspaces,
    source: parseSource(record["source"], `${path}.source`),
    ...(authoritySource === undefined ? {} : { authoritySource }),
  };
  validateBriefEvidenceRefs(item, path);
  return item;
}

function validateBriefEvidenceRefs(item: ResearchWorkItem, path: string): void {
  if (item.brief === undefined) return;
  const validRefs = new Set([
    ...item.acceptanceCriteria.map((record) => record.id),
    ...item.decisions.flatMap((record) => [record.id, `decision:${record.id}`]),
    ...item.runs.map((record) => record.id),
    ...item.artifacts.map((record) => record.id),
  ]);
  for (const ref of item.brief.evidenceRefs) {
    if (!validRefs.has(ref)) throw new Error(`${path}.brief.evidenceRefs references missing record ${ref}`);
  }
}

function optionalBrief(value: unknown, path: string): ResearchBrief | undefined {
  if (value === undefined) return undefined;
  const record = objectValue(value, path);
  const blockedBecause = optionalBoundedString(record["blockedBecause"], `${path}.blockedBecause`, 500);
  const recentChange = optionalBoundedString(record["recentChange"], `${path}.recentChange`, 500);
  return {
    question: boundedString(record["question"], `${path}.question`, 240),
    currentAnswer: boundedString(record["currentAnswer"], `${path}.currentAnswer`, 900),
    confidence: enumValue(record["confidence"], briefConfidences, `${path}.confidence`),
    confidenceReason: boundedString(record["confidenceReason"], `${path}.confidenceReason`, 600),
    ...(blockedBecause === undefined ? {} : { blockedBecause }),
    nextActionOwner: enumValue(record["nextActionOwner"], nextActionOwners, `${path}.nextActionOwner`),
    nextAction: boundedString(record["nextAction"], `${path}.nextAction`, 500),
    ...(recentChange === undefined ? {} : { recentChange }),
    evidenceRefs: stringArray(record["evidenceRefs"], `${path}.evidenceRefs`),
    source: parseSource(record["source"], `${path}.source`),
  };
}

function parseAcceptanceCriterion(value: unknown, path: string): AcceptanceCriterion {
  const record = objectValue(value, path);
  const note = optionalNonEmptyString(record["note"], `${path}.note`);
  const authoritySource = optionalSource(record["authoritySource"], `${path}.authoritySource`);
  return {
    id: idValue(record["id"], `${path}.id`),
    title: nonEmptyString(record["title"], `${path}.title`),
    predicate: nonEmptyString(record["predicate"], `${path}.predicate`),
    status: enumValue(record["status"], criterionStatuses, `${path}.status`),
    result: enumValue(record["result"], criterionResults, `${path}.result`),
    ...(note === undefined ? {} : { note }),
    evidenceRefs: stringArray(record["evidenceRefs"], `${path}.evidenceRefs`),
    source: parseSource(record["source"], `${path}.source`),
    ...(authoritySource === undefined ? {} : { authoritySource }),
  };
}

function parseDecision(value: unknown, path: string): DecisionRecord {
  const record = objectValue(value, path);
  const resolution = optionalNonEmptyString(record["resolution"], `${path}.resolution`);
  const authoritySource = optionalSource(record["authoritySource"], `${path}.authoritySource`);
  const status = enumValue(record["status"], decisionStatuses, `${path}.status`);
  if (status === "resolved" && resolution === undefined) throw new Error(`${path}.resolution is required when status is resolved`);
  return {
    id: idValue(record["id"], `${path}.id`),
    kind: enumValue(record["kind"], decisionKinds, `${path}.kind`),
    question: nonEmptyString(record["question"], `${path}.question`),
    impact: nonEmptyString(record["impact"], `${path}.impact`),
    status,
    ...(resolution === undefined ? {} : { resolution }),
    source: parseSource(record["source"], `${path}.source`),
    ...(authoritySource === undefined ? {} : { authoritySource }),
  };
}

function parseRun(value: unknown, path: string): RunRecord {
  const record = objectValue(value, path);
  const jobId = optionalNonEmptyString(record["jobId"], `${path}.jobId`);
  const startedAt = optionalTimestamp(record["startedAt"], `${path}.startedAt`);
  const finishedAt = optionalTimestamp(record["finishedAt"], `${path}.finishedAt`);
  return {
    id: idValue(record["id"], `${path}.id`),
    kind: enumValue(record["kind"], runKinds, `${path}.kind`),
    status: enumValue(record["status"], runStatuses, `${path}.status`),
    purpose: nonEmptyString(record["purpose"], `${path}.purpose`),
    ...(jobId === undefined ? {} : { jobId }),
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(finishedAt === undefined ? {} : { finishedAt }),
    acceptanceResults: parseArray(record["acceptanceResults"], `${path}.acceptanceResults`, parseAcceptanceResult),
    artifactRefs: stringArray(record["artifactRefs"], `${path}.artifactRefs`),
    source: parseSource(record["source"], `${path}.source`),
  };
}

function parseAcceptanceResult(value: unknown, path: string): AcceptanceResult {
  const record = objectValue(value, path);
  const note = optionalNonEmptyString(record["note"], `${path}.note`);
  return {
    criterionId: idValue(record["criterionId"], `${path}.criterionId`),
    status: enumValue(record["status"], criterionResults, `${path}.status`),
    ...(note === undefined ? {} : { note }),
    evidenceRefs: stringArray(record["evidenceRefs"], `${path}.evidenceRefs`),
  };
}

function parseArtifact(value: unknown, path: string): ArtifactRecord {
  const record = objectValue(value, path);
  const filePath = optionalNonEmptyString(record["path"], `${path}.path`);
  const url = optionalNonEmptyString(record["url"], `${path}.url`);
  if (filePath === undefined && url === undefined) throw new Error(`${path} requires path or url`);
  return {
    id: idValue(record["id"], `${path}.id`),
    label: nonEmptyString(record["label"], `${path}.label`),
    kind: enumValue(record["kind"], artifactKinds, `${path}.kind`),
    ...(filePath === undefined ? {} : { path: filePath }),
    ...(url === undefined ? {} : { url }),
    source: parseSource(record["source"], `${path}.source`),
  };
}

function parseFinding(value: unknown, path: string): FindingRecord {
  const record = objectValue(value, path);
  const authoritySource = optionalSource(record["authoritySource"], `${path}.authoritySource`);
  return {
    id: idValue(record["id"], `${path}.id`),
    summary: nonEmptyString(record["summary"], `${path}.summary`),
    status: enumValue(record["status"], findingStatuses, `${path}.status`),
    evidenceRefs: stringArray(record["evidenceRefs"], `${path}.evidenceRefs`),
    source: parseSource(record["source"], `${path}.source`),
    ...(authoritySource === undefined ? {} : { authoritySource }),
  };
}

function parseReference(value: unknown, path: string): ReferenceRecord {
  const record = objectValue(value, path);
  const label = optionalNonEmptyString(record["label"], `${path}.label`);
  return {
    id: nonEmptyString(record["id"], `${path}.id`),
    ...(label === undefined ? {} : { label }),
    source: parseSource(record["source"], `${path}.source`),
  };
}

function optionalSource(value: unknown, path: string): RecordSource | undefined {
  return value === undefined ? undefined : parseSource(value, path);
}

function parseSource(value: unknown, path: string): RecordSource {
  const record = objectValue(value, path);
  const kind = enumValue(record["kind"], sourceKinds, `${path}.kind`);
  const authorityMode = record["authorityMode"] === undefined
    ? undefined
    : enumValue(record["authorityMode"], authorityModes, `${path}.authorityMode`);
  if (authorityMode !== undefined && kind !== "user") throw new Error(`${path}.authorityMode requires source kind user`);
  return {
    kind,
    ref: nonEmptyString(record["ref"], `${path}.ref`),
    at: timestampValue(record["at"], `${path}.at`),
    ...(authorityMode === undefined ? {} : { authorityMode }),
  };
}

function parseArray<T>(value: unknown, path: string, parser: (entry: unknown, path: string) => T): T[] {
  return arrayValue(value, path).map((entry, index) => parser(entry, `${path}[${String(index)}]`));
}

function objectValue(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${path} must be an object`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function arrayValue(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  return value;
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${path} must be a non-empty string`);
  return value.trim();
}

function optionalNonEmptyString(value: unknown, path: string): string | undefined {
  return value === undefined ? undefined : nonEmptyString(value, path);
}

function boundedString(value: unknown, path: string, maxLength: number): string {
  const text = nonEmptyString(value, path);
  if (text.length > maxLength) throw new Error(`${path} must be at most ${String(maxLength)} characters`);
  return text;
}

function optionalBoundedString(value: unknown, path: string, maxLength: number): string | undefined {
  return value === undefined ? undefined : boundedString(value, path, maxLength);
}

function idValue(value: unknown, path: string): string {
  const id = nonEmptyString(value, path);
  if (!idPattern.test(id)) throw new Error(`${path} must match ${String(idPattern)}`);
  return id;
}

function optionalIdValue(value: unknown, path: string): string | undefined {
  return value === undefined ? undefined : idValue(value, path);
}

function enumValue<const T extends readonly string[]>(value: unknown, choices: T, path: string): T[number] {
  if (!isChoice(value, choices)) throw new Error(`${path} must be one of ${choices.join(", ")}`);
  return value;
}

function isChoice<const T extends readonly string[]>(value: unknown, choices: T): value is T[number] {
  return typeof value === "string" && choices.some((choice) => choice === value);
}

function timestampValue(value: unknown, path: string): string {
  const timestamp = nonEmptyString(value, path);
  if (Number.isNaN(Date.parse(timestamp))) throw new Error(`${path} must be an ISO timestamp`);
  return timestamp;
}

function optionalTimestamp(value: unknown, path: string): string | undefined {
  return value === undefined ? undefined : timestampValue(value, path);
}

function stringArray(value: unknown, path: string): string[] {
  return arrayValue(value, path).map((entry, index) => nonEmptyString(entry, `${path}[${String(index)}]`));
}

function requireUniqueIds(values: { id: string }[], path: string): void {
  const ids = new Set<string>();
  for (const value of values) {
    if (ids.has(value.id)) throw new Error(`${path} contains duplicate id ${value.id}`);
    ids.add(value.id);
  }
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
