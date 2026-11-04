import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  loadRouteTable,
  parseRouteConfig,
  pickEffectiveFeatureDir,
  resolveFeatureDir,
  resolveRoute,
} from '../../src/analyzer/routeResolve.js';

function writePkg(root: string, pkg: string, config: string) {
  const dir = path.join(root, 'packages', pkg, 'config');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.ts'), config);
}

const PROJ_CFG = `export default defineConfig({ routes: [
  { title: '数据收集组维护', priority: 10, path: '/hmes/acq/dc', routes: [
    { priority: 10, path: '/hmes/acq/dc/list', component: '../routes/acq/Collection/CollectionList' },
    { path: '/hmes/acq/dc/detail/:id', component: '../routes/acq/Collection/CollectionDetail' },
  ] },
  { path: '/hbase/customer/list', component: '@/routes/org/Customer' },
] });`;

const PROD_CFG = `export default defineConfig({ routes: [
  { path: '/hmes/acq/dc', routes: [
    { path: '/hmes/acq/dc/list', component: '@/routes/acq/Collection/CollectionList' },
    { path: '/hmes/acq/dc/detail/:id', component: '@/routes/acq/Collection/CollectionDetail' },
  ] },
  { path: '/hbase/customer/list', component: '@/routes/org/Customer' },
  { path: '/hmes/only-prod', priority: 20, component: '@/routes/OnlyProd' },
] });`;

function fixture() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'route-resolve-'));
  const proj = path.join(tmp, 'proj');
  const prod = path.join(tmp, 'prod');
  writePkg(proj, 'key-hmes-front', PROJ_CFG);
  writePkg(prod, 'hcm-mes-front', PROD_CFG);
  return { tmp, proj, prod };
}

describe('routeResolve', () => {
  it('解析 priority：缺省为 0，子路由继承父路由', () => {
    const defs = parseRouteConfig(PROJ_CFG, 'config.ts', '/p/key-hmes-front');
    const byPath = Object.fromEntries(defs.map((d) => [d.path, d]));
    assert.equal(byPath['/hmes/acq/dc/list'].priority, 10);
    assert.equal(byPath['/hmes/acq/dc/detail/:id'].priority, 10, '继承父路由 priority');
    assert.equal(byPath['/hbase/customer/list'].priority, 0);
    assert.equal(byPath['/hbase/customer/list'].priorityExplicit, false);
    assert.equal(byPath['/hmes/acq/dc/list'].componentAbs, path.resolve('/p/key-hmes-front/src/routes/acq/Collection/CollectionList'));
  });

  it('同一路由取 priority 较大者，不论仓库顺序', async () => {
    const { proj, prod } = fixture();
    const t = await loadRouteTable([prod, proj]);
    const r = resolveRoute(t, '/hmes/acq/dc/list')!;
    assert.ok(r.winner.configFile.startsWith(proj));
    assert.equal(r.ambiguous, false);
    assert.ok(resolveRoute(t, '/hmes/only-prod')!.winner.configFile.startsWith(prod));
  });

  it('priority 相同按仓库根顺序（二开在前）', async () => {
    const { proj, prod } = fixture();
    const r = resolveRoute(await loadRouteTable([proj, prod]), '/hbase/customer/list')!;
    assert.ok(r.winner.configFile.startsWith(proj));
    assert.equal(r.ambiguous, false);
  });

  it('父路由 → 生效组件目录的公共祖先', async () => {
    const { proj, prod } = fixture();
    const r = resolveFeatureDir(await loadRouteTable([proj, prod]), '/hmes/acq/dc')!;
    assert.equal(r.dir, path.join(proj, 'packages/key-hmes-front/src/routes/acq/Collection'));
  });

  it('-d 指向被覆盖的产品源码时报错', async () => {
    const { proj, prod } = fixture();
    const prodDir = path.join(prod, 'packages/hcm-mes-front/src/routes/acq/Collection');
    await assert.rejects(pickEffectiveFeatureDir({ roots: [proj, prod], featureDir: prodDir }), /被更高 priority 的定义覆盖/);
    await assert.rejects(
      pickEffectiveFeatureDir({ roots: [proj, prod], route: '/hmes/acq/dc', featureDir: prodDir }),
      /不是运行时生效的源码/,
    );
    const ok = await pickEffectiveFeatureDir({ roots: [proj, prod], route: '/hmes/acq/dc' });
    assert.equal(ok.featureDir, path.join(proj, 'packages/key-hmes-front/src/routes/acq/Collection'));
  });

  it('同一仓库内优先级并列且组件不同：判为不确定', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'route-amb-'));
    writePkg(tmp, 'a-front', `export default { routes: [{ path: '/x', component: '@/routes/A' }] }`);
    writePkg(tmp, 'b-front', `export default { routes: [{ path: '/x', component: '@/routes/B' }] }`);
    const t = await loadRouteTable([tmp]);
    assert.equal(resolveRoute(t, '/x')!.ambiguous, true);
    await assert.rejects(pickEffectiveFeatureDir({ roots: [tmp], route: '/x' }), /不唯一/);
  });
});
