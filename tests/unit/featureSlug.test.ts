import test from 'node:test';
import assert from 'node:assert/strict';
import { featureSlug } from '../../src/knowledge/featureSlug.js';

test('中文功能名按整名哈希，首字相同不撞号', () => {
  const a = featureSlug('物料维护');
  const b = featureSlug('物料站点属性维护');
  assert.match(a, /^feat_[0-9a-f]{8}$/);
  assert.notEqual(a, b);
  assert.equal(featureSlug('物料维护'), a);
});

test('含英文字母的名字仍转小写下划线 slug', () => {
  assert.equal(featureSlug('MaterialSiteProperties'), 'materialsiteproperties');
});
