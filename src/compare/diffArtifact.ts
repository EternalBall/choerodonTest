import type { FeatureArtifact, Flow, MetaOp } from '../core/schema.js';
import { OperationSchema } from '../core/schema.js';
import type { z } from 'zod';
import { deepEqual } from './deepEqual.js';
import { diffFieldFacts, diffRuleLists, type FieldDiffItem, type ListDiffItem } from './diffFields.js';
import { attachFieldFactsToFlows } from './linkFieldFacts.js';
import { diffFlowChains, type FlowChainDiff } from './resolveFlow.js';
import { diffPageModel, pageModelChanged, type PageModelDiff } from './diffPageModel.js';
import { alignOperations, type OperationRename } from './alignOperations.js';

type Operation = z.infer<typeof OperationSchema>;

export type IdDiff<T> = {
  added: T[];
  removed: T[];
  changed: { id: string; before: T; after: T; fields: string[] }[];
  unchanged: string[];
};

export type ArtifactDiff = {
  /** true：连元素名/args/状态词等自由取值也比；默认 false（稳定模式） */
  strict: boolean;
  operations: IdDiff<Operation>;
  /** 按接口相似度判定为改名、已在对比前还原 id 的操作 */
  operation_renames: OperationRename[];
  meta_ops: IdDiff<MetaOp>;
  flows: IdDiff<Flow> & { sequenceChanged: { id: string; before: string[]; after: string[] }[] };
  /** 完整流程链比对（主轴） */
  flow_chains: FlowChainDiff[];
  page_states: { changed: boolean; detail?: string };
  field_rules: { changed: boolean; detail?: string };
  validations: { changed: boolean; detail?: string };
  entry: { changed: boolean; detail?: string };
  /** 字段级：静态提取的字段事实逐项 diff */
  field_facts: FieldDiffItem[];
  /** 字段级：field_rules / validations / page_states 逐项逐属性 diff（上面的 changed 布尔保留） */
  field_rules_items: ListDiffItem[];
  validations_items: ListDiffItem[];
  page_states_items: ListDiffItem[];
  /** 页面结构（表单/字段/页签/按钮/抽屉/表格）静态模型的逐项 diff */
  page_model: PageModelDiff;
};

const OP_COMPARE_FIELDS = [
  'name',
  'type',
  'api',
  'execution_chain',
  'preconditions',
  'opens',
  'description',
  'initial_mode',
  'page_id',
  'route',
  // 字段级补充：以下字段若 OperationSchema 里不存在，读出来恒为 undefined，不会报错
  'fields',
  'unlock',
  'row_target',
  'api_kind',
  'api_source',
  'scope',
  'entry',
  'from_state',
  'to_state',
] as const;

function diffById<T extends { id: string }>(
  before: T[] | undefined,
  after: T[] | undefined,
  fieldPick?: (item: T) => Record<string, unknown>,
): IdDiff<T> {
  const a = before ?? [];
  const b = after ?? [];
  const mapA = new Map(a.map((x) => [x.id, x]));
  const mapB = new Map(b.map((x) => [x.id, x]));
  const added: T[] = [];
  const removed: T[] = [];
  const changed: IdDiff<T>['changed'] = [];
  const unchanged: string[] = [];

  for (const [id, item] of mapB) {
    if (!mapA.has(id)) added.push(item);
  }
  for (const [id, item] of mapA) {
    if (!mapB.has(id)) removed.push(item);
  }
  for (const [id, left] of mapA) {
    const right = mapB.get(id);
    if (!right) continue;
    if (fieldPick) {
      const fields: string[] = [];
      for (const key of Object.keys(fieldPick(left))) {
        if (!deepEqual(fieldPick(left)[key], fieldPick(right)[key])) fields.push(key);
      }
      if (fields.length) changed.push({ id, before: left, after: right, fields });
      else unchanged.push(id);
    } else if (!deepEqual(left, right)) {
      changed.push({ id, before: left, after: right, fields: ['*'] });
    } else unchanged.push(id);
  }

  return { added, removed, changed, unchanged };
}

export function diffFeatureArtifacts(
  before: FeatureArtifact,
  rawAfter: FeatureArtifact,
  opts?: { strict?: boolean },
): ArtifactDiff {
  const strict = opts?.strict ?? false;
  const { after, renamed: operation_renames } = alignOperations(before, rawAfter);
  const operations = diffById(before.operations, after.operations, (op) => {
    const pick: Record<string, unknown> = {};
    for (const f of OP_COMPARE_FIELDS) {
      pick[f] = (op as Operation)[f as keyof Operation];
    }
    return pick;
  });

  const meta_ops = diffById(before.meta_ops, after.meta_ops);
  const page_model = diffPageModel(before.page_model, after.page_model);
  const field_facts = diffFieldFacts(before.field_facts, after.field_facts);
  const flow_chains = attachFieldFactsToFlows(
    diffFlowChains(before, after, strict, page_model),
    field_facts,
    before,
    after,
  );

  const flowsBase = diffById(before.flows, after.flows);
  const sequenceChanged: ArtifactDiff['flows']['sequenceChanged'] = [];
  for (const chain of flow_chains) {
    if (chain.change_type === 'unchanged') continue;
    const seqA = chain.before.map((s) => s.meta_op_id);
    const seqB = chain.after.map((s) => s.meta_op_id);
    if (!deepEqual(seqA, seqB)) {
      sequenceChanged.push({ id: chain.id, before: seqA, after: seqB });
    }
  }

  const flows = { ...flowsBase, sequenceChanged };
  const lists = diffRuleLists(before, after, strict);

  return {
    strict,
    operations,
    operation_renames,
    meta_ops,
    flows,
    flow_chains,
    page_states: {
      changed: !deepEqual(before.page_states, after.page_states),
    },
    field_rules: {
      changed: strict ? !deepEqual(before.field_rules, after.field_rules) : lists.field_rules.length > 0,
    },
    validations: {
      changed: !deepEqual(before.validations, after.validations),
    },
    entry: {
      changed: !deepEqual(before.entry, after.entry),
    },
    field_facts,
    field_rules_items: lists.field_rules,
    validations_items: lists.validations,
    page_states_items: lists.page_states,
    page_model,
  };
}

/** 路径逻辑是否变更：以完整流程链为主，辅以能力/配套模型 */
export function artifactLogicChanged(diff: ArtifactDiff): boolean {
  if (diff.flow_chains.some((c) => c.change_type !== 'unchanged')) return true;
  if (diff.operations.added.length || diff.operations.removed.length) return true;
  if (pageModelChanged(diff.page_model)) return true;
  if (diff.entry.changed || diff.field_facts.length || diff.field_rules_items.length) return true;
  if (!diff.strict) return false;
  // strict：自由取值（描述、元操作参数、状态词、校验与页面状态）也算变化
  if (diff.operations.changed.length) return true;
  if (diff.meta_ops.added.length || diff.meta_ops.removed.length || diff.meta_ops.changed.length) return true;
  if (diff.page_states.changed || diff.field_rules.changed || diff.validations.changed) return true;
  if (diff.validations_items.length || diff.page_states_items.length) return true;
  return false;
}
