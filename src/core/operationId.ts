import { createHash } from 'node:crypto';
import type { FeatureArtifact } from './schema.js';

type Op = FeatureArtifact['operations'][number];

/**
 * 接口归一化：去查询串、版本段与租户占位符，去掉紧随其后的服务前缀，去掉末尾 ui。
 * 如 /v1/{tenantId}/hme-production-capacitys/dispatch/cancel/ui → dispatch/cancel
 */
export function normalizeApi(api: string): string {
  const path = (api.split('?')[0] ?? '').trim();
  const segs = path.split('/').filter(Boolean);
  const version = segs.findIndex((s) => /^v\d+$/i.test(s));
  let rest = version >= 0 ? segs.slice(version + 1) : segs;
  rest = rest.filter((s) => !/^(\{.*\}|\$\{.*\}|:.*)$/.test(s));
  if (rest.length > 1) rest = rest.slice(1);
  if (rest.at(-1) === 'ui') rest = rest.slice(0, -1);
  return rest.join('/') || path;
}

const clean = (s: string) => s.trim().replace(/[^\w一-龥-]+/g, '_').replace(/^_+|_+$/g, '');

/** 触发锚点：优先元素库 key，其次页面文案；无控件时为空 */
export function triggerAnchor(op: Op): string {
  return clean(op.entry_control?.element || op.entry_control?.name || op.row_target?.element || op.row_target?.column || '');
}

const stepSignature = (op: Op) => (op.steps ?? []).map((st) => `${st.kind}:${st.element ?? ''}:${st.api ?? ''}`).join('|');

const shortHash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 6);

/** 同键冲突时的区分后缀：取源码控件 key，其次操作名，都不唯一时用步骤签名哈希；不依赖出现顺序 */
function distinctiveSuffix(op: Op, anchor: string, taken: Set<string>): string {
  const elements = (op.steps ?? []).map((st) => clean(st.element ?? '')).filter((e) => e && e !== anchor);
  const hit = [...elements, clean(op.name ?? '')].find((c) => c && !taken.has(c));
  return hit ?? shortHash(stepSignature(op));
}

export function stableBaseId(op: Op): string {
  const page = clean(op.page_id || op.page || '') || 'page';
  const key = op.api ? clean(normalizeApi(op.api)) : clean(op.type);
  return `${page}.${key}`;
}

/**
 * 由引擎按源码事实生成操作 id：`<页面>.<接口归一化>@<触发锚点>`，与模型命名无关。
 * 同键冲突时按步骤签名排序后追加 `#2`、`#3`。
 */
export function assignStableOperationIds(artifact: FeatureArtifact): FeatureArtifact {
  const ops = artifact.operations;
  const ids = ops.map((o) => {
    const t = triggerAnchor(o);
    return t ? `${stableBaseId(o)}@${t}` : stableBaseId(o);
  });
  const groups = (list: string[]) => {
    const m = new Map<string, number[]>();
    list.forEach((id, i) => m.set(id, [...(m.get(id) ?? []), i]));
    return [...m.values()].filter((g) => g.length > 1);
  };
  for (const g of groups(ids)) {
    const anchor = triggerAnchor(ops[g[0]!]!);
    const ordered = [...g].sort((a, b) => stepSignature(ops[a]!).localeCompare(stepSignature(ops[b]!)) || a - b);
    const taken = new Set<string>();
    for (const i of ordered) {
      const suffix = distinctiveSuffix(ops[i]!, anchor, taken);
      taken.add(suffix);
      ids[i] = `${ids[i]}+${suffix}`;
    }
  }

  const oldCount = new Map<string, number>();
  for (const o of ops) oldCount.set(o.id, (oldCount.get(o.id) ?? 0) + 1);
  const remap = new Map<string, string>();
  ops.forEach((o, i) => {
    if (oldCount.get(o.id) === 1) remap.set(o.id, ids[i]!);
  });
  const mapRef = (s: string) => remap.get(s) ?? s;

  return {
    ...artifact,
    operations: ops.map((o, i) => ({
      ...o,
      id: ids[i]!,
      ...(o.execution_chain ? { execution_chain: o.execution_chain.map(mapRef) } : {}),
      ...(o.used_by ? { used_by: o.used_by.map(mapRef) } : {}),
    })),
  };
}
