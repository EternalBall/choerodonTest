import type {
  FeatureArtifact,
  Flow,
  FlowEdge,
  FlowNode,
  MetaOp,
} from '../core/schema.js';

export type EnsuredFlows = {
  meta_ops: MetaOp[];
  flows: Flow[];
};

/**
 * 若缺 flows/meta_ops，从 operations 生成默认编排；保留 source=user 的 flows。
 * default flow 的 id 对齐 operation.id，稳定 TC_* id。
 */
export function ensureMetaOpsAndFlows(artifact: FeatureArtifact): EnsuredFlows {
  const generated = buildDefaultMetaOpsAndFlows(artifact);
  const existingMeta = artifact.meta_ops ?? [];
  const metaById = new Map<string, MetaOp>();
  for (const m of [...generated.meta_ops, ...existingMeta]) {
    metaById.set(m.id, m);
  }

  const userFlows = (artifact.flows ?? []).filter((f) => f.source === 'user');
  const userIds = new Set(userFlows.map((f) => f.id));
  const defaultFlows = generated.flows.filter((f) => !userIds.has(f.id));
  // 已有 default 且用户未覆盖：用新生成的 default 替换同 id（便于规则升级）
  const keptUser = userFlows;
  const flows = [...keptUser, ...defaultFlows];

  return {
    meta_ops: [...metaById.values()],
    flows,
  };
}

export function buildDefaultMetaOpsAndFlows(artifact: FeatureArtifact): EnsuredFlows {
  const ns = slugNs(artifact.feature);
  const entry = artifact.entry.route;
  const sample = sampleMaterialCode(artifact);
  const meta_ops: MetaOp[] = [];
  const flows: Flow[] = [];
  const metaIds = new Set<string>();

  const addMeta = (m: MetaOp) => {
    if (metaIds.has(m.id)) return;
    metaIds.add(m.id);
    meta_ops.push(m);
  };

  // —— 共享元操作 ——
  addMeta({
    id: 'goto_list',
    name: '打开列表页',
    kind: 'goto',
    page_id: 'list',
    args: { path: entry },
    ready: { visible: `${ns}.pageReady` },
  });
  addMeta({
    id: 'filter_by_sample',
    name: '筛选目标物料',
    kind: 'filter_query',
    page_id: 'list',
    args: {
      mode: 'filterBar',
      resetFirst: true,
      fields: [{ name: 'materialCode', label: '物料编码', value: sample }],
    },
    ready: { hidden: `${ns}.tableSpin` },
  });
  addMeta({
    id: 'assert_list_has_rows',
    name: '确认列表有数据',
    kind: 'assert_table_rows',
    page_id: 'list',
    args: { table: `${ns}.table`, min: 1, label: '列表' },
  });
  addMeta({
    id: 'open_detail_sample',
    name: '进入详情',
    kind: 'open_detail',
    page_id: 'detail',
    args: {
      target: `${ns}.detailLink`,
      whenMultiple: 'first',
      match: sample,
    },
    ready: { visible: `${ns}.editBtn` },
  });
  addMeta({
    id: 'click_edit',
    name: '点击编辑',
    kind: 'click',
    args: { target: `${ns}.editBtn` },
    ready: { visible: `${ns}.saveBtn` },
  });
  addMeta({
    id: 'click_create',
    name: '点击新建',
    kind: 'click',
    page_id: 'detail',
    args: { target: `${ns}.createBtn` },
    ready: { visible: `${ns}.formReady` },
  });
  addMeta({
    id: 'fill_create_form',
    name: '填写基础属性',
    kind: 'fill_form',
    args: {
      fields: {
        [`${ns}.materialCode`]: 'ATA-${ENV.ATA_RUN_ID}',
        [`${ns}.materialName`]: '自动化物料-${ENV.ATA_RUN_ID}',
      },
      saveAs: { [`${ns}.materialCode`]: 'materialCode' },
    },
  });
  addMeta({
    id: 'pick_primary_uom',
    name: '选择基本计量单位',
    kind: 'pick_lov',
    args: { open: `${ns}.primaryUomLovOpen`, row: { first: true } },
  });
  addMeta({
    id: 'save_material',
    name: '提交保存',
    kind: 'click_expect_api',
    args: {
      target: `${ns}.submitBtn`,
      urlIncludes: ['mt-material/save/ui', 'mt-material/check/ui'],
      successUrlIncludes: ['mt-material/save/ui'],
      optionalToast: `${ns}.successToast`,
      timeout: 30_000,
    },
  });
  addMeta({
    id: 'save_material_detail',
    name: '保存详情',
    kind: 'click_expect_api',
    args: {
      target: `${ns}.saveBtn`,
      urlIncludes: ['mt-material/save/ui', 'mt-material/check/ui'],
      successUrlIncludes: ['mt-material/save/ui'],
      optionalToast: `${ns}.successToast`,
      timeout: 30_000,
    },
  });
  addMeta({
    id: 'fill_detail_edit',
    name: '修改可编辑字段',
    kind: 'fill_form',
    args: {
      fields: {
        [`${ns}.materialName`]: `${sample}-改`,
      },
    },
  });
  addMeta({
    id: 'click_copy',
    name: '打开复制抽屉',
    kind: 'click',
    args: { target: `${ns}.copyBtn` },
    ready: { visible: `${ns}.copyDrawer` },
  });
  addMeta({
    id: 'fill_copy_target',
    name: '填写到物料编码',
    kind: 'fill',
    args: { target: `${ns}.copyTargetCode`, value: 'ATA-C-${ENV.ATA_RUN_ID}' },
  });
  addMeta({
    id: 'confirm_copy',
    name: '确定复制',
    kind: 'click_expect_api',
    args: {
      target: `${ns}.copyConfirm`,
      urlIncludes: ['mt-material/check/ui', 'mt-material/save/ui'],
      successUrlIncludes: ['mt-material/check/ui', 'mt-material/save/ui'],
      optionalToast: `${ns}.successToast`,
      timeout: 30_000,
    },
    ready: { hidden: `${ns}.copyDrawer` },
  });
  addMeta({
    id: 'open_site_assignment',
    name: '打开站点分配',
    kind: 'click',
    page_id: 'site_assignment',
    args: { target: `${ns}.siteAssignmentBtn` },
    ready: { visible: `${ns}.pageReady` },
  });
  addMeta({
    id: 'assert_url_site_assignment',
    name: '断言进入站点分配',
    kind: 'assert',
    args: {
      asserts: [{ type: 'urlContains', value: 'site-assignment' }],
    },
  });
  addMeta({
    id: 'assert_site_table_rows',
    name: '确认站点分配表有数据',
    kind: 'assert_table_rows',
    args: { table: `${ns}.siteAssignmentTable`, min: 1, label: '站点分配表' },
  });
  addMeta({
    id: 'click_site_edit',
    name: '站点分配点击编辑',
    kind: 'click',
    args: { target: `${ns}.editBtn` },
    ready: { visible: `${ns}.saveBtn` },
  });
  addMeta({
    id: 'toggle_site_enable',
    name: '切换启用状态开关',
    kind: 'click',
    args: { target: `${ns}.siteEnableFlag`, first: true },
  });
  addMeta({
    id: 'save_site_assignment',
    name: '保存站点分配',
    kind: 'click_expect_api',
    api: '/v1/{tenantId}/mt-material/save/site/ui',
    args: {
      target: `${ns}.saveBtn`,
      urlIncludes: ['mt-material/save/site/ui'],
      successUrlIncludes: ['mt-material/save/site/ui'],
      optionalToast: `${ns}.successToast`,
      timeout: 30_000,
    },
  });
  addMeta({
    id: 'site_add_line',
    name: '表头增行',
    kind: 'click',
    args: { target: `${ns}.siteAddLineBtn` },
    constraints: { requires_prior: ['click_site_edit'] },
  });
  addMeta({
    id: 'site_click_lov_cell',
    name: '点击站点必填格',
    kind: 'click',
    args: { target: `${ns}.siteLovCell`, first: true },
  });
  addMeta({
    id: 'site_pick_lov',
    name: '选择站点',
    kind: 'pick_lov',
    args: { open: `${ns}.siteLovOpen`, row: { first: true } },
  });
  addMeta({
    id: 'site_remove_line',
    name: '点击行删除',
    kind: 'click',
    args: { target: `${ns}.siteRemoveLineBtn`, first: true },
    constraints: { requires_prior: ['site_add_line'] },
  });
  addMeta({
    id: 'site_delete_confirm',
    name: '确认删除',
    kind: 'click',
    args: { target: `${ns}.siteDeleteConfirm` },
  });
  addMeta({
    id: 'click_site_attr_link',
    name: '点击物料站点属性维护',
    kind: 'click',
    args: { target: `${ns}.siteAttrLink`, first: true },
    ready: { visible: `${ns}.pageReady` },
  });
  addMeta({
    id: 'assert_url_site_properties',
    name: '断言进入站点属性',
    kind: 'assert',
    args: {
      asserts: [{ type: 'urlContains', value: 'material-site-properties' }],
    },
  });

  const hasFormUpdate = artifact.operations.some(
    (o) => o.type === 'update' && !isSiteOp(o),
  );

  for (const op of artifact.operations) {
    if (op.type === 'table_picker') continue;
    if (op.type === 'detail' && hasFormUpdate) continue;

    if (op.type === 'query') {
      flows.push(
        chainFlow(op.id, `${artifact.feature} - ${op.name}`, ['query'], [
          'goto_list',
          'filter_by_sample',
        ], { y: flows.length * 80 }),
      );
      continue;
    }

    if (op.type === 'create' && !isSiteOp(op)) {
      flows.push(
        chainFlow(op.id, `${artifact.feature} - ${op.name}`, ['create'], [
          'goto_list',
          'click_create',
          'fill_create_form',
          'pick_primary_uom',
          'save_material',
        ], { y: flows.length * 80 }),
      );
      continue;
    }

    if (op.type === 'update' && !isSiteOp(op)) {
      flows.push(
        chainFlow(
          op.id,
          op.id === 'update' || /编辑保存/i.test(op.name)
            ? `${artifact.feature} - 详情编辑保存`
            : `${artifact.feature} - ${op.name}`,
          ['detail_update', 'update'],
          [
            'goto_list',
            'filter_by_sample',
            'assert_list_has_rows',
            'open_detail_sample',
            'click_edit',
            'fill_detail_edit',
            'save_material_detail',
          ],
          { y: flows.length * 80 },
        ),
      );
      continue;
    }

    if (op.type === 'detail') {
      flows.push(
        chainFlow(op.id, `${artifact.feature} - ${op.name}`, ['detail'], [
          'goto_list',
          'filter_by_sample',
          'assert_list_has_rows',
          'open_detail_sample',
        ], { y: flows.length * 80 }),
      );
      continue;
    }

    if (op.type === 'copy') {
      flows.push(
        chainFlow(op.id, `${artifact.feature} - ${op.name}`, ['copy'], [
          'goto_list',
          'filter_by_sample',
          'assert_list_has_rows',
          'open_detail_sample',
          'click_copy',
          'fill_copy_target',
          'confirm_copy',
        ], { y: flows.length * 80 }),
      );
      continue;
    }

    if (op.type === 'row_action') {
      const elKey = op.row_target?.element || 'defaultSecondaryUomRadio';
      const apiNeedle = apiPathNeedle(op.api) || 'secondary-uom/default';
      const raClickId = `row_action_click_${op.id}`;
      const raApiId = `row_action_api_${op.id}`;
      addMeta({
        id: raClickId,
        name: op.name,
        kind: 'click_expect_api',
        args: {
          target: `${ns}.${elKey}`,
          first: true,
          urlIncludes: [apiNeedle],
          successUrlIncludes: [apiNeedle],
          optionalToast: `${ns}.successToast`,
          timeout: 30_000,
        },
        api: op.api,
      });
      // click_expect_api already does click+api; one node enough
      flows.push(
        chainFlow(op.id, `${artifact.feature} - ${op.name}`, ['row_action'], [
          'goto_list',
          'filter_by_sample',
          'assert_list_has_rows',
          'open_detail_sample',
          raClickId,
        ], { y: flows.length * 80 }),
      );
      void raApiId;
      continue;
    }

    if (op.type === 'related_page' && isSiteEntry(op) && op.scope !== 'external') {
      flows.push(
        chainFlow(op.id, `${artifact.feature} - ${op.name}`, ['related_page', 'page:site_assignment'], [
          'goto_list',
          'filter_by_sample',
          'assert_list_has_rows',
          'open_detail_sample',
          'open_site_assignment',
          'assert_url_site_assignment',
        ], { y: flows.length * 80 }),
      );
      continue;
    }

    if (op.type === 'related_page' && /site.?prop|站点属性/i.test(op.id + op.name)) {
      flows.push(
        chainFlow(
          op.id,
          `${artifact.feature} - ${op.name}`,
          ['related_page', 'external_edge', 'page:site_properties'],
          [
            'goto_list',
            'filter_by_sample',
            'assert_list_has_rows',
            'open_detail_sample',
            'open_site_assignment',
            'assert_url_site_assignment',
            'assert_site_table_rows',
            'click_site_attr_link',
            'assert_url_site_properties',
          ],
          { y: flows.length * 80 },
        ),
      );
      continue;
    }

    if (op.type === 'update' && isSiteOp(op)) {
      flows.push(
        chainFlow(
          op.id,
          `${artifact.feature} - 站点分配编辑保存`,
          ['detail_update', 'page:site_assignment'],
          [
            'goto_list',
            'filter_by_sample',
            'assert_list_has_rows',
            'open_detail_sample',
            'open_site_assignment',
            'assert_url_site_assignment',
            'click_site_edit',
            'assert_site_table_rows',
            'toggle_site_enable',
            'save_site_assignment',
          ],
          { y: flows.length * 80 },
        ),
      );
      continue;
    }

    if (op.type === 'create' && isSiteOp(op)) {
      flows.push(
        chainFlow(
          op.id,
          `${artifact.feature} - 站点分配增行保存`,
          ['create', 'page:site_assignment'],
          [
            'goto_list',
            'filter_by_sample',
            'assert_list_has_rows',
            'open_detail_sample',
            'open_site_assignment',
            'assert_url_site_assignment',
            'click_site_edit',
            'site_add_line',
            'site_click_lov_cell',
            'site_pick_lov',
            'save_site_assignment',
          ],
          { y: flows.length * 80 },
        ),
      );
      continue;
    }

    if (op.type === 'delete' && isSiteOp(op)) {
      flows.push(
        chainFlow(
          op.id,
          `${artifact.feature} - 站点分配删行`,
          ['delete', 'page:site_assignment'],
          [
            'goto_list',
            'filter_by_sample',
            'assert_list_has_rows',
            'open_detail_sample',
            'open_site_assignment',
            'assert_url_site_assignment',
            'click_site_edit',
            'site_add_line',
            'site_remove_line',
            'site_delete_confirm',
            'save_site_assignment',
          ],
          { y: flows.length * 80 },
        ),
      );
      continue;
    }

    // 其它 related_page / other：列表进详情再点入口
    if (op.type === 'related_page') {
      const btn = op.entry_control?.element || 'extendAttrBtn';
      const clickId = `related_click_${op.id}`;
      addMeta({
        id: clickId,
        name: `点击${op.entry_control?.name || op.name}`,
        kind: 'click',
        args: { target: `${ns}.${btn}`, first: true },
        ready: { visible: `${ns}.pageReady` },
      });
      flows.push(
        chainFlow(
          op.id,
          `${artifact.feature} - ${op.name}`,
          ['related_page', ...(op.scope === 'external' ? ['external_edge'] : [])],
          [
            'goto_list',
            'filter_by_sample',
            'assert_list_has_rows',
            'open_detail_sample',
            clickId,
          ],
          { y: flows.length * 80 },
        ),
      );
    }
  }

  // 跨 op：新建 → 回查详情
  if (artifact.operations.some((o) => o.type === 'create' && !isSiteOp(o))) {
    addMeta({
      id: 'set_var_run_code',
      name: '记录新建编码',
      kind: 'set_var',
      args: { values: { materialCode: 'ATA-${ENV.ATA_RUN_ID}' } },
    });
    addMeta({
      id: 'filter_by_var_code',
      name: '筛选新建编码',
      kind: 'filter_query',
      args: {
        mode: 'filterBar',
        resetFirst: true,
        fields: [{ name: 'materialCode', label: '物料编码', value: '${vars.materialCode}' }],
      },
      ready: { hidden: `${ns}.tableSpin` },
    });
    addMeta({
      id: 'open_detail_var',
      name: '进入新建详情',
      kind: 'open_detail',
      args: {
        target: `${ns}.detailLink`,
        whenMultiple: 'first',
        match: '${vars.materialCode}',
      },
      ready: { visible: `${ns}.editBtn` },
    });
    if (!flows.some((f) => f.id === 'flow_create_detail')) {
      flows.push(
        chainFlow(
          'flow_create_detail',
          `${artifact.feature} - 新建后回查详情`,
          ['flow', 'create', 'detail'],
          [
            'goto_list',
            'click_create',
            'fill_create_form',
            'pick_primary_uom',
            'save_material',
            'goto_list',
            'filter_by_var_code',
            'assert_list_has_rows',
            'open_detail_var',
          ],
          { y: flows.length * 80 },
        ),
      );
    }
  }

  return { meta_ops, flows };
}

function isSiteOp(op: { page_id?: string; id: string; name: string; route?: string }): boolean {
  const key = `${op.page_id || ''}|${op.id}|${op.name}|${op.route || ''}`;
  return /site.?assign|站点分配|site-assignment/i.test(key);
}

function isSiteEntry(op: { id: string; name: string }): boolean {
  return /site.?assign|站点分配/i.test(op.id + op.name);
}

function chainFlow(
  id: string,
  title: string,
  tags: string[],
  metaOpIds: string[],
  layout: { y: number },
): Flow {
  const nodes: FlowNode[] = metaOpIds.map((meta_op_id, i) => ({
    id: `n${i}_${meta_op_id}`,
    meta_op_id,
    position: { x: 80 + i * 220, y: 80 + layout.y },
  }));
  const edges: FlowEdge[] = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    edges.push({
      id: `e${i}`,
      source: nodes[i]!.id,
      target: nodes[i + 1]!.id,
    });
  }
  return {
    id,
    title,
    tags,
    source: 'default',
    nodes,
    edges,
  };
}

function slugNs(feature: string): string {
  const ascii = feature.replace(/[^\w]+/g, '_').replace(/^_|_$/g, '');
  if (ascii && /[a-zA-Z]/.test(ascii)) return ascii.toLowerCase();
  return `feat_${Buffer.from(feature).toString('hex').slice(0, 8)}`;
}

function sampleMaterialCode(artifact: FeatureArtifact): string {
  const fromNote = artifact.notes?.find((n) => /ATA-\d+/.test(n));
  if (fromNote) {
    const m = fromNote.match(/ATA-\d+/);
    if (m) return m[0];
  }
  return 'ATA-1789147200001';
}

function apiPathNeedle(api?: string): string | undefined {
  if (!api) return undefined;
  const m = api.match(/([\w-]+(?:\/[\w-]+){1,3})\s*$/);
  if (m) return m[1];
  const parts = api.split('/').filter((p) => p && !p.includes('{'));
  return parts.slice(-3).join('/') || parts.slice(-2).join('/');
}
