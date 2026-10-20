import type { FeatureArtifact, Flow, FlowNode, MetaOp } from '../core/schema.js';
import { OperationSchema } from '../core/schema.js';
import type { z } from 'zod';
import {
  alignStepIds,
  formatChain,
  summarizeEdits,
} from './alignChain.js';
import { deepEqual } from './deepEqual.js';

type Operation = z.infer<typeof OperationSchema>;

/** 流程展开后的单步（完整链路比对单元） */
export type ResolvedFlowStep = {
  index: number;
  node_id: string;
  meta_op_id: string;
  name: string;
  kind: string;
  element?: string;
  api?: string;
  ready?: MetaOp['ready'];
  args?: Record<string, unknown>;
  note?: string;
  /** 元操作 / 能力均未命中时标记 */
  missing_meta_op?: boolean;
};

export type FlowChainDiff = {
  id: string;
  title: string;
  change_type: 'added' | 'removed' | 'modified' | 'unchanged';
  before: ResolvedFlowStep[];
  after: ResolvedFlowStep[];
  /** 人类可读的节点级变更要点（供报告/LLM，宜短） */
  highlights: string[];
};

/** 按 edges 拓扑展开节点顺序；无边则按 nodes 声明序 */
export function orderedFlowNodes(flow: Flow): FlowNode[] {
  if (!flow.edges?.length) return [...flow.nodes];

  const byId = new Map(flow.nodes.map((n) => [n.id, n]));
  const targets = new Set(flow.edges.map((e) => e.target));
  let start: string | undefined =
    flow.nodes.find((n) => !targets.has(n.id))?.id ?? flow.nodes[0]?.id;
  const out: FlowNode[] = [];
  const seen = new Set<string>();
  while (start && !seen.has(start)) {
    seen.add(start);
    const node = byId.get(start);
    if (node) out.push(node);
    const edge = flow.edges.find((e) => e.source === start);
    start = edge?.target;
  }
  for (const n of flow.nodes) {
    if (!seen.has(n.id)) out.push(n);
  }
  return out;
}

export function flowMetaOpSequence(flow: Flow): string[] {
  return orderedFlowNodes(flow).map((n) => n.meta_op_id);
}

/**
 * 比对用流程列表：优先真实 flows（分析后由 compileFlows 写入）；
 * 若无 flows（旧产物），则按每个 operation 的 execution_chain 合成（兼容兜底）。
 */
export function flowsForCompare(artifact: FeatureArtifact): Flow[] {
  if (artifact.flows?.length) return artifact.flows;
  return synthesizeFlowsFromOperations(artifact.operations ?? []);
}

function synthesizeFlowsFromOperations(operations: Operation[]): Flow[] {
  return operations.map((op) => {
    const chain =
      op.execution_chain?.length
        ? op.execution_chain
        : op.preconditions?.length
          ? [...op.preconditions, op.id]
          : [op.id];
    const nodes: FlowNode[] = chain.map((stepId, i) => ({
      id: `${op.id}_n${i}`,
      meta_op_id: stepId,
    }));
    const edges =
      nodes.length < 2
        ? []
        : nodes.slice(0, -1).map((n, i) => ({
            id: `${op.id}_e${i}`,
            source: n.id,
            target: nodes[i + 1]!.id,
          }));
    return {
      id: op.id,
      title: op.name,
      source: 'default' as const,
      nodes,
      edges,
    };
  });
}

function pickStepArgs(
  meta?: MetaOp,
  nodeArgs?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const merged = { ...(meta?.args ?? {}), ...(nodeArgs ?? {}) };
  return Object.keys(merged).length ? merged : undefined;
}

export function resolveFlowChain(
  flow: Flow,
  artifact: FeatureArtifact,
): ResolvedFlowStep[] {
  const metaById = new Map((artifact.meta_ops ?? []).map((m) => [m.id, m]));
  const opById = new Map((artifact.operations ?? []).map((o) => [o.id, o]));

  return orderedFlowNodes(flow).map((node, index) => {
    const meta = metaById.get(node.meta_op_id);
    if (meta) {
      return {
        index,
        node_id: node.id,
        meta_op_id: meta.id,
        name: meta.name,
        kind: meta.kind,
        element: meta.element,
        api: meta.api,
        ready: meta.ready,
        args: pickStepArgs(meta, node.args),
        note: meta.note,
      };
    }

    const op = opById.get(node.meta_op_id);
    if (op) {
      return {
        index,
        node_id: node.id,
        meta_op_id: op.id,
        name: op.name,
        kind: op.type,
        api: op.api,
        args: node.args,
        note: op.description,
      };
    }

    // execution_chain 中的中间态（list / edit / fill…）无独立元操作
    return {
      index,
      node_id: node.id,
      meta_op_id: node.meta_op_id,
      name: node.meta_op_id,
      kind: 'step',
      args: node.args,
      missing_meta_op: true,
    };
  });
}

function stepFingerprint(s: ResolvedFlowStep): string {
  return [
    s.meta_op_id,
    s.kind,
    s.element ?? '',
    s.api ?? '',
    JSON.stringify(s.ready ?? null),
    JSON.stringify(s.args ?? null),
  ].join('|');
}

function fieldDiffs(a: ResolvedFlowStep, b: ResolvedFlowStep): string[] {
  const fieldChanges: string[] = [];
  if (a.kind !== b.kind) fieldChanges.push(`kind ${a.kind}→${b.kind}`);
  if (!deepEqual(a.element, b.element)) fieldChanges.push('element');
  if (!deepEqual(a.api, b.api)) fieldChanges.push('api');
  if (!deepEqual(a.ready, b.ready)) fieldChanges.push('ready');
  if (!deepEqual(a.args, b.args)) fieldChanges.push('args');
  return fieldChanges;
}

/** 用 LCS 对齐步骤 id，生成短 highlights（避免按位「假替换」） */
function chainHighlights(before: ResolvedFlowStep[], after: ResolvedFlowStep[]): string[] {
  const seqBefore = before.map((s) => s.meta_op_id);
  const seqAfter = after.map((s) => s.meta_op_id);
  const edits = alignStepIds(seqBefore, seqAfter);
  const highlights: string[] = [];

  if (!deepEqual(seqBefore, seqAfter)) {
    highlights.push(`整链：${formatChain(seqBefore)} 变为 ${formatChain(seqAfter)}`);
    highlights.push(...summarizeEdits(edits));
  }

  // 同 id 保留步：比对参数/接口等
  const afterById = new Map<string, ResolvedFlowStep[]>();
  for (const s of after) {
    const list = afterById.get(s.meta_op_id) ?? [];
    list.push(s);
    afterById.set(s.meta_op_id, list);
  }
  const used = new Map<string, number>();
  for (const a of before) {
    const list = afterById.get(a.meta_op_id);
    if (!list?.length) continue;
    const idx = used.get(a.meta_op_id) ?? 0;
    const b = list[idx];
    if (!b) continue;
    used.set(a.meta_op_id, idx + 1);
    if (stepFingerprint(a) === stepFingerprint(b)) continue;
    const diffs = fieldDiffs(a, b);
    if (diffs.length) {
      highlights.push(`「${a.meta_op_id}」变更：${diffs.join('、')}`);
    }
  }

  return highlights;
}

/** 以完整流程链为主轴，对齐 before/after 的每条 flow */
export function diffFlowChains(
  beforeArtifact: FeatureArtifact,
  afterArtifact: FeatureArtifact,
): FlowChainDiff[] {
  const beforeFlows = flowsForCompare(beforeArtifact);
  const afterFlows = flowsForCompare(afterArtifact);
  const mapA = new Map(beforeFlows.map((f) => [f.id, f]));
  const mapB = new Map(afterFlows.map((f) => [f.id, f]));
  const ids = new Set([...mapA.keys(), ...mapB.keys()]);
  const out: FlowChainDiff[] = [];

  for (const id of [...ids].sort()) {
    const left = mapA.get(id);
    const right = mapB.get(id);
    if (!left && right) {
      const after = resolveFlowChain(right, afterArtifact);
      out.push({
        id,
        title: right.title,
        change_type: 'added',
        before: [],
        after,
        highlights: [`新增：${formatChain(after.map((s) => s.meta_op_id))}`],
      });
      continue;
    }
    if (left && !right) {
      const before = resolveFlowChain(left, beforeArtifact);
      out.push({
        id,
        title: left.title,
        change_type: 'removed',
        before,
        after: [],
        highlights: [`移除：${formatChain(before.map((s) => s.meta_op_id))}`],
      });
      continue;
    }
    if (!left || !right) continue;

    const before = resolveFlowChain(left, beforeArtifact);
    const after = resolveFlowChain(right, afterArtifact);
    const same =
      before.length === after.length &&
      before.every((s, i) => stepFingerprint(s) === stepFingerprint(after[i]!));
    const title = right.title || left.title;
    if (same) {
      out.push({
        id,
        title,
        change_type: 'unchanged',
        before,
        after,
        highlights: [],
      });
    } else {
      out.push({
        id,
        title,
        change_type: 'modified',
        before,
        after,
        highlights: chainHighlights(before, after),
      });
    }
  }

  return out;
}
