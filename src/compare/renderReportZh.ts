import type { FeatureArtifact } from '../core/schema.js';
import type { CompareDiffDocument } from './buildDiffYaml.js';
import type { FieldDiffItem } from './diffFields.js';
import type { AttrDiff, FieldChange, FormChange, ObjectChange } from './diffPageModel.js';
import { linkedFieldFactKeys } from './linkFieldFacts.js';
import type { StepChange } from './resolveFlow.js';

/**
 * 确定性中文流程变化报告：只用模板，不调模型，同一份对比结果两次输出一致。
 * 面向业务/实施人员：不出现英文标识；字段显示“中文名称（字段名）”。
 */

const ACTION: Record<string, string> = {
  goto: '进入页面',
  click: '点击',
  fill_form: '填写表单',
  click_expect_api: '点击并提交（调用接口）',
  open_detail: '打开详情',
  assert: '检查页面元素',
  assert_table_rows: '检查列表有数据',
  filter_query: '筛选查询',
  pick_lov: '选择值集',
  toggle: '切换开关',
};

const CONTROL: Record<string, string> = {
  TextField: '文本框',
  Select: '下拉框',
  Switch: '开关',
  DateTimePicker: '日期时间选择',
  DatePicker: '日期选择',
  Lov: '值集弹窗选择',
  IntlField: '多语言文本框',
  NumberField: '数字框',
  TextArea: '多行文本框',
  CheckBox: '复选框',
};

const ATTR: Record<string, string> = {
  control: '控件类型',
  'props.disabled': '是否禁用',
  'props.readOnly': '是否只读',
  'props.required': '是否必填',
  'props.newLine': '是否另起一行',
  'props.label': '字段标签',
  'props.lookupCode': '值集编码',
  'props.lovCode': '弹窗值集编码',
  'props.multiple': '是否多选',
  'props.range': '是否范围选择',
  'props.min': '最小值',
  'props.max': '最大值',
  'props.maxLength': '最大长度',
  'props.precision': '小数位数',
  'props.step': '步长',
  'props.colSpan': '占列数',
  'ds.type': '数据类型',
  'ds.label': '字段名称',
  'ds.required': '是否必填',
  'ds.lookupCode': '值集编码',
  'ds.lovCode': '弹窗值集编码',
  'ds.bind': '带出来源',
  'ds.defaultValue': '默认值',
  'ds.trueValue': '选中时的值',
  'ds.falseValue': '未选中时的值',
  'ds.min': '最小值',
  'ds.max': '最大值',
  'ds.maxLength': '最大长度',
  'ds.precision': '小数位数',
  'ds.step': '步长',
  'ds.dynamicProps': '随其他字段变化的规则',
  'ds.lovPara': '值集查询参数',
  'ds.ignore': '是否提交到后端',
  'ds.format': '格式',
  'ds.multiple': '是否多选',
  depends_on: '依赖的字段',
  derived_from: '由哪些字段带出',
  // field_facts 原始属性名
  lookupUrl: '下拉请求地址',
  lookupCode: '值集编码',
  lovCode: '弹窗值集编码',
  required: '是否必填',
  type: '数据类型',
  label: '字段名称',
  bind: '带出来源',
  defaultValue: '默认值',
  dynamicProps: '随其他字段变化的规则',
};

/** 语义标记：⟦A:新增⟧ ⟦D:移除⟧ ⟦C:修改⟧ ⟦W:警告⟧ ⟦O:旧值⟧ ⟦N:新值⟧；Markdown 与 HTML 各自渲染成加粗/颜色 */
const mk = (k: 'A' | 'D' | 'C' | 'W' | 'O' | 'N', t: string) => `⟦${k}:${t}⟧`;
const MARK_RE = /⟦([ADCWON]):([^⟧]*)⟧/g;

const hasCjk = (s: string) => /[一-鿿]/.test(s);

function renderCore(opts: {
  doc: CompareDiffDocument;
  before: FeatureArtifact;
  after: FeatureArtifact;
}): string {
  const { doc, before, after } = opts;

  // 字段中文名：优先表单字段上的名称，其次数据集字段事实
  const labels = new Map<string, string>();
  const put = (n: string, v: unknown) => {
    if (typeof v === 'string' && v && !labels.has(n)) labels.set(n, v);
  };
  for (const art of [after, before]) {
    for (const f of art.page_model?.forms ?? []) {
      for (const x of f.fields) put(x.name, x.ds_attrs?.label ?? x.props?.label);
    }
    for (const f of art.field_facts ?? []) put(f.name, f.attrs.label);
    for (const r of art.field_rules ?? []) put(r.name, r.label);
  }
  const fieldName = (n: string) => (labels.has(n) ? `${labels.get(n)}（${n}）` : n);

  const val = (attr: string, v: unknown): string => {
    if (v === undefined || v === null || v === '') return '无';
    if (v === true || v === 'true') return '是';
    if (v === false || v === 'false') return '否';
    if (attr === 'control' && typeof v === 'string') return CONTROL[v] ?? v;
    if (Array.isArray(v)) return v.map((x) => (attr === 'depends_on' || attr === 'derived_from' ? fieldName(String(x)) : String(x))).join('、') || '无';
    if (typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if ('expr' in o) return `表达式「${String(o.expr)}」`;
      return Object.entries(o)
        .map(([k, x]) => `${k}=${typeof x === 'object' ? JSON.stringify(x) : String(x)}`)
        .join('；');
    }
    const s = String(v);
    return /[(){}=!?:]|\|\||&&/.test(s) && attr.startsWith('props.') ? `表达式「${s}」` : s;
  };
  const attrLine = (a: AttrDiff) =>
    `${ATTR[a.attr] ?? a.attr}：${mk('O', val(a.attr, a.before))} → ${mk('N', val(a.attr, a.after))}`;

  const fieldLines = (fields: FieldChange[]): string[] => {
    const out: string[] = [];
    const added = fields.filter((f) => f.change === 'added').map((f) => fieldName(f.name));
    const removed = fields.filter((f) => f.change === 'removed').map((f) => fieldName(f.name));
    if (added.length) out.push(`${mk('A', '新增字段')}：${added.join('、')}`);
    if (removed.length) out.push(`${mk('D', '移除字段')}：${removed.join('、')}`);
    for (const f of fields.filter((x) => x.change === 'changed')) {
      out.push(`${mk('C', `字段「${fieldName(f.name)}」变化`)}：${f.attrs.map(attrLine).join('；')}`);
    }
    return out;
  };

  const factLines = (facts: FieldDiffItem[]): string[] => {
    const out: string[] = [];
    const groupZh = (g: string) => (g === 'queryFields' ? '查询字段' : '表单字段');
    for (const f of facts) {
      const head =
        f.change === 'added'
          ? mk('A', `新增${groupZh(f.group)}「${fieldName(f.name)}」`)
          : f.change === 'removed'
            ? mk('D', `移除${groupZh(f.group)}「${fieldName(f.name)}」`)
            : mk('C', `${groupZh(f.group)}「${fieldName(f.name)}」变化`);
      const attrs = f.attrs.map(attrLine).join('；');
      out.push(`${head}（数据集 ${f.ds}）${attrs ? `：${attrs}` : ''}`);
    }
    return out;
  };

  const flowFactCount = (f: (typeof doc.flows)[number]) =>
    (f.field_facts?.length ?? 0) + (f.step_changes ?? []).reduce((n, c) => n + (c.field_facts?.length ?? 0), 0);

  const modelOf = (side: FeatureArtifact) => side.page_model;
  const objName = (kind: 'button' | 'tab' | 'panel' | 'drawer' | 'table', id: string): string => {
    for (const m of [modelOf(after), modelOf(before)]) {
      if (!m) continue;
      if (kind === 'button') {
        const b = m.buttons.find((x) => x.id === id);
        if (b) return b.text ? `按钮「${b.text}」` : `按钮（${b.icon ?? id}）`;
      } else if (kind === 'tab') {
        const t = m.tabs.find((x) => x.id === id);
        if (t) return `页签「${t.title ?? t.key}」`;
      } else if (kind === 'panel') {
        const t = m.panels?.find((x) => x.id === id);
        if (t) return `面板「${t.title ?? t.key}」`;
      } else if (kind === 'drawer') {
        const t = m.drawers.find((x) => x.id === id);
        if (t) return `弹窗/抽屉「${t.title ?? id.split('/').pop()}」`;
      } else {
        const t = m.tables.find((x) => x.id === id);
        if (t) return `表格（${t.ds ?? id}）`;
      }
    }
    return id;
  };
  const objLine = (kind: Parameters<typeof objName>[0], o: ObjectChange): string => {
    const n = objName(kind, o.id);
    if (o.change === 'added') return `${mk('A', '新增')}${n}`;
    if (o.change === 'removed') return `${mk('D', '移除')}${n}`;
    const parts = o.attrs.map((a) => {
      if (a.attr === 'columns') {
        const b = (a.before as string[] | undefined) ?? [];
        const x = (a.after as string[] | undefined) ?? [];
        const nm = (c: string) => fieldName(c.replace(/\*$/, ''));
        const add = x.filter((c) => !b.includes(c)).map(nm);
        const del = b.filter((c) => !x.includes(c)).map(nm);
        return [add.length ? `新增列 ${add.join('、')}` : '', del.length ? `移除列 ${del.join('、')}` : ''].filter(Boolean).join('；');
      }
      const label: Record<string, string> = { text: '文案', title: '标题', disabled: '禁用条件', icon: '图标', permission: '权限编码' };
      return `${label[a.attr] ?? a.attr}：${mk('O', val(a.attr, a.before))} → ${mk('N', val(a.attr, a.after))}`;
    });
    return `${n}${mk('C', '变化')}：${parts.join('；')}`;
  };

  // —— 步骤展示名 ——
  const keyOf = (s: { kind: string; api?: string; element?: string }) => `${s.kind}:${s.api || s.element || ''}`;
  const stepTitle = (s: { kind: string; name: string }) => (hasCjk(s.name) ? s.name : ACTION[s.kind] ?? s.name);
  const keyed = <T extends { kind: string; api?: string; element?: string }>(steps: T[]) => {
    const n = new Map<string, number>();
    return steps.map((s) => {
      const k = keyOf(s);
      const i = (n.get(k) ?? 0) + 1;
      n.set(k, i);
      return { key: i === 1 ? k : `${k}#${i}`, s };
    });
  };

  const L: string[] = [];
  const linkedForms = new Set<string>();
  for (const f of doc.flows) for (const c of f.step_changes ?? []) if (c.form) linkedForms.add(c.form.id);

  const changed = doc.flows.filter((f) => f.change_type !== 'unchanged');
  const stateZh: Record<string, string> = { added: mk('A', '新增'), removed: mk('D', '已移除'), modified: mk('C', '有变化'), unchanged: '无变化' };
  const stateText: Record<string, string> = { added: '新增', removed: '已移除', modified: '有变化', unchanged: '无变化' };
  const base = doc.meta.baseline_created_at ? `（保存于 ${String(doc.meta.baseline_created_at).slice(0, 16).replace('T', ' ')}）` : '';

  L.push(`# ${doc.meta.feature}：流程变化报告`);
  L.push('');
  L.push(`对比基线：${doc.meta.baseline_label}${base}`);
  L.push('');
  L.push(
    doc.meta.logic_changed
      ? `结论：共 ${doc.flows.length} 条流程，其中 ${mk('C', `${changed.length} 条有变化`)}，${doc.flows.length - changed.length} 条无变化。`
      : `结论：共 ${doc.flows.length} 条流程，均无变化。`,
  );
  if (doc.structure && doc.structure.comparable === false) {
    L.push('');
    L.push('> 注意：基线里没有页面结构数据（旧基线），表单字段、按钮、页签等变化无法比较。请先用当前代码重存基线。');
  }

  L.push('');
  L.push('## 一、流程总览');
  L.push('');
  L.push('| 流程 | 状态 | 变化概述 |');
  L.push('|---|---|---|');
  for (const f of doc.flows) {
    const sum: string[] = [];
    const sc = f.step_changes ?? [];
    const nField = sc.reduce((n, c) => n + (c.form?.fields.length ?? 0), 0);
    if (nField) sc.filter((c) => c.form).forEach((c) => sum.push(`表单字段变化 ${c.form!.fields.length} 处`));
    const nFacts = flowFactCount(f);
    if (nFacts) sum.push(`数据集字段变化 ${nFacts} 处`);
    if (sc.some((c) => c.object_changes?.length)) sum.push('按钮/表格等页面元素有变化');
    if (sc.some((c) => c.change === 'added')) sum.push(`新增步骤 ${sc.filter((c) => c.change === 'added').length} 个`);
    if (sc.some((c) => c.change === 'removed')) sum.push(`移除步骤 ${sc.filter((c) => c.change === 'removed').length} 个`);
    if (f.stale_reasons?.length) sum.push(mk('W', '依赖的页面内容已被移除'));
    if (f.unconfirmed) sum.push(mk('W', '整条流程新增/移除，需确认'));
    L.push(`| ${f.title} | ${stateZh[f.change_type]} | ${sum.join('；') || '—'} |`);
  }

  L.push('');
  L.push('## 二、有变化的流程（按操作顺序）');
  if (!changed.length) {
    L.push('');
    L.push('无。');
  }
  for (const f of changed) {
    L.push('');
    L.push(`### ${f.title}（${stateText[f.change_type]}）`);
    if (f.unconfirmed) L.push('> 这是整条流程的新增或移除，可能只是分析波动，请对照源码确认。');
    const sc = new Map((f.step_changes ?? []).map((c) => [c.key, c] as [string, StepChange]));
    const afterSteps = keyed(f.after);
    const beforeSteps = keyed(f.before);
    let i = 0;
    const renderStep = (key: string, title: string, tag: string, c?: StepChange) => {
      i += 1;
      L.push(`${i}. ${title}${tag}`);
      if (!c) return;
      for (const d of c.details ?? []) if (d !== '表单字段变更') L.push(`   - ${d.replace('kind ', '动作 ')}`);
      if (c.form) for (const t of fieldLines(c.form.fields)) L.push(`   - ${t}`);
      if (c.field_facts?.length) for (const t of factLines(c.field_facts)) L.push(`   - ${t}`);
      for (const o of c.object_changes ?? []) {
        const m = o.match(/^(按钮|表格) (\S+)/);
        const list = m?.[1] === '按钮' ? doc.structure?.buttons : doc.structure?.tables;
        const hit = m ? list?.find((x) => x.id === m[2]) : undefined;
        L.push(`   - 关联页面元素（按名称推断，需确认）：${hit && m ? objLine(m[1] === '按钮' ? 'button' : 'table', hit) : o}`);
      }
    };
    if (f.change_type === 'removed') {
      beforeSteps.forEach(({ s }) => renderStep('', stepTitle(s), ` ${mk('D', '【已移除】')}`));
    } else {
      for (const { key, s } of afterSteps) {
        const c = sc.get(key);
        const onlyFacts = c && !c.details?.length && !c.form && !c.object_changes?.length && c.field_facts?.length;
        const tag =
          f.change_type === 'added'
            ? ''
            : c?.change === 'added'
              ? ` ${mk('A', '【新增步骤】')}`
              : c
                ? ` ${mk('C', onlyFacts ? '【字段有变化】' : '【有变化】')}`
                : '';
        renderStep(key, stepTitle(s), tag, c);
      }
      for (const { key, s } of beforeSteps) {
        if (sc.get(key)?.change === 'removed') renderStep(key, stepTitle(s), ` ${mk('D', '【已移除步骤】')}`);
      }
    }
    if (f.field_facts?.length) {
      L.push('');
      L.push('相关数据集字段变化（未挂到具体步骤）：');
      for (const t of factLines(f.field_facts)) L.push(`- ${t}`);
    }
    for (const r of f.stale_reasons ?? []) {
      const m = r.match(/^(页签|面板|抽屉) (\S+) 已从源码移除$/);
      const kind = m ? ({ 页签: 'tab', 面板: 'panel', 抽屉: 'drawer' } as const)[m[1] as '页签'] : undefined;
      L.push('');
      L.push(`> ${mk('W', `⚠ 关联推断：${m && kind ? `${objName(kind, m[2]!)}已从源码移除` : r}，本流程可能已不再成立，请对照源码确认。`)}`);
    }
  }

  const st = doc.structure;
  const rest: string[] = [];
  if (st?.comparable) {
    for (const f of st.forms as FormChange[]) {
      if (linkedForms.has(f.id)) continue;
      const head = f.change === 'added' ? '新增表单' : f.change === 'removed' ? '移除表单' : '表单变化';
      const lines = fieldLines(f.fields);
      if (lines.length || f.change !== 'changed') rest.push(`- ${head}（${f.id.split('/').slice(0, -1).join('/') || f.id}）：${lines.join('；') || '无字段明细'}`);
    }
    for (const o of st.tabs) rest.push(`- ${objLine('tab', o)}`);
    for (const o of st.panels) rest.push(`- ${objLine('panel', o)}`);
    for (const o of st.drawers) rest.push(`- ${objLine('drawer', o)}`);
    for (const o of st.tables) rest.push(`- ${objLine('table', o)}`);
    const shownButtons = new Set<string>();
    for (const o of st.buttons) if (!shownButtons.has(o.id)) { shownButtons.add(o.id); rest.push(`- ${objLine('button', o)}`); }
  }
  const linkedFacts = linkedFieldFactKeys(
    doc.flows.map((f) => ({
      id: f.id,
      title: f.title,
      change_type: f.change_type,
      before: [],
      after: [],
      highlights: [],
      step_changes: f.step_changes,
      field_facts: f.field_facts,
    })),
  );
  const orphanFacts = (doc.fields?.field_facts ?? []).filter((f) => !linkedFacts.has(f.key));
  for (const t of factLines(orphanFacts)) rest.push(`- ${t}`);

  L.push('');
  L.push('## 三、页面结构变化（汇总，含未挂到具体流程的）');
  L.push('');
  if (rest.length) L.push(...rest);
  else L.push('无。');

  L.push('');
  L.push('## 四、需要人工确认的事项');
  L.push('');
  const tips: string[] = [];
  if (changed.some((f) => f.unconfirmed)) tips.push('标有“整条流程新增/移除”的流程，可能是分析波动，不一定是真实变化。');
  if (changed.some((f) => f.stale_reasons?.length)) tips.push('标有“关联推断”的内容是按名称匹配出来的，不是源码里的直接证据。');
  if (changed.some((f) => (f.step_changes ?? []).some((c) => c.object_changes?.length))) tips.push('按钮/表格的变化是按元素名称关联到步骤的，可能关联到不相关的步骤，也可能漏关联。');
  if (rest.some((x) => x.startsWith('- 表单') || x.startsWith('- 新增表单') || x.startsWith('- 移除表单'))) tips.push('第三节里的表单变化没有挂到具体流程步骤（流程里没有对应的“填写表单”步骤），请自行判断影响哪些流程。');
  if (orphanFacts.length) tips.push('第三节里未挂到流程的数据集字段变化，是按字段名/查询流程未能匹配到步骤；可能影响列表列展示等，请自行判断。');
  if (changed.some((f) => flowFactCount(f) > 0)) tips.push('数据集字段与流程的关联按字段名（及查询类流程的 queryFields）匹配，不是源码里的直接调用边。');
  tips.forEach((t) => L.push(`- ${t}`));
  L.push('');
  return L.join('\n');
}

type Opts = Parameters<typeof renderCore>[0];

/** Markdown：用图标加粗标注（颜色在飞书/多数 Markdown 里不可用） */
export function renderReportZh(opts: Opts): string {
  const icon = { A: '🟢', D: '🔴', C: '🟡', W: '⚠️', O: '', N: '' } as const;
  return renderCore(opts).replace(MARK_RE, (_m, k: keyof typeof icon, t: string) => {
    if (k === 'O') return `~~${t}~~`;
    if (k === 'N') return `**${t}**`;
    return `${icon[k]} **${t}**`;
  });
}

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** HTML：新增绿、移除红、修改橙、警告黄底，旧值红色删除线，新值绿色加粗 */
export function renderReportHtml(opts: Opts): string {
  const inline = (t: string) =>
    esc(t)
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/⟦([ADCWON]):([^⟧]*)⟧/g, (_m, k: string, x: string) => `<span class="m${k}">${x}</span>`);
  const out: string[] = [];
  const lines = renderCore(opts).split('\n');
  let inTable = false;
  let inList = false;
  const closeList = () => { if (inList) { out.push('</ul>'); inList = false; } };
  for (const line of lines) {
    if (line.startsWith('|')) {
      closeList();
      if (/^\|[-| ]+\|$/.test(line)) continue;
      const cells = line.split('|').slice(1, -1).map((c) => c.trim());
      if (!inTable) { out.push('<table>'); out.push(`<tr>${cells.map((c) => `<th>${inline(c)}</th>`).join('')}</tr>`); inTable = true; }
      else out.push(`<tr>${cells.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`);
      continue;
    }
    if (inTable) { out.push('</table>'); inTable = false; }
    if (line.startsWith('# ')) out.push(`<h1>${inline(line.slice(2))}</h1>`);
    else if (line.startsWith('## ')) { closeList(); out.push(`<h2>${inline(line.slice(3))}</h2>`); }
    else if (line.startsWith('### ')) { closeList(); out.push(`<h3>${inline(line.slice(4))}</h3>`); }
    else if (line.startsWith('> ')) { closeList(); out.push(`<div class="note">${inline(line.slice(2))}</div>`); }
    else if (/^\d+\. /.test(line)) { closeList(); out.push(`<div class="step">${inline(line)}</div>`); }
    else if (line.startsWith('   - ')) out.push(`<div class="sub">${inline(line.slice(5))}</div>`);
    else if (line.startsWith('- ')) { if (!inList) { out.push('<ul>'); inList = true; } out.push(`<li>${inline(line.slice(2))}</li>`); }
    else if (line.trim()) { closeList(); out.push(`<p>${inline(line)}</p>`); }
  }
  closeList();
  if (inTable) out.push('</table>');
  const css = `body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;max-width:960px;margin:24px auto;padding:0 16px;color:#222;line-height:1.7}
h1{border-bottom:2px solid #ddd;padding-bottom:8px}h2{margin-top:32px;border-left:4px solid #4285f4;padding-left:8px}h3{margin-top:24px}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:6px 10px;text-align:left}th{background:#f5f5f5}
.step{margin-top:10px;font-weight:600}.sub{margin-left:28px;padding:2px 8px;border-left:3px solid #ddd;background:#fafafa}
.note{background:#fff8e1;border-left:4px solid #f9a825;padding:6px 10px;margin:8px 0}
.mA{color:#137333;background:#e6f4ea;font-weight:700;padding:0 4px;border-radius:3px}
.mD{color:#c5221f;background:#fce8e6;font-weight:700;padding:0 4px;border-radius:3px}
.mC{color:#b45f06;background:#fff0d9;font-weight:700;padding:0 4px;border-radius:3px}
.mW{color:#8a5a00;background:#fff3cd;font-weight:700;padding:0 4px;border-radius:3px}
.mO{color:#c5221f;text-decoration:line-through}.mN{color:#137333;font-weight:700}
.legend span{margin-right:12px}`;
  const legend = '<p class="legend"><span class="mA">新增</span><span class="mD">移除</span><span class="mC">修改</span><span class="mW">需确认</span><span class="mO">旧值</span><span class="mN">新值</span></p>';
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>流程变化报告</title><style>${css}</style></head><body>${legend}${out.join('\n')}</body></html>`;
}
