import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractPageModel } from '../../src/analyzer/pageModel.js';
import { extractFieldFacts } from '../../src/analyzer/staticExtract.js';

const ds = `export const detailDS = () => ({ fields: [
  { name: 'a', type: FieldType.string, label: intl.get('x').d('甲'), required: true },
  { name: 'b', type: FieldType.string, dynamicProps: { required({ record }) { return record.get('a') === 'Y'; } } },
  { name: 'c', bind: 'cLov.cId' },
] });`;
const ui = `export default () => (<div>
  <Button icon="save" onClick={save}>{intl.get('s').d('保存')}</Button>
  <Form disabled={!canEdit} dataSet={detailDs}>
    <TextField name="a" />
    <Switch name="b" disabled={(detailDs.toData()[0] || {}).a !== 'N'} />
    {/* <TextField name="gone" /> */}
    <Lov name="c" />
  </Form>
  <Tabs><TabPane tab={intl.get('t').d('类别')} key="category"></TabPane></Tabs>
</div>);
function open() { _drawer = Modal.open({ title: '抽屉', children: <Form record={record}><TextField name="a" /></Form> }); }`;

test('提取表单/字段/依赖/带出/页签/按钮/抽屉', () => {
  const files = [
    { relativePath: 'stores/ds.ts', content: ds },
    { relativePath: 'Detail/index.js', content: ui },
  ];
  const m = extractPageModel(files, extractFieldFacts(files));
  assert.equal(m.forms.length, 2);
  const main = m.forms.find((f) => f.ds === 'detailDs')!;
  assert.deepEqual(main.fields.map((f) => f.name), ['a', 'b', 'c']);
  assert.equal(main.disabled, '!canEdit');
  const b = main.fields.find((f) => f.name === 'b')!;
  assert.deepEqual(b.depends_on, ['a']);
  assert.equal(main.fields.find((f) => f.name === 'a')!.ds_attrs?.required, true);
  assert.deepEqual(main.fields.find((f) => f.name === 'c')!.derived_from, ['cLov']);
  assert.deepEqual(m.tabs.map((t) => [t.key, t.title]), [['category', '类别']]);
  assert.equal(m.buttons[0]!.text, '保存');
  assert.deepEqual(m.drawers.map((d) => d.title), ['抽屉']);
  assert.equal(m.forms.find((f) => f.container === '_drawer')!.fields.length, 1);
});
