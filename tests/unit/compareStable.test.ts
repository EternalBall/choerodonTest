import test from 'node:test';
import assert from 'node:assert/strict';
import { diffFeatureArtifacts, artifactLogicChanged } from '../../src/compare/diffArtifact.js';
import type { FeatureArtifact } from '../../src/core/schema.js';

const mk = (over: Record<string, unknown>) =>
  ({
    feature: 'x',
    operations: [{ id: 'save', name: 'save', type: 'update' }],
    meta_ops: [{ id: 'm1', name: 'm1', kind: 'click', element: 'a', args: { v: 1 } }],
    flows: [{ id: 'save', title: 't', source: 'default', nodes: [{ id: 'n0', meta_op_id: 'm1' }], edges: [] }],
    field_rules: [{ name: 'f', label: '字段', control: 'input', editable_when: ['detail_edit'], note: 'a' }],
    ...over,
  }) as unknown as FeatureArtifact;

test('稳定模式：元素名/args/状态词/note 变化不算逻辑变更', () => {
  const before = mk({});
  const after = mk({
    meta_ops: [{ id: 'm1', name: 'm1', kind: 'click', element: 'b', args: { v: 2 } }],
    field_rules: [{ name: 'f', control: 'input', editable_when: ['drawer_edit'], note: 'b' }],
  });
  assert.equal(artifactLogicChanged(diffFeatureArtifacts(before, after)), false);
  assert.equal(artifactLogicChanged(diffFeatureArtifacts(before, after, { strict: true })), true);
});

test('稳定模式：字段增删与控件类型变化仍能检出', () => {
  const before = mk({});
  const removed = mk({ field_rules: [] });
  const d1 = diffFeatureArtifacts(before, removed);
  assert.deepEqual(d1.field_rules_items.map((x) => [x.key, x.change]), [['f', 'removed']]);
  const changed = mk({ field_rules: [{ name: 'f', label: '字段', control: 'select' }] });
  const d2 = diffFeatureArtifacts(before, changed);
  assert.deepEqual(d2.field_rules_items[0]!.attrs.map((a) => a.attr), ['control']);
});

test('整条流程新增/删除标记为未确认', () => {
  const before = mk({});
  const after = mk({
    flows: [
      ...(mk({}).flows ?? []),
      { id: 'extra', title: 'e', source: 'default', nodes: [{ id: 'n0', meta_op_id: 'm1' }], edges: [] },
    ],
  });
  const d = diffFeatureArtifacts(before, after);
  const extra = d.flow_chains.find((c) => c.id === 'extra')!;
  assert.equal(extra.change_type, 'added');
  assert.equal(extra.unconfirmed, true);
});
