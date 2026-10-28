import type { FeatureArtifact } from '../core/schema.js';
import { normalizeApi } from '../core/operationId.js';

/** 未按 id 对上的新旧操作，接口集合 Jaccard 相似度达到该值才视为同一能力改名 */
const PAIR_THRESHOLD = 0.5;

type Op = FeatureArtifact['operations'][number];

export type OperationRename = { from: string; to: string };

const apiSignature = (op: Op): Set<string> =>
  new Set([op.api, ...(op.steps ?? []).map((s) => s.api)].filter((x): x is string => !!x).map(normalizeApi));

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** 对比前把 after 中改名的操作 id 还原为 before 的 id（含 meta_ops / flows 中的派生 id），使其按同一能力比较 */
export function alignOperations(
  before: FeatureArtifact,
  after: FeatureArtifact,
): { after: FeatureArtifact; renamed: OperationRename[] } {
  const beforeIds = new Set(before.operations.map((o) => o.id));
  const afterIds = new Set(after.operations.map((o) => o.id));
  const onlyBefore = before.operations.filter((o) => !afterIds.has(o.id));
  const onlyAfter = after.operations.filter((o) => !beforeIds.has(o.id));

  const pairs = onlyAfter.flatMap((a) =>
    onlyBefore.map((b) => ({ from: b.id, to: a.id, score: jaccard(apiSignature(b), apiSignature(a)) })),
  );
  pairs.sort((x, y) => y.score - x.score || x.from.localeCompare(y.from) || x.to.localeCompare(y.to));

  const usedFrom = new Set<string>();
  const usedTo = new Set<string>();
  const renamed: OperationRename[] = [];
  for (const p of pairs) {
    if (p.score < PAIR_THRESHOLD || usedFrom.has(p.from) || usedTo.has(p.to)) continue;
    usedFrom.add(p.from);
    usedTo.add(p.to);
    renamed.push({ from: p.from, to: p.to });
  }
  if (!renamed.length) return { after, renamed };

  const back = new Map(renamed.map((r) => [r.to, r.from]));
  const rewrite = (s: string): string => {
    let out = s;
    for (const r of [...renamed].sort((a, b) => b.to.length - a.to.length)) out = out.split(r.to).join(r.from);
    return out;
  };
  const mapRef = (s: string) => back.get(s) ?? s;
  const next: FeatureArtifact = {
    ...after,
    operations: after.operations.map((o) => ({
      ...o,
      id: mapRef(o.id),
      ...(o.execution_chain ? { execution_chain: o.execution_chain.map(mapRef) } : {}),
      ...(o.used_by ? { used_by: o.used_by.map(mapRef) } : {}),
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
