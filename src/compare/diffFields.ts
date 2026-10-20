import type { FeatureArtifact, FieldFact } from '../core/schema.js';
import { deepEqual } from './deepEqual.js';

export type FieldAttrDiff = { attr: string; before: unknown; after: unknown };

export type FieldDiffItem = {
  /** ds::group::name；ds 改名按删除+新增处理 */
  key: string;
  ds: string;
  group: string;
  name: string;
  change: 'added' | 'removed' | 'changed';
  attrs: FieldAttrDiff[];
};

/** 通用逐项 diff 结果（field_rules / validations / page_states） */
export type ListDiffItem = {
  key: string;
  change: 'added' | 'removed' | 'changed';
  attrs: FieldAttrDiff[];
};

export type RuleListsDiff = {
  field_rules: ListDiffItem[];
  validations: ListDiffItem[];
  page_states: ListDiffItem[];
};

const byKey = (a: { key: string }, b: { key: string }) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

/** 属性并集按字母序，缺失一侧记 undefined，保证输出稳定 */
function diffAttrs(
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined,
): FieldAttrDiff[] {
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])].sort();
  const out: FieldAttrDiff[] = [];
  for (const attr of keys) {
    const b = before?.[attr];
    const a = after?.[attr];
    // added/removed 列全部属性；changed 只列不等的
    if (before && after && deepEqual(b, a)) continue;
    out.push({ attr, before: b, after: a });
  }
  return out;
}

/** 按 key 配对的通用 diff：缺一侧即 added/removed，两侧都有则比属性 */
function diffKeyed<T>(
  before: Map<string, T>,
  after: Map<string, T>,
  toAttrs: (item: T) => Record<string, unknown>,
): { key: string; change: 'added' | 'removed' | 'changed'; attrs: FieldAttrDiff[] }[] {
  const out: { key: string; change: 'added' | 'removed' | 'changed'; attrs: FieldAttrDiff[] }[] = [];
  for (const [key, item] of after) {
    if (!before.has(key)) out.push({ key, change: 'added', attrs: diffAttrs(undefined, toAttrs(item)) });
  }
  for (const [key, item] of before) {
    const right = after.get(key);
    if (!right) {
      out.push({ key, change: 'removed', attrs: diffAttrs(toAttrs(item), undefined) });
      continue;
    }
    const attrs = diffAttrs(toAttrs(item), toAttrs(right));
    if (attrs.length) out.push({ key, change: 'changed', attrs });
  }
  return out.sort(byKey);
}

export function fieldFactKey(f: Pick<FieldFact, 'ds' | 'group' | 'name'>): string {
  return `${f.ds}::${f.group}::${f.name}`;
}

/**
 * 字段事实 diff。同键重复（同 ds 同名字段写了两次）时后者覆盖前者：
 * 事实本身有歧义，宁可稳定取最后一个，也不要因顺序抖动误报。
 */
export function diffFieldFacts(before?: FieldFact[], after?: FieldFact[]): FieldDiffItem[] {
  const index = (list?: FieldFact[]) => new Map((list ?? []).map((f) => [fieldFactKey(f), f]));
  return diffKeyed(index(before), index(after), (f) => f.attrs).map((r) => {
    const [ds, group, ...rest] = r.key.split('::');
    // name 里理论上可能含 '::'，用 rest 拼回
    return { ...r, ds: ds!, group: group!, name: rest.join('::') };
  });
}

/** 以 getKey 建索引；同键多条且允许 dedupe 时，该键的每一条都加 #序号（从 1 起），避免首条与单条混淆 */
function indexList<T>(list: T[] | undefined, getKey: (item: T) => string, dedupe: boolean) {
  const map = new Map<string, T>();
  const items = list ?? [];
  const total = new Map<string, number>();
  for (const it of items) total.set(getKey(it), (total.get(getKey(it)) ?? 0) + 1);
  const seen = new Map<string, number>();
  for (const it of items) {
    const k = getKey(it);
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    map.set(dedupe && (total.get(k) ?? 0) > 1 ? `${k}#${n}` : k, it);
  }
  return map;
}

function diffList<T extends object>(
  before: T[] | undefined,
  after: T[] | undefined,
  getKey: (item: T) => string,
  dedupe = false,
): ListDiffItem[] {
  return diffKeyed(
    indexList(before, getKey, dedupe),
    indexList(after, getKey, dedupe),
    (item) => item as Record<string, unknown>,
  );
}

/** field_rules 以 name 为键（同名多条加 #序号）；validations / page_states 以 id 为键 */
export function diffRuleLists(
  before: Pick<FeatureArtifact, 'field_rules' | 'validations' | 'page_states'>,
  after: Pick<FeatureArtifact, 'field_rules' | 'validations' | 'page_states'>,
): RuleListsDiff {
  return {
    field_rules: diffList(before.field_rules, after.field_rules, (r) => r.name, true),
    validations: diffList(before.validations, after.validations, (r) => r.id),
    page_states: diffList(before.page_states, after.page_states, (r) => r.id),
  };
}
