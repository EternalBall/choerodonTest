import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { scopeFieldCss, ACTIVE_MODAL_CSS } from '../../src/knowledge/platformKit.js';
import { pruneJsxSource } from '../../src/analyzer/pruneJsx.js';
import { bindPage } from '../../src/analyzer/kitBinding.js';

describe('scopeFieldCss', () => {
  it('.page-content 前缀改写为「活动弹层内，否则页面主体内」', () => {
    const css = scopeFieldCss('.page-content input[name="a"]');
    assert.equal(css, `${ACTIVE_MODAL_CSS} input[name="a"], body:not(:has(${ACTIVE_MODAL_CSS})) .page-content input[name="a"]`);
  });
  it('非 .page-content 前缀或已是并集的不改', () => {
    assert.equal(scopeFieldCss('.c7n-pro-table'), '.c7n-pro-table');
    assert.equal(scopeFieldCss('.page-content a, .page-content b'), '.page-content a, .page-content b');
    assert.equal(scopeFieldCss('.page-content-wrap'), '.page-content-wrap');
  });
});

describe('kitBinding · 页签', () => {
  it('TabPane 按 tab 文案各绑一个 key；动态文案记缺口', () => {
    const src = `
import { Tabs } from 'choerodon-ui';
const P = () => (
  <Tabs>
    <Tabs.TabPane tab={intl.get('a').d('数据项信息')} key="a" />
    <Tabs.TabPane tab="关联对象" key="b" />
    <Tabs.TabPane tab={title} key="c" />
  </Tabs>
);`;
    const f = pruneJsxSource(src, 'a/index.tsx');
    const r = bindPage({ entry: 'a/index.tsx', files: [f], followed: [] }, '测试', 'feat_t');
    const tabs = Object.values(r.locators).filter((d) => d.kit === 'tabsTab').map((d) => d.text);
    assert.deepEqual(tabs, ['数据项信息', '关联对象']);
    assert.ok(r.gaps.some((g) => g.cause === 'tab_label_dynamic'));
  });
});
