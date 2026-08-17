import type { CausalEdge, CausalNode, ResearchCausalGraph } from "./researchWorkflowState.js";

export const CAUSAL_NODE_WIDTH = 238;
export const CAUSAL_NODE_HEIGHT = 126;
export const CAUSAL_CONCLUSION_NODE_HEIGHT = 158;
const STAGE_GAP = 96;
const ITERATION_GAP = 84;
const NODE_STACK_GAP = 18;
const CANVAS_PADDING = 72;
const stageOrder: CausalNode["kind"][] = ["hypothesis", "validation", "analysis", "conclusion"];

export interface PositionedCausalNode {
  node: CausalNode;
  x: number;
  y: number;
  depth: number;
  height: number;
}

export interface CausalRoutePoint {
  x: number;
  y: number;
}

export interface PositionedCausalEdge {
  edge: CausalEdge;
  path: string;
  labelX: number;
  labelY: number;
  routePoints?: CausalRoutePoint[];
}

export interface PositionedCausalRow {
  index: number;
  y: number;
  height: number;
}

export interface ResearchCausalGraphLayout {
  width: number;
  height: number;
  nodes: PositionedCausalNode[];
  edges: PositionedCausalEdge[];
  rows: PositionedCausalRow[];
}

interface CausalIteration {
  id: string;
  nodes: CausalNode[];
  order: number;
}

/**
 * Deterministic stage-column layout for a validated research DAG.
 *
 * Each hypothesis -> validation -> analysis -> conclusion iteration occupies
 * one horizontal row. Motivated follow-up hypotheses move to later rows, so a
 * long research history remains four semantic columns wide rather than
 * becoming one continuously shrinking horizontal chain.
 */
export function layoutResearchCausalGraph(
  graph: ResearchCausalGraph,
  hiddenNodeIds: ReadonlySet<string> = new Set(),
): ResearchCausalGraphLayout {
  const visibleNodes = graph.nodes.filter((node) => !hiddenNodeIds.has(node.id));
  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
  const width = CANVAS_PADDING * 2 + stageOrder.length * CAUSAL_NODE_WIDTH + (stageOrder.length - 1) * STAGE_GAP;
  if (visibleNodes.length === 0) return { width, height: 480, nodes: [], edges: [], rows: [] };

  const nodeOrder = new Map(graph.nodes.map((node, index) => [node.id, index]));
  const parent = new Map(graph.nodes.map((node) => [node.id, node.id]));
  const find = (id: string): string => {
    const current = parent.get(id) ?? id;
    if (current === id) return id;
    const root = find(current);
    parent.set(id, root);
    return root;
  };
  const union = (left: string, right: string): void => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot);
  };
  for (const edge of graph.edges) {
    if (edge.kind !== "motivates") union(edge.from, edge.to);
  }

  const byRoot = new Map<string, CausalNode[]>();
  for (const node of graph.nodes) {
    const root = find(node.id);
    const nodes = byRoot.get(root) ?? [];
    nodes.push(node);
    byRoot.set(root, nodes);
  }
  const iterations: CausalIteration[] = [...byRoot.entries()].map(([id, nodes]) => ({
    id,
    nodes,
    order: Math.min(...nodes.map((node) => nodeOrder.get(node.id) ?? 0)),
  }));
  const iterationByNode = new Map<string, string>();
  for (const iteration of iterations) {
    for (const node of iteration.nodes) iterationByNode.set(node.id, iteration.id);
  }
  const orderedIterations = topologicalIterationOrder(iterations, graph.edges, iterationByNode)
    .filter((iteration) => iteration.nodes.some((node) => visibleNodeIds.has(node.id)));

  const positioned: PositionedCausalNode[] = [];
  const rows: PositionedCausalRow[] = [];
  let nextRowY = CANVAS_PADDING;
  orderedIterations.forEach((iteration, rowIndex) => {
    const visibleIterationNodes = iteration.nodes.filter((node) => visibleNodeIds.has(node.id));
    const byStage = new Map(stageOrder.map((kind) => [kind, visibleIterationNodes.filter((node) => node.kind === kind)
      .sort((left, right) => (nodeOrder.get(left.id) ?? 0) - (nodeOrder.get(right.id) ?? 0))]));
    const stageHeights = stageOrder.map((kind) => stackedNodeHeight(byStage.get(kind) ?? []));
    const rowHeight = Math.max(CAUSAL_NODE_HEIGHT, ...stageHeights);
    rows.push({ index: rowIndex, y: nextRowY, height: rowHeight });
    stageOrder.forEach((kind, stageIndex) => {
      const nodes = byStage.get(kind) ?? [];
      let nextNodeY = nextRowY + (rowHeight - stackedNodeHeight(nodes)) / 2;
      for (const node of nodes) {
        const height = causalNodeHeight(node);
        positioned.push({
          node,
          x: CANVAS_PADDING + stageIndex * (CAUSAL_NODE_WIDTH + STAGE_GAP),
          y: nextNodeY,
          depth: rowIndex,
          height,
        });
        nextNodeY += height + NODE_STACK_GAP;
      }
    });
    nextRowY += rowHeight + ITERATION_GAP;
  });

  const byId = new Map(positioned.map((entry) => [entry.node.id, entry]));
  const visibleEdges = graph.edges.filter((edge) => visibleNodeIds.has(edge.from) && visibleNodeIds.has(edge.to));
  let motivatesRouteIndex = 0;
  const positionedEdges = visibleEdges.flatMap((edge): PositionedCausalEdge[] => {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (from === undefined || to === undefined) return [];
    if (edge.kind === "motivates") {
      const positionedEdge = positionMotivatesEdge(edge, from, to, motivatesRouteIndex, width, rows[to.depth]?.y ?? to.y);
      motivatesRouteIndex += 1;
      return [positionedEdge];
    }
    const fromX = from.x + CAUSAL_NODE_WIDTH;
    const fromY = from.y + from.height / 2;
    const toX = to.x;
    const toY = to.y + to.height / 2;
    const controlOffset = Math.max(52, Math.abs(toX - fromX) * 0.42);
    return [{
      edge,
      path: `M ${String(fromX)} ${String(fromY)} C ${String(fromX + controlOffset)} ${String(fromY)}, ${String(toX - controlOffset)} ${String(toY)}, ${String(toX)} ${String(toY)}`,
      labelX: (fromX + toX) / 2,
      labelY: (fromY + toY) / 2,
    }];
  });
  const lastRow = rows.at(-1);
  return {
    width,
    height: lastRow === undefined ? 480 : lastRow.y + lastRow.height + CANVAS_PADDING,
    nodes: positioned,
    edges: positionedEdges,
    rows,
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

export function causalNodeHeight(node: CausalNode): number {
  return node.kind === "conclusion" ? CAUSAL_CONCLUSION_NODE_HEIGHT : CAUSAL_NODE_HEIGHT;
}

function topologicalIterationOrder(
  iterations: CausalIteration[],
  edges: CausalEdge[],
  iterationByNode: ReadonlyMap<string, string>,
): CausalIteration[] {
  const byId = new Map(iterations.map((iteration) => [iteration.id, iteration]));
  const outgoing = new Map(iterations.map((iteration) => [iteration.id, new Set<string>()]));
  const indegree = new Map(iterations.map((iteration) => [iteration.id, 0]));
  for (const edge of edges) {
    if (edge.kind !== "motivates") continue;
    const from = iterationByNode.get(edge.from);
    const to = iterationByNode.get(edge.to);
    if (from === undefined || to === undefined || from === to || outgoing.get(from)?.has(to) === true) continue;
    outgoing.get(from)?.add(to);
    indegree.set(to, (indegree.get(to) ?? 0) + 1);
  }
  const ready = iterations.filter((iteration) => indegree.get(iteration.id) === 0);
  const ordered: CausalIteration[] = [];
  while (ready.length > 0) {
    ready.sort((left, right) => left.order - right.order);
    const iteration = ready.shift();
    if (iteration === undefined) break;
    ordered.push(iteration);
    for (const target of outgoing.get(iteration.id) ?? []) {
      const next = (indegree.get(target) ?? 0) - 1;
      indegree.set(target, next);
      if (next === 0) {
        const candidate = byId.get(target);
        if (candidate !== undefined) ready.push(candidate);
      }
    }
  }
  if (ordered.length === iterations.length) return ordered;
  const included = new Set(ordered.map((iteration) => iteration.id));
  return [...ordered, ...iterations.filter((iteration) => !included.has(iteration.id)).sort((left, right) => left.order - right.order)];
}

function stackedNodeHeight(nodes: CausalNode[]): number {
  return nodes.reduce((total, node) => total + causalNodeHeight(node), 0) + Math.max(0, nodes.length - 1) * NODE_STACK_GAP;
}

function positionMotivatesEdge(
  edge: CausalEdge,
  from: PositionedCausalNode,
  to: PositionedCausalNode,
  routeIndex: number,
  layoutWidth: number,
  targetRowY: number,
): PositionedCausalEdge {
  const lane = routeIndex % 5;
  const leftRailX = 18 + lane * 10;
  const rightRailX = layoutWidth - 18 - lane * 10;
  const fromX = from.x + CAUSAL_NODE_WIDTH;
  const fromY = from.y + from.height / 2;
  const toX = to.x;
  const toY = to.y + to.height / 2;
  const targetCorridorY = targetRowY - 22 - lane * 10;
  const routePoints: CausalRoutePoint[] = [
    { x: fromX, y: fromY },
    { x: rightRailX, y: fromY },
    { x: rightRailX, y: targetCorridorY },
    { x: leftRailX, y: targetCorridorY },
    { x: leftRailX, y: toY },
    { x: toX, y: toY },
  ];
  return {
    edge,
    path: routePoints.map((point, index) => `${index === 0 ? "M" : "L"} ${String(point.x)} ${String(point.y)}`).join(" "),
    labelX: layoutWidth / 2,
    labelY: targetCorridorY,
    routePoints,
  };
}
