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

describe('dropSelfReady', () => {
  it('点击后等「被点元素自身可见」的 ready 被去掉，其它 ready 保留', async () => {
    const { dropSelfReady } = await import('../../src/codegen/suiteRefs.js');
    const lib = {
      ns1: {
        editBtn: { role: 'button', name: '编辑' },
        viewReady: { role: 'button', name: '编辑', note: '详情就绪' },
        saveBtn: { css: '.save' },
      },
    };
    const s = {
      suite: 'x',
      cases: [{
        id: 'C', title: 't', steps: [
          { name: '点编辑', action: 'click', args: { target: 'ns1.editBtn' }, ready: { visible: 'ns1.viewReady' }, screenshot: true },
          { name: '点编辑2', action: 'click', args: { target: 'ns1.editBtn' }, ready: { visible: 'ns1.saveBtn' }, screenshot: true },
        ],
      }],
    } as unknown as Suite;
    const fixes = dropSelfReady(s, lib);
    assert.equal(fixes.length, 1);
    assert.equal(s.cases[0].steps[0].ready, undefined);
    assert.deepEqual(s.cases[0].steps[1].ready, { visible: 'ns1.saveBtn' });
  });
});

describe('findDanglingRefs · 定位不唯一', () => {
  it('ambiguous 定义（含 within 链）按不可用报告并带原因', () => {
    const lib = {
      ns1: {
        pageReady: { css: '.p' },
        saveBtn: { role: 'button', name: '保存', within: 'box' },
        box: { css: '.c7n-tabs-tab', ambiguous: '缺实例文案' },
        dialog: { css: '.d' },
        toast: { css: '.t' },
        col: { css: '.c' },
      },
    };
    const d = findDanglingRefs(suite, lib);
    assert.deepEqual(d, [{ caseId: 'TC_A', title: '保存', missing: ['ns1.box（缺实例文案）'] }]);
  });
});
