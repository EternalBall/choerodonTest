import type { FeatureArtifact, Flow, MetaOp } from '../core/schema.js';
import { OperationSchema } from '../core/schema.js';
import type { z } from 'zod';
import { deepEqual } from './deepEqual.js';

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

function flowNodeSequence(flow: Flow): string[] {
  if (!flow.edges?.length) {
    return flow.nodes.map((n) => n.meta_op_id);
  }
  const out: string[] = [];
  const byId = new Map(flow.nodes.map((n) => [n.id, n]));
  const targets = new Set(flow.edges.map((e) => e.target));
  let start: string | undefined =
    flow.nodes.find((n) => !targets.has(n.id))?.id ?? flow.nodes[0]?.id;
  const seen = new Set<string>();
  while (start && !seen.has(start)) {
    seen.add(start);
    const node = byId.get(start);
    if (node) out.push(node.meta_op_id);
    const edge = flow.edges.find((e) => e.source === start);
    start = edge?.target;
  }
  if (out.length < flow.nodes.length) {
    for (const n of flow.nodes) {
      if (!out.includes(n.meta_op_id)) out.push(n.meta_op_id);
    }
  }
  return out;
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

  const flowsBase = diffById(before.flows, after.flows);
  const sequenceChanged: ArtifactDiff['flows']['sequenceChanged'] = [];
  for (const id of flowsBase.unchanged) {
    const fA = before.flows?.find((f) => f.id === id);
    const fB = after.flows?.find((f) => f.id === id);
    if (!fA || !fB) continue;
    const seqA = flowNodeSequence(fA);
    const seqB = flowNodeSequence(fB);
    if (!deepEqual(seqA, seqB)) sequenceChanged.push({ id, before: seqA, after: seqB });
  }
  for (const c of flowsBase.changed) {
    sequenceChanged.push({
      id: c.id,
      before: flowNodeSequence(c.before),
      after: flowNodeSequence(c.after),
    });
  }

  const flows = { ...flowsBase, sequenceChanged };

  return {
    operations,
    meta_ops,
    flows,
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
