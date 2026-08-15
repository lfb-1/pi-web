import { StringEnum } from "@earendil-works/pi-ai";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  truncateHead,
  withFileMutationQueue,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Type, type Static } from "typebox";
import {
  activeWorkItem,
  artifactKinds,
  briefConfidences,
  criterionResults,
  criterionStatuses,
  decisionKinds,
  decisionStatuses,
  findingStatuses,
  nextActionOwners,
  objectiveStatuses,
  parseResearchWorkflowStateText,
  RESEARCH_WORKFLOW_STATE_PATH,
  runKinds,
  runStatuses,
  workflowPhases,
  type AcceptanceCriterion,
  type ArtifactRecord,
  type DecisionRecord,
  type FindingRecord,
  type RecordSource,
  type ReferenceRecord,
  type ResearchBrief,
  type ResearchWorkflowState,
  type ResearchWorkItem,
  type RunRecord,
} from "../pi-web-plugins/research-workflow/researchWorkflowState.js";

const actions = [
  "get",
  "upsert_work_item",
  "set_active",
  "upsert_acceptance",
  "upsert_decision",
  "upsert_run",
  "upsert_artifact",
  "upsert_finding",
  "link_session",
  "link_workspace",
  "remove",
] as const;

const recordTypes = ["work-item", "acceptance", "decision", "run", "artifact", "finding", "session", "workspace"] as const;

const sourceDescription = "Stable lowercase id matching ^[a-z][a-z0-9.-]*$. Preserve it across updates.";

const BriefPatchSchema = Type.Object({
  question: Type.String({ maxLength: 240, description: "One plain-language research question." }),
  currentAnswer: Type.String({ maxLength: 900, description: "At most three short sentences; lead with the current answer and preserve uncertainty." }),
  confidence: StringEnum(briefConfidences),
  confidenceReason: Type.String({ maxLength: 600, description: "Explain both the strongest support and the main limitation." }),
  blockedBecause: Type.Optional(Type.String({ maxLength: 500, description: "Only the direct reason work cannot advance." })),
  nextActionOwner: StringEnum(nextActionOwners),
  nextAction: Type.String({ maxLength: 500, description: "One concrete next action, written for the named owner." }),
  recentChange: Type.Optional(Type.String({ maxLength: 500, description: "One material change since the previous brief; omit when nothing changed." })),
  evidenceRefs: Type.Array(Type.String()),
}, { additionalProperties: false });

const WorkItemPatchSchema = Type.Object({
  id: Type.String({ description: sourceDescription }),
  title: Type.Optional(Type.String()),
  objective: Type.Optional(Type.String()),
  objectiveStatus: Type.Optional(StringEnum(objectiveStatuses)),
  rationale: Type.Optional(Type.String()),
  phase: Type.Optional(StringEnum(workflowPhases)),
  definitionOfDone: Type.Optional(Type.String()),
  brief: Type.Optional(BriefPatchSchema),
}, { additionalProperties: false });

const CriterionPatchSchema = Type.Object({
  id: Type.String({ description: sourceDescription }),
  title: Type.Optional(Type.String()),
  predicate: Type.Optional(Type.String()),
  status: Type.Optional(StringEnum(criterionStatuses)),
  result: Type.Optional(StringEnum(criterionResults)),
  note: Type.Optional(Type.String()),
  evidenceRefs: Type.Optional(Type.Array(Type.String())),
}, { additionalProperties: false });

const DecisionPatchSchema = Type.Object({
  id: Type.String({ description: sourceDescription }),
  kind: Type.Optional(StringEnum(decisionKinds)),
  question: Type.Optional(Type.String()),
  impact: Type.Optional(Type.String()),
  status: Type.Optional(StringEnum(decisionStatuses)),
  resolution: Type.Optional(Type.String()),
}, { additionalProperties: false });

const AcceptanceResultSchema = Type.Object({
  criterionId: Type.String(),
  status: StringEnum(criterionResults),
  note: Type.Optional(Type.String()),
  evidenceRefs: Type.Optional(Type.Array(Type.String())),
}, { additionalProperties: false });

const RunPatchSchema = Type.Object({
  id: Type.String({ description: sourceDescription }),
  kind: Type.Optional(StringEnum(runKinds)),
  status: Type.Optional(StringEnum(runStatuses)),
  purpose: Type.Optional(Type.String()),
  jobId: Type.Optional(Type.String()),
  startedAt: Type.Optional(Type.String()),
  finishedAt: Type.Optional(Type.String()),
  acceptanceResults: Type.Optional(Type.Array(AcceptanceResultSchema)),
  artifactRefs: Type.Optional(Type.Array(Type.String())),
}, { additionalProperties: false });

const ArtifactPatchSchema = Type.Object({
  id: Type.String({ description: sourceDescription }),
  label: Type.Optional(Type.String()),
  kind: Type.Optional(StringEnum(artifactKinds)),
  path: Type.Optional(Type.String()),
  url: Type.Optional(Type.String()),
}, { additionalProperties: false });

const FindingPatchSchema = Type.Object({
  id: Type.String({ description: sourceDescription }),
  summary: Type.Optional(Type.String()),
  status: Type.Optional(StringEnum(findingStatuses)),
  evidenceRefs: Type.Optional(Type.Array(Type.String())),
}, { additionalProperties: false });

const ReferencePatchSchema = Type.Object({
  id: Type.String({ description: "Native session or workspace id." }),
  label: Type.Optional(Type.String()),
}, { additionalProperties: false });

const ResearchWorkflowParameters = Type.Object({
  action: StringEnum(actions),
  workItemId: Type.Optional(Type.String({ description: "Parent work-item id for child records." })),
  workItem: Type.Optional(WorkItemPatchSchema),
  criterion: Type.Optional(CriterionPatchSchema),
  decision: Type.Optional(DecisionPatchSchema),
  run: Type.Optional(RunPatchSchema),
  artifact: Type.Optional(ArtifactPatchSchema),
  finding: Type.Optional(FindingPatchSchema),
  reference: Type.Optional(ReferencePatchSchema),
  recordType: Type.Optional(StringEnum(recordTypes)),
  recordId: Type.Optional(Type.String()),
}, { additionalProperties: false });

export type ResearchWorkflowParameters = Static<typeof ResearchWorkflowParameters>;
type AuthorityRequest = { message: string } | undefined;

export default function researchWorkflowExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "research_workflow",
    label: "Research Workflow",
    description: `Read or update ${RESEARCH_WORKFLOW_STATE_PATH}. Manages research objectives, a plain-language semantic brief, acceptance criteria, decisions, runs, artifacts, findings, and runtime links with stable ids and provenance. Authority-bearing transitions require a real user confirmation.`,
    promptSnippet: "Maintain the structured research workflow and its evidence-backed plain-language brief",
    promptGuidelines: [
      "Use research_workflow when the current research objective, semantic brief, definition of done, acceptance criteria, decision state, experiment run, artifact, or finding changes.",
      "Call research_workflow with action=get before updating state that may have changed; update one entity at a time and preserve stable ids.",
      "Rewrite source material into the workItem.brief for human understanding: use plain language, do not copy long source passages, and explain unavoidable jargon. Brief evidenceRefs must use existing artifact, criterion, decision, or run ids; create a labeled artifact record before citing an external path or URL.",
      "A brief question is one sentence; currentAnswer is at most three short sentences and leads with the answer; confidenceReason names both support and limitations; blockedBecause states only the direct blocker; nextAction gives one concrete action and its owner; recentChange records one material change or is omitted.",
      "Keep provisional evidence explicitly qualified. The semantic brief is a Pi interpretation and must not change objective, criterion, decision, finding, or completion authority.",
      "Use proposed or provisional status for Pi-generated content. research_workflow asks the user before confirming an objective, approving a criterion, resolving a decision, accepting a finding, removing a record, or marking a work item completed.",
      "After changing a criterion, decision, run, artifact, or finding, refresh the workItem.brief before ending the task so the executive view stays consistent with the detailed records.",
      "After an authorized experiment reaches a terminal state, use research_workflow to record its status, acceptance results, artifacts, and provisional finding; scheduler submission alone is incomplete.",
    ],
    parameters: ResearchWorkflowParameters,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (params.action === "get") return readToolResult(ctx);
      if (!ctx.isProjectTrusted()) throw new Error("Research Workflow updates require a trusted project");

      const statePath = resolve(ctx.cwd, RESEARCH_WORKFLOW_STATE_PATH);
      return withFileMutationQueue(statePath, async () => {
        const latest = await readWorkflowState(ctx.cwd);
        const authorityRequest = authorityRequestFor(params, latest.state);
        let authoritySource: RecordSource | undefined;
        if (authorityRequest !== undefined) {
          if (!ctx.hasUI) throw new Error(`User confirmation is required: ${authorityRequest.message}`);
          const confirmed = await ctx.ui.confirm("Research Workflow authority", authorityRequest.message);
          if (!confirmed) throw new Error("Research Workflow update was not authorized by the user");
          authoritySource = sourceFor(ctx, "user");
        }
        const next = mutateState(latest.state, params, sourceFor(ctx, "pi"), authoritySource);
        next.updatedAt = new Date().toISOString();
        const validated = validateState(next);
        await writeStateAtomically(statePath, validated);
        const active = activeWorkItem(validated);
        return {
          content: [{
            type: "text",
            text: `Updated ${RESEARCH_WORKFLOW_STATE_PATH}: ${params.action}${active === undefined ? "" : `; active work item ${active.id} (${active.phase})`}`,
          }],
          details: {
            action: params.action,
            path: RESEARCH_WORKFLOW_STATE_PATH,
            updatedAt: validated.updatedAt,
            activeWorkItemId: validated.activeWorkItemId,
          },
        };
      });
    },
  });

  pi.on("before_agent_start", async (event, ctx) => {
    try {
      const loaded = await readWorkflowState(ctx.cwd);
      if (!loaded.exists) return;
      const item = activeWorkItem(loaded.state);
      if (item === undefined) return;
      const openDecisions = item.decisions.filter((decision) => decision.status === "open");
      const activeRuns = item.runs.filter((run) => ["queued", "running", "waiting"].includes(run.status));
      const briefLines = item.brief === undefined
        ? [`- Objective (${item.objectiveStatus}): ${item.objective}`, `- Definition of done: ${item.definitionOfDone}`, "- Semantic brief: missing; create one when this turn reviews the work item."]
        : [
            `- Research question: ${item.brief.question}`,
            `- Current answer (${item.brief.confidence} confidence): ${item.brief.currentAnswer}`,
            `- Confidence reason: ${item.brief.confidenceReason}`,
            ...(item.brief.blockedBecause === undefined ? [] : [`- Blocked because: ${item.brief.blockedBecause}`]),
            `- Next action (${item.brief.nextActionOwner}): ${item.brief.nextAction}`,
          ];
      const summary = [
        "Research Workflow active state:",
        `- Work item: ${item.id} — ${item.title}`,
        `- Phase: ${item.phase}`,
        ...briefLines,
        `- Open decisions: ${openDecisions.length === 0 ? "none" : openDecisions.map((decision) => `${decision.id}: ${decision.question}`).join("; ")}`,
        `- Active runs: ${activeRuns.length === 0 ? "none" : activeRuns.map((run) => `${run.id}: ${run.status}`).join("; ")}`,
        `Use research_workflow to keep ${RESEARCH_WORKFLOW_STATE_PATH} synchronized. If this turn materially changes detailed records or their interpretation, rewrite the semantic brief before ending.`,
      ].join("\n");
      return { systemPrompt: `${event.systemPrompt}\n\n${summary}` };
    } catch {
      return;
    }
  });
}

async function readToolResult(ctx: ExtensionContext) {
  const loaded = await readWorkflowState(ctx.cwd);
  if (!loaded.exists) {
    return {
      content: [{ type: "text" as const, text: `No ${RESEARCH_WORKFLOW_STATE_PATH} exists. Create a proposed work item before adding child records.` }],
      details: { action: "get", path: RESEARCH_WORKFLOW_STATE_PATH, exists: false },
    };
  }

  const text = JSON.stringify(loaded.state, null, 2);
  const truncated = truncateHead(text, { maxBytes: DEFAULT_MAX_BYTES, maxLines: DEFAULT_MAX_LINES });
  const suffix = truncated.truncated ? `\n\n[State truncated; read ${RESEARCH_WORKFLOW_STATE_PATH} for the complete JSON.]` : "";
  return {
    content: [{ type: "text" as const, text: `${truncated.content}${suffix}` }],
    details: {
      action: "get",
      path: RESEARCH_WORKFLOW_STATE_PATH,
      exists: true,
      updatedAt: loaded.state.updatedAt,
      workItemCount: loaded.state.workItems.length,
      truncated: truncated.truncated,
    },
  };
}

export function authorityRequestFor(params: ResearchWorkflowParameters, state: ResearchWorkflowState): AuthorityRequest {
  if (params.action === "remove") {
    return { message: `Remove ${required(params.recordType, "recordType")} ${required(params.recordId, "recordId")} from Research Workflow state?` };
  }

  if (params.action === "upsert_work_item" && params.workItem !== undefined) {
    const existing = state.workItems.find((item) => item.id === params.workItem?.id);
    const transitions: string[] = [];
    if (params.workItem.objectiveStatus === "confirmed" && existing?.objectiveStatus !== "confirmed") transitions.push("confirm the research objective");
    if (params.workItem.phase === "completed" && existing?.phase !== "completed") transitions.push("mark the work item completed");
    if (existing !== undefined && changesAuthorizedWorkItemScope(params.workItem, existing)) {
      if (existing.phase === "completed") transitions.push("change the completed work item scope");
      else if (existing.objectiveStatus === "confirmed") transitions.push("change the confirmed research objective");
    }
    if (existing?.phase === "completed" && params.workItem.phase !== undefined && params.workItem.phase !== "completed") transitions.push("reopen the completed work item");
    return transitions.length === 0 ? undefined : { message: `${uniqueStrings(transitions).join(" and ")} for ${params.workItem.id}?` };
  }

  const item = params.workItemId === undefined ? undefined : state.workItems.find((candidate) => candidate.id === params.workItemId);
  if (params.action === "upsert_acceptance" && params.criterion !== undefined) {
    const existing = item?.acceptanceCriteria.find((criterion) => criterion.id === params.criterion?.id);
    if (params.criterion.status === "approved" && existing?.status !== "approved") return { message: `Approve acceptance criterion ${params.criterion.id}: ${params.criterion.predicate ?? existing?.predicate ?? "(predicate missing)"}?` };
    if (existing?.status === "approved" && changesApprovedCriterion(params.criterion, existing)) return { message: `Change approved acceptance criterion ${params.criterion.id}?` };
  }
  if (params.action === "upsert_decision" && params.decision !== undefined) {
    const existing = item?.decisions.find((decision) => decision.id === params.decision?.id);
    if (params.decision.status !== undefined && params.decision.status !== "open" && existing?.status !== params.decision.status) return { message: `${params.decision.status === "resolved" ? "Resolve" : "Void"} decision ${params.decision.id}${params.decision.resolution === undefined ? "" : ` as: ${params.decision.resolution}`}?` };
    if (existing !== undefined && existing.status !== "open" && changesAuthorizedDecision(params.decision, existing)) return { message: `Change ${existing.status} decision ${params.decision.id}?` };
  }
  if (params.action === "upsert_finding" && params.finding !== undefined) {
    const existing = item?.findings.find((finding) => finding.id === params.finding?.id);
    if (params.finding.status !== undefined && params.finding.status !== "provisional" && existing?.status !== params.finding.status) return { message: `${params.finding.status === "accepted" ? "Accept" : "Reject"} finding ${params.finding.id}: ${params.finding.summary ?? existing?.summary ?? "(summary missing)"}?` };
    if (existing !== undefined && existing.status !== "provisional" && changesAuthorizedFinding(params.finding, existing)) return { message: `Change ${existing.status} finding ${params.finding.id}?` };
  }
  return undefined;
}

function changesAuthorizedWorkItemScope(patch: NonNullable<ResearchWorkflowParameters["workItem"]>, existing: ResearchWorkItem): boolean {
  return (patch.title !== undefined && patch.title !== existing.title)
    || (patch.objective !== undefined && patch.objective !== existing.objective)
    || (patch.rationale !== undefined && patch.rationale !== existing.rationale)
    || (patch.definitionOfDone !== undefined && patch.definitionOfDone !== existing.definitionOfDone)
    || (patch.objectiveStatus !== undefined && patch.objectiveStatus !== "confirmed");
}

function changesApprovedCriterion(patch: NonNullable<ResearchWorkflowParameters["criterion"]>, existing: AcceptanceCriterion): boolean {
  return (patch.title !== undefined && patch.title !== existing.title)
    || (patch.predicate !== undefined && patch.predicate !== existing.predicate)
    || (patch.status !== undefined && patch.status !== "approved");
}

function changesAuthorizedDecision(patch: NonNullable<ResearchWorkflowParameters["decision"]>, existing: DecisionRecord): boolean {
  return (patch.kind !== undefined && patch.kind !== existing.kind)
    || (patch.question !== undefined && patch.question !== existing.question)
    || (patch.impact !== undefined && patch.impact !== existing.impact)
    || (patch.status !== undefined && patch.status !== existing.status)
    || (patch.resolution !== undefined && patch.resolution !== existing.resolution);
}

function changesAuthorizedFinding(patch: NonNullable<ResearchWorkflowParameters["finding"]>, existing: FindingRecord): boolean {
  return (patch.summary !== undefined && patch.summary !== existing.summary)
    || (patch.status !== undefined && patch.status !== existing.status)
    || (patch.evidenceRefs !== undefined && !stringArraysEqual(patch.evidenceRefs, existing.evidenceRefs));
}

function stringArraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

export function mutateState(
  state: ResearchWorkflowState,
  params: ResearchWorkflowParameters,
  source: RecordSource,
  authoritySource: RecordSource | undefined,
): ResearchWorkflowState {
  const next = structuredClone(state);
  switch (params.action) {
    case "upsert_work_item":
      upsertWorkItem(next, required(params.workItem, "workItem"), source, authoritySource);
      break;
    case "set_active": {
      const workItemId = required(params.workItemId, "workItemId");
      requireWorkItem(next, workItemId);
      next.activeWorkItemId = workItemId;
      break;
    }
    case "upsert_acceptance": {
      const item = requireWorkItem(next, required(params.workItemId, "workItemId"));
      upsertCriterion(item, required(params.criterion, "criterion"), source, authoritySource);
      break;
    }
    case "upsert_decision": {
      const item = requireWorkItem(next, required(params.workItemId, "workItemId"));
      upsertDecision(item, required(params.decision, "decision"), source, authoritySource);
      break;
    }
    case "upsert_run": {
      const item = requireWorkItem(next, required(params.workItemId, "workItemId"));
      upsertRun(item, required(params.run, "run"), source);
      break;
    }
    case "upsert_artifact": {
      const item = requireWorkItem(next, required(params.workItemId, "workItemId"));
      upsertArtifact(item, required(params.artifact, "artifact"), source);
      break;
    }
    case "upsert_finding": {
      const item = requireWorkItem(next, required(params.workItemId, "workItemId"));
      upsertFinding(item, required(params.finding, "finding"), source, authoritySource);
      break;
    }
    case "link_session": {
      const item = requireWorkItem(next, required(params.workItemId, "workItemId"));
      upsertReference(item.sessions, required(params.reference, "reference"), source);
      break;
    }
    case "link_workspace": {
      const item = requireWorkItem(next, required(params.workItemId, "workItemId"));
      upsertReference(item.workspaces, required(params.reference, "reference"), source);
      break;
    }
    case "remove":
      removeRecord(next, required(params.recordType, "recordType"), required(params.recordId, "recordId"), params.workItemId);
      break;
    case "get":
      throw new Error("get does not mutate state");
  }
  return next;
}

function upsertWorkItem(
  state: ResearchWorkflowState,
  patch: NonNullable<ResearchWorkflowParameters["workItem"]>,
  source: RecordSource,
  authoritySource: RecordSource | undefined,
): void {
  const index = state.workItems.findIndex((item) => item.id === patch.id);
  const existing = index === -1 ? undefined : state.workItems[index];
  const rationale = patch.rationale ?? existing?.rationale;
  const brief = patch.brief === undefined ? existing?.brief : semanticBriefFromPatch(patch.brief, source);
  const objectiveStatus = patch.objectiveStatus ?? existing?.objectiveStatus ?? "proposed";
  const phase = patch.phase ?? existing?.phase ?? "research";
  const authority = objectiveStatus === "confirmed" || phase === "completed" ? authoritySource ?? existing?.authoritySource : undefined;
  const record: ResearchWorkItem = {
    id: patch.id,
    title: required(patch.title ?? existing?.title, "workItem.title"),
    objective: required(patch.objective ?? existing?.objective, "workItem.objective"),
    objectiveStatus,
    ...(rationale === undefined ? {} : { rationale }),
    phase,
    definitionOfDone: required(patch.definitionOfDone ?? existing?.definitionOfDone, "workItem.definitionOfDone"),
    ...(brief === undefined ? {} : { brief }),
    acceptanceCriteria: existing?.acceptanceCriteria ?? [],
    decisions: existing?.decisions ?? [],
    runs: existing?.runs ?? [],
    artifacts: existing?.artifacts ?? [],
    findings: existing?.findings ?? [],
    sessions: existing?.sessions ?? [],
    workspaces: existing?.workspaces ?? [],
    source: existing?.source ?? source,
    ...(authority === undefined ? {} : { authoritySource: authority }),
  };
  if (existing === undefined) {
    state.workItems.push(record);
    state.activeWorkItemId ??= record.id;
  } else {
    state.workItems[index] = record;
  }
}

function semanticBriefFromPatch(
  patch: NonNullable<NonNullable<ResearchWorkflowParameters["workItem"]>["brief"]>,
  source: RecordSource,
): ResearchBrief {
  return {
    question: patch.question,
    currentAnswer: patch.currentAnswer,
    confidence: patch.confidence,
    confidenceReason: patch.confidenceReason,
    ...(patch.blockedBecause === undefined ? {} : { blockedBecause: patch.blockedBecause }),
    nextActionOwner: patch.nextActionOwner,
    nextAction: patch.nextAction,
    ...(patch.recentChange === undefined ? {} : { recentChange: patch.recentChange }),
    evidenceRefs: patch.evidenceRefs,
    source,
  };
}

function upsertCriterion(
  item: ResearchWorkItem,
  patch: NonNullable<ResearchWorkflowParameters["criterion"]>,
  source: RecordSource,
  authoritySource: RecordSource | undefined,
): void {
  const index = item.acceptanceCriteria.findIndex((record) => record.id === patch.id);
  const existing = index === -1 ? undefined : item.acceptanceCriteria[index];
  const note = patch.note ?? existing?.note;
  const status = patch.status ?? existing?.status ?? "proposed";
  const authority = status === "approved" ? authoritySource ?? existing?.authoritySource : undefined;
  const record: AcceptanceCriterion = {
    id: patch.id,
    title: required(patch.title ?? existing?.title, "criterion.title"),
    predicate: required(patch.predicate ?? existing?.predicate, "criterion.predicate"),
    status,
    result: patch.result ?? existing?.result ?? "pending",
    ...(note === undefined ? {} : { note }),
    evidenceRefs: patch.evidenceRefs ?? existing?.evidenceRefs ?? [],
    source: existing?.source ?? source,
    ...(authority === undefined ? {} : { authoritySource: authority }),
  };
  if (existing === undefined) item.acceptanceCriteria.push(record);
  else item.acceptanceCriteria[index] = record;
}

function upsertDecision(
  item: ResearchWorkItem,
  patch: NonNullable<ResearchWorkflowParameters["decision"]>,
  source: RecordSource,
  authoritySource: RecordSource | undefined,
): void {
  const index = item.decisions.findIndex((record) => record.id === patch.id);
  const existing = index === -1 ? undefined : item.decisions[index];
  const resolution = patch.resolution ?? (patch.status === "open" ? undefined : existing?.resolution);
  const status = patch.status ?? existing?.status ?? "open";
  const authority = status === "open" ? undefined : authoritySource ?? existing?.authoritySource;
  const record: DecisionRecord = {
    id: patch.id,
    kind: patch.kind ?? existing?.kind ?? "other",
    question: required(patch.question ?? existing?.question, "decision.question"),
    impact: required(patch.impact ?? existing?.impact, "decision.impact"),
    status,
    ...(resolution === undefined ? {} : { resolution }),
    source: existing?.source ?? source,
    ...(authority === undefined ? {} : { authoritySource: authority }),
  };
  if (existing === undefined) item.decisions.push(record);
  else item.decisions[index] = record;
}

function upsertRun(
  item: ResearchWorkItem,
  patch: NonNullable<ResearchWorkflowParameters["run"]>,
  source: RecordSource,
): void {
  const index = item.runs.findIndex((record) => record.id === patch.id);
  const existing = index === -1 ? undefined : item.runs[index];
  const jobId = patch.jobId ?? existing?.jobId;
  const startedAt = patch.startedAt ?? existing?.startedAt;
  const finishedAt = patch.finishedAt ?? existing?.finishedAt;
  const acceptanceResults = patch.acceptanceResults?.map((result) => ({
    ...result,
    evidenceRefs: result.evidenceRefs ?? [],
  })) ?? existing?.acceptanceResults ?? [];
  const record: RunRecord = {
    id: patch.id,
    kind: patch.kind ?? existing?.kind ?? "external",
    status: patch.status ?? existing?.status ?? "queued",
    purpose: required(patch.purpose ?? existing?.purpose, "run.purpose"),
    ...(jobId === undefined ? {} : { jobId }),
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(finishedAt === undefined ? {} : { finishedAt }),
    acceptanceResults,
    artifactRefs: patch.artifactRefs ?? existing?.artifactRefs ?? [],
    source: existing?.source ?? source,
  };
  if (existing === undefined) item.runs.push(record);
  else item.runs[index] = record;
}

function upsertArtifact(
  item: ResearchWorkItem,
  patch: NonNullable<ResearchWorkflowParameters["artifact"]>,
  source: RecordSource,
): void {
  const index = item.artifacts.findIndex((record) => record.id === patch.id);
  const existing = index === -1 ? undefined : item.artifacts[index];
  const path = patch.path ?? existing?.path;
  const url = patch.url ?? existing?.url;
  const record: ArtifactRecord = {
    id: patch.id,
    label: required(patch.label ?? existing?.label, "artifact.label"),
    kind: patch.kind ?? existing?.kind ?? "other",
    ...(path === undefined ? {} : { path }),
    ...(url === undefined ? {} : { url }),
    source: existing?.source ?? source,
  };
  if (existing === undefined) item.artifacts.push(record);
  else item.artifacts[index] = record;
}

function upsertFinding(
  item: ResearchWorkItem,
  patch: NonNullable<ResearchWorkflowParameters["finding"]>,
  source: RecordSource,
  authoritySource: RecordSource | undefined,
): void {
  const index = item.findings.findIndex((record) => record.id === patch.id);
  const existing = index === -1 ? undefined : item.findings[index];
  const status = patch.status ?? existing?.status ?? "provisional";
  const authority = status === "provisional" ? undefined : authoritySource ?? existing?.authoritySource;
  const record: FindingRecord = {
    id: patch.id,
    summary: required(patch.summary ?? existing?.summary, "finding.summary"),
    status,
    evidenceRefs: patch.evidenceRefs ?? existing?.evidenceRefs ?? [],
    source: existing?.source ?? source,
    ...(authority === undefined ? {} : { authoritySource: authority }),
  };
  if (existing === undefined) item.findings.push(record);
  else item.findings[index] = record;
}

function upsertReference(
  records: ReferenceRecord[],
  patch: NonNullable<ResearchWorkflowParameters["reference"]>,
  source: RecordSource,
): void {
  const index = records.findIndex((record) => record.id === patch.id);
  const existing = index === -1 ? undefined : records[index];
  const label = patch.label ?? existing?.label;
  const record: ReferenceRecord = {
    id: patch.id,
    ...(label === undefined ? {} : { label }),
    source: existing?.source ?? source,
  };
  if (existing === undefined) records.push(record);
  else records[index] = record;
}

function removeRecord(
  state: ResearchWorkflowState,
  recordType: (typeof recordTypes)[number],
  recordId: string,
  workItemId: string | undefined,
): void {
  if (recordType === "work-item") {
    const previousLength = state.workItems.length;
    state.workItems = state.workItems.filter((item) => item.id !== recordId);
    if (state.workItems.length === previousLength) throw new Error(`Work item ${recordId} does not exist`);
    if (state.activeWorkItemId === recordId) {
      const replacementId = state.workItems[0]?.id;
      if (replacementId === undefined) delete state.activeWorkItemId;
      else state.activeWorkItemId = replacementId;
    }
    return;
  }

  const item = requireWorkItem(state, required(workItemId, "workItemId"));
  const collection = collectionFor(item, recordType);
  const index = collection.findIndex((record) => record.id === recordId);
  if (index === -1) throw new Error(`${recordType} ${recordId} does not exist in ${item.id}`);
  collection.splice(index, 1);
}

function collectionFor(item: ResearchWorkItem, recordType: Exclude<(typeof recordTypes)[number], "work-item">): { id: string }[] {
  switch (recordType) {
    case "acceptance": return item.acceptanceCriteria;
    case "decision": return item.decisions;
    case "run": return item.runs;
    case "artifact": return item.artifacts;
    case "finding": return item.findings;
    case "session": return item.sessions;
    case "workspace": return item.workspaces;
  }
}

function requireWorkItem(state: ResearchWorkflowState, id: string): ResearchWorkItem {
  const item = state.workItems.find((candidate) => candidate.id === id);
  if (item === undefined) throw new Error(`Work item ${id} does not exist`);
  return item;
}

function validateState(state: ResearchWorkflowState): ResearchWorkflowState {
  const parsed = parseResearchWorkflowStateText(JSON.stringify(state));
  if (!parsed.ok) throw new Error(`Research Workflow state is invalid: ${parsed.error}`);
  return parsed.state;
}

async function readWorkflowState(cwd: string): Promise<{ state: ResearchWorkflowState; exists: boolean }> {
  const path = resolve(cwd, RESEARCH_WORKFLOW_STATE_PATH);
  try {
    const text = await readFile(path, "utf8");
    const parsed = parseResearchWorkflowStateText(text);
    if (!parsed.ok) throw new Error(`Existing ${RESEARCH_WORKFLOW_STATE_PATH} is invalid: ${parsed.error}`);
    return { state: parsed.state, exists: true };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return {
        state: { version: 1, updatedAt: new Date().toISOString(), workItems: [] },
        exists: false,
      };
    }
    throw error;
  }
}

async function writeStateAtomically(path: string, state: ResearchWorkflowState): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${String(process.pid)}-${String(Date.now())}`;
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
}

function sourceFor(ctx: ExtensionContext, kind: "pi" | "user"): RecordSource {
  const branch = ctx.sessionManager.getBranch();
  let entryId = ctx.sessionManager.getLeafId() ?? "no-entry";
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index];
    if (entry?.type === "message" && entry.message.role === "user") {
      entryId = entry.id;
      break;
    }
  }
  return {
    kind,
    ref: `session:${ctx.sessionManager.getSessionId()}#${entryId}`,
    at: new Date().toISOString(),
  };
}

function required<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new Error(`${name} is required for this action`);
  return value;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
