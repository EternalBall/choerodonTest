import type { FeatureArtifact, Flow, MetaOp } from '../core/schema.js';
import { OperationSchema } from '../core/schema.js';
import type { z } from 'zod';
import { deepEqual } from './deepEqual.js';
import { diffFlowChains, type FlowChainDiff } from './resolveFlow.js';

type Operation = z.infer<typeof OperationSchema>;

export type IdDiff<T> = {
  added: T[];
  removed: T[];
  changed: { id: string; before: T; after: T; fields: string[] }[];
  unchanged: string[];
};

export type ArtifactDiff = {
  operations: IdDiff<Operation>;
  meta_ops: IdDiff<MetaOp>;
  flows: IdDiff<Flow> & { sequenceChanged: { id: string; before: string[]; after: string[] }[] };
  /** 完整流程链比对（主轴） */
  flow_chains: FlowChainDiff[];
  page_states: { changed: boolean; detail?: string };
  field_rules: { changed: boolean; detail?: string };
  validations: { changed: boolean; detail?: string };
  entry: { changed: boolean; detail?: string };
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

export function diffFeatureArtifacts(before: FeatureArtifact, after: FeatureArtifact): ArtifactDiff {
  const operations = diffById(before.operations, after.operations, (op) => {
    const pick: Record<string, unknown> = {};
    for (const f of OP_COMPARE_FIELDS) {
      pick[f] = (op as Operation)[f as keyof Operation];
    }
    return pick;
  });

  const meta_ops = diffById(before.meta_ops, after.meta_ops);
  const flow_chains = diffFlowChains(before, after);

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

  return {
    operations,
    meta_ops,
    flows,
    flow_chains,
    page_states: {
      changed: !deepEqual(before.page_states, after.page_states),
    },
    field_rules: {
      changed: !deepEqual(before.field_rules, after.field_rules),
    },
    validations: {
      changed: !deepEqual(before.validations, after.validations),
    },
    entry: {
      changed: !deepEqual(before.entry, after.entry),
    },
  };
}

/** 路径逻辑是否变更：以完整流程链为主，辅以能力/配套模型 */
export function artifactLogicChanged(diff: ArtifactDiff): boolean {
  if (diff.flow_chains.some((c) => c.change_type !== 'unchanged')) return true;
  if (diff.operations.added.length || diff.operations.removed.length || diff.operations.changed.length) {
    return true;
  }
  if (diff.meta_ops.added.length || diff.meta_ops.removed.length || diff.meta_ops.changed.length) {
    return true;
  }
  if (
    diff.entry.changed ||
    diff.page_states.changed ||
    diff.field_rules.changed ||
    diff.validations.changed
  ) {
    return true;
  }
  return false;
}
