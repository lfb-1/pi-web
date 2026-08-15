// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { renderWorkspaceMarkdownHtml } from "./workspaceMarkdown";
import { toSafeMarkdownHtml } from "./markdown";

describe("chat Markdown LaTeX rendering", () => {
  it("renders inline and display formulas with accessible KaTeX markup", () => {
    const root = parseHtml(toSafeMarkdownHtml(`Inline: $E = mc^2$.

$$
\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}
$$`));

    expect(root.querySelectorAll(".katex")).toHaveLength(2);
    expect(root.querySelector(".katex-display")).not.toBeNull();
    expect([...root.querySelectorAll("annotation[encoding='application/x-tex']")].map((node) => node.textContent)).toEqual([
      "E = mc^2",
      "\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}",
    ]);
  });

  it("leaves currency, inline code, and fenced code as literal text", () => {
    const root = parseHtml(toSafeMarkdownHtml(`A range from $5 to $10 remains currency.

Inline code: \`$x^2$\`.

\`\`\`latex
$$
x^2
$$
\`\`\``));

    expect(root.querySelector(".katex")).toBeNull();
    expect(root.textContent).toContain("$5 to $10");
    expect(root.querySelector("code")?.textContent).toBe("$x^2$");
    expect(root.querySelector("pre code")?.textContent).toContain("$$\nx^2\n$$");
  });

  it("does not fail the message when streamed or invalid math is incomplete", () => {
    expect(() => toSafeMarkdownHtml("Still streaming: $\\frac{1}{")).not.toThrow();
    const root = parseHtml(toSafeMarkdownHtml("Invalid: $\\notARealCommand{x}$"));

    expect(root.textContent).toContain("\\notARealCommand{x}");
  });

  it("does not leak the chat KaTeX extension into workspace Markdown previews", () => {
    const root = parseHtml(renderWorkspaceMarkdownHtml("Workspace source keeps $x^2$ literal."));

    expect(root.querySelector(".katex")).toBeNull();
    expect(root.textContent).toContain("$x^2$");
  });
});

function parseHtml(html: string): DocumentFragment {
  const template = document.createElement("template");
  template.innerHTML = html;
  return template.content;
}
