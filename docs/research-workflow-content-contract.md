# Research Workflow content contract

Status: Stage 2 causal-canvas contract.

## Decision

PI WEB renders durable structured research state and does not ask a model to reconstruct the
research history whenever the panel opens. The first screen is a causal canvas for the overall
research idea. Pi maintains the canvas when a hypothesis, validation, analysis, conclusion, or
next direction changes. Detailed criteria, runs, artifacts, findings, and provenance remain durable
but stay outside the graph.

Workspace-local version-2 state is stored at:

```text
.pi-web/research-workflow-v2.json
```

The legacy version-1 path `.pi-web/research-workflow.json` remains a read-only migration source.
Using a separate version-2 path prevents a long-running version-1 extension from deleting the
causal graph when it writes its older schema.

The browser plugin and Pi extension share this file through their supported APIs. The browser is a
deterministic projection. Semantic interpretation occurs during a Pi turn and is written through
the validated `research_workflow` tool.

## Causal model

The graph is a directed acyclic graph (DAG) with a strict stage chain:

```text
Hypothesis --tests--> Validation --produces--> Analysis --concludes--> Conclusion
                                                                        |
                                                    motivates + direction
                                                                        v
                                                                  Hypothesis
```

Branches and merges are supported. A conclusion can motivate several hypotheses, and several
conclusions can motivate one hypothesis. The graph does not infer links from chronology. When the
causal relationship is unsupported, histories remain separate roots.

The canvas shows only:

- hypothesis and research motivation;
- validation purpose and status, without code or configuration detail;
- short analysis, without metric tables or result dumps;
- a scoped Pi interpretation of `confirmed`, `denied`, or `unsure`;
- the causal direction that motivates a new hypothesis.

Graph conclusions are evidence-backed Pi interpretations. They do not confirm the research
objective, approve evaluation criteria, authorize compute, accept a durable finding, or mark the
overall idea completed.

## Attention and automatic execution

The Research Workflow extension does not open authority dialogs. Every schema-valid mutation runs
automatically, including objective and criterion maintenance, decision resolution, finding
promotion, graph completion or reopening, and durable-record removal.

Only an open decision with `importance: "critical"` or `blocking: true` appears in the Research
badge and critical-question banner. This is attention state rather than an execution gate. Pi uses
it when the research record should make one of these conditions visible:

- a scientific-direction choice that cannot be inferred;
- substantial compute that still needs an answer in the surrounding agent workflow;
- necessary missing information;
- an irreversible or destructive action.

The record pipeline continues automatically once the needed answer is available. It does not
create a second Workflow authority confirmation. Legacy `authoritySource` fields remain readable
for provenance compatibility, but version 2 does not require them for any state transition.

## State versions and migration

Version 2 introduces the top-level causal graph and decision-attention metadata. The parser accepts
version 1 and version 2. When the version-2 file is absent, the browser and extension read the
legacy version-1 file and migrate it to the version-2 in-memory shape without inventing a graph.
The first validated mutation writes the separate version-2 file. Older extensions can continue to
write only the legacy path and therefore cannot overwrite or delete the causal graph.

```ts
interface ResearchWorkflowState {
  version: 2;
  updatedAt: string;
  activeWorkItemId?: string;
  causalGraph?: ResearchCausalGraph;
  workItems: ResearchWorkItem[];
}

interface ResearchCausalGraph {
  title: string;
  status: "active" | "completed";
  activeNodeId?: string;
  activePathEdgeIds: string[];
  nodes: CausalNode[];
  edges: CausalEdge[];
  source: RecordSource;
  authoritySource?: RecordSource;
}

interface CausalNode {
  id: string;
  kind: "hypothesis" | "validation" | "analysis" | "conclusion";
  title: string;
  summary: string;
  status: "proposed" | "active" | "completed" | "blocked" | "abandoned";
  conclusion?: "confirmed" | "denied" | "unsure";
  workItemId?: string;
  evidenceRefs: string[];
  source: RecordSource;
  updatedSource?: RecordSource;
}

interface CausalEdge {
  id: string;
  from: string;
  to: string;
  kind: "tests" | "produces" | "concludes" | "motivates";
  direction?: string;
  source: RecordSource;
  updatedSource?: RecordSource;
}
```

`direction` is required only for `motivates`. A conclusion value is required only for conclusion
nodes. Completed analysis and conclusion nodes require at least one typed evidence reference.

## Evidence and provenance

Graph evidence references are typed and workspace-local:

```text
<workItemId>/run:<id>
<workItemId>/artifact:<id>
<workItemId>/finding:<id>
<workItemId>/criterion:<id>
<workItemId>/decision:<id>
```

The parser resolves every typed reference against the detailed record. Node and edge creation
provenance is immutable in `source`; later rewrites update `updatedSource`. This keeps automatic
maintenance auditable without putting paths, job IDs, or raw evidence on the canvas.

The graph is bounded to 256 nodes and 512 edges. IDs remain stable and match
`^[a-z][a-z0-9.-]*$`. The parser rejects duplicate IDs, missing endpoints, invalid stage transitions,
self-links, cycles, unresolved evidence references, and malformed active paths.

`replace_causal_graph` supports an intentional wholesale projection reset or compaction. The caller
provides the complete replacement graph in one tool mutation; the extension injects provenance,
validates the full DAG and evidence references, and atomically replaces only the graph while
preserving detailed work-item records. This avoids hundreds of incremental removals and prevents an
intermediate partial graph from becoming durable.

`activePathEdgeIds` is an optional ordered emphasis path represented as an array that may be empty.
When present, its edges must form one continuous path ending at `activeNodeId`. In a merged DAG the
browser does not select an ancestor path itself. Without a persisted path it highlights only the
active node. A completed graph has no active node or path and may contain only completed or
abandoned nodes.

## Canvas behavior

The Research panel:

- uses a deterministic layered left-to-right DAG layout;
- supports pointer drag, wheel pan, Ctrl/Command-wheel zoom, zoom buttons, fit, and active-node
  focus;
- opens a concise node inspector for interpretation, next direction, and evidence-link count;
- lets the user insert a targeted correction prompt for Pi;
- supports workspace-scoped local hiding and restore without creating synthetic edges;
- keeps operational record counts behind a secondary disclosure;
- shows only critical blocking decisions in the badge and attention banner;
- never calls a model merely because the panel opened.

If a version-1 or version-2 state has no graph, the panel displays an explicit empty state and an
instruction to ask Pi to build a conservative DAG from durable records. The browser never invents a
migration graph.

## Pi responsibilities

The companion extension:

1. reads version 2 first, then validates the legacy state only when version 2 is absent;
2. upgrades version 1 into the separate version-2 file on the first write;
3. maintains causal graph nodes and edges automatically as the scientific cycle advances, and uses
   `replace_causal_graph` only for an intentional complete projection reset or compaction;
4. keeps graph text concise and detailed evidence in work-item records;
5. records typed evidence and provenance;
6. rejects invalid stage transitions, cycles, missing references, and invalid active paths;
7. proceeds automatically for every schema-valid record mutation;
8. opens no Workflow authority dialog and keeps critical blockers as visible attention state;
9. records terminal experiments through analysis and conclusion rather than stopping at submission.

## Browser responsibilities

The browser plugin:

- deterministically reads and validates the state through the workspace file helper;
- renders the causal canvas as the first screen;
- distinguishes concise Pi interpretations from detailed durable workflow records;
- avoids displaying code, raw paths, job metadata, or long results on graph nodes;
- keeps traceability available through the node inspector and operational index;
- never repairs or overwrites invalid state.

## Known limitations

- Graph maintenance occurs during Pi turns; there is no independent file watcher or model call from
  the panel.
- Local node hiding is presentation state and does not change the shared graph.
- Detailed runtime truth still depends on Pi, the experiment monitor, or later structured monitor
  integration updating the durable records.
- The deterministic layout is designed for the bounded graph size; very dense merge structures may
  still require local hiding or active-node focus.
