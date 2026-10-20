import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extractFieldFacts } from '../../src/analyzer/staticExtract.js';

export const SAMPLE = `
import { FieldType, FieldIgnore } from 'choerodon-ui/pro/lib/data-set/enum';
import intl from 'utils/intl';

export const tableDS = () => ({
  queryFields: [
    { name: 'materialCode', type: FieldType.string, label: intl.get('hpdl.material.code').d('物料编码') },
  ],
  fields: [
    {
      name: 'materialCode',
      type: FieldType.string,
      label: intl.get('hpdl.material.code').d('物料编码'),
      required: true,
      maxLength: 30,
      ignore: FieldIgnore.clean,
      dynamicProps: {
        disabled: ({ record }) => !record.get('editable'),
      },
    },
    {
      name: 'uomId',
      type: FieldType.object,
      lovCode: 'HPDL.UOM',
      lovPara: { tenantId: 0, nested: { enabled: true } },
      textField: 'uomName',
    },
    { notAField: 1 },
  ],
});

export function detailDS() {
  return {
    fields: [{ name: 'materialCode', type: FieldType.number, min: -1, readOnly: false }],
  };
}
`;

describe('extractFieldFacts', () => {
  const facts = extractFieldFacts([{ relativePath: 'src/ds.ts', content: SAMPLE }]);

  it('按出现顺序提取，并区分 ds / group', () => {
    assert.deepEqual(
      facts.map((f) => `${f.ds}::${f.group}::${f.name}`),
      [
        'tableDS::queryFields::materialCode',
        'tableDS::fields::materialCode',
        'tableDS::fields::uomId',
        'detailDS::fields::materialCode',
      ],
    );
    assert.equal(facts[0]!.file, 'src/ds.ts');
  });

  it('枚举取成员名、intl.get().d() 取中文、字面量原样', () => {
    const f = facts[1]!;
    assert.equal(f.attrs.type, 'string');
    assert.equal(f.attrs.label, '物料编码');
    assert.equal(f.attrs.required, true);
    assert.equal(f.attrs.maxLength, 30);
    assert.equal(f.attrs.ignore, 'clean');
    assert.equal('name' in f.attrs, false);
  });

  it('dynamicProps 箭头函数记 expr，lovPara 递归成对象', () => {
    const dyn = facts[1]!.attrs.dynamicProps as Record<string, { expr: string }>;
    assert.equal(dyn.disabled!.expr, "({ record }) => !record.get('editable')");
    assert.deepEqual(facts[2]!.attrs.lovPara, { tenantId: 0, nested: { enabled: true } });
    assert.equal(facts[2]!.attrs.lovCode, 'HPDL.UOM');
  });

  it('负数与 false 字面量', () => {
    assert.equal(facts[3]!.attrs.min, -1);
    assert.equal(facts[3]!.attrs.readOnly, false);
  });

  it('表达式超长截断到 300 字符，取不到名字用 (anonymous)', () => {
    const long = 'a'.repeat(500);
    const out = extractFieldFacts([
      { relativePath: 'a.js', content: `export default { fields: [{ name: 'x', validator: ${long} }] };` },
    ]);
    assert.equal(out[0]!.ds, '(anonymous)');
    assert.equal((out[0]!.attrs.validator as { expr: string }).expr.length, 300);
  });

  it('文件按路径排序，非代码文件忽略', () => {
    const src = (n: string) => `const d = { fields: [{ name: '${n}' }] };`;
    const out = extractFieldFacts([
      { relativePath: 'b.ts', content: src('b') },
      { relativePath: 'a.tsx', content: src('a') },
      { relativePath: 'c.md', content: src('c') },
    ]);
    assert.deepEqual(out.map((f) => f.name), ['a', 'b']);
  });
});
