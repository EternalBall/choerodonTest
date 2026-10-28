import test from 'node:test';
import assert from 'node:assert/strict';
import { assignStableOperationIds, normalizeApi } from '../../src/core/operationId.js';
import type { FeatureArtifact } from '../../src/core/schema.js';

const op = (id: string, extra: Record<string, unknown> = {}) =>
  ({ id, name: id, type: 'update', page_id: 'dispatch', ...extra }) as FeatureArtifact['operations'][number];
const art = (ops: FeatureArtifact['operations']) => ({ feature: 'x', operations: ops }) as unknown as FeatureArtifact;

test('接口归一化去掉版本前缀、租户占位与末尾 ui', () => {
  assert.equal(normalizeApi('/hmes/v1/{organizationId}/dispatch/cancel/ui'), 'dispatch/cancel');
  assert.equal(normalizeApi('/hmes/v1/${organizationId}/wo/dispatched/query?x=1'), 'wo/dispatched/query');
  assert.equal(normalizeApi('/hmes/v1/:tenantId/sort/update/ui'), 'sort/update');
});

test('id 由页面、接口、触发控件生成，与模型给出的 id 无关', () => {
  const out = assignStableOperationIds(
    art([
      op('cancel_dispatch', { api: '/hmes/v1/{organizationId}/dispatch/cancel/ui', entry_control: { element: 'cancelBtn' } }),
      op('query', { type: 'query', api: '/hmes/v1/{organizationId}/wo/query' }),
    ]),
  );
  assert.deepEqual(out.operations.map((o) => o.id), ['dispatch.dispatch_cancel@cancelBtn', 'dispatch.wo_query']);
});

test('同键冲突追加序号，结果与输入顺序无关，有触发锚点的不受影响', () => {
  const a = op('a', { api: '/hmes/v1/x/save', name: '保存甲', entry_control: { element: 'btnA' } });
  const b = op('b', { api: '/hmes/v1/x/save', name: 'B' });
  const c = op('c', { api: '/hmes/v1/x/save', name: 'C' });
  const forward = assignStableOperationIds(art([a, b, c])).operations.map((o) => o.id);
  const reverse = assignStableOperationIds(art([c, b, a])).operations.map((o) => o.id);
  assert.deepEqual(forward, ['dispatch.x_save@btnA', 'dispatch.x_save', 'dispatch.x_save#2']);
  assert.deepEqual(reverse, ['dispatch.x_save#2', 'dispatch.x_save', 'dispatch.x_save@btnA']);
});

test('execution_chain 与 used_by 中的旧 id 同步替换', () => {
  const out = assignStableOperationIds(
    art([
      op('q', { type: 'query', api: '/hmes/v1/x/list' }),
      op('s', { api: '/hmes/v1/x/save', execution_chain: ['q', 's'] }),
    ]),
  );
  assert.deepEqual(out.operations[1]!.execution_chain, ['dispatch.x_list', 'dispatch.x_save']);
});
