import type { SessionInfo } from "./api";
import type { ChatLine, ChatPart } from "./components/shared";
import { normalizeSessionPath } from "./sessionPaths";

const SUBAGENT_SESSION_PREFIX = "subagent-";
const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

export type AgentSessionKind = "main" | "subagent" | "branch";
export type AgentRunState = "pending" | "running" | "complete" | "failed" | "paused" | "stopped";

export interface SubagentSessionIdentity {
  agent: string;
  runKey?: string;
}

export interface AgentRunEvidence {
  agent?: string;
  runId?: string;
  sessionPath?: string;
  model?: string;
  thinking?: string;
  state?: AgentRunState;
}

export interface AgentSessionGraphNode {
  session: SessionInfo;
  parentSessionId?: string;
  kind: AgentSessionKind;
  agent?: string;
  runId?: string;
  model?: string;
  thinking?: string;
  evidenceState?: AgentRunState;
}

export interface AgentSessionGraph {
  rootSessionId: string;
  nodes: AgentSessionGraphNode[];
}

export interface PositionedAgentSessionNode extends AgentSessionGraphNode {
  x: number;
  y: number;
  depth: number;
}

export interface PositionedAgentSessionEdge {
  parentSessionId: string;
  childSessionId: string;
}

export interface AgentSessionGraphLayout {
  width: number;
  height: number;
  nodes: PositionedAgentSessionNode[];
  edges: PositionedAgentSessionEdge[];
}

export const AGENT_GRAPH_NODE_WIDTH = 176;
export const AGENT_GRAPH_NODE_HEIGHT = 68;
const AGENT_GRAPH_HORIZONTAL_GAP = 34;
const AGENT_GRAPH_VERTICAL_GAP = 68;
const AGENT_GRAPH_PADDING = 28;

/**
 * pi-subagents names child Pi sessions `subagent-<agent>-<run id>[-<index>]`.
 * Current runtime ids are either eight hexadecimal characters or UUIDs, so
 * their first hexadecimal segment is a stable separator even when a custom
 * agent name contains hyphens. Unrecognized names remain ordinary sessions.
 */
export function subagentSessionIdentity(session: Pick<SessionInfo, "name">): SubagentSessionIdentity | undefined {
  const name = session.name?.trim();
  if (name?.startsWith(SUBAGENT_SESSION_PREFIX) !== true) return undefined;
  const parts = name.slice(SUBAGENT_SESSION_PREFIX.length).split("-").filter((part) => part !== "");
  const runStart = parts.findIndex((part) => /^[0-9a-f]{8,}$/i.test(part));
  if (runStart <= 0) return undefined;
  const agent = parts.slice(0, runStart).join("-");
  const runKey = parts[runStart];
  if (agent === "" || runKey === undefined) return undefined;
  return { agent, runKey };
}

export function isAgentChildSession(session: SessionInfo): boolean {
  return session.parentSessionPath !== undefined || subagentSessionIdentity(session) !== undefined;
}

export function mainAgentSessions(sessions: readonly SessionInfo[]): SessionInfo[] {
  return sessions.filter((session) => !isAgentChildSession(session));
}

/** Return the visible root row that owns a selected descendant when known. */
export function mainAgentSessionForSelection(
  sessions: readonly SessionInfo[],
  selected: SessionInfo | undefined,
): SessionInfo | undefined {
  if (selected === undefined) return undefined;
  const byPath = sessionsByPath(sessions);
  let current: SessionInfo | undefined = selected;
  const seen = new Set<string>();
  while (current !== undefined) {
    const key = normalizeSessionPath(current.path);
    if (seen.has(key)) break;
    seen.add(key);
    if (current.parentSessionPath === undefined) return isAgentChildSession(current) ? undefined : current;
    current = byPath.get(normalizeSessionPath(current.parentSessionPath));
  }
  return undefined;
}

export function buildAgentSessionGraph(
  sessions: readonly SessionInfo[],
  root: SessionInfo,
  rootMessages: readonly ChatLine[],
): AgentSessionGraph {
  const byPath = sessionsByPath(sessions);
  const evidence = collectAgentRunEvidence(rootMessages);
  const evidenceByPath = new Map(evidence.flatMap((item) => item.sessionPath === undefined
    ? []
    : [[normalizeSessionPath(item.sessionPath), item] as const]));
  const includedPaths = descendantPaths(root, byPath);
  includedPaths.add(normalizeSessionPath(root.path));

  for (const item of evidence) {
    if (item.sessionPath !== undefined && byPath.has(normalizeSessionPath(item.sessionPath))) {
      includedPaths.add(normalizeSessionPath(item.sessionPath));
    }
  }

  for (const session of sessions) {
    const identity = subagentSessionIdentity(session);
    const runKey = identity?.runKey;
    if (runKey === undefined) continue;
    if (evidence.some((item) => item.runId?.startsWith(runKey) === true)) {
      includedPaths.add(normalizeSessionPath(session.path));
    }
  }

  const nodes: AgentSessionGraphNode[] = [];
  for (const session of sessions) {
    const sessionPath = normalizeSessionPath(session.path);
    if (!includedPaths.has(sessionPath)) continue;
    const identity = subagentSessionIdentity(session);
    const matchingEvidence = evidenceByPath.get(sessionPath)
      ?? evidence.find((item) => identity?.runKey !== undefined && item.runId?.startsWith(identity.runKey) === true);
    const recordedParent = session.parentSessionPath === undefined
      ? undefined
      : byPath.get(normalizeSessionPath(session.parentSessionPath));
    const parentSessionId = session.id === root.id
      ? undefined
      : recordedParent !== undefined && includedPaths.has(normalizeSessionPath(recordedParent.path))
        ? recordedParent.id
        : root.id;
    const kind: AgentSessionKind = session.id === root.id ? "main" : identity === undefined ? "branch" : "subagent";
    const model = splitModelThinking(matchingEvidence?.model, matchingEvidence?.thinking);
    const agent = matchingEvidence?.agent ?? identity?.agent;
    nodes.push({
      session,
      ...(parentSessionId === undefined ? {} : { parentSessionId }),
      kind,
      ...(agent === undefined ? {} : { agent }),
      ...(matchingEvidence?.runId === undefined ? {} : { runId: matchingEvidence.runId }),
      ...(model.model === undefined ? {} : { model: model.model }),
      ...(model.thinking === undefined ? {} : { thinking: model.thinking }),
      ...(matchingEvidence?.state === undefined ? {} : { evidenceState: matchingEvidence.state }),
    });
  }

  if (!nodes.some((node) => node.session.id === root.id)) {
    nodes.unshift({ session: root, kind: "main" });
  }
  return { rootSessionId: root.id, nodes: sortGraphNodes(nodes, root.id) };
}

export function collectAgentRunEvidence(messages: readonly ChatLine[]): AgentRunEvidence[] {
  const evidence: AgentRunEvidence[] = [];
  for (const message of messages) {
    for (const part of message.parts) {
      if (!isSubagentToolPart(part)) continue;
      collectEvidenceDetails(part.details, evidence);
      if (part.type === "toolExecution" && part.resultText !== undefined) collectEvidenceFromText(part.resultText, evidence);
      if (part.type === "toolResult") collectEvidenceFromText(part.text, evidence);
    }
  }
  return mergeEvidence(evidence);
}

export function layoutAgentSessionGraph(graph: AgentSessionGraph): AgentSessionGraphLayout {
  const byId = new Map(graph.nodes.map((node) => [node.session.id, node]));
  const children = new Map<string, AgentSessionGraphNode[]>();
  for (const node of graph.nodes) {
    if (node.parentSessionId === undefined || !byId.has(node.parentSessionId)) continue;
    const siblings = children.get(node.parentSessionId) ?? [];
    siblings.push(node);
    children.set(node.parentSessionId, siblings);
  }
  for (const siblings of children.values()) siblings.sort(compareGraphNodes);

  const subtreeWidths = new Map<string, number>();
  const measure = (nodeId: string, stack: Set<string>): number => {
    if (stack.has(nodeId)) return AGENT_GRAPH_NODE_WIDTH;
    const cached = subtreeWidths.get(nodeId);
    if (cached !== undefined) return cached;
    const nextStack = new Set(stack).add(nodeId);
    const childWidths = (children.get(nodeId) ?? []).map((child) => measure(child.session.id, nextStack));
    const width = Math.max(
      AGENT_GRAPH_NODE_WIDTH,
      childWidths.reduce((sum, childWidth) => sum + childWidth, 0)
        + Math.max(0, childWidths.length - 1) * AGENT_GRAPH_HORIZONTAL_GAP,
    );
    subtreeWidths.set(nodeId, width);
    return width;
  };

  const root = byId.get(graph.rootSessionId) ?? graph.nodes[0];
  if (root === undefined) return { width: 360, height: 220, nodes: [], edges: [] };
  const positioned: PositionedAgentSessionNode[] = [];
  let maxDepth = 0;
  const place = (node: AgentSessionGraphNode, left: number, depth: number, stack: Set<string>) => {
    if (stack.has(node.session.id)) return;
    maxDepth = Math.max(maxDepth, depth);
    const width = measure(node.session.id, new Set());
    positioned.push({ ...node, x: left + (width - AGENT_GRAPH_NODE_WIDTH) / 2, y: AGENT_GRAPH_PADDING + depth * (AGENT_GRAPH_NODE_HEIGHT + AGENT_GRAPH_VERTICAL_GAP), depth });
    let childLeft = left;
    const nextStack = new Set(stack).add(node.session.id);
    for (const child of children.get(node.session.id) ?? []) {
      place(child, childLeft, depth + 1, nextStack);
      childLeft += (subtreeWidths.get(child.session.id) ?? AGENT_GRAPH_NODE_WIDTH) + AGENT_GRAPH_HORIZONTAL_GAP;
    }
  };
  place(root, AGENT_GRAPH_PADDING, 0, new Set());
  const width = Math.max(360, (subtreeWidths.get(root.session.id) ?? AGENT_GRAPH_NODE_WIDTH) + AGENT_GRAPH_PADDING * 2);
  const height = Math.max(220, AGENT_GRAPH_PADDING * 2 + AGENT_GRAPH_NODE_HEIGHT + maxDepth * (AGENT_GRAPH_NODE_HEIGHT + AGENT_GRAPH_VERTICAL_GAP));
  const positionedIds = new Set(positioned.map((node) => node.session.id));
  const edges = positioned.flatMap((node): PositionedAgentSessionEdge[] => node.parentSessionId !== undefined && positionedIds.has(node.parentSessionId)
    ? [{ parentSessionId: node.parentSessionId, childSessionId: node.session.id }]
    : []);
  return { width, height, nodes: positioned, edges };
}

function sessionsByPath(sessions: readonly SessionInfo[]): Map<string, SessionInfo> {
  return new Map(sessions.map((session) => [normalizeSessionPath(session.path), session]));
}

function descendantPaths(root: SessionInfo, byPath: ReadonlyMap<string, SessionInfo>): Set<string> {
  const children = new Map<string, SessionInfo[]>();
  for (const session of byPath.values()) {
    if (session.parentSessionPath === undefined) continue;
    const parentPath = normalizeSessionPath(session.parentSessionPath);
    const siblings = children.get(parentPath) ?? [];
    siblings.push(session);
    children.set(parentPath, siblings);
  }
  const result = new Set<string>();
  const visit = (path: string) => {
    if (result.has(path)) return;
    result.add(path);
    for (const child of children.get(path) ?? []) visit(normalizeSessionPath(child.path));
  };
  visit(normalizeSessionPath(root.path));
  return result;
}

function isSubagentToolPart(part: ChatPart): part is Extract<ChatPart, { type: "toolExecution" | "toolResult" }> {
  return (part.type === "toolExecution" || part.type === "toolResult") && part.toolName === "subagent";
}

function collectEvidenceDetails(value: unknown, evidence: AgentRunEvidence[]): void {
  if (!isRecord(value)) return;
  collectEvidenceArray(value["results"], evidence);
  collectEvidenceArray(value["completions"], evidence);
  const workflow = recordProperty(value, "workflow");
  collectTrace(workflow?.["trace"], evidence);
  const mission = recordProperty(value, "mission");
  collectEvidenceArray(mission?.["workflowChildren"], evidence);
}

function collectEvidenceArray(value: unknown, evidence: AgentRunEvidence[]): void {
  if (!Array.isArray(value)) return;
  for (const item of value) {
    if (!isRecord(item)) continue;
    const sessionPath = stringProperty(item, "sessionFile") ?? stringProperty(item, "sessionPath");
    const model = stringProperty(item, "model");
    const thinking = stringProperty(item, "thinking");
    const runId = stringProperty(item, "runId");
    const agent = stringProperty(item, "agent");
    const state = normalizeRunState(stringProperty(item, "status") ?? stringProperty(item, "state"), item);
    if (sessionPath !== undefined || model !== undefined || runId !== undefined || agent !== undefined || state !== undefined) {
      evidence.push({
        ...(sessionPath === undefined ? {} : { sessionPath }),
        ...(model === undefined ? {} : { model }),
        ...(thinking === undefined ? {} : { thinking }),
        ...(runId === undefined ? {} : { runId }),
        ...(agent === undefined ? {} : { agent }),
        ...(state === undefined ? {} : { state }),
      });
    }
    collectEvidenceArray(item["results"], evidence);
  }
}

function collectTrace(value: unknown, evidence: AgentRunEvidence[]): void {
  if (!Array.isArray(value)) return;
  for (const item of value) {
    if (!isRecord(item) || stringProperty(item, "operation") !== "run") continue;
    const runId = stringProperty(item, "runId");
    const agent = stringProperty(item, "agent");
    const state = normalizeRunState(stringProperty(item, "state"), item);
    if (runId === undefined && agent === undefined) continue;
    evidence.push({
      ...(runId === undefined ? {} : { runId }),
      ...(agent === undefined ? {} : { agent }),
      ...(state === undefined ? {} : { state }),
    });
  }
}

function collectEvidenceFromText(text: string, evidence: AgentRunEvidence[]): void {
  for (const match of text.matchAll(/\b([0-9a-f]{8})(?:-[0-9a-f-]{8,})?\b/gi)) {
    const runId = match[0];
    const nearby = text.slice(Math.max(0, match.index - 100), Math.min(text.length, match.index + runId.length + 100));
    const agent = /\(([^()\s]+)\)\s+(?:completed|failed|running|paused|stopped)/i.exec(nearby)?.[1];
    const state = normalizeRunStateFromText(nearby);
    evidence.push({
      runId,
      ...(agent === undefined ? {} : { agent }),
      ...(state === undefined ? {} : { state }),
    });
  }
}

function mergeEvidence(items: AgentRunEvidence[]): AgentRunEvidence[] {
  const merged: AgentRunEvidence[] = [];
  for (const item of items) {
    const path = item.sessionPath === undefined ? undefined : normalizeSessionPath(item.sessionPath);
    const index = merged.findIndex((candidate) => {
      const candidatePath = candidate.sessionPath === undefined ? undefined : normalizeSessionPath(candidate.sessionPath);
      if (path !== undefined && candidatePath !== undefined) return path === candidatePath;
      if (item.runId !== undefined && candidate.runId !== undefined) return runIdsOverlap(item.runId, candidate.runId);
      return false;
    });
    if (index < 0) merged.push(item);
    else merged[index] = { ...merged[index], ...item };
  }
  return merged;
}

function runIdsOverlap(left: string, right: string): boolean {
  return left.startsWith(right) || right.startsWith(left);
}

function normalizeRunState(value: string | undefined, record: Record<string, unknown>): AgentRunState | undefined {
  if (value === "started" || value === "queued" || value === "pending") return "pending";
  if (value === "running") return "running";
  if (value === "complete" || value === "completed" || value === "success") return "complete";
  if (value === "failed" || value === "error" || record["success"] === false || (typeof record["exitCode"] === "number" && record["exitCode"] !== 0)) return "failed";
  if (value === "paused" || value === "interrupted") return "paused";
  if (value === "stopped" || value === "cancelled") return "stopped";
  if (record["success"] === true || record["exitCode"] === 0) return "complete";
  return undefined;
}

function normalizeRunStateFromText(text: string): AgentRunState | undefined {
  if (/\bfailed\b/i.test(text)) return "failed";
  if (/\bcompleted?\b/i.test(text)) return "complete";
  if (/\brunning\b/i.test(text)) return "running";
  if (/\bpaused\b/i.test(text)) return "paused";
  if (/\bstopped\b/i.test(text)) return "stopped";
  return undefined;
}

function splitModelThinking(model: string | undefined, explicitThinking: string | undefined): { model?: string; thinking?: string } {
  if (model === undefined) return explicitThinking === undefined ? {} : { thinking: explicitThinking };
  const separator = model.lastIndexOf(":");
  const suffix = separator < 0 ? undefined : model.slice(separator + 1);
  if (suffix !== undefined && THINKING_LEVELS.has(suffix)) {
    return { model: model.slice(0, separator), thinking: explicitThinking ?? suffix };
  }
  return { model, ...(explicitThinking === undefined ? {} : { thinking: explicitThinking }) };
}

function sortGraphNodes(nodes: AgentSessionGraphNode[], rootId: string): AgentSessionGraphNode[] {
  return [...nodes].sort((left, right) => {
    if (left.session.id === rootId) return -1;
    if (right.session.id === rootId) return 1;
    return compareGraphNodes(left, right);
  });
}

function compareGraphNodes(left: AgentSessionGraphNode, right: AgentSessionGraphNode): number {
  const created = Date.parse(left.session.created) - Date.parse(right.session.created);
  return created !== 0 ? created : left.session.id.localeCompare(right.session.id);
}

function recordProperty(value: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const property = value[key];
  return isRecord(property) ? property : undefined;
}

function stringProperty(value: Record<string, unknown>, key: string): string | undefined {
  const property = value[key];
  return typeof property === "string" && property !== "" ? property : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
