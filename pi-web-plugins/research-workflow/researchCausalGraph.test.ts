import { describe, expect, it } from "vitest";
import {
  activeCausalPath,
  CAUSAL_CONCLUSION_NODE_HEIGHT,
  CAUSAL_NODE_HEIGHT,
  CAUSAL_NODE_WIDTH,
  layoutResearchCausalGraph,
} from "./researchCausalGraph.js";
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

function stackedStageGraph(): ResearchCausalGraph {
  const causalGraph = structuredClone(graph());
  causalGraph.edges.push({
    id: "concludes.parallel",
    from: "analysis.one",
    to: "conclusion.parallel",
    kind: "concludes",
    source,
  });
  return causalGraph;
}

function segmentIntersectsNode(
  start: { x: number; y: number },
  end: { x: number; y: number },
  positioned: ReturnType<typeof layoutResearchCausalGraph>["nodes"][number],
): boolean {
  const left = positioned.x;
  const right = positioned.x + CAUSAL_NODE_WIDTH;
  const top = positioned.y;
  const bottom = positioned.y + positioned.height;
  if (start.x === end.x) {
    return start.x > left && start.x < right && Math.max(start.y, end.y) > top && Math.min(start.y, end.y) < bottom;
  }
  if (start.y === end.y) {
    return start.y > top && start.y < bottom && Math.max(start.x, end.x) > left && Math.min(start.x, end.x) < right;
  }
  throw new Error("motivates routes must use orthogonal segments");
}

function longGraph(iterationCount: number): ResearchCausalGraph {
  const nodes: ResearchCausalGraph["nodes"] = [];
  const edges: ResearchCausalGraph["edges"] = [];
  const activePathEdgeIds: string[] = [];
  for (let index = 0; index < iterationCount; index += 1) {
    const prefix = `iteration-${String(index)}`;
    const nodeIds = ["hypothesis", "validation", "analysis", "conclusion"].map((kind) => `${prefix}.${kind}`);
    nodes.push(
      { id: nodeIds[0] ?? "", kind: "hypothesis", title: `H${String(index)}`, summary: "Hypothesis", status: "completed", evidenceRefs: [], source },
      { id: nodeIds[1] ?? "", kind: "validation", title: `V${String(index)}`, summary: "Validation", status: "completed", evidenceRefs: [], source },
      { id: nodeIds[2] ?? "", kind: "analysis", title: `A${String(index)}`, summary: "Analysis", status: "completed", evidenceRefs: [], source },
      { id: nodeIds[3] ?? "", kind: "conclusion", title: `C${String(index)}`, summary: "Conclusion", status: "completed", conclusion: "unsure", evidenceRefs: [], source },
    );
    const stageEdges: ResearchCausalGraph["edges"] = [
      { id: `${prefix}.tests`, from: nodeIds[0] ?? "", to: nodeIds[1] ?? "", kind: "tests", source },
      { id: `${prefix}.produces`, from: nodeIds[1] ?? "", to: nodeIds[2] ?? "", kind: "produces", source },
      { id: `${prefix}.concludes`, from: nodeIds[2] ?? "", to: nodeIds[3] ?? "", kind: "concludes", source },
    ];
    if (index > 0) {
      const motivates = {
        id: `${prefix}.motivates`,
        from: `iteration-${String(index - 1)}.conclusion`,
        to: nodeIds[0] ?? "",
        kind: "motivates" as const,
        direction: "Continue with the next hypothesis",
        source,
      };
      edges.push(motivates);
      activePathEdgeIds.push(motivates.id);
    }
    edges.push(...stageEdges);
    activePathEdgeIds.push(...stageEdges.map((edge) => edge.id));
  }
  return {
    title: "Long research history",
    status: "active",
    activeNodeId: `iteration-${String(iterationCount - 1)}.conclusion`,
    activePathEdgeIds,
    nodes,
    edges,
    source,
  };
}

describe("research causal graph layout", () => {
  it("uses semantic stage columns and places motivated hypotheses on later rows", () => {
    const causalGraph = graph();
    const layout = layoutResearchCausalGraph(causalGraph);
    const positions = new Map(layout.nodes.map((entry) => [entry.node.id, entry]));

    for (const edge of causalGraph.edges) {
      const from = positions.get(edge.from);
      const to = positions.get(edge.to);
      if (edge.kind === "motivates") expect((from?.y ?? 0) < (to?.y ?? 0)).toBe(true);
      else {
        expect((from?.y ?? 0) + (from?.height ?? 0) / 2).toBe((to?.y ?? 0) + (to?.height ?? 0) / 2);
        expect((from?.x ?? 0) < (to?.x ?? 0)).toBe(true);
      }
    }
    expect(layout.edges.filter((entry) => entry.edge.to === "hypothesis.next")).toHaveLength(2);
    expect(layout.width).toBeGreaterThan(1000);
    expect(layout.width).toBeLessThan(1600);
  });

  it("routes fan-out and merge edges through gutters instead of intermediate nodes", () => {
    for (const causalGraph of [graph(), stackedStageGraph()]) {
      const layout = layoutResearchCausalGraph(causalGraph);
      const motivatedEdges = layout.edges.filter((entry) => entry.edge.kind === "motivates");

      for (const edge of motivatedEdges) {
        const points = edge.routePoints ?? [];
        expect(points.length).toBeGreaterThan(2);
        for (let index = 1; index < points.length; index += 1) {
          const start = points[index - 1];
          const end = points[index];
          if (start === undefined || end === undefined) continue;
          for (const positioned of layout.nodes) {
            if (positioned.node.id === edge.edge.from || positioned.node.id === edge.edge.to) continue;
            expect(segmentIntersectsNode(start, end, positioned)).toBe(false);
          }
        }
      }
    }
  });

  it("keeps a long research history four columns wide", () => {
    const causalGraph = longGraph(14);
    const layout = layoutResearchCausalGraph(causalGraph);
    const hypotheses = layout.nodes.filter((entry) => entry.node.kind === "hypothesis");

    expect(new Set(hypotheses.map((entry) => entry.x))).toHaveLength(1);
    expect(layout.rows).toHaveLength(14);
    expect(layout.width).toBeLessThan(1600);
    expect(layout.height).toBeGreaterThan(layout.width);
  });

  it("allocates extra height to conclusion nodes without overlapping rows", () => {
    const layout = layoutResearchCausalGraph(graph());
    const conclusion = layout.nodes.find((entry) => entry.node.id === "conclusion.one");
    const hypothesis = layout.nodes.find((entry) => entry.node.id === "hypothesis.one");

    expect(conclusion?.height).toBe(CAUSAL_CONCLUSION_NODE_HEIGHT);
    expect(hypothesis?.height).toBe(CAUSAL_NODE_HEIGHT);
    for (let index = 1; index < layout.rows.length; index += 1) {
      const previous = layout.rows[index - 1];
      const current = layout.rows[index];
      expect((current?.y ?? 0) - ((previous?.y ?? 0) + (previous?.height ?? 0))).toBeGreaterThan(0);
    }
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
