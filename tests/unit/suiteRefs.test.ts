import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Suite } from '../../src/core/schema.js';
import { collectCaseRefs, findDanglingRefs, sanitizeGeneratedElements } from '../../src/codegen/suiteRefs.js';

/** 与具体功能无关的假想用例 */
const suite = {
  suite: '示例',
  cases: [
    {
      id: 'TC_A',
      title: '保存',
      steps: [
        { name: '打开', action: 'goto', args: { path: '/x' }, ready: { visible: 'ns1.pageReady' }, screenshot: true },
        { name: '点保存', action: 'clickExpectApi', args: { target: 'ns1.saveBtn', urlIncludes: ['a.b'] }, screenshot: { target: 'ns1.dialog' } },
        { name: '断言', action: 'assert', args: {}, assert: [{ type: 'visible', target: 'ns1.toast' }], screenshot: true },
      ],
    },
    { id: 'TC_B', title: '查询', steps: [{ name: '打开', action: 'goto', args: { path: '/x' }, skipIfMissing: 'ns1.col', screenshot: true }] },
  ],
} as unknown as Suite;

describe('collectCaseRefs', () => {
  it('收集 args / ready / assert / screenshot.target / skipIfMissing 中的引用，忽略非命名空间的点号取值', () => {
    const refs = collectCaseRefs(suite.cases[0], new Set(['ns1']));
    assert.deepEqual(refs, ['ns1.dialog', 'ns1.pageReady', 'ns1.saveBtn', 'ns1.toast']);
  });
});

describe('findDanglingRefs', () => {
  it('只报告元素库里缺失的引用，按用例分组', () => {
    const lib = { ns1: { pageReady: { css: '.p' }, saveBtn: { role: 'button', name: '保存' } } };
    const d = findDanglingRefs(suite, lib);
    assert.deepEqual(d, [
      { caseId: 'TC_A', title: '保存', missing: ['ns1.dialog', 'ns1.toast'] },
      { caseId: 'TC_B', title: '查询', missing: ['ns1.col'] },
    ]);
  });
});

describe('sanitizeGeneratedElements', () => {
  it('只接受界面语义定位，拒绝 css 与不完整定义', () => {
    const r = sanitizeGeneratedElements({
      okTab: { role: 'tab', name: '数据项' },
      okText: { text: '成功' },
      badCss: { css: '.x' },
      noName: { role: 'button' },
      badRole: { role: 'div', name: 'x' },
      'bad-key': { text: 'x' },
    });
    assert.deepEqual(Object.keys(r.accepted).sort(), ['okTab', 'okText']);
    assert.deepEqual(r.rejected.map((x) => x.key).sort(), ['bad-key', 'badCss', 'badRole', 'noName']);
  });
});
