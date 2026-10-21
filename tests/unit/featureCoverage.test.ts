import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveHints } from '../../src/analyzer/featureCoverage.js';

const FILES = [
  '/r/packages/a/src/routes/P/List/index.tsx',
  '/r/packages/a/src/routes/P/Detail/index.tsx',
  '/r/packages/a/src/routes/P/Detail/DetailTable.tsx',
  '/r/packages/b/src/routes/Other/DetailTable.tsx',
  '/r/packages/a/src/routes/Material/MaterialList/index.js',
];

describe('resolveHints', () => {
  it('带目录的文件/目录按后缀匹配，stores 与 .ts 跳过', () => {
    const r = resolveHints('P/List/index.tsx + stores/ListDS.ts', FILES);
    assert.deepEqual(r.hits, ['/r/packages/a/src/routes/P/List/index.tsx']);
    assert.deepEqual(r.miss, []);
    assert.deepEqual(resolveHints('Material/MaterialList', FILES).hits, ['/r/packages/a/src/routes/Material/MaterialList/index.js']);
  });
  it('裸文件名只在已命中文件的同目录里找，不误中其他包同名文件', () => {
    const r = resolveHints('P/Detail/index.tsx + DetailTable.tsx', FILES);
    assert.deepEqual(r.hits, ['/r/packages/a/src/routes/P/Detail/index.tsx', '/r/packages/a/src/routes/P/Detail/DetailTable.tsx']);
  });
  it('找不到的 token 进 miss', () => {
    assert.deepEqual(resolveHints('No/Such', FILES).miss, ['No/Such']);
  });
});
