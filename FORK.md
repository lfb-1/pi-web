# Research-oriented PI WEB fork

This repository is the `lfb-1/pi-web` fork of
[`jmfederico/pi-web`](https://github.com/jmfederico/pi-web). It provides a maintained
foundation for a Pi-only research interface while preserving PI WEB's persistent session
runtime, workspace tools, and upstream compatibility.

## Foundation baseline

- Upstream repository: `jmfederico/pi-web`
- Initial upstream base: `71c2e03` (PI WEB `1.202608.1` plus service-readiness fixes)
- Fork repository: `lfb-1/pi-web`
- Foundation branch: `foundation/research-ui-base`

The npm package name and service commands remain unchanged during this foundation stage.
A package rename or independent release channel should be handled separately from the UI
and rendering changes.

## Foundation changes

### Research-file source viewing

Server-side language detection and client-side CodeMirror highlighting cover additional
formats commonly used in research repositories:

- LaTeX: `.tex`, `.sty`, `.cls`
- C and C++/CUDA: `.c`, `.h`, `.cpp`, `.cc`, `.cxx`, `.hpp`, `.hh`, `.cu`
- Scientific and data languages: `.jl`, `.R`, `.lua`, `.sql`
- Configuration and automation: `.toml`, `.ini`, `.cfg`, `.bash`, `.zsh`, `.yml`, `.yaml`
- Modern JavaScript/TypeScript: `.mjs`, `.cjs`, `.mts`, `.cts`
- Structured documents: `.jsonc`, `.ipynb`, `.markdown`

Legacy CodeMirror modes provide syntax highlighting for formats without a dedicated
CodeMirror 6 language package. They do not provide grammar-level structural folding.

### Chat LaTeX rendering

Chat Markdown renders:

- inline formulas delimited by `$...$`;
- display formulas delimited by `$$...$$`;
- KaTeX MathML for accessibility;
- horizontally scrollable display formulas when a formula exceeds the chat width.

Currency, inline code, and fenced code keep dollar signs as literal text. Invalid or
partially streamed formulas do not break the surrounding message. The chat parser uses an
isolated Marked instance so the KaTeX extension does not change stricter workspace Markdown
preview behavior.

### Voice input

The prompt editor provides Chrome-first speech-to-text through the browser Web Speech API.
Users select Chinese (`zh-CN`) or English (`en-US`), click the microphone to start or stop,
and review the final transcript inserted at the current editor selection before sending.
Interim recognition stays in a status line and does not modify the draft.

The implementation uses `SpeechRecognition` with the Chrome-compatible
`webkitSpeechRecognition` fallback. It does not upload audio through PI WEB, but Chrome may
send audio to its own speech-recognition service. Unsupported browsers, denied microphone
permission, missing audio capture, recognition network failures, and remote HTTP origins receive
explicit guidance. HTTPS or localhost access is recommended for reliable microphone permission.

### Research Workflow prototype

The bundled `research-workflow` plugin adds a workspace panel for objective, definition of
done, acceptance criteria, decisions, runs, findings, artifacts, evidence, and linked runtime
records. The companion `research_workflow` Pi extension writes validated workspace-local state,
records provenance, injects the active objective into Pi turns, and requires an authority dialog
for authority-bearing transitions. Under this fork's user-configured timeout policy, an unanswered
confirmation applies its visibly marked **Yes** recommendation at the deadline.

The Stage 1 state contract is documented in
`docs/research-workflow-content-contract.md`. The prototype uses
`.pi-web/research-workflow.json`; cross-machine attention and runtime-derived experiment state
remain later stages.

### Agent session graph and main-session forks

The right workspace panel is split horizontally: its upper area keeps the selected Git,
Terminal, Research, or other workspace tool, while the lower area shows a zoomable and pannable
session graph. Root sessions and response-level forks form the persistent main-agent lineage.
Each main session's delegated `pi-subagents` and tracked subsessions are folded into that main by
default; selecting a main node toggles its own subagents, while selecting any visible node opens
that session in the middle chat panel.

Assistant text responses in root or forked-main sessions expose a Fork action next to Copy;
subagent and archived chats remain read-only for lineage creation. The action creates and selects
a new main session at that exact Pi session-tree entry, leaving the source session unchanged. A durable
`parentSessionRelation` distinguishes these main forks from subagents across listing, reload,
archive, navigation, and graph projections. The left navigation therefore lists root and forked
main sessions as a nested tree while delegated subagents remain filtered from that panel. Agent
output and tool details retain the existing collapsed-by-default behavior.

### Persistent notification banner

Session notifications use one fixed banner above the chat transcript. Each new update replaces
the banner's visible status in place and reports the retained update count, so periodic experiment
monitor checks do not create a growing stack in the middle panel. The complete bounded notification
history remains available through the banner disclosure and existing clear controls.

### Recommended extension-dialog timeouts

Extension dialogs now default to a one-hour deadline. Confirm dialogs mark **Yes** as the
recommended action, and select dialogs visibly mark their first option as recommended. If no user
answer arrives before the deadline, the session daemon applies that recommendation while retaining
`timeout` as the audited close reason and showing the selected value in the settled card. Input
dialogs have no inferred recommendation and continue to close without text. Explicit cancellation,
**No**, run abort, and runtime replacement remain non-authorizing outcomes.

## Upstream maintenance

The local checkout uses conventional fork remotes:

```text
origin    https://github.com/lfb-1/pi-web.git
upstream  https://github.com/jmfederico/pi-web.git
```

Before merging upstream changes into the derived branch:

```bash
git fetch upstream
git switch foundation/research-ui-base
git merge upstream/main
npm ci
npm run verify
npm run build
```

Resolve changes in Markdown rendering, `FormattedText`, `CodeViewer`, and workspace file
classification with the foundation tests retained.

## Verification contract

Changes to this foundation should keep the following checks passing:

```bash
npm run typecheck
npm run lint
npm run knip
npm test
npm run build
```

The LaTeX contract tests are in
`src/client/src/formatting/markdown.test.ts`. File-language detection tests are in
`src/server/workspaces/fileContentService.read.test.ts`. Voice-input behavior is covered by
`src/client/src/voiceInput.test.ts` and
`src/client/src/components/PromptEditor.voice.test.ts`. Research Workflow parser, panel, and
extension tests are under `pi-web-plugins/research-workflow/` and
`extensions/research-workflow-extension.test.ts`.
