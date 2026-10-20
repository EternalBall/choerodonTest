import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  compileMetaOpsAndFlows,
  normalizeChainToken,
  normalizeExecutionChain,
} from '../../src/analyzer/compileFlows.js';
import type { FeatureArtifact } from '../../src/core/schema.js';

function baseArtifact(overrides: Partial<FeatureArtifact> = {}): FeatureArtifact {
  return {
    feature: '字段配置',
    entry: { route: '/tarzan/problem-field-config' },
    pages: [
      {
        id: 'config',
        name: '字段配置',
        route: '/tarzan/problem-field-config',
        scope: 'in_feature',
      },
    ],
    operations: [
      {
        id: 'query',
        name: '查询',
        type: 'query',
        page_id: 'config',
        fields: ['fieldType'],
        api: '/v1/{tenantId}/tree/ui',
      },
      {
        id: 'reset',
        name: '重置',
        type: 'other',
        page_id: 'config',
        execution_chain: ['config', 'click_reset'],
      },
      {
        id: 'toggle_hide',
        name: '切换显示',
        type: 'row_action',
        page_id: 'config',
        row_target: {
          area: 'tree',
          control: 'switch',
          column: 'hideFlag',
          element: 'hideFlagSwitch',
        },
      },
    ],
    sources: [],
    confidence: 0.8,
    ...overrides,
  };
}

describe('normalizeChainToken', () => {
  it('maps synonyms and keeps page ids', () => {
    const pages = new Set(['config', 'list']);
    assert.equal(normalizeChainToken('click_query', pages), 'query');
    assert.equal(normalizeChainToken('click_reset', pages), 'reset');
    assert.equal(normalizeChainToken('config', pages), 'config');
    assert.equal(normalizeChainToken('???', pages), null);
  });

  it('dedupes normalized chains', () => {
    const pages = new Set(['config']);
    assert.deepEqual(normalizeExecutionChain(['config', 'click_query', 'search'], pages), [
      'config',
      'query',
    ]);
  });
});

describe('compileMetaOpsAndFlows', () => {
  it('emits meta_ops and one flow per operation', () => {
    const out = compileMetaOpsAndFlows(baseArtifact(), { force: true });
    assert.ok(out.meta_ops && out.meta_ops.length > 0);
    assert.equal(out.flows?.length, 3);
    assert.equal(out.flows![0]!.id, 'query');
    assert.ok(out.flows![0]!.nodes.every((n) => out.meta_ops!.some((m) => m.id === n.meta_op_id)));
  });

  it('rewrites execution_chain to meta_op ids', () => {
    const out = compileMetaOpsAndFlows(baseArtifact(), { force: true });
    const query = out.operations.find((o) => o.id === 'query')!;
    assert.ok(query.execution_chain?.length);
    assert.ok(query.execution_chain!.every((id) => id.startsWith('goto_') || id.includes('_')));
    assert.ok(query.execution_chain!.includes('goto_config'));
    assert.ok(query.execution_chain!.some((id) => id.startsWith('filter_query_')));
  });

  it('is stable across two compiles', () => {
    const a = compileMetaOpsAndFlows(baseArtifact(), { force: true });
    const b = compileMetaOpsAndFlows(baseArtifact(), { force: true });
    assert.deepEqual(
      a.flows!.map((f) => f.nodes.map((n) => n.meta_op_id)),
      b.flows!.map((f) => f.nodes.map((n) => n.meta_op_id)),
    );
    assert.deepEqual(
      a.meta_ops!.map((m) => m.id).sort(),
      b.meta_ops!.map((m) => m.id).sort(),
    );
  });

  it('skips when flows already present unless force', () => {
    const seeded = baseArtifact({
      meta_ops: [{ id: 'goto_config', name: '进页', kind: 'goto', page_id: 'config' }],
      flows: [
        {
          id: 'custom',
          title: '手工',
          source: 'user',
          nodes: [{ id: 'n0', meta_op_id: 'goto_config' }],
          edges: [],
        },
      ],
    });
    const kept = compileMetaOpsAndFlows(seeded);
    assert.equal(kept.flows![0]!.id, 'custom');
    const forced = compileMetaOpsAndFlows(seeded, { force: true });
    assert.equal(forced.flows!.length, 3);
  });

  it('reuses goto meta_op across operations', () => {
    const out = compileMetaOpsAndFlows(baseArtifact(), { force: true });
    const gotos = out.meta_ops!.filter((m) => m.kind === 'goto');
    assert.equal(gotos.length, 1);
    assert.equal(gotos[0]!.id, 'goto_config');
  });
});

describe('compileMetaOpsAndFlows delete', () => {
  it('行编辑模式 delete：编辑 → 增行 → 删行 → 确认 → 保存', () => {
    const art = baseArtifact({
      operations: [
        {
          id: 'delete_line',
          name: '删除行',
          type: 'delete',
          page_id: 'config',
          description: '先增行再删除未落库行',
          preconditions: ['click:editBtn'],
          api: '/v1/save',
        },
      ],
    });
    const out = compileMetaOpsAndFlows(art, { force: true });
    const chain = out.operations[0]!.execution_chain!;
    assert.deepEqual(chain, [
      'goto_config',
      'click_edit_config',
      'add_line_delete_line',
      'remove_line_delete_line',
      'confirm_delete_line',
      'save_delete_line',
    ]);
    const byId = new Map(out.meta_ops!.map((m) => [m.id, m]));
    assert.equal(byId.get('add_line_delete_line')!.element, 'addLineBtn');
    assert.equal(byId.get('remove_line_delete_line')!.element, 'removeLineBtn');
    assert.equal(byId.get('save_delete_line')!.kind, 'click_expect_api');
    assert.equal(byId.get('save_delete_line')!.api, '/v1/save');
  });

  it('普通 delete 仍为原 4 步', () => {
    const art = baseArtifact({
      operations: [
        { id: 'del', name: '删除', type: 'delete', page_id: 'config', api: '/v1/del' },
      ],
    });
    const out = compileMetaOpsAndFlows(art, { force: true });
    assert.deepEqual(out.operations[0]!.execution_chain, [
      'goto_config',
      'click_delete_del',
      'confirm_del',
      'expect_api_del',
    ]);
  });
});


describe('compileMetaOpsAndFlows 带路径参数页面', () => {
  it('沿 page_edges 从入口页导航，不 goto 含 : 的路径', () => {
    const art = baseArtifact({
      entry: { route: '/m/list' },
      pages: [
        { id: 'list', name: '列表', route: '/m/list', scope: 'in_feature' },
        { id: 'detail', name: '详情', route: '/m/dist/:id', scope: 'in_feature' },
        { id: 'site', name: '站点', route: '/m/site/:id', scope: 'in_feature' },
      ],
      page_edges: [
        { id: 'list_to_detail', from_page: 'list', to_page: 'detail', via: 'row_link' },
        {
          id: 'detail_to_site',
          from_page: 'detail',
          to_page: 'site',
          via: 'header_button',
          control: { kind: 'button', name: '站点分配', element: 'siteBtn' },
        },
      ],
      operations: [
        { id: 'update', name: '更新', type: 'update', page_id: 'detail' },
        { id: 'site_update', name: '站点更新', type: 'update', page_id: 'site' },
      ],
    });
    const out = compileMetaOpsAndFlows(art, { force: true });
    for (const m of out.meta_ops!.filter((m) => m.kind === 'goto')) {
      assert.ok(!String(m.args?.path ?? '').includes(':'), `goto ${m.id} 含 :`);
    }
    const update = out.operations.find((o) => o.id === 'update')!;
    assert.deepEqual(update.execution_chain!.slice(0, 2), ['goto_list', 'open_detail_list']);
    const site = out.operations.find((o) => o.id === 'site_update')!.execution_chain!;
    const iClick = site.indexOf('click_detail_to_site');
    assert.ok(iClick >= 0);
    assert.ok(iClick > site.indexOf('open_detail_list'));
    assert.equal(out.meta_ops!.find((m) => m.id === 'click_detail_to_site')!.element, 'siteBtn');
  });
});

describe('行编辑模式下的增行(create)', () => {
  it('需先点编辑再增行，而不是页头新建按钮', () => {
    const art = compileMetaOpsAndFlows(
      baseArtifact({
        pages: [
          { id: 'config', name: '页', route: '/x/config', scope: 'in_feature' },
        ],
        operations: [
          {
            id: 'row_create',
            name: '增行保存',
            type: 'create',
            page_id: 'config',
            scope: 'in_feature',
            initial_mode: 'view',
            unlock: 'click:editBtn',
            preconditions: ['click:editBtn'],
            description: '仅未落库行可选站点：须先增行',
            api: '/v1/{tenantId}/x/save',
          } as never,
        ],
        field_rules: [],
      }),
      { force: true },
    );
    const flow = art.flows!.find((f) => f.id === 'row_create')!;
    const kinds = flow.nodes.map((n) => n.meta_op_id);
    assert.ok(kinds.some((id) => id.startsWith('click_edit_')), '应包含点编辑');
    assert.ok(kinds.some((id) => id.startsWith('add_line_')), '应包含增行');
    assert.ok(!kinds.some((id) => id.startsWith('click_create_')), '不应出现页头新建');
  });
});
