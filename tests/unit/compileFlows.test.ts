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

describe('头行联动与抽屉', () => {
  const art = (): FeatureArtifact =>
    baseArtifact({
      feature: '送货单',
      entry: { route: '/p/list' },
      pages: [
        { id: 'list', name: '列表', route: '/p/list', scope: 'in_feature' },
        { id: 'order', name: '订单', route: '/o/list', scope: 'external' },
      ],
      page_edges: [
        {
          id: 'list_to_order',
          from_page: 'list',
          to_page: 'order',
          via: 'row_link',
          control: { kind: 'link', name: '订单号', element: 'poLink' },
        },
      ],
      operations: [
        {
          id: 'sign',
          name: '签收确认',
          type: 'row_action',
          page_id: 'list',
          api: '/v1/x/sign',
          execution_chain: ['list', 'query', 'click_header_row', 'select_line_row', 'sign', 'confirm_modal'],
        },
        {
          id: 'mlt',
          name: '创建物料批',
          type: 'create',
          page_id: 'list',
          api: '/v1/x/save',
          entry_control: { kind: 'button', name: '创建物料批', element: 'createMltBtn' },
          execution_chain: ['list', 'query', 'select_header_row', 'select_line_rows', 'open_drawer', 'fill', 'save'],
        },
        {
          id: 'po',
          name: '跳转订单',
          type: 'related_page',
          page_id: 'order',
          scope: 'external',
          execution_chain: ['list', 'query', 'click_header_row', 'po'],
        },
      ],
    } as Partial<FeatureArtifact>);

  const kinds = (a: FeatureArtifact, flowId: string) => {
    const flow = a.flows!.find((f) => f.id === flowId)!;
    return flow.nodes.map((n) => a.meta_ops!.find((m) => m.id === n.meta_op_id)!);
  };

  it('签收确认：点头行→勾选行→点按钮→确认，接口挂在确认上', () => {
    const steps = kinds(compileMetaOpsAndFlows(art(), { force: true }), 'sign');
    assert.deepEqual(
      steps.map((s) => s.id),
      [
        'goto_list',
        'filter_query_list',
        'click_header_row_list',
        'select_line_row_list',
        'action_sign',
        'confirm_modal_sign',
      ],
    );
    assert.equal(steps[4]!.kind, 'click');
    assert.equal(steps[5]!.kind, 'click_expect_api');
    assert.equal(steps[5]!.api, '/v1/x/sign');
  });

  it('创建物料批：不套用「新建」模板，而是 勾选→开抽屉→填写→保存', () => {
    const steps = kinds(compileMetaOpsAndFlows(art(), { force: true }), 'mlt');
    const ids = steps.map((s) => s.id);
    assert.ok(!ids.includes('click_create_list'));
    assert.deepEqual(ids.slice(2), [
      'click_header_row_list',
      'select_line_row_list',
      'open_drawer_mlt',
      'fill_mlt',
      'drawer_save_mlt',
    ]);
    const save = steps.find((s) => s.id === 'drawer_save_mlt')!;
    assert.equal(save.element, 'drawerBodySaveBtn');
    assert.equal(save.kind, 'click_expect_api');
    assert.equal(steps.find((s) => s.id === 'open_drawer_mlt')!.element, 'createMltBtn');
  });

  it('Modal.confirm 用 confirmModalOk，Popconfirm 的 confirm 仍是 confirmBtn', () => {
    const a = compileMetaOpsAndFlows(art(), { force: true });
    assert.equal(kinds(a, 'sign').pop()!.element, 'confirmModalOk');
  });

  it('下拉菜单：先点触发按钮，再按文本点菜单项，接口挂在菜单项上', () => {
    const base = art();
    base.operations!.push({
      id: 'st',
      name: '状态变更-取消',
      type: 'row_action',
      page_id: 'list',
      api: '/v1/x/status',
      entry_control: { kind: 'button', name: '状态变更', element: 'changeStatusBtn' },
      row_target: { control: 'button', column: '取消' },
      execution_chain: ['list', 'query', 'select_header_row', 'open_dropdown', 'click_menu_item'],
    } as never);
    const steps = kinds(compileMetaOpsAndFlows(base, { force: true }), 'st');
    const tail = steps.slice(-2);
    assert.equal(tail[0]!.element, 'changeStatusBtn');
    assert.equal(tail[1]!.element, 'dropdownMenuItem');
    assert.equal(tail[1]!.kind, 'click_expect_api');
    assert.equal((tail[1]!.args as { text?: string }).text, '取消');
  });

  it('行内 Lov：先点单元格，再 pick_lov 且用行内触发器', () => {
    const base = art();
    base.operations!.push({
      id: 'loc',
      name: '改库位',
      type: 'update',
      page_id: 'list',
      row_target: { control: 'lov', column: 'locator', element: 'locatorLovIcon', cell_element: 'locatorCell' },
      execution_chain: ['list', 'query', 'click_header_row', 'edit', 'edit_cell', 'pick_lov'],
    } as never);
    const steps = kinds(compileMetaOpsAndFlows(base, { force: true }), 'loc');
    const tail = steps.slice(-2);
    assert.equal(tail[0]!.element, 'locatorCell');
    assert.equal(tail[1]!.kind, 'pick_lov');
    assert.equal(tail[1]!.element, 'locatorLovIcon');
    assert.deepEqual(tail[1]!.args, { open: 'locatorLovIcon' });
  });

  it('external 目标页：在来源页点边上的控件，而不是 goto 外部页', () => {
    const steps = kinds(compileMetaOpsAndFlows(art(), { force: true }), 'po');
    assert.ok(steps.every((s) => s.page_id === 'list'));
    assert.equal(steps[steps.length - 1]!.element, 'poLink');
  });
});

describe('模型直出 steps', () => {
  const mk = (steps: unknown[], extra: Partial<FeatureArtifact> = {}) =>
    baseArtifact({
      apis: ['/v1/{tenantId}/x/save'],
      operations: [
        {
          id: 'op1',
          name: '保存',
          type: 'update',
          page_id: 'config',
          steps,
        } as never,
      ],
      ...extra,
    });
  const good = [
    { kind: 'goto', name: '进入', page_id: 'config' },
    { kind: 'click', name: '编辑', page_id: 'config', element: 'editBtn' },
    { kind: 'click_expect_api', name: '保存', element: 'saveBtn', api: '/v1/{tenantId}/x/save' },
  ];
  const known = ['editBtn', 'saveBtn'];

  it('校验通过 → 采用模型步骤，api 断言带 urlIncludes', () => {
    const a = compileMetaOpsAndFlows(mk(good), { force: true, knownElements: known });
    assert.equal(a.operations[0]!.step_source, 'llm_steps');
    const last = a.meta_ops!.find((m) => m.id === 'op1_s3')!;
    assert.equal(last.kind, 'click_expect_api');
    assert.deepEqual(last.args, { urlIncludes: '/v1/{tenantId}/x/save' });
    assert.equal(a.meta_ops!.find((m) => m.id === 'goto_config')!.args?.path, '/tarzan/problem-field-config');
  });

  it('未知 kind / 未定义元素 / 编造接口 / 首步非 goto → 回退模板并写入 risks', () => {
    const bad = [
      { kind: 'click', name: '点', element: 'ghostBtn' },
      { kind: 'teleport', name: '飞' },
      { kind: 'click_expect_api', name: '存', element: 'saveBtn', api: '/v1/made/up' },
    ];
    const a = compileMetaOpsAndFlows(
      mk(bad, { review_suggestions: { status: 'pending_human_review', confidence: 0.5, risks: [] } as never }),
      { force: true, knownElements: known },
    );
    assert.equal(a.operations[0]!.step_source, 'template');
    const risks = a.review_suggestions!.risks!.join('\n');
    assert.match(risks, /ghostBtn/);
    assert.match(risks, /teleport/);
    assert.match(risks, /made\/up/);
    assert.match(risks, /第一步必须是 goto/);
  });

  it('不传 knownElements 时跳过元素定义检查', () => {
    const a = compileMetaOpsAndFlows(
      mk([{ kind: 'goto', name: '进入', page_id: 'config' }, { kind: 'click', name: '点', element: 'anything' }]),
      { force: true },
    );
    assert.equal(a.operations[0]!.step_source, 'llm_steps');
  });

  it('goto 带路径参数的页面被拒绝', () => {
    const a = compileMetaOpsAndFlows(
      mk([{ kind: 'goto', name: '进详情', page_id: 'd' }], {
        pages: [
          { id: 'config', name: '列表', route: '/a/list', scope: 'in_feature' },
          { id: 'd', name: '详情', route: '/a/detail/:id', scope: 'in_feature' },
        ],
      }),
      { force: true },
    );
    assert.equal(a.operations[0]!.step_source, 'template');
  });
});
