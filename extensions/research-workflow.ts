import { StringEnum } from "@earendil-works/pi-ai";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
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
  causalConclusions,
  causalEdgeKinds,
  causalGraphStatuses,
  causalNodeKinds,
  causalNodeStatuses,
  criterionResults,
  criterionStatuses,
  decisionImportances,
  decisionKinds,
  decisionRequiresAttention,
  decisionStatuses,
  findingStatuses,
  LEGACY_RESEARCH_WORKFLOW_STATE_PATH,
  nextActionOwners,
  objectiveStatuses,
  parseResearchWorkflowStateText,
  RESEARCH_WORKFLOW_STATE_PATH,
  runKinds,
  runStatuses,
  workflowPhases,
  type AcceptanceCriterion,
  type ArtifactRecord,
  type CausalEdge,
  type CausalNode,
  type DecisionRecord,
  type FindingRecord,
  type RecordSource,
  type ReferenceRecord,
  type ResearchBrief,
  type ResearchCausalGraph,
  type ResearchWorkflowState,
  type ResearchWorkItem,
  type RunRecord,
} from "../pi-web-plugins/research-workflow/researchWorkflowState.js";

const actions = [
  "get",
  "upsert_work_item",
  "set_active",
  "upsert_causal_graph",
  "replace_causal_graph",
  "upsert_causal_node",
  "upsert_causal_edge",
  "upsert_acceptance",
  "upsert_decision",
  "upsert_run",
  "upsert_artifact",
  "upsert_finding",
  "link_session",
  "link_workspace",
  "remove",
] as const;

const recordTypes = ["work-item", "causal-node", "causal-edge", "acceptance", "decision", "run", "artifact", "finding", "session", "workspace"] as const;

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

const CausalGraphPatchSchema = Type.Object({
  title: Type.Optional(Type.String({ maxLength: 160 })),
  status: Type.Optional(StringEnum(causalGraphStatuses)),
  activeNodeId: Type.Optional(Type.String({ description: sourceDescription })),
  activePathEdgeIds: Type.Optional(Type.Array(Type.String({ description: sourceDescription }))),
  clearActiveNode: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });

const CausalNodePatchSchema = Type.Object({
  id: Type.String({ description: sourceDescription }),
  kind: Type.Optional(StringEnum(causalNodeKinds)),
  title: Type.Optional(Type.String({ maxLength: 240 })),
  summary: Type.Optional(Type.String({ maxLength: 700 })),
  status: Type.Optional(StringEnum(causalNodeStatuses)),
  conclusion: Type.Optional(StringEnum(causalConclusions)),
  workItemId: Type.Optional(Type.String({ description: "Optional branch work-item id represented by this node." })),
  evidenceRefs: Type.Optional(Type.Array(Type.String({ description: "Typed ref: <workItemId>/(run|artifact|finding|criterion|decision):<recordId>." }))),
}, { additionalProperties: false });

const CausalEdgePatchSchema = Type.Object({
  id: Type.String({ description: sourceDescription }),
  from: Type.Optional(Type.String({ description: sourceDescription })),
  to: Type.Optional(Type.String({ description: sourceDescription })),
  kind: Type.Optional(StringEnum(causalEdgeKinds)),
  direction: Type.Optional(Type.String({ maxLength: 360, description: "Required only for motivates edges; summarize why the conclusion led to the next hypothesis." })),
}, { additionalProperties: false });

const CausalGraphReplacementNodeSchema = Type.Object({
  id: Type.String({ description: sourceDescription }),
  kind: StringEnum(causalNodeKinds),
  title: Type.String({ maxLength: 240 }),
  summary: Type.String({ maxLength: 700 }),
  status: StringEnum(causalNodeStatuses),
  conclusion: Type.Optional(StringEnum(causalConclusions)),
  workItemId: Type.Optional(Type.String({ description: "Optional branch work-item id represented by this node." })),
  evidenceRefs: Type.Array(Type.String({ description: "Typed ref: <workItemId>/(run|artifact|finding|criterion|decision):<recordId>." })),
}, { additionalProperties: false });

const CausalGraphReplacementEdgeSchema = Type.Object({
  id: Type.String({ description: sourceDescription }),
  from: Type.String({ description: sourceDescription }),
  to: Type.String({ description: sourceDescription }),
  kind: StringEnum(causalEdgeKinds),
  direction: Type.Optional(Type.String({ maxLength: 360, description: "Required only for motivates edges." })),
}, { additionalProperties: false });

const CausalGraphReplacementSchema = Type.Object({
  title: Type.String({ maxLength: 160 }),
  status: StringEnum(causalGraphStatuses),
  activeNodeId: Type.Optional(Type.String({ description: sourceDescription })),
  activePathEdgeIds: Type.Array(Type.String({ description: sourceDescription })),
  nodes: Type.Array(CausalGraphReplacementNodeSchema),
  edges: Type.Array(CausalGraphReplacementEdgeSchema),
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
  importance: Type.Optional(StringEnum(decisionImportances)),
  blocking: Type.Optional(Type.Boolean()),
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
  causalGraph: Type.Optional(CausalGraphPatchSchema),
  causalGraphReplacement: Type.Optional(CausalGraphReplacementSchema),
  causalNode: Type.Optional(CausalNodePatchSchema),
  causalEdge: Type.Optional(CausalEdgePatchSchema),
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

export default function researchWorkflowExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "research_workflow",
    label: "Research Workflow",
    description: `Read or update ${RESEARCH_WORKFLOW_STATE_PATH}. Maintains an evidence-backed research causal graph plus durable objectives, decisions, runs, artifacts, findings, and provenance. Every validated mutation is automatic; critical decisions remain visible as attention state but do not open authority dialogs.`,
    promptSnippet: "Maintain the research causal graph from hypothesis through validation, analysis, conclusion, and next direction",
    promptGuidelines: [
      "Use research_workflow whenever a hypothesis, validation, analysis, conclusion, or resulting research direction changes. Call action=get first when state may have changed; update one entity at a time and preserve stable ids.",
      `Never create, edit, copy, or overwrite ${RESEARCH_WORKFLOW_STATE_PATH} with file, shell, or text-edit tools. Only research_workflow may write it because the tool injects nested provenance, validates evidence references, checks the explicit active path, and writes atomically. If action=get reports invalid state, stop and report the exact validation error instead of replacing the file.`,
      "The causal graph is the primary human view. Keep it current automatically: hypothesis -> validation -> analysis -> conclusion, then connect a conclusion to each new hypothesis with a motivates edge whose direction explains the causal reason. Branches and merges are allowed; cycles are not. Use replace_causal_graph only for an intentional wholesale projection reset or compaction; provide the complete replacement graph in one validated mutation.",
      "Graph nodes are concise semantic summaries. Never put code, paths, job metadata, long metric tables, or implementation detail in them. A validation node states only what was tested and its status; an analysis node states the short interpretation; a conclusion node uses confirmed, denied, or unsure while preserving scope and uncertainty.",
      "Keep detailed runs, artifacts, criteria, and findings durable for traceability, but do not copy their detail into the graph. Link a graph node to its branch with workItemId when available.",
      "Continue automatically for reversible implementation choices, evidence-backed graph maintenance, routine record synchronization, and an obvious recommended next step. Do not ask the user about implementation detail or ordinary result bookkeeping.",
      "Create a blocking critical decision only when safe progress genuinely requires a scientific-direction choice that cannot be inferred, substantial unapproved compute, necessary missing information, or an irreversible/destructive action. Mark it importance=critical and blocking=true. Other decisions stay routine or important and must not interrupt progress.",
      "Rewrite source material into workItem.brief for agent context in plain language. Promote findings automatically when evidence and registered criteria support the transition, while preserving scope and uncertainty; use graph conclusions for automatic scientific interpretation. Graph conclusions do not authorize substantial unapproved compute or mark the overall research idea completed.",
      "Run the complete research-record pipeline automatically. Never open a Workflow authority dialog: objective, criteria, decision, finding, completion, reopening, removal, and graph maintenance mutations all proceed after validation. Critical/blocking decisions remain visible for attention and may be resolved automatically once the needed answer is available.",
      "After an authorized experiment reaches a terminal state, record its status, artifacts, provisional finding, concise analysis/conclusion nodes, and any motivated next hypothesis. Scheduler submission alone is incomplete.",
    ],
    parameters: ResearchWorkflowParameters,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (params.action === "get") return readToolResult(ctx);
      if (!ctx.isProjectTrusted()) throw new Error("Research Workflow updates require a trusted project");

      const statePath = resolve(ctx.cwd, RESEARCH_WORKFLOW_STATE_PATH);
      return withFileMutationQueue(statePath, () => withWorkflowStateLock(statePath, async () => {
        const latest = await readWorkflowState(ctx.cwd);
        const next = mutateState(latest.state, params, sourceFor(ctx), undefined);
        next.updatedAt = new Date().toISOString();
        const validated = validateState(next);
        await writeStateAtomically(statePath, validated);
        const active = activeWorkItem(validated);
        return {
          content: [{
            type: "text" as const,
            text: `Updated ${RESEARCH_WORKFLOW_STATE_PATH}: ${params.action}${active === undefined ? "" : `; active work item ${active.id} (${active.phase})`}`,
          }],
          details: {
            action: params.action,
            path: RESEARCH_WORKFLOW_STATE_PATH,
            updatedAt: validated.updatedAt,
            activeWorkItemId: validated.activeWorkItemId,
          },
        };
      }));
    },
  });

  pi.on("before_agent_start", async (event, ctx) => {
    try {
      const loaded = await readWorkflowState(ctx.cwd);
      if (!loaded.exists) return;
      const item = activeWorkItem(loaded.state);
      if (item === undefined) return;
      const criticalDecisions = item.decisions.filter(decisionRequiresAttention);
      const activeRuns = item.runs.filter((run) => ["queued", "running", "waiting"].includes(run.status));
      const graph = loaded.state.causalGraph;
      const activeNode = graph?.nodes.find((node) => node.id === graph.activeNodeId);
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
        `- Causal graph: ${graph === undefined ? "missing; build it from durable records" : `${graph.title} (${graph.status}); ${String(graph.nodes.length)} nodes, ${String(graph.edges.length)} edges`}`,
        ...(activeNode === undefined ? [] : [`- Active causal node: ${activeNode.id} [${activeNode.kind}] ${activeNode.title}`]),
        `- Critical blocking decisions: ${criticalDecisions.length === 0 ? "none" : criticalDecisions.map((decision) => `${decision.id}: ${decision.question}`).join("; ")}`,
        `- Active runs: ${activeRuns.length === 0 ? "none" : activeRuns.map((run) => `${run.id}: ${run.status}`).join("; ")}`,
        `Use research_workflow exclusively to keep ${RESEARCH_WORKFLOW_STATE_PATH} synchronized; never write that file with file, shell, or text-edit tools. Maintain the causal graph automatically after material hypothesis, validation, analysis, conclusion, or direction changes. Ask the user only when the underlying research genuinely cannot continue without new information; never ask for record bookkeeping or a Workflow authority transition.`,
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

export function mutateState(
  state: ResearchWorkflowState,
  params: ResearchWorkflowParameters,
  source: RecordSource,
  authoritySource: RecordSource | undefined,
): ResearchWorkflowState {
  void authoritySource;
  const next = structuredClone(state);
  switch (params.action) {
    case "upsert_work_item":
      upsertWorkItem(next, required(params.workItem, "workItem"), source);
      break;
    case "set_active": {
      const workItemId = required(params.workItemId, "workItemId");
      requireWorkItem(next, workItemId);
      next.activeWorkItemId = workItemId;
      break;
    }
    case "upsert_causal_graph":
      upsertCausalGraph(next, required(params.causalGraph, "causalGraph"), source);
      break;
    case "replace_causal_graph":
      replaceCausalGraph(next, required(params.causalGraphReplacement, "causalGraphReplacement"), source);
      break;
    case "upsert_causal_node": {
      const graph = requireCausalGraph(next);
      upsertCausalNode(graph, required(params.causalNode, "causalNode"), source);
      delete graph.authoritySource;
      break;
    }
    case "upsert_causal_edge": {
      const graph = requireCausalGraph(next);
      upsertCausalEdge(graph, required(params.causalEdge, "causalEdge"), source);
      delete graph.authoritySource;
      break;
    }
    case "upsert_acceptance": {
      const item = requireWorkItem(next, required(params.workItemId, "workItemId"));
      upsertCriterion(item, required(params.criterion, "criterion"), source);
      break;
    }
    case "upsert_decision": {
      const item = requireWorkItem(next, required(params.workItemId, "workItemId"));
      upsertDecision(item, required(params.decision, "decision"), source);
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
      upsertFinding(item, required(params.finding, "finding"), source);
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
      if (next.causalGraph !== undefined) delete next.causalGraph.authoritySource;
      break;
    case "get":
      throw new Error("get does not mutate state");
  }
  return next;
}

function upsertCausalGraph(
  state: ResearchWorkflowState,
  patch: NonNullable<ResearchWorkflowParameters["causalGraph"]>,
  source: RecordSource,
): void {
  const existing = state.causalGraph;
  const status = patch.status ?? existing?.status ?? "active";
  const activeNodeId = patch.clearActiveNode === true ? undefined : patch.activeNodeId ?? existing?.activeNodeId;
  const activeNodeChanged = patch.activeNodeId !== undefined && patch.activeNodeId !== existing?.activeNodeId;
  const activePathEdgeIds = patch.clearActiveNode === true || (activeNodeChanged && patch.activePathEdgeIds === undefined)
    ? []
    : patch.activePathEdgeIds ?? existing?.activePathEdgeIds ?? [];
  state.causalGraph = {
    title: required(patch.title ?? existing?.title, "causalGraph.title"),
    status,
    ...(activeNodeId === undefined ? {} : { activeNodeId }),
    activePathEdgeIds,
    nodes: existing?.nodes ?? [],
    edges: existing?.edges ?? [],
    source: existing?.source ?? source,
  };
}

function replaceCausalGraph(
  state: ResearchWorkflowState,
  replacement: NonNullable<ResearchWorkflowParameters["causalGraphReplacement"]>,
  source: RecordSource,
): void {
  state.causalGraph = {
    title: replacement.title,
    status: replacement.status,
    ...(replacement.activeNodeId === undefined ? {} : { activeNodeId: replacement.activeNodeId }),
    activePathEdgeIds: replacement.activePathEdgeIds,
    nodes: replacement.nodes.map((node) => ({ ...node, source })),
    edges: replacement.edges.map((edge) => ({ ...edge, source })),
    source,
  };
}

function upsertCausalNode(
  graph: ResearchCausalGraph,
  patch: NonNullable<ResearchWorkflowParameters["causalNode"]>,
  source: RecordSource,
): void {
  const index = graph.nodes.findIndex((node) => node.id === patch.id);
  const existing = index === -1 ? undefined : graph.nodes[index];
  const kind = patch.kind ?? existing?.kind;
  const conclusion = patch.conclusion ?? (kind === "conclusion" ? existing?.conclusion : undefined);
  const workItemId = patch.workItemId ?? existing?.workItemId;
  const record: CausalNode = {
    id: patch.id,
    kind: required(kind, "causalNode.kind"),
    title: required(patch.title ?? existing?.title, "causalNode.title"),
    summary: required(patch.summary ?? existing?.summary, "causalNode.summary"),
    status: patch.status ?? existing?.status ?? "proposed",
    ...(conclusion === undefined ? {} : { conclusion }),
    ...(workItemId === undefined ? {} : { workItemId }),
    evidenceRefs: patch.evidenceRefs ?? existing?.evidenceRefs ?? [],
    source: existing?.source ?? source,
    ...(existing === undefined ? {} : { updatedSource: source }),
  };
  if (existing === undefined) graph.nodes.push(record);
  else graph.nodes[index] = record;
}

function upsertCausalEdge(
  graph: ResearchCausalGraph,
  patch: NonNullable<ResearchWorkflowParameters["causalEdge"]>,
  source: RecordSource,
): void {
  const index = graph.edges.findIndex((edge) => edge.id === patch.id);
  const existing = index === -1 ? undefined : graph.edges[index];
  const kind = patch.kind ?? existing?.kind;
  const direction = patch.direction ?? (kind === "motivates" ? existing?.direction : undefined);
  const record: CausalEdge = {
    id: patch.id,
    from: required(patch.from ?? existing?.from, "causalEdge.from"),
    to: required(patch.to ?? existing?.to, "causalEdge.to"),
    kind: required(kind, "causalEdge.kind"),
    ...(direction === undefined ? {} : { direction }),
    source: existing?.source ?? source,
    ...(existing === undefined ? {} : { updatedSource: source }),
  };
  if (existing === undefined) graph.edges.push(record);
  else graph.edges[index] = record;
}

function upsertWorkItem(
  state: ResearchWorkflowState,
  patch: NonNullable<ResearchWorkflowParameters["workItem"]>,
  source: RecordSource,
): void {
  const index = state.workItems.findIndex((item) => item.id === patch.id);
  const existing = index === -1 ? undefined : state.workItems[index];
  const rationale = patch.rationale ?? existing?.rationale;
  const brief = patch.brief === undefined ? existing?.brief : semanticBriefFromPatch(patch.brief, source);
  const objectiveStatus = patch.objectiveStatus ?? existing?.objectiveStatus ?? "proposed";
  const phase = patch.phase ?? existing?.phase ?? "research";
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
): void {
  const index = item.acceptanceCriteria.findIndex((record) => record.id === patch.id);
  const existing = index === -1 ? undefined : item.acceptanceCriteria[index];
  const note = patch.note ?? existing?.note;
  const status = patch.status ?? existing?.status ?? "proposed";
  const record: AcceptanceCriterion = {
    id: patch.id,
    title: required(patch.title ?? existing?.title, "criterion.title"),
    predicate: required(patch.predicate ?? existing?.predicate, "criterion.predicate"),
    status,
    result: patch.result ?? existing?.result ?? "pending",
    ...(note === undefined ? {} : { note }),
    evidenceRefs: patch.evidenceRefs ?? existing?.evidenceRefs ?? [],
    source: existing?.source ?? source,
  };
  if (existing === undefined) item.acceptanceCriteria.push(record);
  else item.acceptanceCriteria[index] = record;
}

function upsertDecision(
  item: ResearchWorkItem,
  patch: NonNullable<ResearchWorkflowParameters["decision"]>,
  source: RecordSource,
): void {
  const index = item.decisions.findIndex((record) => record.id === patch.id);
  const existing = index === -1 ? undefined : item.decisions[index];
  const resolution = patch.resolution ?? (patch.status === "open" ? undefined : existing?.resolution);
  const status = patch.status ?? existing?.status ?? "open";
  const importance = patch.importance ?? existing?.importance;
  const blocking = patch.blocking ?? existing?.blocking;
  const record: DecisionRecord = {
    id: patch.id,
    kind: patch.kind ?? existing?.kind ?? "other",
    question: required(patch.question ?? existing?.question, "decision.question"),
    impact: required(patch.impact ?? existing?.impact, "decision.impact"),
    status,
    ...(importance === undefined ? {} : { importance }),
    ...(blocking === undefined ? {} : { blocking }),
    ...(resolution === undefined ? {} : { resolution }),
    source: existing?.source ?? source,
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
): void {
  const index = item.findings.findIndex((record) => record.id === patch.id);
  const existing = index === -1 ? undefined : item.findings[index];
  const status = patch.status ?? existing?.status ?? "provisional";
  const record: FindingRecord = {
    id: patch.id,
    summary: required(patch.summary ?? existing?.summary, "finding.summary"),
    status,
    evidenceRefs: patch.evidenceRefs ?? existing?.evidenceRefs ?? [],
    source: existing?.source ?? source,
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

  if (recordType === "causal-node") {
    const graph = requireCausalGraph(state);
    const previousLength = graph.nodes.length;
    graph.nodes = graph.nodes.filter((node) => node.id !== recordId);
    if (graph.nodes.length === previousLength) throw new Error(`causal-node ${recordId} does not exist`);
    const removedEdgeIds = new Set(graph.edges.filter((edge) => edge.from === recordId || edge.to === recordId).map((edge) => edge.id));
    graph.edges = graph.edges.filter((edge) => !removedEdgeIds.has(edge.id));
    if (graph.activeNodeId === recordId) delete graph.activeNodeId;
    if (graph.activeNodeId === undefined || graph.activePathEdgeIds.some((id) => removedEdgeIds.has(id))) graph.activePathEdgeIds = [];
    return;
  }
  if (recordType === "causal-edge") {
    const graph = requireCausalGraph(state);
    const previousLength = graph.edges.length;
    graph.edges = graph.edges.filter((edge) => edge.id !== recordId);
    if (graph.edges.length === previousLength) throw new Error(`causal-edge ${recordId} does not exist`);
    if (graph.activePathEdgeIds.includes(recordId)) graph.activePathEdgeIds = [];
    return;
  }

  const item = requireWorkItem(state, required(workItemId, "workItemId"));
  const collection = collectionFor(item, recordType);
  const index = collection.findIndex((record) => record.id === recordId);
  if (index === -1) throw new Error(`${recordType} ${recordId} does not exist in ${item.id}`);
  collection.splice(index, 1);
}

function collectionFor(item: ResearchWorkItem, recordType: Exclude<(typeof recordTypes)[number], "work-item" | "causal-node" | "causal-edge">): { id: string }[] {
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

function requireCausalGraph(state: ResearchWorkflowState): ResearchCausalGraph {
  if (state.causalGraph === undefined) throw new Error("causalGraph does not exist; create it with upsert_causal_graph first");
  return state.causalGraph;
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
  for (const relativePath of [RESEARCH_WORKFLOW_STATE_PATH, LEGACY_RESEARCH_WORKFLOW_STATE_PATH]) {
    const path = resolve(cwd, relativePath);
    try {
      const text = await readFile(path, "utf8");
      const parsed = parseResearchWorkflowStateText(text);
      if (!parsed.ok) throw new Error(`Existing ${relativePath} is invalid: ${parsed.error}`);
      return { state: parsed.state, exists: true };
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") continue;
      throw error;
    }
  }
  return {
    state: { version: 2, updatedAt: new Date().toISOString(), workItems: [] },
    exists: false,
  };
}

async function withWorkflowStateLock<T>(path: string, operation: () => Promise<T>): Promise<T> {
  await mkdir(dirname(path), { recursive: true });
  if (process.platform !== "linux") {
    // withFileMutationQueue still serializes one Pi process. The deployed
    // multi-session service runs on Linux, where the kernel lock below also
    // serializes independent Pi processes without token or stale-lock races.
    return operation();
  }
  const lockProcess = await acquireKernelFileLock(`${path}.mutation-lock`);
  try {
    return await operation();
  } finally {
    lockProcess.stdin.end();
    await waitForLockProcess(lockProcess);
  }
}

function acquireKernelFileLock(lockPath: string): Promise<ChildProcessWithoutNullStreams> {
  return new Promise((resolveLock, rejectLock) => {
    const child = spawn("/usr/bin/flock", ["--exclusive", lockPath, "--", "/bin/sh", "-c", "printf 'LOCKED\\n'; cat >/dev/null"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let settled = false;
    let stdout = "";
    let stderr = "";
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      rejectLock(error);
    };
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (!settled && stdout.includes("LOCKED\n")) {
        settled = true;
        resolveLock(child);
      }
    });
    child.once("error", (error) => { fail(error); });
    child.once("exit", (code) => {
      if (!settled) fail(new Error(`Research Workflow lock process exited before acquisition (${String(code)}): ${stderr.trim()}`));
    });
  });
}

function waitForLockProcess(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null) {
    return child.exitCode === 0
      ? Promise.resolve()
      : Promise.reject(new Error(`Research Workflow lock process exited with code ${String(child.exitCode)}`));
  }
  return new Promise((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("exit", (code) => {
      if (code === 0) resolveExit();
      else rejectExit(new Error(`Research Workflow lock process exited with code ${String(code)}`));
    });
  });
}

async function writeStateAtomically(path: string, state: ResearchWorkflowState): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${String(process.pid)}-${String(Date.now())}`;
  await writeFile(temporaryPath, `${JSON.stringify(state)}\n`, "utf8");
  await rename(temporaryPath, path);
}

type SourceSessionManager = Pick<ExtensionContext["sessionManager"], "getBranch" | "getLeafId" | "getSessionId">;

function sourceFor(ctx: ExtensionContext): RecordSource {
  return sourceForSessionManager(ctx.sessionManager);
}

function sourceForSessionManager(sessionManager: SourceSessionManager): RecordSource {
  const branch = sessionManager.getBranch();
  let entryId = sessionManager.getLeafId() ?? "no-entry";
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index];
    if (entry?.type === "message" && entry.message.role === "user") {
      entryId = entry.id;
      break;
    }
  }
  return {
    kind: "pi",
    ref: `session:${sessionManager.getSessionId()}#${entryId}`,
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
