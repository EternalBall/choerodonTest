import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { delegateChat, type DelegateRunner } from '../../src/analyzer/llmDelegate.js';

const messages = [{ role: 'user' as const, content: 'hello' }];

function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function countingRunner(): { run: DelegateRunner; calls: () => number } {
  let n = 0;
  const run: DelegateRunner = () => {
    n++;
    return { status: 0, stdout: `answer-${n}`, stderr: '', signal: null, pid: 0, output: [], error: undefined } as never;
  };
  return { run, calls: () => n };
}

test('同一请求不同通道不复用应答', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'delegate-cache-'));
  try {
    withEnv({ LLM_HANDOFF_DIR: dir, LLM_HANDOFF_REUSE: undefined }, () => {
      const first = countingRunner();
      withEnv({ LLM_DELEGATE_LANE: 'haiku' }, () => delegateChat({ messages }, first.run));
      const second = countingRunner();
      withEnv({ LLM_DELEGATE_LANE: 'sonnet' }, () => delegateChat({ messages }, second.run));
      assert.equal(first.calls(), 1);
      assert.equal(second.calls(), 1);
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('同一通道同一请求默认复用应答', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'delegate-cache-'));
  try {
    withEnv({ LLM_HANDOFF_DIR: dir, LLM_DELEGATE_LANE: 'sonnet', LLM_HANDOFF_REUSE: undefined }, () => {
      const first = countingRunner();
      const a = delegateChat({ messages }, first.run);
      const second = countingRunner();
      const b = delegateChat({ messages }, second.run);
      assert.equal(second.calls(), 0);
      assert.equal(a.content, b.content);
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('LLM_HANDOFF_REUSE=0 时即使已有应答也重新调用', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'delegate-cache-'));
  try {
    withEnv({ LLM_HANDOFF_DIR: dir, LLM_DELEGATE_LANE: 'sonnet', LLM_HANDOFF_REUSE: undefined }, () => {
      delegateChat({ messages }, countingRunner().run);
    });
    withEnv({ LLM_HANDOFF_DIR: dir, LLM_DELEGATE_LANE: 'sonnet', LLM_HANDOFF_REUSE: '0' }, () => {
      const again = countingRunner();
      delegateChat({ messages }, again.run);
      assert.equal(again.calls(), 1);
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
