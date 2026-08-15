// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import type { RecordSource, ResearchWorkItem } from "./researchWorkflowState.js";
import {
  renderResearchWorkItem,
  researchWorkflowInitializePrompt,
  researchWorkflowUpdatePrompt,
} from "./researchWorkflowPanelElement.js";

const source: RecordSource = {
  kind: "pi",
  ref: "session:s-1#entry-1",
  at: "2026-08-15T20:00:00.000Z",
};

function workItem(): ResearchWorkItem {
  return {
    id: "parafm.current",
    title: "Evaluate episode-frame transport",
    objective: "Determine whether episode-frame transport improves accuracy.",
    objectiveStatus: "proposed",
    phase: "blocked",
    definitionOfDone: "A preregistered comparison reaches a terminal interpretation.",
    brief: {
      question: "Does episode-frame transport improve CIFAR-10 accuracy?",
      currentAnswer: "Current exploratory evidence shows no improvement.",
      confidence: "medium",
      confidenceReason: "Four seeds agree, but the run was not preregistered.",
      blockedBecause: "The available run cannot satisfy the preregistered gate.",
      nextActionOwner: "user",
      nextAction: "Decide whether to authorize a new confirmation run.",
      recentChange: "The existing run was classified as exploratory evidence.",
      evidenceRefs: ["result.report"],
      source,
    },
    acceptanceCriteria: [],
    decisions: [{
      id: "confirmation.run",
      kind: "follow-up-compute",
      question: "Should a confirmation run be authorized?",
      impact: "This determines whether the blocked question receives confirmatory evidence.",
      status: "open",
      source,
    }],
    runs: [],
    artifacts: [{
      id: "result.report",
      label: "Episode-frame result report",
      kind: "report",
      path: "results/episode/RESULT.md",
      source,
    }],
    findings: [],
    sessions: [],
    workspaces: [],
    source,
  };
}

describe("Research Workflow semantic panel", () => {
  it("puts the human-readable answer before progressive-disclosure details", () => {
    const rendered = renderResearchWorkItem(workItem(), "2026-08-15T20:01:00.000Z");

    expect(rendered.indexOf("Current answer")).toBeGreaterThan(-1);
    expect(rendered.indexOf("Current answer")).toBeLessThan(rendered.indexOf("Why this is the current answer"));
    expect(rendered).toContain("Current exploratory evidence shows no improvement.");
    expect(rendered).toContain("Decide whether to authorize a new confirmation run.");
    expect(rendered).toContain("Based on 1 source");
    expect(rendered).toContain("Episode-frame result report");
  });

  it("opens only the user-decision section by default and labels provenance accurately", () => {
    const rendered = renderResearchWorkItem(workItem(), "2026-08-15T20:01:00.000Z");
    const container = document.createElement("div");
    container.innerHTML = rendered;
    const sections = [...container.querySelectorAll<HTMLDetailsElement>("details.workflow-section")];
    const decisionSection = sections.find((section) => section.querySelector("summary")?.textContent.includes("Needs your decision") === true);
    const explanationSection = sections.find((section) => section.querySelector("summary")?.textContent.includes("Why this is the current answer") === true);

    expect(decisionSection?.open).toBe(true);
    expect(explanationSection?.open).toBe(false);
    expect(sections.filter((section) => section.open)).toHaveLength(1);
    expect(rendered).toContain("Recorded by pi");
    expect(rendered).not.toContain("Source:");
  });

  it("states when optional blocker and recent-change summaries are absent", () => {
    const item = workItem();
    const brief = item.brief;
    if (brief === undefined) throw new Error("expected brief");
    delete brief.blockedBecause;
    delete brief.recentChange;

    const rendered = renderResearchWorkItem(item, "2026-08-15T20:01:00.000Z");

    expect(rendered).toContain("No blocker recorded in the semantic brief.");
    expect(rendered).toContain("No recent material change recorded.");
  });

  it("keeps legacy work items readable while asking Pi for a semantic summary", () => {
    const item = workItem();
    delete item.brief;

    const rendered = renderResearchWorkItem(item, "2026-08-15T20:01:00.000Z");

    expect(rendered).toContain("Plain-language summary not generated yet.");
    expect(rendered).toContain(item.objective);
  });

  it("asks Pi to rewrite source material semantically", () => {
    const initialize = researchWorkflowInitializePrompt();
    const update = researchWorkflowUpdatePrompt(workItem());

    expect(initialize).toContain("plain-language semantic synthesis");
    expect(update).toContain("instead of copying source text");
    expect(update).toContain("one concrete next action and owner");
  });
});
