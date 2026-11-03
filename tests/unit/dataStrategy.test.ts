import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Suite } from '../../src/core/schema.js';
import { applyDataStrategy } from '../../src/codegen/dataStrategy.js';

const mk = () =>
  ({
    suite: 's',
    cases: [
      { id: 'Q', title: '查询', tags: ['query'], steps: [{ name: '进详情', action: 'openDetailRow', args: { target: 'n.link' } }] },
      {
        id: 'U',
        title: '编辑',
        tags: ['update'],
        steps: [
          { name: '进详情', action: 'openDetailRow', args: { target: 'n.link' } },
          { name: '点编辑', action: 'click', args: { target: 'n.btnEdit' } },
        ],
      },
      { id: 'C', title: '新建', tags: ['create'], steps: [{ name: '新建', action: 'click', args: { target: 'n.btnCreate' } }] },
      {
        id: 'B',
        title: '批量关闭',
        tags: ['update'],
        steps: [{ name: '勾选', action: 'click', args: { target: 'n.tableRowCheckboxFirst' } }],
      },
    ],
  }) as unknown as Suite;

describe('applyDataStrategy', () => {
  it('写操作进详情限定自有数据并要求后续按钮可用；只读用例与纯新建不动', () => {
    const s = mk();
    applyDataStrategy(s);
    assert.deepEqual(s.cases[0].steps[0].args, { target: 'n.link' });
    assert.deepEqual(s.cases[1].steps[0].args, { target: 'n.link', ownPrefix: '${ENV.TEST_DATA_PREFIX}', requireEnabled: 'n.btnEdit' });
    assert.equal(s.cases[2].steps[0].action, 'click');
  });
  it('批量操作的勾选第一行改为勾选自有数据行', () => {
    const s = mk();
    applyDataStrategy(s);
    assert.equal(s.cases[3].steps[0].action, 'selectTableRow');
    assert.deepEqual(s.cases[3].steps[0].args, { ownPrefix: '${ENV.TEST_DATA_PREFIX}' });
  });
});
