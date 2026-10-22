import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, it } from 'node:test';
import { judgeProbe, needsInteraction, suggestStatus } from '../../src/probe/judge.js';

describe('judgeProbe', () => {
  it('0 个 → missing；不可见 → hidden；多个且无 nth → multiple；其余 ok', () => {
    assert.equal(judgeProbe({ count: 0, firstVisible: false }), 'missing');
    assert.equal(judgeProbe({ count: 2, firstVisible: false }), 'hidden');
    assert.equal(judgeProbe({ count: 3, firstVisible: true }, 'td a'), 'multiple');
    assert.equal(judgeProbe({ count: 3, firstVisible: true }, '.c7n-pro-table >> nth=1'), 'ok');
    assert.equal(judgeProbe({ count: 1, firstVisible: true }), 'ok');
  });
  it('建议状态映射', () => {
    assert.equal(suggestStatus('ok'), 'proposed');
    assert.equal(suggestStatus('missing'), 'needs_review');
    assert.equal(suggestStatus('multiple'), 'needs_review');
  });
  it('弹层/下拉/InModal 定位标记为需要交互', () => {
    assert.ok(needsInteraction('detailTableInModal', '.c7n-pro-table >> nth=0', undefined));
    assert.ok(needsInteraction('x', '.c7n-pro-modal-wrapper button', undefined));
    assert.ok(!needsInteraction('btnSave', undefined, undefined));
  });
});

describe('只读保证', () => {
  it('探测模块源码不含输入/勾选/保存类调用，点击仅限 3 处（选中行、点单号链接、点“编辑”）', () => {
    const src = ['src/probe/probeFeature.ts', 'src/probe/judge.ts'].map((f) => fs.readFileSync(f, 'utf8')).join('\n');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const m of ['.dblclick(', '.fill(', '.type(', '.press(', '.check(', '.uncheck(', '.selectOption(', '.dispatchEvent(', '.setInputFiles(', '.dragTo(', '.pressSequentially(']) {
      assert.ok(!code.includes(m), `不应出现 ${m}`);
    }
    assert.equal((code.match(/\.click\(/g) ?? []).length, 3);
  });
});
