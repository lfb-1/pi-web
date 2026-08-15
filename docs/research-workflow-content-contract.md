# Research Workflow content contract

Status: Stage 1 prototype contract.

## Decision

PI WEB must render durable structured workflow state. It must not ask a model to reconstruct
research state from chat every time a panel opens. Pi contributes proposed or observed records
through a validated tool; explicit user decisions and runtime evidence remain distinct sources.

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
| Objective and definition of done | Proposed text | User confirmation | User dialog and session reference |
| Acceptance criterion | Proposed predicate | User approval | User dialog and session reference |
| Decision request | Open request | User resolution | User dialog and session reference |
| Run purpose and status | Reported record | Runtime integration in later stages | Session/tool source now; monitor or scheduler event later |
| Artifact | Observed reference | File/log existence where available | Repository, terminal, or monitor source |
| Finding | Provisional interpretation | User acceptance | User dialog plus evidence references |
| Phase | Proposed transition | Completion requires user confirmation | User dialog and acceptance state |

The model can propose and organize content. The model does not gain authority to approve a
criterion, resolve a decision, accept a finding, or authorize follow-up compute. The companion
extension requests a real user confirmation before writing those transitions.

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

The panel is a deterministic projection of the JSON state. It never treats chat prose as an
approved field. Every mutable record includes creation provenance with source kind, source
reference, and timestamp. Authority-bearing records additionally store `authoritySource`; this
prevents a later Pi update from obscuring the user confirmation that approved the transition.

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

interface ResearchWorkItem {
  id: string;
  title: string;
  objective: string;
  objectiveStatus: "proposed" | "confirmed";
  rationale?: string;
  phase: WorkflowPhase;
  definitionOfDone: string;
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
record-specific status fields. The checked TypeScript schema is canonical for the exact shape.

## Pi responsibilities

The companion extension:

1. exposes `research_workflow` to read and update one entity at a time;
2. serializes concurrent mutations through Pi's file mutation queue;
3. validates IDs, enums, required fields, and references before writing;
4. records session-based provenance automatically;
5. requests confirmation for authority-bearing transitions;
6. injects a compact active-work-item summary before each agent turn;
7. leaves invalid existing state untouched and reports the validation error.

Pi should call `get` before an update when current state may have changed. It should update run,
artifact, acceptance, and finding records as an authorized experiment progresses to terminal
analysis. A successful scheduler submission does not complete a work item.

## Browser responsibilities

The browser plugin:

- reads and validates the state through the workspace file helper;
- shows objective, phase, definition of done, acceptance, decisions, runs, findings, artifacts,
  and provenance;
- labels proposed, confirmed, provisional, accepted, reported, and runtime-derived content;
- exposes refresh and prompt-insertion actions;
- does not silently repair or overwrite invalid state.

## Known Stage 1 limitations

- Run status written by the model is labeled as Pi-reported until the experiment monitor emits
  structured runtime events.
- Workspace-local storage does not yet provide a cross-machine attention inbox.
- Machine-profile snapshots and configuration drift remain Stage 2 work.
- The primary Machine → Project → Workspace → Session navigation remains unchanged until the
  product model has been validated on real ParaFM work.
