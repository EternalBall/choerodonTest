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

/** applies：动作名（suite action），或 `route:<前缀>` 匹配功能页面路由（含 external 页） */
export type InteractionNote = { id: string; applies?: string[]; note: string; source?: string };

/** 静态抽取的 DataSet 字段事实（feature.yaml field_facts） */
export type FieldFact = { name: string; ds?: string; file?: string; attrs?: Record<string, unknown> };

export type CardPage = { id: string; name?: string; route?: string; scope?: string };

export type CardInput = {
  feature: string;
  slug: string;
  cases: CardCase[];
  /** 元素库，key 不带命名空间 */
  lib: ElementLib;
  fieldRules?: FieldRule[];
  fieldFacts?: FieldFact[];
  pages?: CardPage[];
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
  if (depth === 0 && typeof def.note === 'string' && def.note) s += `（说明：${def.note}）`;
  return s;
}

/** 顶层逗号拆分（括号/引号内的逗号不拆） */
export function splitCssUnion(css: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = '';
  let cur = '';
  for (const ch of css) {
    if (quote) {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const SCOPE_PREFIXES = [
  /^\.c7n-pro-modal-wrapper:visible\s+/,
  /^body:not\(:has\([^)]*\)\)(?::not\(:has\([^)]*\)\))?\s+/,
  /^\.page-content\s+\.c7n-tabs-tabpane-active\s+/,
  /^\.page-content\s+/,
];

/** 去掉运行时作用域前缀（弹层 / 激活页签 / 页面主体），只留控件本身的选择器 */
function coreSelector(branch: string): string {
  let b = branch;
  for (let changed = true; changed; ) {
    changed = false;
    for (const re of SCOPE_PREFIXES) {
      if (re.test(b)) {
        b = b.replace(re, '');
        changed = true;
      }
    }
  }
  return b;
}

/** css 里常见的 c7n 结构转成文字，并附选择器：作用域分支合并为一句说明，真正的备选分支逐条列出 */
export function humanizeCss(css: string): string {
  const hints: string[] = [];
  const name = css.match(/input\[name="([^"]+)"\]/)?.[1];
  if (name) hints.push(`字段 name=${name}`);
  if (/icon-search/.test(css)) hints.push('的 LOV 放大镜');
  const icon = css.match(/:has\(\.icon-([\w-]+)\)/)?.[1];
  if (icon && !name) hints.push(`带 icon-${icon} 图标的按钮`);
  const branches = splitCssUnion(css);
  const scoped = branches.some((b) => b.startsWith('body:not('));
  if (scoped) {
    hints.push(/tabpane-active/.test(css) ? '（有弹层时在弹层内，否则在当前激活页签内）' : '（有弹层时在弹层内，否则在页面主体内）');
  } else if (/modal-wrapper/.test(css)) hints.push('（在当前弹层内）');
  else if (/thead/.test(css)) hints.push('（表头）');
  else if (/page-head/.test(css)) hints.push('（页头）');
  const cores = [...new Set(scoped ? branches.map(coreSelector) : branches)];
  const sel = cores.map((c) => `\`${c}\``).join(' 或 ');
  return `${hints.join('')}${hints.length ? ' ' : ''}css ${sel}`;
}

function refArg(step: CardStep, slug: string): string | undefined {
  const a = step.args ?? {};
  const v = a.target ?? a.row ?? a.table ?? a.open;
  return typeof v === 'string' ? stripNs(v, slug) : undefined;
}

/** DataSet 标识：同名 DS（如多个文件里都叫 tableDS）按文件区分 */
const dsKey = (f: FieldFact) => (f.ds ? `${f.file ?? ''}#${f.ds}` : '');
const dsLabel = (key: string) => {
  const [file, ds] = key.split('#');
  return `${ds}@${file.split('/').pop()}`;
};

type FactView = { label?: string; labels: string[]; required: boolean; derivedFrom?: string; disabled: boolean; defaultValue?: unknown };

/** 选出覆盖这些字段最多的 DataSet；并列则返回 undefined（无法判断表单属于哪个 DS） */
function pickDs(names: string[], facts: FieldFact[]): string | undefined {
  const hit = new Map<string, Set<string>>();
  for (const f of facts) if (f.ds && names.includes(f.name)) (hit.get(dsKey(f)) ?? hit.set(dsKey(f), new Set()).get(dsKey(f))!).add(f.name);
  const score = new Map([...hit].map(([k, v]) => [k, v.size]));
  const ranked = [...score.entries()].sort((a, b) => b[1] - a[1]);
  if (!ranked.length || (ranked[1] && ranked[1][1] === ranked[0][1])) return undefined;
  return ranked[0][0];
}

function factView(name: string, facts: FieldFact[], ds?: string): FactView | undefined {
  const all = facts.filter((f) => f.name === name);
  if (!all.length) return undefined;
  const mine = ds ? all.filter((f) => dsKey(f) === ds) : all;
  const pick = mine[0] ?? all[0];
  const attrs = pick.attrs ?? {};
  const dsFields = new Set(facts.filter((f) => dsKey(f) === dsKey(pick)).map((f) => f.name));
  const bind = typeof attrs.bind === 'string' ? attrs.bind : undefined;
  // bind 指向同 DS 另一字段（如 tagLov.tagDescription）= 选了该字段后自动带出
  const derivedFrom = bind && dsFields.has(bind.split('.')[0]) ? bind.split('.')[0] : undefined;
  return {
    label: typeof attrs.label === 'string' ? attrs.label : undefined,
    labels: [...new Set(all.map((f) => f.attrs?.label).filter((x): x is string => typeof x === 'string'))],
    required: attrs.required === true,
    derivedFrom,
    disabled: attrs.disabled === true,
    defaultValue: attrs.defaultValue,
  };
}

function factFlags(v: FactView | undefined): string {
  if (!v) return '';
  const out: string[] = [];
  if (v.required) out.push('必填');
  if (v.defaultValue !== undefined) out.push(`默认值 ${JSON.stringify(v.defaultValue)}，页面可能已预填或只读`);
  if (v.derivedFrom) out.push(`由 ${v.derivedFrom} 选择后自动带出`);
  if (v.disabled) out.push('只读');
  return out.join('，');
}

/** 元素定义里的字段名（input[name=X] 或 data-index=X） */
function fieldNameOf(def: ElementDef | undefined): string | undefined {
  const css = typeof def?.css === 'string' ? def.css : '';
  return css.match(/input\[name="([^"]+)"\]/)?.[1] ?? css.match(/data-index="([^"]+)"/)?.[1];
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
      const facts = input.fieldFacts ?? [];
      const names = fields.map((f) => String(f.name));
      const ds = pickDs(names, facts);
      const list = fields.map((f) => {
        const r = rules.get(String(f.name));
        const v = factView(String(f.name), facts, ds);
        // DS 不唯一时同名字段在不同表单里标签不同（如复制弹窗「目标收集组编码」），全部列出
        const label = ds ? (v?.label ?? r?.label) : v && v.labels.length > 1 ? v.labels.join(' / ') : (v?.label ?? r?.label);
        const flags = v ? factFlags(v) : r?.required ? '必填' : '';
        return `${label ?? f.name}（name=${f.name}，${f.control ?? r?.control ?? '?'}${flags ? `，${flags}` : ''}）`;
      });
      let line = `${name}：${list.join('、')}`;
      if (ds) {
        const missing = facts
          .filter((f) => dsKey(f) === ds && !names.includes(f.name))
          .map((f) => ({ f, v: factView(f.name, facts, ds)! }))
          .filter(({ v }) => v.required && !v.derivedFrom && !v.disabled);
        if (missing.length) {
          line += `；同表单（${dsLabel(ds)}）里还有必填：${missing.map(({ f, v }) => `${v.label ?? f.name}(${f.name})`).join('、')}`;
        }
      }
      return line;
    }
    case 'fill': {
      const v = factView(fieldNameOf(ref ? input.lib[ref] : undefined) ?? '', input.fieldFacts ?? []);
      const flags = factFlags(v);
      return `${name}${where}${flags ? `（字段事实：${flags}${v?.derivedFrom || v?.disabled ? '，通常无需手填' : ''}）` : ''}`;
    }
    case 'clickExpectApi': {
      const urls = [a.successUrlIncludes, a.urlIncludes].flat().filter(Boolean);
      return `${name}${where}；取证接口：${[...new Set(urls)].map((u) => `\`${u}\``).join('、')}`;
    }
    case 'pickLov':
    case 'pickSelect':
      return `${name}${where}${a.field ? `（字段 ${a.field}）` : ''}${
        step.action === 'pickLov' ? '；若在表格行内编辑：输入框没有 name，先点单元格（td[data-index=字段名]）激活，再点放大镜' : ''
      }`;
    default:
      return `${name}${where}`;
  }
}

export function notesFor(actions: Set<string>, notes: InteractionNote[]): InteractionNote[] {
  return notes.filter((n) => !n.applies?.length || n.applies.some((x) => actions.has(x)));
}

export function notesForRoute(route: string, notes: InteractionNote[]): InteractionNote[] {
  return notes.filter((n) => n.applies?.some((x) => x.startsWith('route:') && route.startsWith(x.slice(6))));
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
  const factReq = new Map<string, string[]>();
  for (const f of input.fieldFacts ?? []) {
    if (f.attrs?.required !== true || !f.ds) continue;
    const k = dsLabel(dsKey(f));
    (factReq.get(k) ?? factReq.set(k, []).get(k)!).push(`${f.attrs.label ?? f.name}(${f.name})`);
  }
  if (required.length || factReq.size || input.apis?.length) {
    L.push('## 表单与接口', '');
    if (factReq.size) {
      L.push('- 源码 DataSet 中静态必填的字段（动态必填不在其中，以页面必填标记为准）：');
      for (const [ds, list] of factReq) L.push(`  - ${ds}：${[...new Set(list)].join('、')}`);
    } else if (required.length) {
      L.push(`- 分析出的必填字段（可能不全，以页面必填标记为准）：${required.map((r) => `${r.label ?? r.name}(${r.name})`).join('、')}`);
    }
    if (input.apis?.length) L.push(`- 相关接口：${input.apis.map((u) => `\`${u}\``).join('、')}`);
    L.push('');
  }
  const allNotes = input.notes ?? [];
  const actionNotes = allNotes.filter((n) => !n.applies?.some((x) => x.startsWith('route:')));
  if (actionNotes.length) {
    L.push('## 交互要点', '', ...actionNotes.map((n) => `- [${n.id}] ${n.note}`), '');
  }
  const external = (input.pages ?? []).filter((p) => p.scope === 'external' && p.route);
  if (external.length) {
    L.push('## 外部页面（本功能只负责入口，页面本身是平台通用页）', '');
    for (const p of external) {
      const ns = notesForRoute(p.route!, allNotes);
      L.push(`- ${p.name ?? p.id}：\`${p.route}\``, ...ns.map((n) => `  - ${n.note}`));
      if (!ns.length) L.push('  - 暂无该页面的交互要点，按页面快照操作，走通后把要点回写到 interaction-notes.yaml');
    }
    L.push('');
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
