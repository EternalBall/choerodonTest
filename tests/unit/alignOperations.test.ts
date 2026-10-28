import test from 'node:test';
import assert from 'node:assert/strict';
import { alignOperations } from '../../src/compare/alignOperations.js';
import { diffFeatureArtifacts } from '../../src/compare/diffArtifact.js';
import type { FeatureArtifact } from '../../src/core/schema.js';

const op = (id: string, extra: Record<string, unknown> = {}) =>
  ({ id, name: id, type: 'update', page_id: 'dispatch', ...extra }) as FeatureArtifact['operations'][number];

const base = (over: Record<string, unknown>) =>
  ({
    feature: 'x',
    operations: [],
    meta_ops: [],
    flows: [],
    ...over,
  }) as unknown as FeatureArtifact;

test('同一接口集合改名后按 before 的 id 对齐，派生的元操作与流程 id 同步还原', () => {
  const before = base({
    operations: [op('dispatch.wo_query@x', { api: '/hmes/v1/x/wo/query' })],
    meta_ops: [{ id: 'click_dispatch.wo_query@x', name: 'm', kind: 'click' }],
    flows: [
      {
        id: 'dispatch.wo_query@x',
        title: 't',
        nodes: [{ id: 'dispatch.wo_query@x_n0', meta_op_id: 'click_dispatch.wo_query@x' }],
        edges: [],
      },
    ],
  });
  const after = base({
    operations: [op('wo_search', { api: '/hmes/v1/x/wo/query' })],
    meta_ops: [{ id: 'click_wo_search', name: 'm', kind: 'click' }],
    flows: [{ id: 'wo_search', title: 't', nodes: [{ id: 'wo_search_n0', meta_op_id: 'click_wo_search' }], edges: [] }],
  });
  const { after: aligned, renamed } = alignOperations(before, after);
  assert.deepEqual(renamed, [{ from: 'dispatch.wo_query@x', to: 'wo_search' }]);
  assert.equal(aligned.operations[0]!.id, 'dispatch.wo_query@x');
  assert.equal(aligned.meta_ops![0]!.id, 'click_dispatch.wo_query@x');
  assert.equal(aligned.flows![0]!.nodes[0]!.meta_op_id, 'click_dispatch.wo_query@x');
});

test('接口无交集不配对，视为新增与移除', () => {
  const before = base({ operations: [op('a', { api: '/hmes/v1/x/a' })] });
  const after = base({ operations: [op('b', { api: '/hmes/v1/x/b' })] });
  const d = diffFeatureArtifacts(before, after);
  assert.deepEqual(d.operation_renames, []);
  assert.deepEqual(d.operations.added.map((o) => o.id), ['b']);
  assert.deepEqual(d.operations.removed.map((o) => o.id), ['a']);
});

test('改名并变更描述的操作计入 changed 而非新增移除', () => {
  const before = base({ operations: [op('dispatch.save@a', { api: '/hmes/v1/x/save', description: '旧' })] });
  const after = base({ operations: [op('save_new', { api: '/hmes/v1/x/save', description: '新' })] });
  const d = diffFeatureArtifacts(before, after);
  assert.equal(d.operations.added.length, 0);
  assert.equal(d.operations.removed.length, 0);
  assert.deepEqual(d.operations.changed.map((c) => c.id), ['dispatch.save@a']);
});
