import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extractFieldFacts } from '../../src/analyzer/staticExtract.js';
import { diffFieldFacts, diffRuleLists } from '../../src/compare/diffFields.js';
import { renderReportMarkdown } from '../../src/compare/renderReportMarkdown.js';

const extract = (content: string) => extractFieldFacts([{ relativePath: 'ds.ts', content }]);

const BEFORE = extract(`
const tableDS = () => ({
  fields: [
    { name: 'code', type: FieldType.string, required: false, lookupCode: 'HPDL.A',
      dynamicProps: { disabled: ({ record }) => record.get('a') } },
    { name: 'old', type: FieldType.string },
  ],
});`);

const AFTER = extract(`
const tableDS = () => ({
  fields: [
    { name: 'code', type: FieldType.string, required: true, lookupCode: 'HPDL.B',
      validator: (v) => !!v,
      dynamicProps: { disabled: ({ record }) => record.get('b') } },
    { name: 'fresh', type: FieldType.number },
  ],
});`);

describe('diffFieldFacts', () => {
  const diff = diffFieldFacts(BEFORE, AFTER);
  const byName = (n: string) => diff.find((d) => d.name === n)!;

  it('识别新增 / 删除字段并列出全部属性，结果按 key 排序', () => {
    assert.equal(byName('fresh').change, 'added');
    assert.deepEqual(byName('fresh').attrs.map((a) => a.attr), ['type']);
    assert.equal(byName('old').change, 'removed');
    const keys = diff.map((d) => d.key);
    assert.deepEqual(keys, [...keys].sort());
    assert.equal(byName('fresh').key, 'tableDS::fields::fresh');
  });

  it('changed 仅列出不等属性：required、validator、lookupCode、dynamicProps', () => {
    const code = byName('code');
    assert.equal(code.change, 'changed');
    const attrs = Object.fromEntries(code.attrs.map((a) => [a.attr, a]));
    assert.deepEqual(Object.keys(attrs).sort(), ['dynamicProps', 'lookupCode', 'required', 'validator']);
    assert.equal(attrs.required!.before, false);
    assert.equal(attrs.required!.after, true);
    assert.equal(attrs.validator!.before, undefined);
    assert.deepEqual(attrs.validator!.after, { expr: '(v) => !!v' });
    assert.equal(attrs.lookupCode!.after, 'HPDL.B');
    assert.notDeepEqual(attrs.dynamicProps!.before, attrs.dynamicProps!.after);
  });

  it('无变化 / 缺省入参返回空；ds 改名视为删除+新增', () => {
    assert.deepEqual(diffFieldFacts(BEFORE, BEFORE), []);
    assert.deepEqual(diffFieldFacts(undefined, undefined), []);
    const renamed = extract(`const otherDS = { fields: [{ name: 'old' }] };`);
    const d = diffFieldFacts(BEFORE.filter((f) => f.name === 'old'), renamed);
    assert.deepEqual(d.map((x) => x.change).sort(), ['added', 'removed']);
  });

  it('同名字段在不同 ds 互不干扰', () => {
    const a = extract(`const aDS = { fields: [{ name: 'x', required: true }] }; const bDS = { fields: [{ name: 'x', required: true }] };`);
    const b = extract(`const aDS = { fields: [{ name: 'x', required: true }] }; const bDS = { fields: [{ name: 'x', required: false }] };`);
    const d = diffFieldFacts(a, b);
    assert.equal(d.length, 1);
    assert.equal(d[0]!.key, 'bDS::fields::x');
  });
});

describe('diffRuleLists', () => {
  it('field_rules 按 name（同名加序号）、validations/page_states 按 id', () => {
    const d = diffRuleLists(
      {
        field_rules: [{ name: 'a', required: false }, { name: 'a' }],
        validations: [{ id: 'v1', name: 'n' }],
        page_states: [{ id: 'p1' } as never],
      },
      {
        field_rules: [{ name: 'a', required: true }, { name: 'a' }],
        validations: [{ id: 'v1', name: 'n' }, { id: 'v2', name: 'm' }],
        page_states: [],
      },
    );
    assert.deepEqual(d.field_rules.map((x) => [x.key, x.change]), [['a#1', 'changed']]);
    assert.deepEqual(d.validations.map((x) => [x.key, x.change]), [['v2', 'added']]);
    assert.deepEqual(d.page_states.map((x) => [x.key, x.change]), [['p1', 'removed']]);
  });
});

describe('renderReportMarkdown 字段级变更', () => {
  const report = {
    report_version: '2' as const,
    feature: 'F',
    logic_changed: true,
    summary: 's',
    flows: [],
  };

  it('无变更写「无字段级变化」', () => {
    assert.match(renderReportMarkdown(report as never), /无字段级变化/);
  });

  it('按 数据集 → 字段 → 属性 渲染并带中文标签', () => {
    const md = renderReportMarkdown(report as never, {
      field_facts: diffFieldFacts(BEFORE, AFTER),
      field_rules: [],
      validations: [],
      page_states: [],
    });
    assert.match(md, /数据集 \*\*tableDS\*\*/);
    assert.match(md, /字段 \*\*code\*\*/);
    assert.match(md, /\[必输性\] required: `false` → `true`/);
    assert.match(md, /\[值集\] lookupCode: `HPDL.A` → `HPDL.B`/);
    assert.match(md, /\[校验\] validator: （无） → `\(v\) => !!v`/);
    assert.match(md, /\[联动\] dynamicProps/);
  });
});
