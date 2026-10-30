import test from 'node:test';
import assert from 'node:assert/strict';
import { assignStableOperationIds, normalizeApi } from '../../src/core/operationId.js';
import type { FeatureArtifact } from '../../src/core/schema.js';

const op = (id: string, extra: Record<string, unknown> = {}) =>
  ({ id, name: id, type: 'update', page_id: 'dispatch', ...extra }) as FeatureArtifact['operations'][number];
const art = (ops: FeatureArtifact['operations']) => ({ feature: 'x', operations: ops }) as unknown as FeatureArtifact;

test('接口归一化去掉版本前缀、租户占位与末尾 ui', () => {
  assert.equal(normalizeApi('/v1/{tenantId}/hme-production-capacitys/dispatch/cancel/ui'), 'dispatch/cancel');
  assert.equal(normalizeApi('/v1/${tenantId}/svc/wo/dispatched/query?x=1'), 'wo/dispatched/query');
  assert.equal(normalizeApi('/v1/:tenantId/svc/sort/update/ui'), 'sort/update');
});

test('id 由页面、接口、触发控件生成，与模型给出的 id 无关', () => {
  const out = assignStableOperationIds(
    art([
      op('cancel_dispatch', { api: '/v1/{tenantId}/svc/dispatch/cancel/ui', entry_control: { element: 'cancelBtn' } }),
      op('query', { type: 'query', api: '/v1/{tenantId}/svc/wo/query' }),
    ]),
  );
  assert.deepEqual(out.operations.map((o) => o.id), ['dispatch.dispatch_cancel@cancelBtn', 'dispatch.wo_query']);
});

test('同键冲突用控件 key 区分，结果与输入顺序无关，有触发锚点的不受影响', () => {
  const a = op('a', { api: '/v1/{t}/svc/save', entry_control: { element: 'btnA' } });
  const b = op('b', { api: '/v1/{t}/svc/save', steps: [{ kind: 'fill', name: 'f', element: 'x' }] });
  const c = op('c', { api: '/v1/{t}/svc/save', steps: [{ kind: 'click', name: 'c', element: 'y' }] });
  const idByName = (list: FeatureArtifact['operations']) =>
    Object.fromEntries(assignStableOperationIds(art(list)).operations.map((o) => [o.name, o.id]));
  const forward = idByName([a, b, c]);
  const reverse = idByName([c, b, a]);
  assert.deepEqual(forward, reverse);
  assert.equal(forward.a, 'dispatch.save@btnA');
  assert.deepEqual([forward.b, forward.c].sort(), ['dispatch.save+x', 'dispatch.save+y']);
});

test('execution_chain 与 used_by 中的旧 id 同步替换', () => {
  const out = assignStableOperationIds(
    art([
      op('q', { type: 'query', api: '/v1/{t}/svc/list' }),
      op('s', { api: '/v1/{t}/svc/save', execution_chain: ['q', 's'] }),
    ]),
  );
  assert.deepEqual(out.operations[1]!.execution_chain, ['dispatch.list', 'dispatch.save']);
});
