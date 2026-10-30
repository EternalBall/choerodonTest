import test from 'node:test';
import assert from 'node:assert/strict';
import { diffFeatureArtifacts, verificationItems } from '../../src/compare/diffArtifact.js';
import type { FeatureArtifact } from '../../src/core/schema.js';

const op = (id: string, element?: string) =>
  ({ id, name: id, type: 'update', page_id: 'main', steps: [{ kind: 'click', name: id, element: element ?? 'okBtn' }] });

const art = (ops: unknown[], hints: unknown[] = []) =>
  ({ feature: 'x', entry: { route: '/r' }, operations: ops, elements_hints: hints }) as unknown as FeatureArtifact;

test('引用 state=unknown 控件的操作不参与对比，并单独列出', () => {
  const hints = [{ ref: 'hiddenBtn', state: 'unknown' }, { ref: 'okBtn', state: 'always' }];
  const before = art([op('keep'), op('hidden', 'hiddenBtn')], hints);
  const after = art([op('keep'), op('newHidden', 'hiddenBtn'), op('added')], hints);
  const diff = diffFeatureArtifacts(before, after);
  assert.deepEqual(diff.operations.added.map((o) => o.id), ['added']);
  assert.deepEqual(diff.operations.removed, []);
  assert.deepEqual(diff.unverified_operations.sort(), ['hidden', 'newHidden']);
});

test('没有 unknown 控件时行为不变', () => {
  const before = art([op('a')], [{ ref: 'okBtn', state: 'always' }]);
  const after = art([op('a'), op('b')], [{ ref: 'okBtn', state: 'always' }]);
  const diff = diffFeatureArtifacts(before, after);
  assert.deepEqual(diff.operations.added.map((o) => o.id), ['b']);
  assert.deepEqual(diff.unverified_operations, []);
});

test('data_dependent 控件仍参与对比，只有 unknown 被排除', () => {
  const hints = [{ ref: 'delMarkBtn', state: 'data_dependent' }];
  const before = art([op('a', 'delMarkBtn')], hints);
  const after = art([op('a', 'delMarkBtn'), op('b', 'delMarkBtn')], hints);
  const diff = diffFeatureArtifacts(before, after);
  assert.deepEqual(diff.operations.added.map((o) => o.id), ['b']);
  assert.deepEqual(diff.unverified_operations, []);
});

test('verificationItems 列出引用指定状态控件的操作及其说明', () => {
  const hints = [{ ref: 'hiddenBtn', state: 'unknown', note: '源码未找到渲染条件' }, { ref: 'delBtn', state: 'data_dependent', note: '选中行有 tag' }];
  const a = art([op('x', 'hiddenBtn'), op('y', 'delBtn'), op('z')], hints);
  assert.deepEqual(verificationItems(a, 'unknown'), [{ id: 'x', name: 'x', refs: ['hiddenBtn'], notes: ['源码未找到渲染条件'] }]);
  assert.deepEqual(verificationItems(a, 'data_dependent').map((i) => i.id), ['y']);
});
