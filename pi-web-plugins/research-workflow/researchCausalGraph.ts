import type { CausalEdge, CausalNode, ResearchCausalGraph } from "./researchWorkflowState.js";

export const CAUSAL_NODE_WIDTH = 238;
export const CAUSAL_NODE_HEIGHT = 126;
const LAYER_GAP = 116;
const ROW_GAP = 56;
const CANVAS_PADDING = 72;

export interface PositionedCausalNode {
  node: CausalNode;
  x: number;
  y: number;
  depth: number;
}

export interface PositionedCausalEdge {
  edge: CausalEdge;
  path: string;
  labelX: number;
  labelY: number;
}

export interface ResearchCausalGraphLayout {
  width: number;
  height: number;
  nodes: PositionedCausalNode[];
  edges: PositionedCausalEdge[];
}

/** Deterministic left-to-right layout for a validated research DAG. */
export function layoutResearchCausalGraph(
  graph: ResearchCausalGraph,
  hiddenNodeIds: ReadonlySet<string> = new Set(),
): ResearchCausalGraphLayout {
  const visibleNodes = graph.nodes.filter((node) => !hiddenNodeIds.has(node.id));
  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
  const visibleEdges = graph.edges.filter((edge) => visibleNodeIds.has(edge.from) && visibleNodeIds.has(edge.to));
  if (visibleNodes.length === 0) return { width: 720, height: 480, nodes: [], edges: [] };

  const order = new Map(visibleNodes.map((node, index) => [node.id, index]));
  const indegree = new Map(visibleNodes.map((node) => [node.id, 0]));
  const outgoing = new Map<string, string[]>(visibleNodes.map((node) => [node.id, []]));
  const incoming = new Map<string, string[]>(visibleNodes.map((node) => [node.id, []]));
  for (const edge of visibleEdges) {
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
    outgoing.get(edge.from)?.push(edge.to);
    incoming.get(edge.to)?.push(edge.from);
  }

  const ready = visibleNodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id);
  const depth = new Map(visibleNodes.map((node) => [node.id, 0]));
  while (ready.length > 0) {
    ready.sort((left, right) => (order.get(left) ?? 0) - (order.get(right) ?? 0));
    const id = ready.shift();
    if (id === undefined) break;
    for (const target of outgoing.get(id) ?? []) {
      depth.set(target, Math.max(depth.get(target) ?? 0, (depth.get(id) ?? 0) + 1));
      const next = (indegree.get(target) ?? 0) - 1;
      indegree.set(target, next);
      if (next === 0) ready.push(target);
    }
  }

  const layers = new Map<number, CausalNode[]>();
  for (const node of visibleNodes) {
    const nodeDepth = depth.get(node.id) ?? 0;
    const layer = layers.get(nodeDepth) ?? [];
    layer.push(node);
    layers.set(nodeDepth, layer);
  }
  const layerEntries = [...layers.entries()].sort(([left], [right]) => left - right);
  const maxRows = Math.max(...layerEntries.map(([, nodes]) => nodes.length));
  const contentHeight = maxRows * CAUSAL_NODE_HEIGHT + Math.max(0, maxRows - 1) * ROW_GAP;
  const positioned: PositionedCausalNode[] = [];
  for (const [nodeDepth, nodes] of layerEntries) {
    nodes.sort((left, right) => {
      const leftParents = incoming.get(left.id) ?? [];
      const rightParents = incoming.get(right.id) ?? [];
      const leftRank = leftParents.length === 0 ? (order.get(left.id) ?? 0) : average(leftParents.map((id) => order.get(id) ?? 0));
      const rightRank = rightParents.length === 0 ? (order.get(right.id) ?? 0) : average(rightParents.map((id) => order.get(id) ?? 0));
      return leftRank - rightRank || (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0);
    });
    const layerHeight = nodes.length * CAUSAL_NODE_HEIGHT + Math.max(0, nodes.length - 1) * ROW_GAP;
    const startY = CANVAS_PADDING + (contentHeight - layerHeight) / 2;
    nodes.forEach((node, index) => {
      positioned.push({
        node,
        x: CANVAS_PADDING + nodeDepth * (CAUSAL_NODE_WIDTH + LAYER_GAP),
        y: startY + index * (CAUSAL_NODE_HEIGHT + ROW_GAP),
        depth: nodeDepth,
      });
    });
  }

  const byId = new Map(positioned.map((entry) => [entry.node.id, entry]));
  const positionedEdges = visibleEdges.flatMap((edge): PositionedCausalEdge[] => {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (from === undefined || to === undefined) return [];
    const fromX = from.x + CAUSAL_NODE_WIDTH;
    const fromY = from.y + CAUSAL_NODE_HEIGHT / 2;
    const toX = to.x;
    const toY = to.y + CAUSAL_NODE_HEIGHT / 2;
    const controlOffset = Math.max(52, (toX - fromX) * 0.42);
    return [{
      edge,
      path: `M ${String(fromX)} ${String(fromY)} C ${String(fromX + controlOffset)} ${String(fromY)}, ${String(toX - controlOffset)} ${String(toY)}, ${String(toX)} ${String(toY)}`,
      labelX: (fromX + toX) / 2,
      labelY: (fromY + toY) / 2,
    }];
  });
  const maxDepth = Math.max(...positioned.map((entry) => entry.depth));
  return {
    width: CANVAS_PADDING * 2 + (maxDepth + 1) * CAUSAL_NODE_WIDTH + maxDepth * LAYER_GAP,
    height: CANVAS_PADDING * 2 + contentHeight,
    nodes: positioned,
    edges: positionedEdges,
  };
}

/** The persisted ordered path avoids inventing one branch when a DAG has merges. */
export function activeCausalPath(graph: ResearchCausalGraph): { nodeIds: Set<string>; edgeIds: Set<string> } {
  const edgeIds = new Set(graph.activePathEdgeIds);
  const nodeIds = new Set<string>();
  if (graph.activeNodeId !== undefined) nodeIds.add(graph.activeNodeId);
  for (const edge of graph.edges) {
    if (!edgeIds.has(edge.id)) continue;
    nodeIds.add(edge.from);
    nodeIds.add(edge.to);
  }
  return { nodeIds, edgeIds };
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length;
}
