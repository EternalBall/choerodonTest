import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { planAdoption, ADOPT_NOTE_PREFIX } from '../../src/probe/adopt.js';
import { buildDelegateTask, delegateChat } from '../../src/analyzer/llmDelegate.js';

const rep = (items: unknown[]) => ({ items }) as never;

describe('planAdoption', () => {
  const reports = [
    { label: 'r1', report: rep([
      { key: 'btnSave', verdict: 'ok', stage: 'edit', def: { role: 'button', name: '保存', evidence: 'x' } },
      { key: 'poLineIdLink', verdict: 'missing', def: { css: 'a' } },
      { key: 'headerRowAny', verdict: 'ok', def: { css: 'tr' } },
    ]) },
    { label: 'r2', report: rep([
      { key: 'btnSave', verdict: 'ok', stage: 'create', def: { role: 'button', name: '保存' } },
      { key: 'poLineIdLink', verdict: 'ok', def: { css: 'td a', within: 's.lineTable' } },
    ]) },
  ];
  it('只采纳 ok；只保留定位字段；先出现的报告优先；已有条目不动；其它报告里通过的算通过', () => {
    const existing = { headerRowAny: { css: 'tr.row', note: '人工' } };
    const p = planAdoption(existing, reports, '2026-10-22');
    assert.deepEqual(p.added.sort(), ['btnSave', 'poLineIdLink']);
    assert.deepEqual(p.keptExisting, ['headerRowAny']);
    assert.deepEqual(p.notOk, []);
    assert.equal(p.merged.headerRowAny.note, '人工');
    assert.equal(p.merged.btnSave.name, '保存');
    assert.ok(!('evidence' in p.merged.btnSave));
    assert.match(String(p.merged.btnSave.note), /2026-10-22 UAT 只读探测通过（r1，编辑态/);
  });
  it('--refresh 只重写上次由本命令写入的条目，人工条目仍不动', () => {
    const existing = { btnSave: { role: 'button', name: '旧', note: `2026-10-01 ${ADOPT_NOTE_PREFIX}（x）` }, headerRowAny: { css: 'a', note: '人工' } };
    const p = planAdoption(existing, reports, '2026-10-22', { refresh: true });
    assert.deepEqual(p.refreshed, ['btnSave']);
    assert.equal(p.merged.btnSave.name, '保存');
    assert.equal(p.merged.headerRowAny.note, '人工');
  });
});

describe('delegateChat', () => {
  it('调用 bird-delegate 并把校验通过的应答落成 response.txt；非法 JSON 报错', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dlg-'));
    process.env.LLM_HANDOFF_DIR = dir;
    try {
      const calls: string[][] = [];
      const ok = (args: string[]) => {
        const out = args[args.indexOf('--output-file') + 1];
        fs.writeFileSync(out, '{"a":1}', 'utf8');
        return { status: 0, stdout: '', stderr: '' } as never;
      };
      const r = delegateChat({ messages: [{ role: 'user', content: 'hi' }], responseFormatJson: true }, (cmd, args) => { calls.push([cmd, ...args]); return ok(args); });
      assert.equal(r.content, '{"a":1}');
      assert.equal(calls[0][0], 'bird-delegate');
      assert.ok(calls[0].includes('--lane') && calls[0].includes('haiku'));
      assert.ok(fs.readdirSync(dir).some((f) => f.endsWith('.response.txt')));
      // 同请求再来一次直接复用，不再调用
      delegateChat({ messages: [{ role: 'user', content: 'hi' }], responseFormatJson: true }, () => { throw new Error('不应再调用'); });
      assert.throws(() => delegateChat({ messages: [{ role: 'user', content: 'bad' }], responseFormatJson: true }, (_c, args) => {
        fs.writeFileSync(args[args.indexOf('--output-file') + 1], 'not json', 'utf8');
        return { status: 0, stdout: '', stderr: '' } as never;
      }), /不是合法 JSON/);
    } finally {
      delete process.env.LLM_HANDOFF_DIR;
    }
  });
  it('任务描述明确只做文本生成', () => {
    const t = buildDelegateTask('/x/req.json', false);
    assert.match(t, /不要修改、创建或删除任何文件/);
    assert.match(t, /\/x\/req\.json/);
  });
});
