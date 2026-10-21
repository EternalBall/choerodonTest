import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pruneJsxSource } from '../../src/analyzer/pruneJsx.js';
import { bindPage, tableKeyFromDataSet } from '../../src/analyzer/kitBinding.js';
import { applyQualityGates, hasCommaUnion } from '../../src/analyzer/validateLocate.js';

const SRC = `
import { Table, Button, Lov, TextField } from 'choerodon-ui/pro';
import { Button as PermissionButton } from 'components/Permission';
import { Header, Content } from 'components/Page';
import Fancy from './Fancy';
import Remote from '@/components/Remote';
const columns = [
  { name: 'docNum', renderer: ({ value }) => <a onClick={go}>{value}</a> },
  { name: 'plain' },
];
const P = () => (
  <div>
    <Header>
      <PermissionButton onClick={handleCreate}>{intl.get('x.create').d('新建')}</PermissionButton>
      <PermissionButton>出炉</PermissionButton>
    </Header>
    <Content>
      <Table dataSet={headerDS} columns={columns} />
      <Table dataSet={lineDs} />
      <Lov name="materialLov" />
      <TextField name="remark" />
      <Remote />
    </Content>
  </div>
);
`;

function page() {
  const f = pruneJsxSource(SRC, 'a/index.tsx');
  return { entry: 'a/index.tsx', files: [f], followed: [] };
}

describe('pruneJsx', () => {
  it('识别 kind、字面量文案与 onClick 处理函数名', () => {
    const f = pruneJsxSource(SRC, 'a/index.tsx');
    const flat: string[] = [];
    const walk = (n: any) => { flat.push(`${n.tag}:${n.kind}:${n.text ?? ''}`); n.children.forEach(walk); };
    f.roots.forEach(walk);
    assert.ok(flat.includes('PermissionButton:c7n:新建'));
    assert.ok(flat.includes('Header:custom:'));
    assert.ok(flat.some((x) => x.startsWith('Remote:custom')));
    assert.equal(f.columns.find((c) => c.name === 'docNum')?.link?.tag, 'a');
    assert.equal(f.columns.find((c) => c.name === 'docNum')?.group, 'columns');
  });
});

describe('kitBinding', () => {
  it('Table 键来自 dataSet，多实例用 nth 并标 needs_review', () => {
    assert.equal(tableKeyFromDataSet('purchaseListDS'), 'purchaseListTable');
    assert.equal(tableKeyFromDataSet('headerBindTableDs'), 'headerBindTable');
    const r = bindPage(page(), '测试', 'feat_t');
    assert.equal(r.locators.headerTable.css, '.c7n-pro-table >> nth=0');
    assert.equal(r.locators.headerTable.status, 'needs_review');
    assert.equal(r.locators.lineTable.css, '.c7n-pro-table >> nth=1');
    assert.ok(r.gaps.some((g) => g.type === 'ambiguous_multi_instance'));
  });
  it('按钮：有处理函数名才起键，否则留 unbound + suggest；列内链接 within 表', () => {
    const r = bindPage(page(), '测试', 'feat_t');
    assert.partialDeepStrictEqual(r.locators.btnCreate, { role: 'button', name: '新建' });
    const unbound = r.pages[0].nodes.find((n) => n.name === '出炉');
    assert.equal(unbound?.locator_status, 'unbound');
    assert.deepEqual(unbound?.suggest, { role: 'button', name: '出炉' });
    assert.partialDeepStrictEqual(r.locators.docNumLink, { css: 'td[data-index="docNum"] a', within: 'feat_t.headerTable' });
  });
  it('字段 Lov/TextField 复用 cssForFieldRule；未展开自定义组件进 unresolved_custom 且不绑定', () => {
    const r = bindPage(page(), '测试', 'feat_t');
    assert.ok(r.locators.materialLovOpen.css!.includes('input[name="materialLov"]'));
    assert.ok(r.locators.remark.css!.includes('input.c7n-pro-input[name="remark"]'));
    const remote = r.pages[0].nodes.find((n) => n.component === 'Remote');
    assert.equal(remote?.locator_status, 'unresolved_custom');
    assert.ok(r.gaps.some((g) => g.type === 'unresolved_custom'));
  });
});

describe('quality gates', () => {
  const base = () => bindPage(page(), '测试', 'feat_t');
  it('逗号并集 css 被 blocked，序号 key 被 blocked，confidence 降低', () => {
    assert.equal(hasCommaUnion('a, b'), true);
    assert.equal(hasCommaUnion('input[name="a,b"]'), false);
    const r = base();
    r.locators.element_3 = { css: '.x', evidence: 'e' };
    r.locators.bad = { css: '.a, .b', evidence: 'e' };
    const { result, violations } = applyQualityGates(r, { kitKeys: new Set(['table']) });
    assert.equal(result.locators.element_3.status, 'blocked');
    assert.equal(result.locators.bad.status, 'blocked');
    for (const g of [3, 4]) assert.ok(violations.some((v) => v.gate === g));
    assert.ok(result.confidence < r.confidence);
    assert.equal(result.elements_draft.feat_t?.bad, undefined);
  });
  it('custom 被标 bound 会被撤销；无 evidence 的定位降为 needs_review', () => {
    const r = base();
    const remote = r.pages[0].nodes.find((n) => n.component === 'Remote')!;
    remote.locator_status = 'bound';
    r.locators.noEv = { css: '.y' };
    const { result, violations } = applyQualityGates(r, { kitKeys: new Set() });
    assert.equal(result.pages[0].nodes.find((n) => n.component === 'Remote')!.locator_status, 'unresolved_custom');
    assert.equal(result.locators.noEv.status, 'needs_review');
    for (const g of [6, 8]) assert.ok(violations.some((v) => v.gate === g));
  });
  it('c7n 叶子 unbound 视同 needs_kit 并进 gaps；非法 slug 大幅降分', () => {
    const r = base();
    const { result } = applyQualityGates({ ...r, slug: '' }, { kitKeys: new Set() });
    const n = result.pages[0].nodes.find((x) => x.name === '出炉')!;
    assert.equal(n.locator_status, 'needs_kit');
    assert.ok(result.gaps.some((g) => g.node_id === n.id && g.type === 'needs_kit'));
    assert.ok(result.confidence < 0.4);
  });
});

describe('按钮语义键名与库组件归属', () => {
  it('buttonKeyFromText：纯字母直接用，常见中文查表，未知返回 undefined', async () => {
    const { buttonKeyFromText } = await import('../../src/analyzer/btnKeys.js');
    assert.equal(buttonKeyFromText('Clear'), 'btnClear');
    assert.equal(buttonKeyFromText('保存并新建下一条'), 'btnSaveAndNext');
    assert.equal(buttonKeyFromText('出炉'), undefined);
  });

  it('无处理函数名的带文案按钮：词表命中则 bound，未命中仍 unbound + suggest', () => {
    const src = `import { Button } from 'choerodon-ui/pro';
const P = () => (<div><Button>删除</Button><Button>出炉</Button></div>);`;
    const r = bindPage({ entry: 'a', files: [pruneJsxSource(src, 'a/index.tsx')], followed: [] }, 't', 'feat_t');
    assert.partialDeepStrictEqual(r.locators.btnDelete, { role: 'button', name: '删除' });
    const n = r.pages[0].nodes.find((x) => x.name === '出炉')!;
    assert.equal(n.locator_status, 'unbound');
    assert.deepEqual(n.suggest, { role: 'button', name: '出炉' });
  });

  it('库别名来自 tsconfig paths；已登记库组件记 lib_known/needs_probe，未登记记 lib_unknown，且不产出 css', async () => {
    const os = await import('node:os');
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const { loadLibAliases, matchLibAlias } = await import('../../src/analyzer/libComponents.js');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'libal-'));
    await fs.writeFile(
      path.join(dir, 'tsconfig.json'),
      `{ /* 注释 */ "compilerOptions": { "paths": { "components/*": ["./node_modules/hzero-front/lib/components/*"], "@components/*": ["./node_modules/hcm-components-front/lib/components/*"], "@/*": ["./src/*"] } } }`,
    );
    const la = await loadLibAliases(dir);
    assert.deepEqual(la, { components: 'hzero-front', '@components': 'hcm-components-front' });
    assert.equal(matchLibAlias('@components/tarzan-ui', la)?.pkg, 'hcm-components-front');
    assert.equal(matchLibAlias('@/components/x', la), null);

    const src = `import Lov from 'components/Lov';
import Foo from 'components/Foo';
import { Table } from 'choerodon-ui/pro';
const P = () => (<div><Lov code="X" /><Foo /></div>);`;
    const r = bindPage({ entry: 'a', files: [pruneJsxSource(src, 'a/index.tsx')], followed: [] }, 't', 'feat_t', { libAliases: la });
    const lov = r.pages[0].nodes.find((x) => x.component === 'Lov')!;
    const foo = r.pages[0].nodes.find((x) => x.component === 'Foo')!;
    assert.equal(lov.locator_status, 'needs_probe');
    assert.equal(foo.locator_status, 'unresolved_custom');
    assert.ok(r.gaps.some((g) => g.cause === 'lib_known:hzero-front/components/Lov'));
    assert.ok(r.gaps.some((g) => g.cause === 'lib_unknown:hzero-front:components/Foo'));
    assert.equal(Object.keys(r.locators).length, 0);
  });
});
