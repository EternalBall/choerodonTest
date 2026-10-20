/**
 * 链路编译：LLM 只产出 operations（能力事实）；本模块确定性生成
 * meta_ops + flows，并把 operation.execution_chain 反写为 meta_op_id 序列。
 *
 * 权威编排在 meta_ops / flows；execution_chain 仅作人读摘要。
 */
import type {
  FeatureArtifact,
  Flow,
  FlowEdge,
  FlowNode,
  MetaOp,
  MetaOpKind,
  PageEdge,
  PageNode,
} from '../core/schema.js';

type Operation = FeatureArtifact['operations'][number];

/** 开放词 → 规范 token（用于吃掉 LLM 残留 chain） */
const TOKEN_SYNONYMS: Record<string, string> = {
  search: 'query',
  click_query: 'query',
  click_search: 'query',
  do_query: 'query',
  click_reset: 'reset',
  do_reset: 'reset',
  save_btn: 'save',
  click_save: 'save',
  submit: 'save',
  edit_btn: 'edit',
  click_edit: 'edit',
  unlock: 'edit',
  fill_form: 'fill',
  input: 'fill',
  toggle_switch: 'toggle',
  switch: 'toggle',
  click_init: 'init',
  confirm_modal: 'confirm',
  popconfirm: 'confirm',
  assert_tree_rows: 'assert_rows',
  assert_table_rows: 'assert_rows',
  table_has_rows: 'assert_rows',
  tree_has_rows: 'assert_rows',
  query_success: 'query',
  enter_detail: 'detail',
  open_detail: 'detail',
};

const ACTION_TOKENS = new Set([
  'query',
  'reset',
  'save',
  'edit',
  'fill',
  'toggle',
  'confirm',
  'assert_rows',
  'create',
  'detail',
  'delete',
  'pick_lov',
  'add_line',
  'remove_line',
  'init',
]);

export function normalizeChainToken(raw: string, pageIds: Set<string>): string | null {
  const t = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/^click:/, '')
    .replace(/\s+/g, '_');
  if (!t) return null;
  if (pageIds.has(t)) return t;
  const mapped = TOKEN_SYNONYMS[t] ?? t;
  if (pageIds.has(mapped) || ACTION_TOKENS.has(mapped)) return mapped;
  // 保留 operation 风格 id（蛇形），供后续映射
  if (/^[a-z][a-z0-9_]*$/.test(mapped)) return mapped;
  return null;
}

export function normalizeExecutionChain(
  chain: string[] | undefined,
  pageIds: Set<string>,
): string[] {
  if (!chain?.length) return [];
  const out: string[] = [];
  for (const raw of chain) {
    const n = normalizeChainToken(raw, pageIds);
    if (n && out[out.length - 1] !== n) out.push(n);
  }
  return out;
}

type DraftStep = {
  /** 稳定 meta_op id */
  id: string;
  name: string;
  kind: MetaOpKind;
  page_id?: string;
  element?: string;
  api?: string;
  args?: Record<string, unknown>;
  note?: string;
};

function pageIdOf(op: Operation, pages: PageNode[], entryRoute?: string): string {
  if (op.page_id) return op.page_id;
  if (op.page) return op.page;
  const byRoute = pages.find((p) => p.route && op.route && p.route === op.route);
  if (byRoute) return byRoute.id;
  if (pages[0]) return pages[0].id;
  return 'main';
}

function routeOf(
  pageId: string,
  pages: PageNode[],
  op: Operation,
  entryRoute?: string,
): string | undefined {
  const page = pages.find((p) => p.id === pageId);
  return page?.route || op.route || entryRoute;
}

function unlockElement(op: Operation): string | undefined {
  const u = op.unlock;
  if (!u) return undefined;
  if (u.startsWith('click:')) return u.slice('click:'.length);
  return u;
}

function entryElement(op: Operation): string | undefined {
  return op.entry_control?.element || op.row_target?.element;
}

function ensureMeta(map: Map<string, MetaOp>, draft: DraftStep): string {
  const existing = map.get(draft.id);
  if (!existing) {
    map.set(draft.id, {
      id: draft.id,
      name: draft.name,
      kind: draft.kind,
      page_id: draft.page_id,
      element: draft.element,
      api: draft.api,
      args: draft.args,
      note: draft.note,
    });
  } else {
    // 合并：后写入的 api/element 仅在原空时补上
    if (!existing.api && draft.api) existing.api = draft.api;
    if (!existing.element && draft.element) existing.element = draft.element;
    if (!existing.args && draft.args) existing.args = draft.args;
  }
  return draft.id;
}

function draftGoto(
  pageId: string,
  pages: PageNode[],
  op: Operation,
  entryRoute?: string,
): DraftStep {
  const route = routeOf(pageId, pages, op, entryRoute);
  return {
    id: `goto_${pageId}`,
    name: `进入${pages.find((p) => p.id === pageId)?.name || pageId}`,
    kind: 'goto',
    page_id: pageId,
    args: route ? { path: route } : undefined,
  };
}

/**
 * 到达目标页的步骤。带路径参数（route 含 ':'）的页面无法直接 goto，
 * 改为从入口页出发沿 page_edges 最短路径逐边导航；找不到路径则回退为单个 goto。
 */
function gotoStepsFor(
  pageId: string,
  pages: PageNode[],
  edges: PageEdge[],
  op: Operation,
  entryRoute?: string,
): DraftStep[] {
  const fallback = [draftGoto(pageId, pages, op, entryRoute)];
  const target = pages.find((p) => p.id === pageId);
  if (!target?.route?.includes(':')) return fallback;

  const entry =
    (entryRoute ? pages.find((p) => p.route === entryRoute) : undefined) ??
    pages.find((p) => p.scope === 'in_feature' && p.route && !p.route.includes(':'));
  if (!entry || entry.id === pageId) return fallback;

  // BFS：prev 记录到达某页所用的边
  const prev = new Map<string, PageEdge>();
  const seen = new Set([entry.id]);
  const queue = [entry.id];
  while (queue.length && !seen.has(pageId)) {
    const cur = queue.shift()!;
    for (const e of edges) {
      if (e.from_page !== cur || seen.has(e.to_page)) continue;
      seen.add(e.to_page);
      prev.set(e.to_page, e);
      queue.push(e.to_page);
    }
  }
  if (!seen.has(pageId)) return fallback;

  const path: PageEdge[] = [];
  for (let cur = pageId; cur !== entry.id; ) {
    const e = prev.get(cur)!;
    path.unshift(e);
    cur = e.from_page;
  }

  const steps: DraftStep[] = [draftGoto(entry.id, pages, op, entryRoute)];
  for (const e of path) {
    const edgeName = e.id || `${e.from_page}_${e.to_page}`;
    if (e.via === 'row_link') {
      steps.push({
        id: `open_detail_${e.from_page}`,
        name: e.control?.name || '打开详情',
        kind: 'open_detail',
        page_id: e.from_page,
        element: e.control?.element,
      });
    } else {
      steps.push({
        id: `click_${edgeName}`,
        name: e.control?.name || edgeName,
        kind: 'click',
        page_id: e.from_page,
        element: e.control?.element,
      });
    }
  }
  return steps;
}

function draftFromActionToken(
  token: string,
  op: Operation,
  pageId: string,
): DraftStep | null {
  switch (token) {
    case 'query':
      return {
        id: `filter_query_${pageId}`,
        name: '查询',
        kind: 'filter_query',
        page_id: pageId,
        args: op.fields?.length ? { fields: op.fields } : undefined,
      };
    case 'reset':
      return {
        id: `click_reset_${pageId}`,
        name: '重置',
        kind: 'click',
        page_id: pageId,
        element: 'resetBtn',
      };
    case 'save':
      return {
        id: op.api ? `save_${op.id}` : `click_save_${pageId}`,
        name: '保存',
        kind: op.api ? 'click_expect_api' : 'click',
        page_id: pageId,
        element: 'saveBtn',
        api: op.api,
        args: op.api ? { urlIncludes: op.api } : undefined,
      };
    case 'edit':
      return {
        id: `click_edit_${pageId}`,
        name: '编辑',
        kind: 'click',
        page_id: pageId,
        element: unlockElement(op) || 'editBtn',
      };
    case 'fill':
      return {
        id: `fill_${op.id}`,
        name: '填写表单',
        kind: 'fill_form',
        page_id: pageId,
        args: op.fields?.length ? { fields: op.fields } : undefined,
      };
    case 'toggle':
      return {
        id: `toggle_${op.id}`,
        name: op.name || '切换',
        kind: 'click',
        page_id: pageId,
        element: op.row_target?.element || entryElement(op),
        note: op.row_target ? `column=${op.row_target.column}` : undefined,
      };
    case 'confirm':
      return {
        id: `confirm_${op.id}`,
        name: '确认',
        kind: 'click',
        page_id: pageId,
        element: 'confirmBtn',
      };
    case 'assert_rows':
      return {
        id: `assert_rows_${pageId}`,
        name: '断言有数据行',
        kind: 'assert_table_rows',
        page_id: pageId,
      };
    case 'detail':
      return {
        id: `open_detail_${pageId}`,
        name: '打开详情',
        kind: 'open_detail',
        page_id: pageId,
      };
    case 'create':
      return {
        id: `click_create_${pageId}`,
        name: '新建',
        kind: 'click',
        page_id: pageId,
        element: entryElement(op) || 'createBtn',
      };
    case 'delete':
      return {
        id: `click_delete_${op.id}`,
        name: '删除',
        kind: 'click',
        page_id: pageId,
        element: entryElement(op) || 'deleteBtn',
      };
    case 'pick_lov':
      return {
        id: `pick_lov_${op.id}`,
        name: '选择 Lov',
        kind: 'pick_lov',
        page_id: pageId,
      };
    case 'add_line':
      return {
        id: `add_line_${op.id}`,
        name: '增行',
        kind: 'click',
        page_id: pageId,
        element: 'addLineBtn',
      };
    case 'remove_line':
      return {
        id: `remove_line_${op.id}`,
        name: '删行',
        kind: 'click',
        page_id: pageId,
        element: 'removeLineBtn',
      };
    case 'init':
      return {
        id: `click_init_${op.id}`,
        name: '数据初始化',
        kind: op.api ? 'click_expect_api' : 'click',
        page_id: pageId,
        element: 'initBtn',
        api: op.api,
      };
    default:
      return null;
  }
}

/** 按 operation.type 生成规范步骤草案（不依赖 LLM chain） */
function templateStepsForOp(
  op: Operation,
  pages: PageNode[],
  pageIds: Set<string>,
  entryRoute?: string,
  hasRowGate = false,
  edges: PageEdge[] = [],
): DraftStep[] {
  const pageId = pageIdOf(op, pages, entryRoute);
  const steps: DraftStep[] = [];
  const push = (d: DraftStep) => {
    if (!steps.some((s) => s.id === d.id)) steps.push(d);
  };
  const pushAll = (ds: DraftStep[]) => ds.forEach(push);

  // 前置：preconditions 中可识别 token
  for (const pre of op.preconditions ?? []) {
    const tok = normalizeChainToken(pre, pageIds);
    if (!tok) continue;
    if (pageIds.has(tok)) {
      pushAll(gotoStepsFor(tok, pages, edges, op, entryRoute));
      continue;
    }
    if (tok === 'detail' || tok === 'enter_detail') {
      // 先到列表再开详情
      const listPage = pages.find((p) => /list/i.test(p.id))?.id;
      if (listPage) pushAll(gotoStepsFor(listPage, pages, edges, op, entryRoute));
      push({
        id: `open_detail_${pageId}`,
        name: '打开详情',
        kind: 'open_detail',
        page_id: pageId,
      });
      continue;
    }
    const fromTok = draftFromActionToken(tok, op, pageId);
    if (fromTok) push(fromTok);
  }

  switch (op.type) {
    case 'query': {
      pushAll(gotoStepsFor(pageId, pages, edges, op, entryRoute));
      push({
        id: `filter_query_${pageId}`,
        name: op.name || '查询',
        kind: 'filter_query',
        page_id: pageId,
        args: op.fields?.length ? { fields: op.fields } : undefined,
        api: op.api,
      });
      push({
        id: `assert_rows_${pageId}`,
        name: '断言有数据行',
        kind: 'assert_table_rows',
        page_id: pageId,
      });
      break;
    }
    case 'detail': {
      const listPage = pages.find((p) => /list/i.test(p.id))?.id ?? pageId;
      pushAll(gotoStepsFor(listPage, pages, edges, op, entryRoute));
      push({
        id: `open_detail_${op.id}`,
        name: op.name || '打开详情',
        kind: 'open_detail',
        page_id: pageId,
        element: entryElement(op),
      });
      break;
    }
    case 'create': {
      pushAll(gotoStepsFor(pageId, pages, edges, op, entryRoute));
      if (isRowEditDelete(op, hasRowGate)) {
        // 表格行编辑模式下的「增行」：没有页头「新建」按钮，需先进编辑再点增行
        // （isRowEditDelete 的判定条件对增行同样适用：需先点编辑 + 行级门禁/增行描述）
        push({
          id: `click_edit_${pageId}`,
          name: '编辑',
          kind: 'click',
          page_id: pageId,
          element: unlockElement(op) || 'editBtn',
        });
        push({
          id: `add_line_${op.id}`,
          name: '增行',
          kind: 'click',
          page_id: pageId,
          element: 'addLineBtn',
        });
      } else if (op.opens === 'page' || op.initial_mode === 'create') {
        // 可能已在 create 路由；仍保留填表+保存
      } else {
        push({
          id: `click_create_${pageId}`,
          name: '新建',
          kind: 'click',
          page_id: pageId,
          element: entryElement(op) || 'createBtn',
        });
      }
      push({
        id: `fill_${op.id}`,
        name: '填写表单',
        kind: 'fill_form',
        page_id: pageId,
        args: op.fields?.length ? { fields: op.fields } : undefined,
      });
      push({
        id: `save_${op.id}`,
        name: '保存',
        kind: op.api ? 'click_expect_api' : 'click',
        page_id: pageId,
        element: 'saveBtn',
        api: op.api,
        args: op.api ? { urlIncludes: op.api } : undefined,
      });
      break;
    }
    case 'update': {
      pushAll(gotoStepsFor(pageId, pages, edges, op, entryRoute));
      const unlock = unlockElement(op);
      if (unlock || op.initial_mode === 'view') {
        push({
          id: `click_edit_${pageId}`,
          name: '编辑',
          kind: 'click',
          page_id: pageId,
          element: unlock || 'editBtn',
        });
      }
      push({
        id: `fill_${op.id}`,
        name: '填写表单',
        kind: 'fill_form',
        page_id: pageId,
        args: op.fields?.length ? { fields: op.fields } : undefined,
      });
      push({
        id: `save_${op.id}`,
        name: '保存',
        kind: op.api ? 'click_expect_api' : 'click',
        page_id: pageId,
        element: 'saveBtn',
        api: op.api,
        args: op.api ? { urlIncludes: op.api } : undefined,
      });
      break;
    }
    case 'copy': {
      pushAll(gotoStepsFor(pageId, pages, edges, op, entryRoute));
      push({
        id: `click_copy_${op.id}`,
        name: '复制',
        kind: 'click',
        page_id: pageId,
        element: entryElement(op) || 'copyBtn',
      });
      push({
        id: `fill_${op.id}`,
        name: '填写表单',
        kind: 'fill_form',
        page_id: pageId,
      });
      push({
        id: `save_${op.id}`,
        name: '保存',
        kind: op.api ? 'click_expect_api' : 'click',
        page_id: pageId,
        element: 'saveBtn',
        api: op.api,
      });
      break;
    }
    case 'delete': {
      pushAll(gotoStepsFor(pageId, pages, edges, op, entryRoute));
      if (isRowEditDelete(op, hasRowGate)) {
        // 表格行编辑模式：已落库行不可删（row_gate 限制），固定模板的「点删除」无目标行会失败。
        // 改为：进编辑 → 增行造出未落库行 → 删该行 → Popconfirm 确认 → 保存落库。
        push({
          id: `click_edit_${pageId}`,
          name: '编辑',
          kind: 'click',
          page_id: pageId,
          element: unlockElement(op) || 'editBtn',
        });
        push({
          id: `add_line_${op.id}`,
          name: '增行',
          kind: 'click',
          page_id: pageId,
          element: 'addLineBtn',
        });
        push({
          id: `remove_line_${op.id}`,
          name: op.name || '删行',
          kind: 'click',
          page_id: pageId,
          element: 'removeLineBtn',
        });
        push({
          id: `confirm_${op.id}`,
          name: '确认删除',
          kind: 'click',
          page_id: pageId,
          element: 'confirmBtn',
          note: 'Popconfirm 确认',
        });
        push({
          id: `save_${op.id}`,
          name: '保存',
          kind: op.api ? 'click_expect_api' : 'click',
          page_id: pageId,
          element: 'saveBtn',
          api: op.api,
          args: op.api ? { urlIncludes: op.api } : undefined,
        });
        break;
      }
      push({
        id: `click_delete_${op.id}`,
        name: op.name || '删除',
        kind: 'click',
        page_id: pageId,
        element: entryElement(op) || 'deleteBtn',
      });
      push({
        id: `confirm_${op.id}`,
        name: '确认删除',
        kind: 'click',
        page_id: pageId,
        element: 'confirmBtn',
      });
      if (op.api) {
        push({
          id: `expect_api_${op.id}`,
          name: '期望删除接口',
          kind: 'click_expect_api',
          page_id: pageId,
          api: op.api,
          args: { urlIncludes: op.api },
          note: '若确认点击已带 api，可与上一步合并',
        });
      }
      break;
    }
    case 'related_page': {
      const nav = gotoStepsFor(pageId, pages, edges, op, entryRoute);
      pushAll(nav);
      // 多于 1 步说明 pageId 本身是经边点击进入的页面，点击已包含在导航中，不再重复 open_related
      if (nav.length > 1) break;
      push({
        id: `open_related_${op.id}`,
        name: op.name || '打开关联页',
        kind: 'click',
        page_id: pageId,
        element: entryElement(op),
        note: op.route ? `to=${op.route}` : undefined,
      });
      break;
    }
    case 'table_picker': {
      pushAll(gotoStepsFor(pageId, pages, edges, op, entryRoute));
      push({
        id: `pick_lov_${op.id}`,
        name: op.name || '选择 Lov',
        kind: 'pick_lov',
        page_id: pageId,
        element: entryElement(op),
      });
      break;
    }
    case 'row_action': {
      pushAll(gotoStepsFor(pageId, pages, edges, op, entryRoute));
      // 行内动作常依赖查询有数
      if (!steps.some((s) => s.kind === 'filter_query')) {
        push({
          id: `filter_query_${pageId}`,
          name: '查询',
          kind: 'filter_query',
          page_id: pageId,
        });
        push({
          id: `assert_rows_${pageId}`,
          name: '断言有数据行',
          kind: 'assert_table_rows',
          page_id: pageId,
        });
      }
      push({
        id: `row_action_${op.id}`,
        name: op.name,
        kind: op.api ? 'click_expect_api' : 'click',
        page_id: pageId,
        element: op.row_target?.element || entryElement(op),
        api: op.api,
        args: op.api ? { urlIncludes: op.api } : undefined,
        note: op.row_target
          ? `area=${op.row_target.area};column=${op.row_target.column}`
          : undefined,
      });
      break;
    }
    case 'other':
    default: {
      pushAll(gotoStepsFor(pageId, pages, edges, op, entryRoute));
      // 尝试用归一后的 LLM chain 动作 token 补步骤
      const normalized = normalizeExecutionChain(op.execution_chain, pageIds);
      let addedAction = false;
      for (const tok of normalized) {
        if (pageIds.has(tok)) {
          pushAll(gotoStepsFor(tok, pages, edges, op, entryRoute));
          continue;
        }
        const d = draftFromActionToken(tok, op, pageId);
        if (d) {
          push(d);
          addedAction = true;
        }
      }
      if (!addedAction) {
        push({
          id: `action_${op.id}`,
          name: op.name,
          kind: op.api ? 'click_expect_api' : 'click',
          page_id: pageId,
          element: entryElement(op),
          api: op.api,
          args: op.api ? { urlIncludes: op.api } : undefined,
          note: op.description,
        });
      }
      break;
    }
  }

  return steps;
}

/**
 * 是否为「表格行编辑模式」下的删除：需先点页头编辑，且只能删未落库的新增行。
 * 动机：此类页面没有可直接点的删除按钮，固定 4 步模板会在回放时找不到目标。
 */
function isRowEditDelete(op: Operation, hasRowGate: boolean): boolean {
  const needEdit =
    (op.preconditions ?? []).includes('click:editBtn') || op.unlock === 'click:editBtn';
  if (!needEdit) return false;
  const chain = op.execution_chain ?? [];
  return (
    Boolean(op.description?.includes('增行')) ||
    chain.includes('add_line') ||
    chain.includes('remove_line') ||
    hasRowGate
  );
}

function stepsToFlow(op: Operation, metaIds: string[]): Flow {
  const nodes: FlowNode[] = metaIds.map((meta_op_id, i) => ({
    id: `${op.id}_n${i}`,
    meta_op_id,
  }));
  const edges: FlowEdge[] =
    nodes.length < 2
      ? []
      : nodes.slice(0, -1).map((n, i) => ({
          id: `${op.id}_e${i}`,
          source: n.id,
          target: nodes[i + 1]!.id,
        }));
  return {
    id: op.id,
    title: op.name,
    source: 'default',
    nodes,
    edges,
  };
}

/**
 * 对分析产物编译 meta_ops / flows，并反写 execution_chain。
 * 若已有 flows 且 force=false，则跳过（保留人工编排）。
 */
export function compileMetaOpsAndFlows(
  artifact: FeatureArtifact,
  opts?: { force?: boolean },
): FeatureArtifact {
  if (artifact.flows?.length && artifact.meta_ops?.length && !opts?.force) {
    return artifact;
  }

  const pages = artifact.pages ?? [];
  const pageIds = new Set(pages.map((p) => p.id));
  const entryRoute = artifact.entry?.route;
  const metaMap = new Map<string, MetaOp>();
  const flows: Flow[] = [];
  // 同页存在 row_gate 说明有「仅未落库行可操作」的行级门禁，供 delete 判定行编辑模式
  const hasRowGate = (artifact.field_rules ?? []).some((r) => Boolean(r.row_gate));
  const operations = (artifact.operations ?? []).map((op) => {
    const drafts = templateStepsForOp(
      op,
      pages,
      pageIds,
      entryRoute,
      hasRowGate,
      artifact.page_edges ?? [],
    );
    const metaIds = drafts.map((d) => ensureMeta(metaMap, d));
    flows.push(stepsToFlow(op, metaIds));
    return {
      ...op,
      execution_chain: metaIds,
    };
  });

  return {
    ...artifact,
    operations,
    meta_ops: [...metaMap.values()],
    flows,
  };
}

/** 旧产物升级：无 flows 时编译；已有则原样返回 */
export function ensureCompiledFlows(artifact: FeatureArtifact): FeatureArtifact {
  if (artifact.flows?.length && artifact.meta_ops?.length) return artifact;
  return compileMetaOpsAndFlows(artifact, { force: true });
}
