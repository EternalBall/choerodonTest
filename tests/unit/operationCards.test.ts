import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { describeElement, humanizeCss, renderOperationCards } from '../../src/cards/operationCards.js';

describe('operationCards', () => {
  const lib = {
    modal: { css: '.c7n-pro-modal-wrapper:visible' },
    saveBtn: { role: 'button', name: '^\\s*保存\\s*$' },
    typeMaterial: { text: '物料', within: 'feat_x.modal' },
  };
  it('元素描述：role+name 去掉正则锚点，within 展开作用域', () => {
    assert.equal(describeElement('saveBtn', lib), 'button「保存」');
    assert.match(describeElement('typeMaterial', lib), /文字「物料」；范围：（在当前弹层内）/);
    assert.match(describeElement('nope', lib), /元素库无定义/);
  });
  it('css 转可读提示', () => {
    assert.match(humanizeCss('.page-content .c7n-pro-select-wrapper:has(input[name="objectLov"]) .icon-search'), /字段 name=objectLov的 LOV 放大镜/);
    assert.match(humanizeCss('.page-head button:has(.icon-save)'), /带 icon-save 图标的按钮（页头）/);
  });
  it('卡片：不含预期、带取证接口与必填、按动作挂要点', () => {
    const md = renderOperationCards({
      feature: '演示', slug: 'feat_x',
      cases: [{ id: 'c1', title: '演示 - 新建', steps: [
        { action: 'fillForm', name: '填写', args: { fields: [{ name: 'code', control: 'input' }] } },
        { action: 'clickExpectApi', name: '保存', args: { target: 'feat_x.saveBtn', urlIncludes: ['a/save'] } },
      ] }],
      lib, fieldRules: [{ name: 'code', label: '编码', required: true }],
      notes: [{ id: 'n1', applies: ['clickExpectApi'], note: '看响应体' }, { id: 'n2', applies: ['pickLov'], note: '无关' }],
    });
    assert.match(md, /编码（name=code，input，必填）/);
    assert.match(md, /保存：button「保存」；取证接口：`a\/save`/);
    assert.match(md, /要点：\[n1\]$/m);
    assert.doesNotMatch(md, /要点：.*\[n2\]/);
  });
});

import { scopeFieldCss } from '../../src/knowledge/platformKit.js';
describe('表头控件作用域', () => {
  it('thead 控件限定到 .page-content 内激活页签，并兼容弹层与无页签', () => {
    const css = scopeFieldCss('.c7n-pro-table thead button:has(.icon-add)');
    assert.match(css, /^\.c7n-pro-modal-wrapper:visible \.c7n-pro-table thead/);
    assert.match(css, /\.page-content \.c7n-tabs-tabpane-active \.c7n-pro-table thead/);
    assert.match(css, /:not\(:has\(\.page-content \.c7n-tabs-tabpane-active\)\) \.page-content \.c7n-pro-table thead/);
  });
});

