import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractRenderedEditableFields } from '../../src/analyzer/staticExtract.js';
import { pruneUnrenderedFields } from '../../src/analyzer/baselineAnchor.js';
import type { FeatureArtifact } from '../../src/core/schema.js';

const src = `export default () => (<Form>
  <TextField name="a" />
  {/* <TextField name="b" /> */}
  <Lov name={'c'} />
</Form>);
const t = { columns: [{ name: 'd', editor: () => 1 }, { name: 'e' }] };`;

test('只提取实际渲染的控件，忽略注释', () => {
  assert.deepEqual(extractRenderedEditableFields([{ relativePath: 'x.js', content: src }]), ['a', 'c', 'd']);
});

test('剔除未渲染的可编辑字段', () => {
  const art = {
    field_rules: [
      { name: 'a', editable_when: ['edit'] },
      { name: 'b', editable_when: ['edit'] },
      { name: 'e' },
    ],
    operations: [{ id: 'u', steps: [{ args: { fields: ['a', 'b'] } }], fields: ['a', 'b'] }],
  } as unknown as FeatureArtifact;
  const r = pruneUnrenderedFields(art, ['a', 'c', 'd']);
  assert.deepEqual(r.dropped, ['b']);
  assert.deepEqual(r.artifact.field_rules?.map((x) => x.name), ['a', 'e']);
  assert.deepEqual((r.artifact.operations[0] as any).fields, ['a']);
  assert.deepEqual((r.artifact.operations[0] as any).steps[0].args.fields, ['a']);
});
