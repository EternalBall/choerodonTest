import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  detectChoerodonComponents,
  loadPlaybookIndex,
  loadPlaybooks,
  selectPlaybooks,
} from '../../src/knowledge/loadPlaybooks.js';

const index = await loadPlaybookIndex();
const docs = await loadPlaybooks();
const ids = (sources: string[]) =>
  selectPlaybooks(docs, index, detectChoerodonComponents(sources, index.dataset_hints)).map((d) => d.id);

describe('detectChoerodonComponents', () => {
  it('带 /pro 的导入归 pro，不带的归 legacy', () => {
    const d = detectChoerodonComponents([
      `import React from 'react';
import { Table, Select as S, DataSet } from 'choerodon-ui/pro';
import { Popconfirm, Tag } from 'choerodon-ui';`,
    ]);
    assert.deepEqual([...d.pro].sort(), ['dataset', 'select', 'table']);
    assert.deepEqual([...d.legacy].sort(), ['popconfirm', 'tag']);
  });

  it('支持 lib 目录默认导入与更深路径', () => {
    const d = detectChoerodonComponents([
      `import DatePicker from 'choerodon-ui/pro/lib/date-picker';
import Column from 'choerodon-ui/pro/lib/table/Column';
import InputNumber from 'choerodon-ui/lib/input-number';`,
    ]);
    assert.deepEqual([...d.pro].sort(), ['datepicker', 'table']);
    assert.deepEqual([...d.legacy], ['inputnumber']);
  });

  it('不跨语句误吞前面的花括号导入', () => {
    const d = detectChoerodonComponents([
      `import { useState } from 'react'\nimport { Lov } from 'choerodon-ui/pro'`,
    ]);
    assert.deepEqual([...d.pro], ['lov']);
  });

  it('DataSet 字段 lovCode / lookupCode 视同 Pro Lov / Select', () => {
    const d = detectChoerodonComponents([`fields: [{ name: 'uom', lovCode: 'MT.UOM' }]`], index.dataset_hints);
    assert.deepEqual([...d.pro], ['lov']);
  });
});

describe('selectPlaybooks', () => {
  it('Pro Table 选 Pro 表格手册，不选旧版', () => {
    const r = ids([`import { Table } from 'choerodon-ui/pro';`]);
    assert.ok(r.includes('choerodon-table-row-edit'));
    assert.ok(!r.includes('choerodon-legacy-table'));
  });

  it('旧版 Table 选旧版手册，不选 Pro', () => {
    const r = ids([`import { Table } from 'choerodon-ui';`]);
    assert.ok(r.includes('choerodon-legacy-table'));
    assert.ok(!r.includes('choerodon-table'));
  });

  it('通用手册始终在最前', () => {
    const r = ids([`import { Tag } from 'choerodon-ui';`]);
    assert.deepEqual(r.slice(0, index.always.length), index.always);
  });

  it('未识别到任何导入时用 fallback', () => {
    const r = ids([`import Foo from '@/components/Foo';`]);
    assert.deepEqual(r.slice(0, index.always.length), index.always);
    assert.deepEqual(new Set(r), new Set([...index.always, ...index.fallback]));
  });
});
