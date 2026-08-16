# Research Workflow content contract

Status: Stage 1 prototype contract.

## Decision

PI WEB must render durable structured workflow state. It must not ask a model to reconstruct
research state from chat every time a panel opens. Pi contributes proposed or observed records
through a validated tool and writes a plain-language semantic brief for human understanding;
explicit user decisions and runtime evidence remain distinct sources.

The Stage 1 prototype stores workspace-local operational state at:

```text
.pi-web/research-workflow.json
```

This location lets the browser plugin and the Pi extension use the same file through their
supported APIs. Projects may ignore the file when the state should remain local. Accepted plans,
findings, and evidence continue to be exported to the repository paths required by each
project's process rules.

PI WEB data-directory storage remains the target after a general server-plugin state API exists.
The current server-plugin backend is available only to the plugin that owns a workspace. Making
the prototype a workspace provider would displace the Git provider, so Stage 1 uses a
browser-only panel and a Pi extension instead.

## Content authority

| Content | Pi may create | Authority transition | Verification source |
| --- | --- | --- | --- |
| Semantic brief | Evidence-backed plain-language interpretation | No authority transition | Evidence references and Pi session source |
| Objective and definition of done | Proposed text | User confirmation | User dialog and session reference |
| Acceptance criterion | Proposed predicate | User approval | User dialog and session reference |
| Decision request | Open request | User resolution | User dialog and session reference |
| Run purpose and status | Reported record | Runtime integration in later stages | Session/tool source now; monitor or scheduler event later |
| Artifact | Observed reference | File/log existence where available | Repository, terminal, or monitor source |
| Finding | Provisional interpretation | User acceptance | User dialog plus evidence references |
| Phase | Proposed transition | Completion requires user confirmation | User dialog and acceptance state |

The model can propose and organize content. The model does not gain authority to approve a
criterion, resolve a decision, accept a finding, or authorize follow-up compute. The companion
extension opens an authority dialog before writing those transitions. A direct user answer controls
the result; when the host has a user-delegated recommended-timeout policy, an unanswered dialog may
apply that visibly identified recommendation at the configured deadline. The settled dialog retains
the timeout reason for auditability.

## Data flow

```text
user instruction / canonical project files / runtime evidence
                         |
                         v
                 Pi reasoning session
                         |
              research_workflow tool
                         |
       schema validation + authority confirmation
                         |
                         v
          .pi-web/research-workflow.json
                         |
                         v
             Research Workflow panel
```

The panel is a deterministic projection of the JSON state. Semantic reasoning occurs when Pi
updates the durable brief, not when the panel opens. It never treats chat prose as an approved
field. Every mutable record includes creation provenance with source kind, source reference, and
timestamp. Authority-bearing records additionally store `authoritySource`; this prevents a later
Pi update from obscuring the user-owned dialog policy that approved the transition. Because Pi's
`ctx.ui` API returns only the selected primitive, durable records conservatively label the mode as
`dialog-or-recommended-timeout-policy`; the browser-local settled card provides the more specific
`Answered` or `Timed out` outcome while it remains available.

## Stable identity

- Work-item and child-record IDs match `^[a-z][a-z0-9.-]*$`.
- IDs remain stable when titles, status, or interpretation change.
- Session, workspace, Slurm job, terminal, artifact, and acceptance references use their native
  identifiers when available.
- Child references are scoped to one work item in Stage 1.
- A session can be referenced by several work items; the prototype does not infer that relation.

## Prototype state

```ts
interface ResearchWorkflowState {
  version: 1;
  updatedAt: string;
  activeWorkItemId?: string;
  workItems: ResearchWorkItem[];
}

interface ResearchBrief {
  question: string;
  currentAnswer: string;
  confidence: "low" | "medium" | "high";
  confidenceReason: string;
  blockedBecause?: string;
  nextActionOwner: "user" | "pi" | "runtime" | "none";
  nextAction: string;
  recentChange?: string;
  evidenceRefs: string[];
  source: RecordSource;
}

interface ResearchWorkItem {
  id: string;
  title: string;
  objective: string;
  objectiveStatus: "proposed" | "confirmed";
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
```

Acceptance criteria, decisions, runs, artifacts, findings, and references use stable IDs and
record-specific status fields. `brief` remains optional for version-1 compatibility. It is a
model-generated reading aid and does not approve criteria, accept findings, resolve decisions,
or authorize compute. The checked TypeScript schema is canonical for the exact shape.

## Semantic brief contract

Pi rewrites source material rather than copying project paragraphs into the first screen:

- `question` is one plain-language sentence;
- `currentAnswer` leads with the answer and uses at most three short sentences;
- `confidenceReason` states both the strongest support and the main limitation;
- `blockedBecause` contains only the direct reason progress cannot continue;
- `nextAction` contains one concrete action and names its owner through `nextActionOwner`;
- `recentChange` records one material change and is omitted when nothing changed;
- external paths and URLs first receive labeled artifact records; brief `evidenceRefs` contain only
  artifact, criterion, decision, or run IDs that resolve inside the work item;
- provisional evidence keeps explicit uncertainty language.

The panel presents the brief first and keeps criteria, runs, detailed findings, raw paths, and
provenance behind progressive disclosure. Session provenance is labeled `Recorded by`;
`evidenceRefs` are the content sources; user authority is labeled `Confirmed by`.

## Pi responsibilities

The companion extension:

1. exposes `research_workflow` to read and update one entity at a time;
2. serializes concurrent mutations through Pi's file mutation queue;
3. validates IDs, enums, required fields, semantic-brief length bounds, and references before writing;
4. records session-based provenance automatically and refreshes brief provenance on every rewrite;
5. evaluates authority transitions against the latest queued state and requests confirmation before
   changing, downgrading, or removing authority-bearing content;
6. injects the semantic brief, open decisions, and active runs before each agent turn;
7. asks Pi to refresh the brief after material detailed-record changes;
8. leaves invalid existing state untouched and reports the validation error.

Pi should call `get` before an update when current state may have changed. It should update run,
artifact, acceptance, and finding records as an authorized experiment progresses to terminal
analysis. A successful scheduler submission does not complete a work item.

## Browser responsibilities

The browser plugin:

- reads and validates the state through the workspace file helper;
- shows the research question, current answer, confidence, blocker, next action, and recent change
  as a 30-second executive view;
- keeps objective, definition of done, acceptance, decisions, runs, findings, artifacts, and raw
  provenance available through progressive disclosure;
- labels proposed, confirmed, provisional, accepted, reported, and runtime-derived content;
- exposes refresh and prompt-insertion actions;
- does not silently repair or overwrite invalid state.

## Known Stage 1 limitations

- The semantic brief requires an explicit Pi update and may temporarily lag detailed records;
  Stage 1 does not include file watching or automatic reconciliation.
- Confidence is a model interpretation accompanied by a reason and evidence references; it is not
  an authority state.
- Run status written by the model is labeled as Pi-reported until the experiment monitor emits
  structured runtime events.
- Workspace-local storage does not yet provide a cross-machine attention inbox.
- Machine-profile snapshots and configuration drift remain Stage 2 work.
- The primary Machine → Project → Workspace → Session navigation remains unchanged until the
  product model has been validated on real ParaFM work.
