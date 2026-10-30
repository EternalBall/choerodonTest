import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalizeElementRefs, ungroundedRefs } from '../../src/analyzer/elementRefs.js';

test('同一页面的不同 ref 前缀统一为 page_id，重复 ref 去重', () => {
  const art = {
    operations: [
      { id: 'a', page_id: 'machine_dispatch', steps: [{ kind: 'click', element: 'dispatch.delTagBtn' }] },
      { id: 'b', page_id: 'machine_dispatch', steps: [{ kind: 'click', element: 'machineDispatch.delTagBtn' }] },
    ],
    meta_ops: [{ id: 'm', page_id: 'machine_dispatch', element: 'dispatch.stationCard' }],
    elements_hints: [
      { ref: 'dispatch.delTagBtn', state: 'data_dependent' },
      { ref: 'machineDispatch.delTagBtn', state: 'data_dependent' },
      { ref: 'dispatch.stationCard', state: 'after:dispatch.tabSend' },
    ],
  };
  const out = canonicalizeElementRefs(art) as typeof art;
  assert.deepEqual(out.operations[0].steps[0].element, 'machine_dispatch.delTagBtn');
  assert.deepEqual(out.operations[1].steps[0].element, 'machine_dispatch.delTagBtn');
  assert.equal(out.meta_ops[0].element, 'machine_dispatch.stationCard');
  assert.deepEqual(out.elements_hints.map((h) => h.ref), ['machine_dispatch.delTagBtn', 'machine_dispatch.stationCard']);
  assert.equal(out.meta_ops[0].element, 'machine_dispatch.stationCard');
});

test('步骤裸名与 hints 前缀对齐到同一规范 ref', () => {
  const art = {
    operations: [{ id: 'a', page_id: 'machine_dispatch', steps: [{ kind: 'click', element: 'loginModal' }] }],
    meta_ops: [],
    elements_hints: [{ ref: 'dispatch.loginModal', state: 'after:x' }],
  };
  const out = canonicalizeElementRefs(art) as typeof art;
  assert.equal(out.elements_hints[0].ref, 'machine_dispatch.loginModal');
  assert.equal(out.operations[0].steps[0].element, 'machine_dispatch.loginModal');
});

test('无 hints 时原样返回', () => {
  const art = { operations: [], elements_hints: [] };
  assert.equal(canonicalizeElementRefs(art), art);
});

test('ungroundedRefs 列出名字在源码中找不到的 ref', () => {
  const miss = ungroundedRefs([{ ref: 'p.okBtn' }, { ref: 'p.ghostBtn' }], "<Button id='okBtn'/>");
  assert.deepEqual(miss, ['p.ghostBtn']);
});
