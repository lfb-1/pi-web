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
`src/server/workspaces/fileContentService.read.test.ts`.
