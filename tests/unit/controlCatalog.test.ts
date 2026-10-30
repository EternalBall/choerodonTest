import test from 'node:test';
import assert from 'node:assert/strict';
import { buildControlCatalog } from '../../src/analyzer/controlCatalog.js';

const src = `
import { Button, Modal } from 'hzero-ui';
export default function Page({ flag, rows }) {
  return (
    <div>
      <Button onClick={() => save()}>保存</Button>
      {flag && <Button onClick={() => del()}>删除</Button>}
      {/* <Button>注释掉的按钮</Button> */}
      {rows.length > 0 && <Table />}
    </div>
  );
}
`;

test('控件按渲染结构确定 state：无条件 always，条件渲染 data_dependent，注释掉的不收录', () => {
  const cat = buildControlCatalog([{ relativePath: 'index.js', absolutePath: '/x/index.js', content: src }]);
  const byLabel = Object.fromEntries(cat.map((c) => [c.label, c]));
  assert.equal(byLabel['保存']?.state, 'always');
  assert.equal(byLabel['删除']?.state, 'data_dependent');
  assert.ok(byLabel['删除'].note.startsWith('条件：'));
  assert.equal(cat.some((c) => c.label.includes('注释掉')), false);
});

test('弹窗内的控件 state 为 unknown', () => {
  const modal = `
import { Button, Modal } from 'hzero-ui';
export default function Page() {
  return <Modal visible={true}><Button>确定</Button></Modal>;
}
`;
  const cat = buildControlCatalog([{ relativePath: 'p.js', absolutePath: '/x/p.js', content: modal }]);
  assert.ok(cat.length >= 1);
  assert.ok(cat.every((c) => c.state === 'unknown'));
});

test('label 中的 HTML 实体被还原', () => {
  const ent = `
import { Button } from 'hzero-ui';
export default function P() { return <Button>&lt; 上一班次</Button>; }
`;
  const cat = buildControlCatalog([{ relativePath: 'e.js', absolutePath: '/x/e.js', content: ent }]);
  assert.equal(cat[0]?.label, '< 上一班次');
});

test('Modal.open 弹出的控件 state 为 after:<触发它的控件>', () => {
  const lines = [
    "import { Button, Modal } from 'hzero-ui';",
    'export default function P() {',
    '  const open = () => { Modal.open({ children: <Button>确定</Button> }); };',
    '  return (',
    '    <Button onClick={() => open()}>打开</Button>',
    '  );',
    '}',
  ];
  const cat = buildControlCatalog([{ relativePath: 'p.js', absolutePath: '/x/p.js', content: lines.join('\n') }]);
  const ok = cat.find((c) => c.label === '确定');
  const opener = cat.find((c) => c.label === '打开');
  assert.ok(ok && opener);
  assert.equal(ok.state, `after:p.js:${opener.line}`);
  assert.equal(opener.line, 5);
});

test('useEffect 挂载时调用、内部 Modal.open 的弹窗控件为 always（进入功能自动弹出）', () => {
  const lines = [
    "import React, { useEffect } from 'react';",
    "import { Button, Modal } from 'hzero-ui';",
    'export default function P() {',
    '  const login = () => { Modal.open({ children: <Button>登录</Button> }); };',
    '  useEffect(() => { login(); }, []);',
    '  return <div />;',
    '}',
  ];
  const cat = buildControlCatalog([{ relativePath: 'q.js', absolutePath: '/x/q.js', content: lines.join('\n') }]);
  const btn = cat.find((c) => c.label === '登录');
  assert.equal(btn?.state, 'always');
  assert.ok(btn?.note.includes('自动弹出'));
});
