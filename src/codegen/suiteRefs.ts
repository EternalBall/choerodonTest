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

/** 用例引用了、元素库里却没有定义的元素；空数组表示一致 */
export function findDanglingRefs(suite: Suite, lib: ElementLib, extraNamespaces: string[] = []): DanglingRefs[] {
  const namespaces = new Set([...Object.keys(lib), ...extraNamespaces]);
  const out: DanglingRefs[] = [];
  for (const c of suite.cases) {
    const missing = collectCaseRefs(c, namespaces).filter((ref) => {
      const [ns, key] = ref.split('.');
      return !(lib[ns] && key in lib[ns]);
    });
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
