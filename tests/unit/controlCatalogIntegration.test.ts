import test from 'node:test';
import assert from 'node:assert/strict';
import { applyControlCatalog, catalogPromptBlock, type CatalogControl } from '../../src/analyzer/controlCatalog.js';
import { refName } from '../../src/analyzer/elementRefs.js';
import { canonicalizeElementRefs } from '../../src/analyzer/elementRefs.js';

const cat: CatalogControl[] = [
  { id: 'p/a.js|Button|保存||save', file: 'p/a.js', line: 3, tag: 'Button', label: '保存', state: 'always', note: '' },
  { id: 'p/a.js|Button|取消||close', file: 'p/a.js', line: 4, tag: 'Button', label: '取消', state: 'after:p/a.js|Button|保存||save', note: '点击后弹出' },
];

test('语义 id 原样作为引用键，不做前缀归一', () => {
  assert.equal(refName(cat[0].id), cat[0].id);
  const art = { operations: [{ id: 'x', steps: [{ kind: 'click', element: cat[1].id }] }], elements_hints: cat.map((c) => ({ ref: c.id })) };
  assert.equal(canonicalizeElementRefs(art), art);
});

test('applyControlCatalog 用目录替换 elements_hints，并找出不在目录中的步骤引用', () => {
  const raw = {
    operations: [{ id: 'o', steps: [{ kind: 'click', element: cat[0].id }, { kind: 'click', element: 'p/a.js|Button|臆造||' }] }],
    meta_ops: [{ id: 'm', element: cat[1].id }],
    elements_hints: [{ ref: 'old.name' }],
  };
  const r = applyControlCatalog(raw, cat);
  assert.equal((r.artifact.elements_hints as Array<{ ref: string }>).length, 2);
  assert.equal((r.artifact.elements_hints as Array<{ ref: string }>)[0].ref, cat[0].id);
  assert.deepEqual(r.unverified, ['p/a.js|Button|臆造||']);
});

test('catalogPromptBlock 列出每个控件的 id、标签与状态', () => {
  const block = catalogPromptBlock(cat);
  assert.ok(block.includes(cat[0].id));
  assert.ok(block.includes('after:'));
  assert.ok(block.includes('唯一可用的控件'));
});
