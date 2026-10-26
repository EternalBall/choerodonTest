import type { FeatureArtifact } from '../core/schema.js';
import type { FieldDiffItem } from './diffFields.js';
import type { FlowChainDiff, ResolvedFlowStep, StepChange } from './resolveFlow.js';

/** 数据集名归一：忽略大小写与 `.current` 后缀，便于 page_model.ds 与 field_facts.ds 对齐 */
export function normDs(ds: string): string {
  return ds.toLowerCase().replace(/\.current$/i, '');
}

function stepArgFields(s: ResolvedFlowStep): string[] {
  const f = (s.args as { fields?: unknown } | undefined)?.fields;
  return Array.isArray(f) ? f.filter((x): x is string => typeof x === 'string') : [];
}

/** 流程显式涉及的字段名：步骤 args.fields ∪ operation.fields */
export function flowReferencedNames(steps: ResolvedFlowStep[], opFields?: string[]): Set<string> {
  const names = new Set<string>(opFields ?? []);
  for (const s of steps) for (const n of stepArgFields(s)) names.add(n);
  return names;
}

/**
 * 流程触及的数据集：page_model 里字段名与流程字段有交集的表单/表格的 ds。
 * 查询类流程额外纳入带 queryFields 的列表表格 ds（仅当 operation.type === query）。
 */
export function flowTouchedDatasets(
  _steps: ResolvedFlowStep[],
  names: Set<string>,
  artifacts: FeatureArtifact[],
  isQueryOp: boolean,
): Set<string> {
  const ds = new Set<string>();
  for (const art of artifacts) {
    if (!isQueryOp) {
      for (const f of art.page_model?.forms ?? []) {
        if (!f.ds) continue;
        if ((f.fields ?? []).some((x) => names.has(x.name))) ds.add(normDs(f.ds));
      }
    }
    for (const t of art.page_model?.tables ?? []) {
      if (!t.ds) continue;
      const nd = normDs(t.ds);
      if (isQueryOp) {
        ds.add(nd);
        continue;
      }
      // 非查询：字段名落在该表对应的 field_facts 上则视为触及（表格列/行编辑字段）
      const onTable = (art.field_facts ?? []).some((ff) => normDs(ff.ds) === nd && names.has(ff.name));
      if (onTable) ds.add(nd);
    }
  }
  return ds;
}

function opFieldsOf(art: FeatureArtifact | undefined, flowId: string): string[] | undefined {
  const op = art?.operations?.find((o) => o.id === flowId);
  return Array.isArray(op?.fields) ? (op!.fields as string[]) : undefined;
}

function isQueryOperation(art: FeatureArtifact | undefined, flowId: string): boolean {
  const op = art?.operations?.find((o) => o.id === flowId);
  return op?.type === 'query' || flowId === 'list_query';
}

/**
 * 某条事实是否应挂到该流程：
 * - 查询类：只认 queryFields，且 ds 落在列表表格
 * - 非查询：字段名命中且 ds 触及；不把 queryFields 挂到填表流程（避免同名串台）
 */
export function factMatchesFlow(
  fact: FieldDiffItem,
  names: Set<string>,
  datasets: Set<string>,
  isQueryOp: boolean,
): boolean {
  const ds = normDs(fact.ds);
  if (isQueryOp) {
    return fact.group === 'queryFields' && datasets.has(ds);
  }
  if (fact.group === 'queryFields') return false;
  if (!names.has(fact.name)) return false;
  return !datasets.size || datasets.has(ds);
}

/** 把已匹配的事实挂到最贴切的步骤（fill_form / filter_query）；挂不上则留在流程级 */
function distributeToSteps(
  steps: ResolvedFlowStep[],
  facts: FieldDiffItem[],
  existing: StepChange[] | undefined,
): StepChange[] {
  const byKey = new Map<string, StepChange>();
  for (const c of existing ?? []) byKey.set(c.key, { ...c });

  const keyOf = (s: ResolvedFlowStep, ordinal: Map<string, number>) => {
    const base = `${s.kind}:${s.api || s.element || ''}`;
    const n = (ordinal.get(base) ?? 0) + 1;
    ordinal.set(base, n);
    return n === 1 ? base : `${base}#${n}`;
  };

  const afterKeys: { key: string; s: ResolvedFlowStep }[] = [];
  const ord = new Map<string, number>();
  for (const s of steps) afterKeys.push({ key: keyOf(s, ord), s });

  for (const fact of facts) {
    let target: string | undefined;
    for (const { key, s } of afterKeys) {
      if (s.kind === 'fill_form' && stepArgFields(s).includes(fact.name)) {
        target = key;
        break;
      }
    }
    if (!target && fact.group === 'queryFields') {
      const hit = afterKeys.find((x) => x.s.kind === 'filter_query');
      if (hit) target = hit.key;
    }
    if (!target) continue;
    const cur = byKey.get(target) ?? { key: target, change: 'modified' as const };
    const list = [...(cur.field_facts ?? [])];
    if (!list.some((x) => x.key === fact.key)) list.push(fact);
    byKey.set(target, {
      ...cur,
      change: cur.change === 'added' || cur.change === 'removed' ? cur.change : 'modified',
      field_facts: list,
    });
  }

  // 保持原有步骤顺序，再追加新建的
  const out: StepChange[] = [];
  const seen = new Set<string>();
  for (const c of existing ?? []) {
    const u = byKey.get(c.key)!;
    out.push(u);
    seen.add(c.key);
  }
  for (const [k, c] of byKey) {
    if (!seen.has(k)) out.push(c);
  }

  // 流程级：未被步骤认领的事实
  return out;
}

/**
 * 将 field_facts diff 关联到相关 flow：
 * - 字段名出现在流程步骤/operation.fields → 挂上
 * - 查询类流程额外挂同表 queryFields
 * - 仅因字段事实变化时，把 unchanged 升为 modified
 */
export function attachFieldFactsToFlows(
  chains: FlowChainDiff[],
  facts: FieldDiffItem[],
  before: FeatureArtifact,
  after: FeatureArtifact,
): FlowChainDiff[] {
  if (!facts.length) return chains;

  return chains.map((chain) => {
    if (chain.change_type === 'added' || chain.change_type === 'removed') {
      // 整条新增/移除：把能按名称命中的事实也附上，便于报告阅读
      const steps = chain.change_type === 'added' ? chain.after : chain.before;
      const art = chain.change_type === 'added' ? after : before;
      const names = flowReferencedNames(steps, opFieldsOf(art, chain.id));
      const isQuery = isQueryOperation(art, chain.id);
      const datasets = flowTouchedDatasets(steps, names, [before, after], isQuery);
      const hit = facts.filter((f) => factMatchesFlow(f, names, datasets, isQuery));
      if (!hit.length) return chain;
      return { ...chain, field_facts: hit };
    }

    const steps = chain.after.length ? chain.after : chain.before;
    const names = flowReferencedNames(
      steps,
      opFieldsOf(after, chain.id) ?? opFieldsOf(before, chain.id),
    );
    const isQuery = isQueryOperation(after, chain.id) || isQueryOperation(before, chain.id);
    const datasets = flowTouchedDatasets(steps, names, [before, after], isQuery);
    const hit = facts.filter((f) => factMatchesFlow(f, names, datasets, isQuery));
    if (!hit.length) return chain;

    const step_changes = distributeToSteps(steps, hit, chain.step_changes);
    const claimed = new Set(step_changes.flatMap((c) => (c.field_facts ?? []).map((f) => f.key)));
    const flowLevel = hit.filter((f) => !claimed.has(f.key));
    const highlights = [
      ...chain.highlights,
      ...hit.map((f) => `数据集字段 ${f.ds}.${f.name}（${f.group}）${f.change === 'added' ? '新增' : f.change === 'removed' ? '移除' : '变更'}`),
    ];

    return {
      ...chain,
      change_type: chain.change_type === 'unchanged' ? 'modified' : chain.change_type,
      highlights,
      step_changes,
      // 挂到步骤上的不在流程级重复；未认领的留在流程级
      ...(flowLevel.length ? { field_facts: flowLevel } : {}),
    };
  });
}

/** 已被任一流程认领的 field_fact key */
export function linkedFieldFactKeys(chains: FlowChainDiff[]): Set<string> {
  const keys = new Set<string>();
  for (const c of chains) {
    for (const f of c.field_facts ?? []) keys.add(f.key);
    for (const s of c.step_changes ?? []) for (const f of s.field_facts ?? []) keys.add(f.key);
  }
  return keys;
}
