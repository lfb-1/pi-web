# PI-only workflow interface analysis

Status: initial product and architecture analysis for review.

## Research decision

PI WEB already provides reliable persistent sessions, real workspaces, machine federation,
files, Git, terminals, and responsive browser access. A PI-only research workflow requires
additional persistent state for research intent, decisions, long-running execution, evidence,
and effective agent configuration. These concepts currently exist mainly in chat transcripts,
notifications, repository files, and external schedulers.

The first redesign objective is to make the complete research lifecycle inspectable and
controllable without reducing the existing coding-agent capabilities.

## Current evidence

A live ParaFM workspace has demonstrated the scaling pressure:

- 37 workspaces, including 36 legacy execution worktrees;
- 137 sessions in the main workspace;
- 44,487 messages;
- a largest session with 5,071 messages;
- Slurm progress represented as chat notifications rather than durable run state.

The current primary hierarchy is:

```text
Machine -> Project -> Workspace -> Session
```

This hierarchy accurately represents runtime topology. It does not directly represent the
research question, accepted plan, decision boundary, experiment, acceptance gate, or finding.

## Product principles

1. **Objective-first context** — every active work item exposes the objective, rationale,
   definition of done, and current decision.
2. **Research-loose, execution-strict behavior** — exploration can propose hypotheses and
   discriminating tests; approved execution makes result-affecting ambiguity visible and waits
   for confirmation.
3. **End-to-end execution semantics** — run and submit operations include monitoring,
   collection, evaluation, interpretation, and reporting.
4. **Chat plus structured state** — conversation remains the primary interaction channel;
   durable workflow state is independently inspectable and does not require transcript search.
5. **Evidence-linked conclusions** — findings link to metrics, logs, artifacts, code revisions,
   and acceptance criteria.
6. **Distributed configuration visibility** — every machine reports the effective Pi version,
   instruction chain, skills, extensions, and configuration drift.
7. **Progressive disclosure** — research meaning and decisions remain prominent; tool traces,
   worktrees, and low-level runtime details remain available on demand.
8. **No hidden follow-up authorization** — result interpretation does not authorize additional
   compute.

## Proposed product model

```ts
type WorkflowPhase =
  | "research"
  | "planning"
  | "awaiting-approval"
  | "executing"
  | "waiting"
  | "reviewing-results"
  | "completed"
  | "blocked";

interface ResearchWorkItem {
  id: string;
  title: string;
  objective: string;
  rationale?: string;
  phase: WorkflowPhase;
  definitionOfDone: string;
  acceptanceCriteria: AcceptanceCriterion[];
  sessions: SessionRef[];
  workspaces: WorkspaceRef[];
  runs: RunRef[];
  decisions: DecisionRef[];
  artifacts: ArtifactRef[];
  findings: FindingRef[];
}

interface RunRecord {
  id: string;
  kind: "pi-session" | "subsession" | "terminal" | "slurm" | "external";
  status: "queued" | "running" | "waiting" | "succeeded" | "failed" | "cancelled";
  purpose: string;
  startedAt?: string;
  finishedAt?: string;
  acceptanceResults: AcceptanceResult[];
  artifactRefs: string[];
}

interface DecisionRequest {
  id: string;
  kind: "config-approval" | "ambiguity" | "result-acceptance" | "follow-up-compute";
  question: string;
  impact: string;
  status: "open" | "resolved" | "void";
  resolution?: string;
}

interface MachineProfileSnapshot {
  machineId: string;
  piVersion: string;
  piWebVersion: string;
  instructionFiles: Array<{ path: string; digest: string }>;
  skills: Array<{ name: string; digest: string }>;
  extensions: Array<{ name: string; digest: string; diagnostics: string[] }>;
  canonicalProfileDrift: string[];
}
```

Operational state should ultimately live in PI WEB's data directory. Durable scientific findings
and approved plans can additionally export to tracked repository files. The Stage 1 prototype
uses `.pi-web/research-workflow.json` because the current server-plugin backend is available only
to the plugin that owns a workspace; claiming a Git workspace solely for state storage would
replace its Git provider. The ownership and authority rules are defined in
[`research-workflow-content-contract.md`](research-workflow-content-contract.md).

## Proposed information architecture

### Global level

- attention inbox across machines;
- open decision requests;
- active and recently completed runs;
- machine health and agent-profile drift;
- research work items grouped by phase and priority.

### Work-item level

- persistent objective and definition-of-done header;
- conversation and structured activity timeline;
- current plan and approval state;
- experiment/run table;
- findings and evidence;
- linked sessions, workspaces, files, Git state, and terminals.

### Runtime level

Machine, project, workspace, worktree, session, terminal, and tool-event details remain
available as secondary operational views.

## Initial desktop layout hypothesis

```text
+----------------------+--------------------------------+------------------------+
| Work items           | Objective + conversation       | Inspector              |
| Open decisions       | Current phase and decision     | Runs / evidence        |
| Active runs          | Structured activity timeline   | Files / Git / terminal |
| Machine drift        | Prompt and model controls      | Session details        |
+----------------------+--------------------------------+------------------------+
```

The right panel should allocate width according to its selected content and support a compact
state. The conversation should receive the largest default reading width.

## Configuration parity requirement

A PI-only distributed workflow needs an answer to: "Which instructions and capabilities did
this machine actually load?" The machine view should expose:

- Pi and PI WEB versions;
- effective `PI_CODING_AGENT_DIR` and session directory;
- ordered instruction files and digests;
- loaded skills and digests;
- loaded extensions, diagnostics, and disabled resources;
- model/provider availability;
- comparison with a selected canonical profile.

Configuration drift should create an actionable warning before an execution starts when the
drift can change results.

## Prototype strategy

### Stage 0 — configuration and event inventory

Document the effective data available from machine status, session status, asks, extension
dialogs, notifications, terminal command runs, workspace providers, and experiment-monitor
records. Define stable identifiers and ownership boundaries.

### Stage 1 — `Research Workflow` plugin

Use browser plugin API v2 to add a workspace panel and actions backed by validated
workspace-local state plus a companion Pi extension. Validate:

- work-item creation and phase transitions;
- objective, acceptance criteria, and linked sessions;
- decision requests;
- run records and artifact links;
- machine-profile snapshots.

The plugin prototype can validate the data model without immediately replacing the application
shell. Current plugin APIs cannot reorganize primary navigation or add persistent content to the
chat header, so successful concepts will require core changes.

### Stage 2 — attention inbox and run lifecycle

Unify asks, extension dialogs, experiment states, failures, and completed results into one
prioritized inbox. Convert repeated scheduler notifications into updates to a durable run record.

### Stage 3 — core shell redesign

After the product model is validated, make work items the primary navigation entity, add the
objective/phase header to chat, and move runtime topology into secondary views.

### Stage 4 — durable research orchestration

Connect submission, monitoring, artifact collection, acceptance evaluation, interpretation, and
reporting. Preserve explicit authorization for follow-up compute.

## Validation plan

Test the prototype on real ParaFM workflows and measure:

- time required to identify the current objective and next decision;
- time required to identify every active experiment and its purpose;
- percentage of submitted experiments with terminal collection and acceptance results;
- number of visible session rows required for routine supervision;
- frequency of duplicate scheduler notifications;
- configuration-drift detection before execution;
- completion rate for user decisions presented through the attention inbox;
- regressions in ordinary file, Git, terminal, and chat tasks.

## Open decisions

1. Whether work items are machine-local, federated, or replicated through a designated gateway.
2. Which state belongs in PI WEB data storage and which state should export to the repository.
3. Whether a session can belong to multiple work items.
4. How experiment-monitor records receive stable work-item and acceptance-criterion identifiers.
5. Which configuration differences should block execution and which should remain warnings.
6. Whether the first prototype targets only research repositories or remains generic through
   configurable work-item types.
