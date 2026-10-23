import test from 'node:test';
import assert from 'node:assert/strict';
import { diffFeatureArtifacts, artifactLogicChanged } from '../../src/compare/diffArtifact.js';
import type { FeatureArtifact } from '../../src/core/schema.js';

const model = (fields: { name: string; control?: string; props?: Record<string, string> }[], tabs: string[] = ['t1']) => ({
  forms: [{ id: 'idx/page/ds', file: 'idx.js', container: 'page', ds: 'ds', fields: fields.map((f) => ({ control: 'TextField', ...f })) }],
  tabs: tabs.map((k) => ({ id: `idx/${k}`, key: k, file: 'idx.js' })),
  buttons: [], drawers: [], tables: [],
});
const mk = (pm: unknown, fields: string[]) =>
  ({
    feature: 'x',
    operations: [{ id: 'create', name: 'c', type: 'create' }],
    meta_ops: [
      { id: 'a', name: 'a', kind: 'click', element: 'addBtn' },
      { id: 'b', name: 'b', kind: 'fill_form', args: { fields } },
      { id: 'c', name: 'c', kind: 'click', element: 'saveBtn' },
    ],
    flows: [{ id: 'create', title: '新建', source: 'default', nodes: ['a', 'b', 'c'].map((m, i) => ({ id: `n${i}`, meta_op_id: m })), edges: [] }],
    page_model: pm,
  }) as unknown as FeatureArtifact;

test('新建流程：填表单步骤下钻到字段增删与属性变化', () => {
  const before = mk(model([{ name: 'a' }, { name: 'b' }, { name: 'c' }]), ['a', 'b', 'c']);
  const after = mk(model([{ name: 'a', props: { disabled: 'x' } }, { name: 'c', control: 'Select' }, { name: 'd' }]), ['x']);
  const d = diffFeatureArtifacts(before, after);
  const chain = d.flow_chains[0]!;
  assert.equal(chain.change_type, 'modified');
  const step = chain.step_changes!.find((s) => s.key === 'fill_form:')!;
  assert.deepEqual(step.form!.fields.map((f) => [f.name, f.change]), [['a', 'changed'], ['b', 'removed'], ['c', 'changed'], ['d', 'added']]);
  assert.equal(artifactLogicChanged(d), true);
});

test('页签被删：关联流程标失效；基线无模型则不可比', () => {
  const before = mk(model([{ name: 'a' }], ['t1', 'create']), []);
  const after = mk(model([{ name: 'a' }], ['t1']), []);
  const d = diffFeatureArtifacts(before, after);
  assert.equal(d.page_model.tabs[0]!.change, 'removed');
  assert.ok(d.flow_chains[0]!.stale_reasons?.[0]?.includes('idx/create'));
  const none = diffFeatureArtifacts(mk(undefined, []), after);
  assert.equal(none.page_model.comparable, false);
});
