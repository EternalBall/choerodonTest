import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { formatSnippetsForPrompt, retrieveFeatureCode } from '../../src/analyzer/retrieve.js';

describe('retrieveFeatureCode featureDir 模式', () => {
  let root: string;
  const big = 'x'.repeat(20_000); // 超过默认 maxCharsPerFile，用于断言不截断

  before(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'retrieve-dir-'));
    const w = async (rel: string, content: string) => {
      const abs = path.join(root, rel);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, content);
    };
    await w('feat/b.tsx', big);
    await w('feat/a.ts', 'export const a = 1;');
    await w('feat/sub/c.js', 'module.exports = 3;');
    await w('feat/types.d.ts', 'declare const d: number;');
    await w('feat/a.test.ts', 'test');
    await w('feat/a.spec.ts', 'spec');
    await w('feat/node_modules/m/index.js', 'nm');
    await w('feat/__snapshots__/s.ts', 'snap');
    await w('other/outside.ts', 'outside');
  });

  after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('完整内容未截断、顺序确定、排除 d.ts/test/spec，且不含目录外文件', async () => {
    const { snippets } = await retrieveFeatureCode({
      feature: 'ignored',
      projectRoot: root,
      featureDir: 'feat',
    });
    assert.deepEqual(
      snippets.map((s) => s.relativePath),
      ['feat/a.ts', 'feat/b.tsx', 'feat/sub/c.js'],
    );
    assert.equal(snippets.find((s) => s.relativePath === 'feat/b.tsx')!.content, big);
  });

  it('支持绝对路径目录，且结果与相对路径一致', async () => {
    const rel = await retrieveFeatureCode({ feature: 'f', projectRoot: root, featureDir: 'feat' });
    const abs = await retrieveFeatureCode({
      feature: 'f',
      projectRoot: root,
      featureDir: path.join(root, 'feat'),
    });
    assert.deepEqual(abs.snippets, rel.snippets);
  });

  it('formatSnippetsForPrompt 可传入更大上限', async () => {
    const { snippets } = await retrieveFeatureCode({
      feature: 'f',
      projectRoot: root,
      featureDir: 'feat',
    });
    const small = formatSnippetsForPrompt(snippets, 100);
    assert.ok(!small.includes('feat/b.tsx'));
    assert.ok(formatSnippetsForPrompt(snippets, 400_000).includes('feat/sub/c.js'));
  });
});
