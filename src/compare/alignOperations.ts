import type { FeatureArtifact } from '../core/schema.js';
import { normalizeApi } from '../core/operationId.js';

/** 新旧操作的接口集合或步骤动作集合 Jaccard 相似度达到该值才视为同一操作 */
const PAIR_THRESHOLD = 0.5;
/** 步骤动作少于该数量时不用动作序列做配对依据（单步骤操作过于通用） */
const MIN_ACTIONS_FOR_CHAIN = 2;

type Op = FeatureArtifact['operations'][number];

export type OperationRename = { from: string; to: string };

const apiSignature = (op: Op): Set<string> =>
  new Set([op.api, ...(op.steps ?? []).map((s) => s.api)].filter((x): x is string => !!x).map(normalizeApi));

/** execution_chain 中以本操作 id 为前缀的部分，去掉前缀后为动作后缀，如 `_click_orgswitchbtn` */
const ownActions = (op: Op): Set<string> => {
  const out = new Set<string>();
  for (const e of op.execution_chain ?? []) if (e.startsWith(`${op.id}_`)) out.add(e.slice(op.id.length));
  return out;
};

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

const chainSim = (b: Op, a: Op): number => {
  const ab = ownActions(b);
  const aa = ownActions(a);
  return ab.size >= MIN_ACTIONS_FOR_CHAIN && aa.size >= MIN_ACTIONS_FOR_CHAIN ? jaccard(ab, aa) : 0;
};

const hasSignal = (op: Op): boolean => apiSignature(op).size > 0 || ownActions(op).size >= MIN_ACTIONS_FOR_CHAIN;

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * 按操作语义配对新旧版本（不依赖 id 相同）：接口集合或动作序列相似度为主，名称相同、id 相同为次级排序依据；
 * 无任何可比信号且 id 相同的操作视为同一操作。未配对的新操作若 id 与旧操作冲突则加 ~added 后缀，避免被误比为修改。
 */
export function alignOperations(
  before: FeatureArtifact,
  after: FeatureArtifact,
): { after: FeatureArtifact; renamed: OperationRename[] } {
  const candidates: { b: Op; a: Op; rank: number }[] = [];
  for (const b of before.operations) {
    for (const a of after.operations) {
      if (b.page_id && a.page_id && b.page_id !== a.page_id) continue;
      const sameId = b.id === a.id;
      const api = jaccard(apiSignature(b), apiSignature(a));
      const chain = chainSim(b, a);
      const primary =
        sameId && !hasSignal(b) && !hasSignal(a) ? PAIR_THRESHOLD : Math.max(api, chain);
      if (primary < PAIR_THRESHOLD) continue;
      const rank = primary + 0.01 * chain + 0.01 * (b.name === a.name ? 1 : 0) + 0.005 * (sameId ? 1 : 0);
      candidates.push({ b, a, rank });
    }
  }
  candidates.sort((x, y) => y.rank - x.rank || x.b.id.localeCompare(y.b.id) || x.a.id.localeCompare(y.a.id));

  const pairedB = new Set<Op>();
  const pairedA = new Map<Op, Op>();
  for (const c of candidates) {
    if (pairedB.has(c.b) || pairedA.has(c.a)) continue;
    pairedB.add(c.b);
    pairedA.set(c.a, c.b);
  }

  const renamed: OperationRename[] = [];
  const finalId = new Map<string, string>();
  const beforeIds = new Set(before.operations.map((o) => o.id));
  for (const a of after.operations) {
    const b = pairedA.get(a);
    if (b) {
      finalId.set(a.id, b.id);
      if (b.id !== a.id) renamed.push({ from: b.id, to: a.id });
    } else {
      finalId.set(a.id, beforeIds.has(a.id) ? `${a.id}~added` : a.id);
    }
  }
  if (finalId.size === 0 || [...finalId].every(([from, to]) => from === to)) return { after, renamed };

  const keys = [...finalId.keys()].sort((x, y) => y.length - x.length);
  const pattern = new RegExp(keys.map(escapeRegExp).join('|'), 'g');
  const rewrite = (s: string): string => s.replace(pattern, (m) => finalId.get(m) ?? m);
  const mapRef = (s: string) => finalId.get(s) ?? s;

  const next: FeatureArtifact = {
    ...after,
    operations: after.operations.map((o) => ({
      ...o,
      id: mapRef(o.id),
      ...(o.execution_chain ? { execution_chain: o.execution_chain.map(rewrite) } : {}),
      ...(o.used_by ? { used_by: o.used_by.map(rewrite) } : {}),
    })),
    meta_ops: after.meta_ops?.map((m) => ({ ...m, id: rewrite(m.id) })),
    flows: after.flows?.map((f) => ({
      ...f,
      id: rewrite(f.id),
      nodes: f.nodes.map((n) => ({ ...n, id: rewrite(n.id), meta_op_id: rewrite(n.meta_op_id) })),
      edges: f.edges.map((e) => ({ ...e, id: rewrite(e.id), source: rewrite(e.source), target: rewrite(e.target) })),
    })),
  };
  return { after: next, renamed };
}
