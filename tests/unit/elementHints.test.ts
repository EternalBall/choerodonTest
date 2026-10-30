import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLlmJson } from '../../src/analyzer/llmAnalyze.js';

test('elements_hints 保留 state 字段，缺省时不写入', () => {
  const out = normalizeLlmJson(
    {
      elements_hints: [
        { ref: 'loginConfirmBtn', css: 'button.c7n-pro-btn-primary', state: 'after:loginBtn', note: '登录弹窗' },
        { ref: 'editBtn', name: '编辑', state: 'always' },
        { ref: 'legacy', name: '旧' },
      ],
    },
    '机台派工',
  ) as { elements_hints: Array<Record<string, unknown>> };
  const [a, b, c] = out.elements_hints;
  assert.equal(a?.state, 'after:loginBtn');
  assert.equal(b?.state, 'always');
  assert.equal(c?.state, undefined);
});
