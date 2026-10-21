import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { discoverEntries, loadPackageAliases, scanRoutes } from '../../src/analyzer/scanRoutes.js';

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'scan-dom-'));
  const pkg = path.join(root, 'packages', 'p-front');
  const w = async (rel: string, text: string) => {
    const f = path.join(pkg, rel);
    await fs.mkdir(path.dirname(f), { recursive: true });
    await fs.writeFile(f, text);
  };
  await w(
    'config/config.ts',
    `export default { extraBabelPlugins: [['module-resolver', { root: ['./'], alias: { '@': './src', '@components': 'lib/components' } }]] };`,
  );
  await w(
    'src/routes/Foo/index.tsx',
    `import { Table, Button, Output } from 'choerodon-ui/pro';
import Sub from '@/components/Sub';
import Lib from 'components/Lov';
export default () => (<div><Button onClick={handleAdd}>新建</Button><Button>出炉</Button><Button icon="x" /><Output name="a" /><Table dataSet={fooDS} /><Sub /><Lib {...props} />{list.map((i) => <Button key={i}>{i}</Button>)}</div>);`,
  );
  await w('src/components/Sub/index.tsx', `import { Button } from 'choerodon-ui/pro';\nexport default () => <Button onClick={handleSave}>保存</Button>;`);
  await w('src/routes/Foo/stores/FooDS.ts', `export const x = 1;`);
  await w('src/routes/Bar/index.js', `import { Table } from 'choerodon-ui/pro';\nexport default () => <div><Table dataSet={aDS} /><Table dataSet={bDS} /></div>;`);
  return root;
}

describe('scanRoutes', () => {
  it('只收本地别名（./ 开头），库别名不收', async () => {
    const root = await fixture();
    const a = await loadPackageAliases(path.join(root, 'packages', 'p-front'));
    assert.deepEqual(Object.keys(a), ['@']);
  });

  it('入口发现：含 index 的目录，跳过 stores', async () => {
    const root = await fixture();
    const e = await discoverEntries(path.join(root, 'packages', 'p-front', 'src', 'routes'));
    assert.equal(e.length, 2);
    assert.ok(e.every((x) => !x.includes('stores')));
  });

  it('端到端：别名跟进、展示组件不计缺口、缺口按原因聚类、动态写法计数', async () => {
    const root = await fixture();
    const { summary, pages } = await scanRoutes({ root });
    assert.equal(pages.length, 2);
    const foo = pages.find((p) => p.entry.includes('Foo'))!;
    // 通过 '@/components/Sub' 别名跟进后，Sub 里的「保存」按钮被绑定（handleSave → btnSave）
    assert.equal(foo.files, 2);
    assert.ok(foo.bound >= 3); // 新建 + 保存 + 单表(kit table)
    assert.equal(foo.causes['button_needs_key_name'], 1); // 出炉（有文案，仅缺语义键名）
    assert.equal(foo.causes['button_icon_only'], 2); // 图标按钮 + .map 里无字面量文案的按钮;
    assert.equal(foo.causes['custom_unresolved:components/Lov'], 1);
    assert.equal(foo.causes['kit_missing:Output'], undefined);
    assert.equal(foo.spreads, 1);
    assert.equal(foo.mapJsx, 1);
    const bar = pages.find((p) => p.entry.includes('Bar'))!;
    // Bar 里两个 Table 均无条件渲染 → 下标稳定，不再算缺口
    assert.equal(bar.causes['multi_table_nth'], undefined);
    assert.equal(bar.causes['multi_table_unstable'], undefined);
    assert.equal(bar.bound, 2);
    assert.equal(summary.total.errors, 0);
  });
});
