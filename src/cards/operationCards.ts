/**
 * 操作卡：把项目已有的分析产物（suite 步骤 + 元素库 + 字段规则 + 平台交互要点）渲染成给自主测试 agent 看的提示。
 * 只回答「在哪、怎么点、怎么取证」，不给预期结果——预期以业务确认的场景表为准。
 * 卡片内容都是提示：与页面快照不一致时以页面为准，并作为「提示偏差」上报，供回写修正。
 */

export type ElementDef = Record<string, unknown>;
export type ElementLib = Record<string, ElementDef>;

export type CardStep = {
  action: string;
  name?: string;
  args?: Record<string, unknown>;
};

export type CardCase = { id: string; title: string; steps: CardStep[]; tags?: string[] };

export type FieldRule = { name: string; label?: string; control?: string; required?: boolean; editable_when?: string[] };

export type InteractionNote = { id: string; applies?: string[]; note: string; source?: string };

export type CardInput = {
  feature: string;
  slug: string;
  cases: CardCase[];
  /** 元素库，key 不带命名空间 */
  lib: ElementLib;
  fieldRules?: FieldRule[];
  apis?: string[];
  notes?: InteractionNote[];
  /** 路由生效源码判定说明（routeResolve.describeResolution 输出） */
  routeReport?: string[];
  sourceDir?: string;
};

const NS_RE = /^[\w-]+\./;

function stripNs(ref: string, slug: string): string {
  return ref.startsWith(slug + '.') ? ref.slice(slug.length + 1) : ref.replace(NS_RE, '');
}

/** 把元素定义写成人能读的定位提示；within 递归展开一层作用域 */
export function describeElement(key: string, lib: ElementLib, depth = 0): string {
  const def = lib[key];
  if (!def) return `\`${key}\`（元素库无定义，按步骤名称在页面上找）`;
  const parts: string[] = [];
  if (def.role) parts.push(`${def.role}${def.name ? `「${String(def.name).replace(/^\^\\s\*|\\s\*\$$|^\^|\$$/g, '')}」` : ''}`);
  if (def.text) parts.push(`文字「${def.text}」`);
  if (def.label) parts.push(`标签「${def.label}」`);
  if (def.placeholder) parts.push(`占位「${def.placeholder}」`);
  if (def.testId) parts.push(`testId=${def.testId}`);
  if (def.css && !parts.length) parts.push(humanizeCss(String(def.css)));
  if (def.nth !== undefined) parts.push(typeof def.nth === 'number' ? `第 ${def.nth + 1} 个` : `取 ${def.nth}`);
  let s = parts.join('，') || `\`${key}\``;
  if (def.within && depth < 2) {
    const w = stripNs(String(def.within), '');
    s += `；范围：${lib[w] ? describeElement(w, lib, depth + 1) : w}`;
  }
  return s;
}

/** css 里常见的 c7n 结构转成文字，原 css 附后（多分支时只附第一支） */
export function humanizeCss(css: string): string {
  const hints: string[] = [];
  const name = css.match(/input\[name="([^"]+)"\]/)?.[1];
  if (name) hints.push(`字段 name=${name}`);
  if (/icon-search/.test(css)) hints.push('的 LOV 放大镜');
  const icon = css.match(/:has\(\.icon-([\w-]+)\)/)?.[1];
  if (icon && !name) hints.push(`带 icon-${icon} 图标的按钮`);
  if (/modal-wrapper/.test(css)) hints.push('（在当前弹层内）');
  else if (/thead/.test(css)) hints.push('（表头）');
  else if (/page-head/.test(css)) hints.push('（页头）');
  const first = css.split(/,\s*(?![^()]*\))/)[0];
  return `${hints.join('')}${hints.length ? ' ' : ''}css \`${first}\``;
}

function refArg(step: CardStep, slug: string): string | undefined {
  const a = step.args ?? {};
  const v = a.target ?? a.row ?? a.table ?? a.open;
  return typeof v === 'string' ? stripNs(v, slug) : undefined;
}

function describeStep(step: CardStep, input: CardInput): string {
  const a = step.args ?? {};
  const name = step.name ?? step.action;
  const ref = refArg(step, input.slug);
  const where = ref ? `：${describeElement(ref, input.lib)}` : '';
  switch (step.action) {
    case 'goto':
      return `${name}：打开 \`${a.path}\``;
    case 'fillForm': {
      const fields = Array.isArray(a.fields) ? (a.fields as Array<Record<string, unknown>>) : [];
      const rules = new Map((input.fieldRules ?? []).map((r) => [r.name, r]));
      const list = fields.map((f) => {
        const r = rules.get(String(f.name));
        return `${r?.label ?? f.name}（name=${f.name}，${f.control ?? r?.control ?? '?'}${r?.required ? '，必填' : ''}）`;
      });
      return `${name}：${list.join('、')}`;
    }
    case 'clickExpectApi': {
      const urls = [a.successUrlIncludes, a.urlIncludes].flat().filter(Boolean);
      return `${name}${where}；取证接口：${[...new Set(urls)].map((u) => `\`${u}\``).join('、')}`;
    }
    case 'pickLov':
    case 'pickSelect':
      return `${name}${where}${a.field ? `（字段 ${a.field}）` : ''}`;
    default:
      return `${name}${where}`;
  }
}

export function notesFor(actions: Set<string>, notes: InteractionNote[]): InteractionNote[] {
  return notes.filter((n) => !n.applies?.length || n.applies.some((x) => actions.has(x)));
}

export function renderOperationCards(input: CardInput): string {
  const L: string[] = [];
  L.push(`# 操作卡：${input.feature}`, '');
  L.push(
    '> 本卡由项目分析产物生成，**只是提示**：每步先看页面快照，与卡片一致就照做；不一致以页面为准，并在结果里记一条「提示偏差：卡片说 X，页面是 Y」。',
    '> 卡片不含预期结果，是否通过按场景表的预期判定，保存类操作必须刷新/重新打开回查。',
    '',
  );
  if (input.sourceDir || input.routeReport?.length) {
    L.push('## 生效源码', '');
    if (input.sourceDir) L.push(`- 源码目录（只读，可用于定位原因）：\`${input.sourceDir}\``);
    if (input.routeReport?.length) L.push('- 路由 priority 判定：', '```', ...input.routeReport, '```');
    L.push('');
  }
  const required = (input.fieldRules ?? []).filter((r) => r.required);
  if (required.length || input.apis?.length) {
    L.push('## 表单与接口', '');
    if (required.length) L.push(`- 分析出的必填字段（可能不全，以页面必填标记为准）：${required.map((r) => `${r.label ?? r.name}(${r.name})`).join('、')}`);
    if (input.apis?.length) L.push(`- 相关接口：${input.apis.map((u) => `\`${u}\``).join('、')}`);
    L.push('');
  }
  const allNotes = input.notes ?? [];
  if (allNotes.length) {
    L.push('## 交互要点', '', ...allNotes.map((n) => `- [${n.id}] ${n.note}`), '');
  }
  L.push('## 各操作', '');
  for (const c of input.cases) {
    L.push(`### ${c.title.replace(`${input.feature} - `, '')}`, '');
    c.steps.forEach((s, i) => L.push(`${i + 1}. ${describeStep(s, input)}`));
    const specific = notesFor(new Set(c.steps.map((s) => s.action)), allNotes).filter((n) => n.applies?.length);
    if (specific.length) L.push('', `要点：${specific.map((n) => `[${n.id}]`).join(' ')}`);
    L.push('');
  }
  return L.join('\n');
}
