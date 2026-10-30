import test from 'node:test';
import assert from 'node:assert/strict';
import { pageIdFromSource, stabilizePageIds } from '../../src/analyzer/pageIds.js';

test('页面 id 由源码主文件路径派生，index 文件取目录名', () => {
  assert.equal(pageIdFromSource('MachineProductionDispatch/index.js'), 'machine_production_dispatch');
  assert.equal(pageIdFromSource('Material/MaterialSiteAssignment'), 'material_site_assignment');
  assert.equal(pageIdFromSource('MachineProductionDispatch/index.js（+ Component/MachineLoadNew.js）'), 'machine_production_dispatch');
});

test('同一页面在不同版本的 LLM 命名不同时，统一为路径派生 id 并同步改写引用', () => {
  const artifact = {
    pages: [
      { id: 'dispatch', name: '机台派工', route: '/r', source_hint: 'MachineProductionDispatch/index.js' },
      { id: 'list', name: '列表', route: '/r' },
    ],
    page_edges: [{ id: 'dispatch_to_list', from_page: 'dispatch', to_page: 'list' }],
    operations: [
      { id: 'dispatch.query', page_id: 'dispatch', steps: [{ kind: 'goto', page_id: 'dispatch' }, { kind: 'click', page_id: 'list' }] },
    ],
    page_states: [{ id: 's1', page_id: 'dispatch' }],
  };
  const out = stabilizePageIds(artifact) as typeof artifact;
  assert.deepEqual(out.pages.map((p) => p.id), ['machine_production_dispatch', 'list']);
  assert.deepEqual(out.page_edges[0], { id: 'machine_production_dispatch_to_list', from_page: 'machine_production_dispatch', to_page: 'list' });
  assert.equal(out.operations[0].page_id, 'machine_production_dispatch');
  assert.deepEqual(out.operations[0].steps.map((s) => s.page_id), ['machine_production_dispatch', 'list']);
  assert.equal(out.page_states[0].page_id, 'machine_production_dispatch');
});

test('派生 id 与已有 id 冲突时保持原 id，不影响其他页面', () => {
  const artifact = {
    pages: [
      { id: 'a', source_hint: 'Foo/index.js' },
      { id: 'foo', source_hint: 'Bar/index.js' },
    ],
    operations: [],
  };
  const out = stabilizePageIds(artifact) as typeof artifact;
  assert.deepEqual(out.pages.map((p) => p.id), ['a', 'bar']);
});

test('保留页面 id 不被派生覆盖', () => {
  const artifact = {
    pages: [{ id: 'detail', source_hint: 'Material/MaterialDetail/index.js' }],
    operations: [],
  };
  const out = stabilizePageIds(artifact) as typeof artifact;
  assert.deepEqual(out.pages.map((p) => p.id), ['detail']);
});
