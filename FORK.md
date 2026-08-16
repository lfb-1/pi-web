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
records provenance, injects the active objective into Pi turns, and requires a user dialog for
authority-bearing transitions.

The Stage 1 state contract is documented in
`docs/research-workflow-content-contract.md`. The prototype uses
`.pi-web/research-workflow.json`; cross-machine attention and runtime-derived experiment state
remain later stages.

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
