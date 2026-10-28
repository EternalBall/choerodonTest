import test from 'node:test';
import assert from 'node:assert/strict';
import { anchorToBaseline, formatBaselineForPrompt, repairFromBaseline } from '../../src/analyzer/baselineAnchor.js';
import type { FeatureArtifact } from '../../src/core/schema.js';

const op = (id: string, extra: Record<string, unknown> = {}) =>
  ({ id, name: id, type: 'update', page_id: 'detail', ...extra }) as FeatureArtifact['operations'][number];
const art = (ops: FeatureArtifact['operations']) => ({ feature: 'x', operations: ops }) as unknown as FeatureArtifact;

test('LLM 改了 id 的操作按接口唯一匹配回基线 id，并按基线顺序排序', () => {
  const base = art([op('query', { type: 'query', api: '/a/list' }), op('save', { api: '/a/save' })]);
  const cur = art([op('new_save_name', { api: '/a/save' }), op('query', { type: 'query', api: '/a/list' }), op('extra')]);
  const { artifact, report } = anchorToBaseline(cur, base);
  assert.deepEqual(artifact.operations.map((o) => o.id), ['query', 'save', 'extra']);
  assert.deepEqual(report.renamed, [{ from: 'new_save_name', to: 'save' }]);
  assert.deepEqual(report.added, ['extra']);
  assert.deepEqual(report.removed, []);
});

test('同键多个候选时不猜测，保持原 id', () => {
  const base = art([op('a', { name: 'same' }), op('b', { name: 'same' })]);
  const { artifact } = anchorToBaseline(art([op('c', { name: 'same' })]), base);
  assert.equal(artifact.operations[0]!.id, 'c');
});

test('基线提示块只含骨架信息', () => {
  const text = formatBaselineForPrompt(art([op('save', { api: '/a/save' })]));
  assert.match(text, /基线分析/);
  assert.match(text, /"id":"save"/);
});

test('基线提示块带 step 的 page_id 与基线元素定义', () => {
  const base = {
    feature: 'x',
    operations: [op('save', { steps: [{ kind: 'goto', name: '进入', page_id: 'detail' }] })],
    elements_hints: [{ ref: 'm.saveBtn', role: 'button', name: '保存' }],
  } as unknown as FeatureArtifact;
  const text = formatBaselineForPrompt(base);
  assert.match(text, /"page_id":"detail"/);
  assert.match(text, /"ref":"m.saveBtn"/);
});

const withSteps = (steps: unknown[], hints: unknown[] = [], risks: string[] = []) =>
  ({
    feature: 'x',
    operations: [op('save', { steps })],
    elements_hints: hints,
    review_suggestions: { status: 'pending_human_review', risks },
  }) as unknown as FeatureArtifact;

test('repair：goto 缺 page_id 用能力的 page_id 补全，已有值不覆盖', () => {
  const cur = withSteps([{ kind: 'goto', name: 'a' }, { kind: 'goto', name: 'b', page_id: 'other' }]);
  const { artifact, report } = repairFromBaseline(cur, withSteps([]));
  assert.deepEqual(artifact.operations[0]!.steps!.map((s) => s.page_id), ['detail', 'other']);
  assert.deepEqual(report.filledPageIds, ['save#1']);
});

test('repair：元素缺定义且基线有同名定义时补入并留痕', () => {
  const base = withSteps([], [{ ref: 'm.saveBtn', role: 'button', name: '保存' }]);
  const cur = withSteps([{ kind: 'click', name: 'x', element: 'saveBtn' }]);
  const { artifact, report } = repairFromBaseline(cur, base);
  assert.deepEqual(report.reusedElements, ['saveBtn']);
  assert.equal(artifact.elements_hints!.length, 1);
  assert.ok(artifact.review_suggestions!.risks!.includes('元素定义沿用基线：saveBtn'));
});

test('repair：基线也没有的元素不补，仍交给校验回退', () => {
  const cur = withSteps([{ kind: 'click', name: 'x', element: 'ghostBtn' }]);
  const { artifact, report } = repairFromBaseline(cur, withSteps([]));
  assert.deepEqual(report.reusedElements, []);
  assert.equal(artifact.elements_hints!.length, 0);
});
