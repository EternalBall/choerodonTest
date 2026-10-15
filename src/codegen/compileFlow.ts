import type {
  FeatureArtifact,
  Flow,
  MetaOp,
  Suite,
} from '../core/schema.js';

type Step = Suite['cases'][number]['steps'][number];

/**
 * 将 flow 拓扑序编译为 suite steps。
 * 一期要求单主链（唯一入度为 0 的起点）。
 */
export function compileFlowToSteps(
  flow: Flow,
  metaOps: MetaOp[],
  _artifact: FeatureArtifact,
): Step[] {
  const byId = new Map(metaOps.map((m) => [m.id, m]));
  const ordered = topoSortFlow(flow);
  const steps: Step[] = [];

  for (const node of ordered) {
    const meta = byId.get(node.meta_op_id);
    if (!meta) {
      throw new Error(`flow ${flow.id}: 未知 meta_op_id=${node.meta_op_id}`);
    }
    const args = { ...(meta.args || {}), ...(node.args || {}) };
    steps.push(...compileMetaOp(meta, args));
  }
  return steps;
}

export function topoSortFlow(flow: Flow): Flow['nodes'] {
  const nodes = flow.nodes;
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const indeg = new Map<string, number>();
  const outs = new Map<string, string[]>();
  for (const n of nodes) {
    indeg.set(n.id, 0);
    outs.set(n.id, []);
  }
  for (const e of flow.edges) {
    if (!nodeMap.has(e.source) || !nodeMap.has(e.target)) {
      throw new Error(`flow ${flow.id}: 边引用不存在的节点 ${e.source}->${e.target}`);
    }
    indeg.set(e.target, (indeg.get(e.target) || 0) + 1);
    outs.get(e.source)!.push(e.target);
  }

  if (flow.edges.length === 0 && nodes.length > 1) {
    // 无边时按 nodes 声明顺序
    return [...nodes];
  }

  const starts = nodes.filter((n) => (indeg.get(n.id) || 0) === 0);
  if (starts.length !== 1 && nodes.length > 0 && flow.edges.length > 0) {
    throw new Error(
      `flow ${flow.id}: 需要恰好 1 个起点（入度 0），当前 ${starts.length} 个`,
    );
  }

  const queue = starts.map((n) => n.id);
  const ordered: Flow['nodes'] = [];
  while (queue.length) {
    const id = queue.shift()!;
    ordered.push(nodeMap.get(id)!);
    for (const t of outs.get(id) || []) {
      const next = (indeg.get(t) || 0) - 1;
      indeg.set(t, next);
      if (next === 0) queue.push(t);
    }
  }

  if (ordered.length !== nodes.length) {
    throw new Error(`flow ${flow.id}: 存在环或无法拓扑排序`);
  }
  return ordered;
}

function compileMetaOp(meta: MetaOp, args: Record<string, unknown>): Step[] {
  const name = meta.name;
  const ready = meta.ready;
  const base = { name, screenshot: true as const, ready };

  switch (meta.kind) {
    case 'goto':
      return [
        {
          ...base,
          action: 'goto',
          args: { path: args.path ?? args.url },
        },
      ];
    case 'filter_query':
      return [
        {
          ...base,
          action: 'tableFilterQuery',
          args: {
            mode: args.mode ?? 'filterBar',
            resetFirst: args.resetFirst ?? true,
            fields: args.fields,
          },
        },
      ];
    case 'assert_table_rows':
      return [
        {
          ...base,
          action: 'assertTableHasRows',
          args: {
            table: args.table,
            min: args.min ?? 1,
            label: args.label,
          },
        },
      ];
    case 'open_detail':
      return [
        {
          ...base,
          action: 'openDetailRow',
          args: {
            target: args.target,
            whenMultiple: args.whenMultiple ?? 'first',
            match: args.match,
          },
        },
      ];
    case 'click':
      return [
        {
          ...base,
          action: 'click',
          args: pickClickArgs(args),
        },
      ];
    case 'fill':
      return [
        {
          ...base,
          action: 'fill',
          args: { target: args.target, value: args.value },
        },
      ];
    case 'fill_form':
      return [
        {
          ...base,
          action: 'fillForm',
          args: { fields: args.fields, saveAs: args.saveAs },
        },
      ];
    case 'pick_lov':
      return [
        {
          ...base,
          action: 'pickLov',
          args: { open: args.open, row: args.row ?? { first: true } },
        },
      ];
    case 'click_expect_api':
      return [
        {
          ...base,
          action: 'clickExpectApi',
          args: {
            target: args.target,
            first: args.first,
            urlIncludes: args.urlIncludes,
            successUrlIncludes: args.successUrlIncludes ?? args.urlIncludes,
            optionalToast: args.optionalToast,
            timeout: args.timeout ?? 30_000,
          },
        },
      ];
    case 'assert': {
      const asserts = (args.asserts as Step['assert']) || [];
      return [
        {
          name,
          action: 'assert',
          args: {},
          assert: asserts,
          screenshot: true,
        },
      ];
    }
    case 'set_var':
      return [
        {
          ...base,
          action: 'setVar',
          args: { values: args.values ?? args },
        },
      ];
    default:
      throw new Error(`未知 meta_op kind: ${(meta as MetaOp).kind}`);
  }
}

function pickClickArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (args.target != null) out.target = args.target;
  if (args.text != null) out.text = args.text;
  if (args.role != null) out.role = args.role;
  if (args.name != null) out.name = args.name;
  if (args.first != null) out.first = args.first;
  if (args.nth != null) out.nth = args.nth;
  if (args.hasText != null) out.hasText = args.hasText;
  return out;
}
