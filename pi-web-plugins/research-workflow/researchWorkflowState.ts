export const RESEARCH_WORKFLOW_STATE_PATH = ".pi-web/research-workflow-v2.json";
export const LEGACY_RESEARCH_WORKFLOW_STATE_PATH = ".pi-web/research-workflow.json";

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
export type DecisionImportance = "routine" | "important" | "critical";
export type RunKind = "pi-session" | "subsession" | "terminal" | "slurm" | "external";
export type RunStatus = "queued" | "running" | "waiting" | "succeeded" | "failed" | "cancelled";
export type FindingStatus = "provisional" | "accepted" | "rejected";
export type BriefConfidence = "low" | "medium" | "high";
export type NextActionOwner = "user" | "pi" | "runtime" | "none";
export type CausalGraphStatus = "active" | "completed";
export type CausalNodeKind = "hypothesis" | "validation" | "analysis" | "conclusion";
export type CausalNodeStatus = "proposed" | "active" | "completed" | "blocked" | "abandoned";
export type CausalConclusion = "confirmed" | "denied" | "unsure";
export type CausalEdgeKind = "tests" | "produces" | "concludes" | "motivates";

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
  importance?: DecisionImportance;
  blocking?: boolean;
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

export interface CausalNode {
  id: string;
  kind: CausalNodeKind;
  title: string;
  summary: string;
  status: CausalNodeStatus;
  conclusion?: CausalConclusion;
  workItemId?: string;
  evidenceRefs: string[];
  source: RecordSource;
  updatedSource?: RecordSource;
}

export interface CausalEdge {
  id: string;
  from: string;
  to: string;
  kind: CausalEdgeKind;
  direction?: string;
  source: RecordSource;
  updatedSource?: RecordSource;
}

export interface ResearchCausalGraph {
  title: string;
  status: CausalGraphStatus;
  activeNodeId?: string;
  activePathEdgeIds: string[];
  nodes: CausalNode[];
  edges: CausalEdge[];
  source: RecordSource;
  authoritySource?: RecordSource;
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
  version: 2;
  updatedAt: string;
  activeWorkItemId?: string;
  causalGraph?: ResearchCausalGraph;
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
export const decisionImportances = ["routine", "important", "critical"] as const;
export const runKinds = ["pi-session", "subsession", "terminal", "slurm", "external"] as const;
export const runStatuses = ["queued", "running", "waiting", "succeeded", "failed", "cancelled"] as const;
export const artifactKinds = ["file", "log", "checkpoint", "metric", "report", "url", "other"] as const;
export const findingStatuses = ["provisional", "accepted", "rejected"] as const;
export const briefConfidences = ["low", "medium", "high"] as const;
export const nextActionOwners = ["user", "pi", "runtime", "none"] as const;
export const causalGraphStatuses = ["active", "completed"] as const;
export const causalNodeKinds = ["hypothesis", "validation", "analysis", "conclusion"] as const;
export const causalNodeStatuses = ["proposed", "active", "completed", "blocked", "abandoned"] as const;
export const causalConclusions = ["confirmed", "denied", "unsure"] as const;
export const causalEdgeKinds = ["tests", "produces", "concludes", "motivates"] as const;

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

/** Only decisions that truly block safe autonomous progress should interrupt the user. */
export function decisionRequiresAttention(decision: DecisionRecord): boolean {
  return decision.status === "open" && (decision.blocking === true || decision.importance === "critical");
}

function parseState(value: unknown): ResearchWorkflowState {
  const record = objectValue(value, "state");
  const storedVersion = record["version"];
  if (storedVersion !== 1 && storedVersion !== 2) throw new Error("state.version must be 1 or 2");
  const updatedAt = timestampValue(record["updatedAt"], "state.updatedAt");
  const workItems = arrayValue(record["workItems"], "state.workItems").map((item, index) => parseWorkItem(item, `state.workItems[${String(index)}]`));
  requireUniqueIds(workItems, "state.workItems");
  const activeWorkItemId = optionalIdValue(record["activeWorkItemId"], "state.activeWorkItemId");
  if (activeWorkItemId !== undefined && !workItems.some((item) => item.id === activeWorkItemId)) {
    throw new Error(`state.activeWorkItemId references missing work item ${activeWorkItemId}`);
  }
  const causalGraph = storedVersion === 2 ? optionalCausalGraph(record["causalGraph"], "state.causalGraph", workItems) : undefined;
  return {
    version: 2,
    updatedAt,
    ...(activeWorkItemId === undefined ? {} : { activeWorkItemId }),
    ...(causalGraph === undefined ? {} : { causalGraph }),
    workItems,
  };
}

function optionalCausalGraph(value: unknown, path: string, workItems: ResearchWorkItem[]): ResearchCausalGraph | undefined {
  if (value === undefined) return undefined;
  const record = objectValue(value, path);
  const nodes = parseArray(record["nodes"], `${path}.nodes`, parseCausalNode);
  const edges = parseArray(record["edges"], `${path}.edges`, parseCausalEdge);
  if (nodes.length > 256) throw new Error(`${path}.nodes must contain at most 256 entries`);
  if (edges.length > 512) throw new Error(`${path}.edges must contain at most 512 entries`);
  requireUniqueIds(nodes, `${path}.nodes`);
  requireUniqueIds(edges, `${path}.edges`);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const workItemIds = new Set(workItems.map((item) => item.id));
  for (const node of nodes) {
    if (node.workItemId !== undefined && !workItemIds.has(node.workItemId)) {
      throw new Error(`${path}.nodes references missing work item ${node.workItemId}`);
    }
    validateCausalEvidenceRefs(node, workItems, `${path}.nodes.${node.id}`);
  }
  for (const edge of edges) validateCausalEdge(edge, nodes, nodeIds, `${path}.edges`);
  validateCausalGraphIsAcyclic(nodes, edges, path);
  const activeNodeId = optionalIdValue(record["activeNodeId"], `${path}.activeNodeId`);
  if (activeNodeId !== undefined && !nodeIds.has(activeNodeId)) {
    throw new Error(`${path}.activeNodeId references missing node ${activeNodeId}`);
  }
  const activePathEdgeIds = stringArray(record["activePathEdgeIds"], `${path}.activePathEdgeIds`);
  validateActivePath(activeNodeId, activePathEdgeIds, edges, path);
  const status = enumValue(record["status"], causalGraphStatuses, `${path}.status`);
  const authoritySource = optionalSource(record["authoritySource"], `${path}.authoritySource`);
  if (status === "completed" && authoritySource === undefined) {
    throw new Error(`${path}.authoritySource is required when status is completed`);
  }
  if (status === "completed" && authoritySource?.kind !== "user") {
    throw new Error(`${path}.authoritySource must be a user source when status is completed`);
  }
  const hasUnfinishedNode = nodes.some((node) => node.status === "active" || node.status === "proposed" || node.status === "blocked");
  if (status === "completed" && (activeNodeId !== undefined || activePathEdgeIds.length > 0 || hasUnfinishedNode)) {
    throw new Error(`${path} cannot retain an active path or unfinished node when status is completed`);
  }
  return {
    title: boundedString(record["title"], `${path}.title`, 160),
    status,
    ...(activeNodeId === undefined ? {} : { activeNodeId }),
    activePathEdgeIds,
    nodes,
    edges,
    source: parseSource(record["source"], `${path}.source`),
    ...(authoritySource === undefined ? {} : { authoritySource }),
  };
}

function parseCausalNode(value: unknown, path: string): CausalNode {
  const record = objectValue(value, path);
  const kind = enumValue(record["kind"], causalNodeKinds, `${path}.kind`);
  const conclusion = record["conclusion"] === undefined
    ? undefined
    : enumValue(record["conclusion"], causalConclusions, `${path}.conclusion`);
  if (kind === "conclusion" && conclusion === undefined) throw new Error(`${path}.conclusion is required for a conclusion node`);
  if (kind !== "conclusion" && conclusion !== undefined) throw new Error(`${path}.conclusion is only valid for a conclusion node`);
  const workItemId = optionalIdValue(record["workItemId"], `${path}.workItemId`);
  const updatedSource = optionalSource(record["updatedSource"], `${path}.updatedSource`);
  return {
    id: idValue(record["id"], `${path}.id`),
    kind,
    title: boundedString(record["title"], `${path}.title`, 240),
    summary: boundedString(record["summary"], `${path}.summary`, 700),
    status: enumValue(record["status"], causalNodeStatuses, `${path}.status`),
    ...(conclusion === undefined ? {} : { conclusion }),
    ...(workItemId === undefined ? {} : { workItemId }),
    evidenceRefs: stringArray(record["evidenceRefs"], `${path}.evidenceRefs`),
    source: parseSource(record["source"], `${path}.source`),
    ...(updatedSource === undefined ? {} : { updatedSource }),
  };
}

function parseCausalEdge(value: unknown, path: string): CausalEdge {
  const record = objectValue(value, path);
  const kind = enumValue(record["kind"], causalEdgeKinds, `${path}.kind`);
  const direction = optionalBoundedString(record["direction"], `${path}.direction`, 360);
  if (kind === "motivates" && direction === undefined) throw new Error(`${path}.direction is required for a motivates edge`);
  if (kind !== "motivates" && direction !== undefined) throw new Error(`${path}.direction is only valid for a motivates edge`);
  const updatedSource = optionalSource(record["updatedSource"], `${path}.updatedSource`);
  return {
    id: idValue(record["id"], `${path}.id`),
    from: idValue(record["from"], `${path}.from`),
    to: idValue(record["to"], `${path}.to`),
    kind,
    ...(direction === undefined ? {} : { direction }),
    source: parseSource(record["source"], `${path}.source`),
    ...(updatedSource === undefined ? {} : { updatedSource }),
  };
}

function validateCausalEdge(edge: CausalEdge, nodes: CausalNode[], nodeIds: Set<string>, path: string): void {
  if (!nodeIds.has(edge.from)) throw new Error(`${path} edge ${edge.id} references missing source node ${edge.from}`);
  if (!nodeIds.has(edge.to)) throw new Error(`${path} edge ${edge.id} references missing target node ${edge.to}`);
  if (edge.from === edge.to) throw new Error(`${path} edge ${edge.id} cannot connect a node to itself`);
  const fromKind = nodes.find((node) => node.id === edge.from)?.kind;
  const toKind = nodes.find((node) => node.id === edge.to)?.kind;
  const expected: Record<CausalEdgeKind, readonly [CausalNodeKind, CausalNodeKind]> = {
    tests: ["hypothesis", "validation"],
    produces: ["validation", "analysis"],
    concludes: ["analysis", "conclusion"],
    motivates: ["conclusion", "hypothesis"],
  };
  const [expectedFrom, expectedTo] = expected[edge.kind];
  if (fromKind !== expectedFrom || toKind !== expectedTo) {
    throw new Error(`${path} edge ${edge.id} (${edge.kind}) must connect ${expectedFrom} to ${expectedTo}`);
  }
}

function validateCausalEvidenceRefs(node: CausalNode, workItems: ResearchWorkItem[], path: string): void {
  if ((node.kind === "analysis" || node.kind === "conclusion") && node.status === "completed" && node.evidenceRefs.length === 0) {
    throw new Error(`${path}.evidenceRefs requires at least one typed reference for a completed ${node.kind} node`);
  }
  for (const ref of node.evidenceRefs) {
    const match = /^([a-z][a-z0-9.-]*)\/(run|artifact|finding|criterion|decision):([a-z][a-z0-9.-]*)$/u.exec(ref);
    if (match === null) throw new Error(`${path}.evidenceRefs contains invalid typed reference ${ref}`);
    const workItemId = match[1];
    const kind = match[2];
    const recordId = match[3];
    if (workItemId === undefined || kind === undefined || recordId === undefined) {
      throw new Error(`${path}.evidenceRefs contains invalid typed reference ${ref}`);
    }
    const item = workItems.find((candidate) => candidate.id === workItemId);
    if (item === undefined) throw new Error(`${path}.evidenceRefs references missing work item ${workItemId}`);
    const exists = kind === "run" ? item.runs.some((record) => record.id === recordId)
      : kind === "artifact" ? item.artifacts.some((record) => record.id === recordId)
        : kind === "finding" ? item.findings.some((record) => record.id === recordId)
          : kind === "criterion" ? item.acceptanceCriteria.some((record) => record.id === recordId)
            : item.decisions.some((record) => record.id === recordId);
    if (!exists) throw new Error(`${path}.evidenceRefs references missing ${kind} ${recordId} in ${workItemId}`);
  }
}

function validateActivePath(activeNodeId: string | undefined, edgeIds: string[], edges: CausalEdge[], path: string): void {
  if (new Set(edgeIds).size !== edgeIds.length) throw new Error(`${path}.activePathEdgeIds must not contain duplicates`);
  if (edgeIds.length === 0) return;
  if (activeNodeId === undefined) throw new Error(`${path}.activePathEdgeIds requires activeNodeId`);
  const pathEdges = edgeIds.map((id) => {
    const edge = edges.find((candidate) => candidate.id === id);
    if (edge === undefined) throw new Error(`${path}.activePathEdgeIds references missing edge ${id}`);
    return edge;
  });
  for (let index = 1; index < pathEdges.length; index += 1) {
    if (pathEdges[index - 1]?.to !== pathEdges[index]?.from) {
      throw new Error(`${path}.activePathEdgeIds must form one ordered continuous path`);
    }
  }
  if (pathEdges.at(-1)?.to !== activeNodeId) throw new Error(`${path}.activePathEdgeIds must end at activeNodeId ${activeNodeId}`);
}

function validateCausalGraphIsAcyclic(nodes: CausalNode[], edges: CausalEdge[], path: string): void {
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map<string, string[]>(nodes.map((node) => [node.id, []]));
  for (const edge of edges) {
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
    outgoing.get(edge.from)?.push(edge.to);
  }
  const ready = nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id);
  let visited = 0;
  while (ready.length > 0) {
    const id = ready.shift();
    if (id === undefined) break;
    visited += 1;
    for (const target of outgoing.get(id) ?? []) {
      const next = (indegree.get(target) ?? 0) - 1;
      indegree.set(target, next);
      if (next === 0) ready.push(target);
    }
  }
  if (visited !== nodes.length) throw new Error(`${path} must be a directed acyclic graph`);
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
  const importance = record["importance"] === undefined
    ? undefined
    : enumValue(record["importance"], decisionImportances, `${path}.importance`);
  const blocking = optionalBoolean(record["blocking"], `${path}.blocking`);
  if (status === "resolved" && resolution === undefined) throw new Error(`${path}.resolution is required when status is resolved`);
  return {
    id: idValue(record["id"], `${path}.id`),
    kind: enumValue(record["kind"], decisionKinds, `${path}.kind`),
    question: nonEmptyString(record["question"], `${path}.question`),
    impact: nonEmptyString(record["impact"], `${path}.impact`),
    status,
    ...(importance === undefined ? {} : { importance }),
    ...(blocking === undefined ? {} : { blocking }),
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

function optionalBoolean(value: unknown, path: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new Error(`${path} must be a boolean`);
  return value;
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
