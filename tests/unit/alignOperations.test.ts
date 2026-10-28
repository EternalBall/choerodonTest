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

test('无接口信息时按步骤动作序列配对（忽略 @anchor 与 #n 后缀差异）', () => {
  const chain = (id: string, actions: string[]) => actions.map((a) => `${id}${a}`);
  const acts = ['_click_orgswitchbtn', '_fill_form_loginprodlineselect', '_click_expect_api_loginconfirmbtn'];
  const before = base({
    operations: [
      op('dispatch.other@dispatch_orgSwitchBtn', { execution_chain: ['goto_dispatch', ...chain('dispatch.other@dispatch_orgSwitchBtn', acts)] }),
    ],
  });
  const after = base({
    operations: [
      op('dispatch.other#2', {
        execution_chain: ['goto_dispatch', ...chain('dispatch.other#2', [...acts.slice(0, 1), '_fill_form_loginworkcellselect', ...acts.slice(1)])],
      }),
    ],
  });
  const d = diffFeatureArtifacts(before, after);
  assert.deepEqual(d.operation_renames, [{ from: 'dispatch.other@dispatch_orgSwitchBtn', to: 'dispatch.other#2' }]);
  assert.equal(d.operations.added.length, 0);
  assert.equal(d.operations.removed.length, 0);
});

test('同名基础 id 的多个操作按动作序列各自配对，不交叉', () => {
  const ca = ['_click_a', '_fill_form_x', '_assert'];
  const cb = ['_click_b', '_click_expect_api_y', '_assert'];
  const before = base({
    operations: [
      op('dispatch.save@a', { execution_chain: ca.map((x) => `dispatch.save@a${x}`) }),
      op('dispatch.save@b', { execution_chain: cb.map((x) => `dispatch.save@b${x}`) }),
    ],
  });
  const after = base({
    operations: [
      op('dispatch.save#2', { execution_chain: cb.map((x) => `dispatch.save#2${x}`) }),
      op('dispatch.save#3', { execution_chain: ca.map((x) => `dispatch.save#3${x}`) }),
    ],
  });
  const { renamed } = alignOperations(before, after);
  assert.deepEqual(
    [...renamed].sort((x, y) => x.to.localeCompare(y.to)),
    [
      { from: 'dispatch.save@b', to: 'dispatch.save#2' },
      { from: 'dispatch.save@a', to: 'dispatch.save#3' },
    ],
  );
});

test('同 id 但步骤不同的操作不误判为修改，新操作 id 冲突时加 ~added 后缀', () => {
  const before = base({
    operations: [op('dispatch.other#2', { execution_chain: ['dispatch.other#2_click_a', 'dispatch.other#2_click_b', 'dispatch.other#2_assert'] })],
  });
  const after = base({
    operations: [op('dispatch.other#2', { execution_chain: ['dispatch.other#2_fill_form_x', 'dispatch.other#2_click_expect_api_y', 'dispatch.other#2_assert'] })],
  });
  const d = diffFeatureArtifacts(before, after);
  assert.deepEqual(d.operations.changed, []);
  assert.deepEqual(d.operations.removed.map((o) => o.id), ['dispatch.other#2']);
  assert.deepEqual(d.operations.added.map((o) => o.id), ['dispatch.other#2~added']);
});
