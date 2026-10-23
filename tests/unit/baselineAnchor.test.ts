import test from 'node:test';
import assert from 'node:assert/strict';
import { anchorToBaseline, formatBaselineForPrompt } from '../../src/analyzer/baselineAnchor.js';
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
