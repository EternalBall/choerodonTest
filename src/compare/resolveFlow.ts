import type { FeatureArtifact, Flow, FlowNode, MetaOp } from '../core/schema.js';
import { OperationSchema } from '../core/schema.js';
import type { z } from 'zod';
import {
  alignStepIds,
  formatChain,
  summarizeEdits,
} from './alignChain.js';
import { deepEqual } from './deepEqual.js';
import type { FieldDiffItem } from './diffFields.js';
import type { FormChange, PageModelDiff } from './diffPageModel.js';

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
  /** 流程整条新增/删除可能只是分析波动（模型多拆/少拆），需结合源码确认 */
  unconfirmed?: boolean;
  /** 步骤级变更树：步骤增删改；填表单类步骤下钻到字段 */
  step_changes?: StepChange[];
  /** 流程依赖的页面对象（页签/抽屉/表单）在新源码里已被删除：关联推断，需结合源码确认 */
  stale_reasons?: string[];
  /**
   * 关联到本流程、但未挂到具体步骤的 field_facts 变更（按字段名 / 查询数据集匹配）。
   * 已挂到 step_changes[].field_facts 的不在此重复。
   */
  field_facts?: FieldDiffItem[];
};

export type StepChange = {
  /** 语义 key：kind:api 或 kind:element，不随序号 / 步骤命名变化 */
  key: string;
  change: 'added' | 'removed' | 'modified';
  /** modified 时：api / 表单字段集等 */
  details?: string[];
  /** 填表单类步骤关联到的表单及其字段级变更 */
  form?: { id: string; fields: FormChange['fields'] };
  /** 关联推断到的按钮/表格变更（按元素名匹配，需结合源码确认） */
  object_changes?: string[];
  /** 该步骤关联到的数据集字段事实变更（field_facts） */
  field_facts?: FieldDiffItem[];
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

/**
 * 步骤指纹。默认（稳定模式）只看 步骤 id / 类型 / 接口：元素名、args、ready 是模型起的名字或参数，
 * 同一份源码两次分析也会不同；strict 才把它们算进来。
 */
function stepFields(s: ResolvedFlowStep): string[] {
  const f = (s.args as { fields?: unknown } | undefined)?.fields;
  return Array.isArray(f) ? f.filter((x): x is string => typeof x === 'string').sort() : [];
}

function stepFingerprint(s: ResolvedFlowStep, strict = false, argFields = true): string {
  // 步骤内处理的字段集合（如 fill_form 的 fields）属于流程内容，稳定模式也比
  const base = [strict ? s.meta_op_id : stepKey(s), s.kind, s.api ?? '', argFields ? stepFields(s).join(',') : ''];
  if (strict) base.push(s.element ?? '', JSON.stringify(s.ready ?? null), JSON.stringify(s.args ?? null));
  return base.join('|');
}

function fieldDiffs(a: ResolvedFlowStep, b: ResolvedFlowStep, strict = false, argFields = true): string[] {
  const fieldChanges: string[] = [];
  if (a.kind !== b.kind) fieldChanges.push(`kind ${a.kind}→${b.kind}`);
  if (!deepEqual(a.api, b.api)) fieldChanges.push('api');
  const fa = argFields ? stepFields(a) : [];
  const fb = argFields ? stepFields(b) : [];
  const plus = fb.filter((x) => !fa.includes(x));
  const minus = fa.filter((x) => !fb.includes(x));
  if (plus.length) fieldChanges.push(`字段新增 ${plus.join(',')}`);
  if (minus.length) fieldChanges.push(`字段移除 ${minus.join(',')}`);
  if (strict) {
    if (!deepEqual(a.element, b.element)) fieldChanges.push('element');
    if (!deepEqual(a.ready, b.ready)) fieldChanges.push('ready');
    if (!deepEqual(a.args, b.args)) fieldChanges.push('args');
  }
  return fieldChanges;
}

/** 语义步骤 key：动作 + 目标（接口优先，其次元素），不依赖序号和模型起的步骤名 */
export function stepKey(s: ResolvedFlowStep): string {
  return `${s.kind}:${s.api || s.element || ''}`;
}

/** 用 LCS 对齐步骤 id，生成短 highlights（避免按位「假替换」） */
function chainHighlights(before: ResolvedFlowStep[], after: ResolvedFlowStep[], strict = false, argFields = true): string[] {
  const idOf = (s: ResolvedFlowStep) => (strict ? s.meta_op_id : stepKey(s));
  const seqBefore = before.map(idOf);
  const seqAfter = after.map(idOf);
  const edits = alignStepIds(seqBefore, seqAfter);
  const highlights: string[] = [];

  if (!deepEqual(seqBefore, seqAfter)) {
    highlights.push(`整链：${formatChain(seqBefore)} 变为 ${formatChain(seqAfter)}`);
    highlights.push(...summarizeEdits(edits));
  }

  // 同 id 保留步：比对参数/接口等
  const afterById = new Map<string, ResolvedFlowStep[]>();
  for (const s of after) {
    const list = afterById.get(idOf(s)) ?? [];
    list.push(s);
    afterById.set(idOf(s), list);
  }
  const used = new Map<string, number>();
  for (const a of before) {
    const list = afterById.get(idOf(a));
    if (!list?.length) continue;
    const idx = used.get(idOf(a)) ?? 0;
    const b = list[idx];
    if (!b) continue;
    used.set(idOf(a), idx + 1);
    if (stepFingerprint(a, strict, argFields) === stepFingerprint(b, strict, argFields)) continue;
    const diffs = fieldDiffs(a, b, strict, argFields);
    if (diffs.length) {
      highlights.push(`「${idOf(a)}」变更：${diffs.join('、')}`);
    }
  }

  return highlights;
}


const stemOf = (el: string) => el.toLowerCase().replace(/(btn|button|link|cell|icon|tab)$/g, '').replace(/[^a-z0-9]/g, '');
const flatAttrs = (o: { attrs: { attr: string; before?: unknown; after?: unknown }[] }) =>
  o.attrs.map((a) => `${a.attr}: ${JSON.stringify(a.before ?? null)}→${JSON.stringify(a.after ?? null)}`).join('; ');

/** 按元素名把按钮/表格变更关联到步骤：按钮看图标与点击处理函数名，表格看数据集名 */
function objectLinks(step: ResolvedFlowStep, pageDiff: PageModelDiff | undefined): string[] {
  const el = step.element;
  if (!pageDiff?.comparable || !el) return [];
  const out: string[] = [];
  const stem = stemOf(el);
  if (stem.length >= 3) {
    for (const b of pageDiff.buttons) {
      const names = [b.id.split('/').pop() ?? '', ...(b.hints ?? [])].map((x) => x.toLowerCase().replace(/[^a-z0-9]/g, '')).filter((x) => x.length >= 3);
      if (names.some((tail) => tail === stem || tail.includes(stem) || stem.includes(tail))) {
        out.push(`按钮 ${b.id} ${b.change}${b.attrs.length ? `（${flatAttrs(b)}）` : ''}`);
      }
    }
  }
  const low = el.toLowerCase();
  for (const t of pageDiff.tables) {
    const ds = (t.id.split('/').pop() ?? '').toLowerCase();
    if (low.length >= 5 && ds.includes(low.replace(/(row|cell|link|btn|button)$/g, ''))) {
      out.push(`表格 ${t.id} ${t.change}${t.attrs.length ? `（${flatAttrs(t)}）` : ''}`);
    }
  }
  return out;
}

type Model = { forms: { id: string; fields: { name: string }[] }[] } | undefined;

/** 步骤级变更树：按语义 key（含出现序号）配对；填表单类步骤关联到表单并带出字段级变更 */
function buildStepChanges(
  before: ResolvedFlowStep[],
  after: ResolvedFlowStep[],
  pageDiff: PageModelDiff | undefined,
  mb: Model,
  ma: Model,
  argFields: boolean,
): StepChange[] {
  const keyed = (steps: ResolvedFlowStep[]) => {
    const n = new Map<string, number>();
    return steps.map((s) => {
      const k = stepKey(s);
      const i = (n.get(k) ?? 0) + 1;
      n.set(k, i);
      return { k: i === 1 ? k : `${k}#${i}`, base: k, s };
    });
  };
  const kb = keyed(before);
  const ka = keyed(after);
  const mapB = new Map(kb.map((x) => [x.k, x.s]));
  const mapA = new Map(ka.map((x) => [x.k, x.s]));
  const out: StepChange[] = [];
  const linkForm = (names: string[]): FormChange | undefined => {
    if (!pageDiff?.comparable || !names.length) return undefined;
    let best: FormChange | undefined;
    let bestN = 0;
    for (const f of pageDiff.forms) {
      const all = new Set([
        ...(mb?.forms.find((x) => x.id === f.id)?.fields ?? []).map((x) => x.name),
        ...(ma?.forms.find((x) => x.id === f.id)?.fields ?? []).map((x) => x.name),
      ]);
      const n = names.filter((x) => all.has(x)).length;
      if (n > bestN) {
        best = f;
        bestN = n;
      }
    }
    return best;
  };
  for (const { k, s } of kb) if (!mapA.has(k)) out.push({ key: k, change: 'removed' });
  for (const { k, s } of ka) {
    const b = mapB.get(k);
    if (!b) {
      out.push({ key: k, change: 'added' });
      continue;
    }
    const details = fieldDiffs(b, s, false, argFields);
    const names = [...new Set([...stepFields(b), ...stepFields(s)])];
    const form = s.kind === 'fill_form' || b.kind === 'fill_form' ? linkForm(names) : undefined;
    if (form?.fields.length) details.push('表单字段变更');
    const links = objectLinks(s, pageDiff);
    if (details.length || form?.fields.length || links.length) {
      out.push({ key: k, change: 'modified', ...(details.length ? { details } : {}), ...(links.length ? { object_changes: links } : {}), ...(form ? { form: { id: form.id, fields: form.fields } } : {}) });
    }
  }
  return out;
}

/** 已删除页签/抽屉/表单对应的流程：按名字关联推断 */
function staleReasons(flowId: string, after: ResolvedFlowStep[], pageDiff: PageModelDiff | undefined): string[] {
  if (!pageDiff?.comparable) return [];
  const text = [flowId, ...after.flatMap((s) => [s.element ?? '', s.meta_op_id, s.name])].join(' ').toLowerCase().replace(/[_\s]/g, '');
  const out: string[] = [];
  const check = (kind: string, id: string, token: string) => {
    const t = token.toLowerCase().replace(/[_\s]/g, '');
    if (t.length >= 4 && text.includes(t)) out.push(`${kind} ${id} 已从源码移除`);
  };
  for (const t of pageDiff.tabs) if (t.change === 'removed') check('页签', t.id, t.id.split('/').pop() ?? '');
  for (const p of pageDiff.panels) if (p.change === 'removed') check('面板', p.id, p.id.split('/').pop() ?? '');
  for (const d of pageDiff.drawers) if (d.change === 'removed') check('抽屉', d.id, (d.id.split('/').pop() ?? '').replace(/^_/, '').replace(/drawer$/i, ''));
  return out;
}

/** 以完整流程链为主轴，对齐 before/after 的每条 flow */
export function diffFlowChains(
  beforeArtifact: FeatureArtifact,
  afterArtifact: FeatureArtifact,
  strict = false,
  pageDiff?: PageModelDiff,
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
        unconfirmed: true,
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
        unconfirmed: true,
      });
      continue;
    }
    if (!left || !right) continue;

    const before = resolveFlowChain(left, beforeArtifact);
    const after = resolveFlowChain(right, afterArtifact);
    // 页面结构模型可比时，表单字段以静态提取为准，不再看 LLM 写的 args.fields
    const argFields = !pageDiff?.comparable;
    const same =
      before.length === after.length &&
      before.every((s, i) => stepFingerprint(s, strict, argFields) === stepFingerprint(after[i]!, strict, argFields));
    const title = right.title || left.title;
    const stepChanges = strict ? [] : buildStepChanges(before, after, pageDiff, beforeArtifact.page_model, afterArtifact.page_model, argFields);
    const stale = staleReasons(id, after, pageDiff);
    const extra = {
      ...(stepChanges.length ? { step_changes: stepChanges } : {}),
      ...(stale.length ? { stale_reasons: stale } : {}),
    };
    if (same && !stepChanges.length && !stale.length) {
      out.push({ id, title, change_type: 'unchanged', before, after, highlights: [] });
    } else {
      const hl = same ? [] : chainHighlights(before, after, strict, argFields);
      for (const c of stepChanges) {
        for (const o of c.object_changes ?? []) hl.push(`步骤「${c.key}」关联推断：${o}`);
        if (c.form) hl.push(`步骤「${c.key}」表单 ${c.form.id}：${c.form.fields.map((f) => `${f.change === 'added' ? '+' : f.change === 'removed' ? '-' : '~'}${f.name}`).join(' ')}`);
      }
      for (const r of stale) hl.push(`关联推断：${r}`);
      out.push({ id, title, change_type: 'modified', before, after, highlights: hl, ...extra });
    }
  }

  return out;
}
