import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('对比摘要：delegate 模式与 handoff 一样不加载 DeepSeek 配置', () => {
  const src = readFileSync(new URL('../../src/compare/llmSummarizeDiff.ts', import.meta.url), 'utf8');
  assert.match(src, /isHandoffMode\(\)\s*\|\|\s*isDelegateMode\(\)\s*\?\s*undefined\s*:\s*loadDeepSeekConfig\(\)/);
});
