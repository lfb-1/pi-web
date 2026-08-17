import { describe, expect, it } from "vitest";
import { activeCausalPath, layoutResearchCausalGraph } from "./researchCausalGraph.js";
import type { RecordSource, ResearchCausalGraph } from "./researchWorkflowState.js";

const source: RecordSource = { kind: "pi", ref: "session:test#entry", at: "2026-08-17T00:00:00.000Z" };

function graph(): ResearchCausalGraph {
  return {
    title: "Research idea",
    status: "active",
    activeNodeId: "hypothesis.next",
    activePathEdgeIds: ["tests", "produces", "concludes", "motivates"],
    nodes: [
      { id: "hypothesis.one", kind: "hypothesis", title: "H1", summary: "First hypothesis", status: "completed", evidenceRefs: [], source },
      { id: "validation.one", kind: "validation", title: "V1", summary: "First validation", status: "completed", evidenceRefs: [], source },
      { id: "analysis.one", kind: "analysis", title: "A1", summary: "First analysis", status: "completed", evidenceRefs: ["item/finding:one"], source },
      { id: "conclusion.one", kind: "conclusion", title: "C1", summary: "First conclusion", status: "completed", conclusion: "denied", evidenceRefs: ["item/finding:one"], source },
      { id: "conclusion.parallel", kind: "conclusion", title: "C2", summary: "Parallel conclusion", status: "completed", conclusion: "unsure", evidenceRefs: ["item/finding:one"], source },
      { id: "hypothesis.next", kind: "hypothesis", title: "H2", summary: "Merged next hypothesis", status: "active", evidenceRefs: [], source },
    ],
    edges: [
      { id: "tests", from: "hypothesis.one", to: "validation.one", kind: "tests", source },
      { id: "produces", from: "validation.one", to: "analysis.one", kind: "produces", source },
      { id: "concludes", from: "analysis.one", to: "conclusion.one", kind: "concludes", source },
      { id: "motivates", from: "conclusion.one", to: "hypothesis.next", kind: "motivates", direction: "Revise the mechanism", source },
      { id: "merges", from: "conclusion.parallel", to: "hypothesis.next", kind: "motivates", direction: "Resolve the parallel uncertainty", source },
    ],
    source,
  };
}

describe("research causal graph layout", () => {
  it("places each causal edge left-to-right and supports a merged hypothesis", () => {
    const layout = layoutResearchCausalGraph(graph());
    const positions = new Map(layout.nodes.map((entry) => [entry.node.id, entry]));

    for (const edge of graph().edges) {
      expect((positions.get(edge.from)?.x ?? 0) < (positions.get(edge.to)?.x ?? 0)).toBe(true);
    }
    expect(layout.edges.filter((entry) => entry.edge.to === "hypothesis.next")).toHaveLength(2);
    expect(layout.width).toBeGreaterThan(1000);
  });

  it("does not synthesize links across locally hidden nodes", () => {
    const layout = layoutResearchCausalGraph(graph(), new Set(["analysis.one"]));

    expect(layout.nodes.some((entry) => entry.node.id === "analysis.one")).toBe(false);
    expect(layout.edges.some((entry) => entry.edge.id === "produces" || entry.edge.id === "concludes")).toBe(false);
  });

  it("highlights only the explicit active path rather than every merge ancestor", () => {
    const path = activeCausalPath(graph());

    expect(path.nodeIds).toContain("conclusion.one");
    expect(path.nodeIds).not.toContain("conclusion.parallel");
    expect(path.edgeIds).toEqual(new Set(["tests", "produces", "concludes", "motivates"]));
  });
});
