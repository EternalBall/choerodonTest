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
  assert.equal(ok.state, `after:${opener.id}`);
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

test('语义指纹 id 不随行号变化：上方插入控件不改变其它控件的 id', () => {
  const base = "import { Button, Modal } from 'hzero-ui';\nexport default function P() {\n  return (\n    <div>\n      <Button onClick={() => save()}>保存</Button>\n    </div>\n  );\n}\n";
  const shifted = base.replace('<div>', '<div>\n      <Button>新增</Button>');
  const a = buildControlCatalog([{ relativePath: 's.js', absolutePath: '/x/s.js', content: base }]);
  const b = buildControlCatalog([{ relativePath: 's.js', absolutePath: '/x/s.js', content: shifted }]);
  const idA = a.find((c) => c.label === '保存')?.id;
  const idB = b.find((c) => c.label === '保存')?.id;
  assert.ok(idA);
  assert.equal(idA, idB);
  assert.notEqual(a.find((c) => c.label === '保存')?.line, b.find((c) => c.label === '保存')?.line);
});

test('同指纹控件加 #序号并标记 ambiguous', () => {
  const dup = "import { Button } from 'hzero-ui';\nexport default function P() {\n  return (<div><Button>取消</Button><Button>取消</Button></div>);\n}\n";
  const cat = buildControlCatalog([{ relativePath: 'd.js', absolutePath: '/x/d.js', content: dup }]);
  const cancels = cat.filter((c) => c.label === '取消');
  assert.equal(cancels.length, 2);
  assert.ok(cancels.every((c) => c.ambiguous === true));
  assert.notEqual(cancels[0].id, cancels[1].id);
  assert.ok(cancels[1].id.endsWith('#2'));
});

test('无文案的控件 label 不带行号，只用组件名', () => {
  const noText = "import { Button } from 'hzero-ui';\nexport default function P() {\n  return <div>\n    <Button />\n  </div>;\n}\n";
  const cat = buildControlCatalog([{ relativePath: 'n.js', absolutePath: '/x/n.js', content: noText }]);
  assert.equal(cat[0]?.label, 'Button');
  assert.ok(!cat[0].id.includes('@'));
});

test('onClick 内联箭头：带字面量参数的调用取 fn(\'lit\')，区分同函数不同参数的按钮', () => {
  const two = [
    "import { Button } from 'hzero-ui';",
    'export default function P({ flag }) {',
    '  const del = async (f) => f;',
    '  return (<div>',
    "    {flag ? <Button onClick={() => del('sended')}>删除标记</Button>",
    "      : <Button onClick={() => del('send')}>删除标记</Button>}",
    '  </div>);',
    '}',
  ].join('\n');
  const cat = buildControlCatalog([{ relativePath: 't.js', absolutePath: '/x/t.js', content: two }]);
  const ids = cat.map((c) => c.id.split('|')[4]);
  assert.deepEqual(ids, ["del('sended')", "del('send')"]);
  assert.ok(cat.every((c) => !c.ambiguous));
});

test('onClick 内联复杂逻辑不取内部标识符，指纹为空', () => {
  const inline = "import { Button } from 'hzero-ui';\nexport default function P() {\n  return <Button onClick={() => { setA(1); setB(2); }}>确定</Button>;\n}\n";
  const cat = buildControlCatalog([{ relativePath: 'i.js', absolutePath: '/x/i.js', content: inline }]);
  assert.equal(cat[0].id, 'i.js|Button|确定||');
});

test('所在容器取最近一层带文案的 Tab，指纹随页签变化而区分', () => {
  const tabs = [
    "import { Button, Tabs, Tab } from 'hzero-ui';",
    'export default function P() {',
    '  return (<Tabs>',
    "    <Tab tab={intl.get('a.x').d('已派工单')}><Button>查询</Button></Tab>",
    "    <Tab tab={intl.get('a.y').d('待派工单')}><Button>查询</Button></Tab>",
    '  </Tabs>);',
    '}',
  ].join('\n');
  const cat = buildControlCatalog([{ relativePath: 'tb.js', absolutePath: '/x/tb.js', content: tabs }]);
  const btns = cat.filter((c) => c.tag === 'Button');
  assert.deepEqual(btns.map((c) => c.id.split('|')[3]), ['Tab:已派工单', 'Tab:待派工单']);
  assert.ok(btns.every((c) => !c.ambiguous));
});

test('Table 按绑定的数据集及其请求地址区分，不再同名冲突', () => {
  const ds = [
    "const Host = 'h';",
    'const tenantId = 1;',
    'const aDS = () => ({',
    '  transport: { read: () => ({ url: `${Host}/v1/${tenantId}/x/a/query` }) },',
    '});',
    'const bDS = () => ({',
    '  transport: { read: () => ({ url: `${Host}/v1/${tenantId}/x/b/info` }) },',
    '});',
  ].join('\n');
  const page = [
    "import { Table } from 'hzero-ui';",
    "import { aDS, bDS } from './ds';",
    'export default function P() {',
    '  const dsA = new DataSet({ ...aDS() });',
    '  const dsB = new DataSet({ ...bDS() });',
    '  return (<div>',
    '    <Table dataSet={dsA} />',
    '    <Table dataSet={dsB} />',
    '  </div>);',
    '}',
  ].join('\n');
  const cat = buildControlCatalog([
    { relativePath: 'ds.js', absolutePath: '/x/ds.js', content: ds },
    { relativePath: 'p.js', absolutePath: '/x/p.js', content: page },
  ]);
  const tables = cat.filter((c) => c.tag === 'Table');
  assert.equal(tables.length, 2);
  assert.ok(tables.every((c) => !c.ambiguous));
  assert.equal(tables[0].id.split('|')[4], 'dataSet:dsA@/v1/x/a/query');
  assert.equal(tables[1].id.split('|')[4], 'dataSet:dsB@/v1/x/b/info');
});

test('同一函数被多个点击调用时，after 记录全部触发控件（triggers），state 取首个', () => {
  const two = [
    "import { Button, Modal } from 'hzero-ui';",
    'export default function P() {',
    '  const detail = (id) => { Modal.open({ title: intl.get(`a.b`).d("详情"), children: <Button>确定</Button> }); };',
    '  return (<div>',
    '    <a onClick={() => { detail(1); }}>甲</a>',
    '    <a onClick={() => { detail(2); }}>乙</a>',
    '  </div>);',
    '}',
  ].join('\n');
  const cat = buildControlCatalog([{ relativePath: 'm.js', absolutePath: '/x/m.js', content: two }]);
  const ok = cat.find((c) => c.label === '确定');
  const aJia = cat.find((c) => c.label === '甲');
  const aYi = cat.find((c) => c.label === '乙');
  assert.ok(ok && aJia && aYi);
  assert.deepEqual(ok.triggers, [aJia.id, aYi.id]);
  assert.equal(ok.state, `after:${aJia.id}`);
  assert.equal(aJia.triggers, undefined);
});

test('三元条件分支的备注显示条件文本（不是字符偏移），否定侧标为“非”', () => {
  const tern = [
    "import { Button } from 'hzero-ui';",
    'export default function P({ btnFlag }) {',
    '  return (<div>',
    "    {btnFlag ? <Button>甲</Button> : <Button>乙</Button>}",
    '  </div>);',
    '}',
  ].join('\n');
  const cat = buildControlCatalog([{ relativePath: 'tn.js', absolutePath: '/x/tn.js', content: tern }]);
  const yes = cat.find((c) => c.label === '甲');
  const no = cat.find((c) => c.label === '乙');
  assert.ok(yes && no);
  assert.ok(yes.note.includes('btnFlag') && !/\d{3,}/.test(yes.note));
  assert.ok(no.note.includes('非(btnFlag)'));
});
