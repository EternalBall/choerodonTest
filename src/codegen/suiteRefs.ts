import type { CaseDef, Suite } from '../core/schema.js';

type ElementLib = Record<string, Record<string, unknown>>;
type ElementDef = Record<string, unknown>;

const REF_RE = /^([A-Za-z_][\w]*)\.([A-Za-z_][\w]*)$/;

function walkStrings(value: unknown, visit: (s: string) => void): void {
  if (typeof value === 'string') visit(value);
  else if (Array.isArray(value)) value.forEach((v) => walkStrings(v, visit));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => walkStrings(v, visit));
}

/**
 * 一条用例引用到的元素（namespace.key）。只认 namespaces 里列出的命名空间，
 * 避免把 "a.b" 形态的普通取值（文件名、版本号）误判为元素引用。
 */
export function collectCaseRefs(c: CaseDef, namespaces: Set<string>): string[] {
  const refs = new Set<string>();
  const visit = (s: string) => {
    const m = REF_RE.exec(s.trim());
    if (m && namespaces.has(m[1])) refs.add(s.trim());
  };
  for (const step of c.steps) {
    walkStrings(step.args, visit);
    walkStrings(step.ready, visit);
    walkStrings(step.assert, visit);
    walkStrings(step.skipIfMissing, visit);
    if (step.screenshot && typeof step.screenshot === 'object') walkStrings(step.screenshot.target, visit);
  }
  return [...refs].sort();
}

export type DanglingRefs = { caseId: string; title: string; missing: string[] };

/**
 * 一条用例里不可用的元素引用：元素库没有定义，或定义被建库标为 ambiguous（如多实例组件缺实例文案）。
 * 返回 `ns.key` 或 `ns.key（原因）`；within 链上的不可用元素一并检查。
 */
export function caseUnusableRefs(c: CaseDef, lib: ElementLib, namespaces: Set<string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const check = (ref: string, curNs?: string) => {
    const full = ref.includes('.') || !curNs ? ref : `${curNs}.${ref}`;
    if (seen.has(full)) return;
    seen.add(full);
    const [ns, key] = full.split('.');
    const def = lib[ns]?.[key] as Record<string, unknown> | undefined;
    if (!def) {
      out.push(full);
      return;
    }
    if (typeof def.ambiguous === 'string') out.push(`${full}（${def.ambiguous}）`);
    if (typeof def.within === 'string') check(def.within, ns);
  };
  for (const ref of collectCaseRefs(c, namespaces)) check(ref);
  return out;
}

/** 用例引用了、元素库里却没有定义（或定义不唯一）的元素；空数组表示一致 */
export function findDanglingRefs(suite: Suite, lib: ElementLib, extraNamespaces: string[] = []): DanglingRefs[] {
  const namespaces = new Set([...Object.keys(lib), ...extraNamespaces]);
  const out: DanglingRefs[] = [];
  for (const c of suite.cases) {
    const missing = caseUnusableRefs(c, lib, namespaces);
    if (missing.length) out.push({ caseId: c.id, title: c.title, missing });
  }
  return out;
}

/** 生成器允许自行声明的定位方式：只能用界面可见语义，不许写 css（css 只能来自 kit / 人工 / 探针） */
const ALLOWED_ROLES = new Set([
  'button', 'tab', 'link', 'menuitem', 'checkbox', 'radio', 'dialog', 'row', 'cell',
  'option', 'textbox', 'combobox', 'switch', 'columnheader', 'heading',
]);
const ALLOWED_FIELDS = new Set(['role', 'name', 'text', 'label', 'placeholder', 'within']);

export type SanitizedElements = {
  accepted: Record<string, ElementDef>;
  rejected: { key: string; reason: string }[];
};

export function sanitizeGeneratedElements(raw: unknown): SanitizedElements {
  const accepted: Record<string, ElementDef> = {};
  const rejected: { key: string; reason: string }[] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { accepted, rejected };
  for (const [key, def] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^[A-Za-z_]\w*$/.test(key)) {
      rejected.push({ key, reason: 'key 不是合法标识符' });
      continue;
    }
    if (!def || typeof def !== 'object' || Array.isArray(def)) {
      rejected.push({ key, reason: '定义不是对象' });
      continue;
    }
    const d = def as Record<string, unknown>;
    const extra = Object.keys(d).filter((k) => !ALLOWED_FIELDS.has(k));
    if (extra.length) {
      rejected.push({ key, reason: `不允许的字段: ${extra.join(', ')}（生成器不得自造 css）` });
      continue;
    }
    if (d.role != null) {
      if (!ALLOWED_ROLES.has(String(d.role))) {
        rejected.push({ key, reason: `role 不在允许范围: ${String(d.role)}` });
        continue;
      }
      if (!d.name) {
        rejected.push({ key, reason: 'role 必须带 name（界面可见文案）' });
        continue;
      }
    } else if (!d.text && !d.label && !d.placeholder) {
      rejected.push({ key, reason: '需要 role+name / text / label / placeholder 之一' });
      continue;
    }
    const clean: ElementDef = {};
    for (const k of ALLOWED_FIELDS) if (d[k] != null && d[k] !== '') clean[k] = String(d[k]);
    accepted[key] = clean;
  }
  return { accepted, rejected };
}

export function formatDangling(list: DanglingRefs[]): string {
  return list.map((d) => `- ${d.caseId}（${d.title}）: ${d.missing.join(', ')}`).join('\n');
}

const LOCATOR_FIELDS = ['role', 'name', 'testId', 'label', 'placeholder', 'text', 'css', 'within', 'nth'];

function locatorKey(lib: ElementLib, ref: string): string | undefined {
  const [ns, key] = ref.split('.');
  const def = lib[ns]?.[key] as Record<string, unknown> | undefined;
  if (!def) return undefined;
  return JSON.stringify(LOCATOR_FIELDS.map((f) => def[f] ?? null));
}

export type SelfReadyFix = { caseId: string; step: string; target: string; ready: string };

/**
 * 点击后的就绪条件若与被点元素是同一个定位（如点「编辑」后等「编辑」可见），
 * 对编辑/切换类按钮必然失败（点完按钮就消失）。这类 ready 不提供任何信息，直接去掉并记录。
 */
export function dropSelfReady(suite: Suite, lib: ElementLib): SelfReadyFix[] {
  const fixes: SelfReadyFix[] = [];
  for (const c of suite.cases) {
    for (const step of c.steps) {
      const target = typeof step.args?.target === 'string' ? step.args.target : undefined;
      const ready = step.ready?.visible;
      if (!target || !ready || !step.action.startsWith('click')) continue;
      const a = locatorKey(lib, target);
      const b = locatorKey(lib, ready);
      if (a && b && a === b) {
        fixes.push({ caseId: c.id, step: step.name, target, ready });
        delete step.ready!.visible;
        if (!step.ready!.hidden && !step.ready!.response) step.ready = undefined;
      }
    }
  }
  return fixes;
}
