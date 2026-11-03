import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { roleNamePattern, scopeRelative } from '../../src/keywords/resolveElement.js';

describe('roleNamePattern', () => {
  it('纯文字整体匹配：允许图标字形与字间空格，不匹配更长的按钮名', () => {
    const re = roleNamePattern('新建');
    assert.ok(re.test('新建'));
    assert.ok(re.test(' 新建'));
    assert.ok(re.test('新 建'));
    assert.ok(!re.test('保存并新建'));
  });
  it('含正则元字符时按正则原样使用', () => {
    assert.ok(roleNamePattern('^\\s*数据项信息').test('数据项信息 3'));
    assert.ok(roleNamePattern('确定|确认').test('确认'));
  });
});

describe('scopeRelative', () => {
  it('css 开头与 within 相同 → :scope', () => {
    assert.equal(
      scopeRelative({ css: '.c7n-pro-table thead button' }, { css: '.c7n-pro-table' }).css,
      ':scope thead button',
    );
  });
  it('不同前缀或并集不改', () => {
    assert.equal(scopeRelative({ css: 'thead button' }, { css: '.c7n-pro-table' }).css, 'thead button');
    assert.equal(scopeRelative({ css: '.a b' }, { css: '.a, .c' }).css, '.a b');
  });
});
