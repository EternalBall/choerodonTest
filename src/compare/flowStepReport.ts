import type { ControlDiff } from './controlCatalogDiff.js';

/**
 * 流程变化报告（脚本生成，不调用 LLM，与功能无关）。
 * - 步骤内容取自 feature.yaml：flow.nodes → meta_ops（名称、类型、控件、接口）。
 * - 控件变化：步骤的 element 与控件目录差异的语义 id 精确匹配。
 * - 逻辑变化：步骤所用处理函数（handler）在 V1 与当前源码中的规范化哈希是否不同。
 * - 「已移除」不再仅凭流程 id 缺失判断，而是核对步骤的处理函数在当前源码中是否仍存在。
 */

type MetaOp = { id: string; name?: string; kind?: string; element?: string; api?: string };
type FlowNode = { id: string; meta_op_id: string };
type Flow = { id: string; title?: string; nodes?: FlowNode[] };
export type FeatureDoc = { flows?: Flow[]; meta_ops?: MetaOp[] };

export type ReportInput = {
  feature: string;
  label: string;
  diff: ControlDiff;
  current: FeatureDoc;
  v1: FeatureDoc;
  /** 处理函数名 → 哈希；缺省时不做逻辑比对 */
  currentFns?: Map<string, string>;
  v1Fns?: Map<string, string>;
  /** 当前源码全文，用于核对接口路径是否仍在源码中（无处理函数时的兜底） */
  currentText?: string;
};

const TAG_CN: Record<string, string> = {
  Table: '表格', Tabs: '页签', Tab: '页签', Form: '表单', Button: '按钮', Select: '下拉框', Input: '输入框',
  Checkbox: '复选框', CheckBox: '复选框', Radio: '单选框', Switch: '开关', Tooltip: '提示', Modal: '弹窗', Drawer: '抽屉',
  Tag: '标签', Link: '链接', a: '链接', DatePicker: '日期选择', Lov: '值集',
};

const FIELD_CN: Record<string, string> = { state: '显示状态', note: '备注', tag: '类型', label: '名称', triggers: '触发入口' };

const KIND_TEXT: Record<string, string> = {
  goto: '进入页面',
  click: '点击',
  click_expect_api: '点击并等待接口返回',
  fill: '填写',
  pick_lov: '选择值集',
  assert: '校验',
  assert_component: '校验组件显示',
  assert_table_rows: '校验表格数据',
  filter_query: '按条件查询',
  expect_api: '等待接口返回',
  open_detail: '打开详情',
};

/** 语义控件 id（path|tag|label|ctx|handler）→ 中文描述；数据集名、接口、处理函数名保留原文 */
export function describeElement(id: string): string {
  const [, tag = '', label = '', ctx = '', handler = ''] = id.split('|');
  let out = TAG_CN[tag] ?? tag;
  if (label && label !== tag) out += `「${label}」`;
  const extras: string[] = [];
  for (const seg of [ctx, handler]) {
    if (!seg) continue;
    if (seg.startsWith('dataSet:')) {
      const [ds, api] = seg.slice(8).split('@');
      extras.push(`数据集 ${ds}`);
      if (api) extras.push(`接口 ${api}`);
    } else if (/^(Modal|Drawer)\.open:/.test(seg)) {
      extras.push(`所在弹窗「${seg.replace(/^(Modal|Drawer)\.open:/, '')}」`);
    } else if (/^[A-Za-z_$][\w$]*(\(.*\))?$/.test(seg)) {
      extras.push(`处理函数 ${seg}`);
    } else {
      extras.push(seg);
    }
  }
  return extras.length ? `${out}（${extras.join('，')}）` : out;
}

/** 从控件 id 取处理函数名（如 handleX、handelDelTag('send') → handelDelTag）；数据集或无处理函数返回 undefined */
export function handlerNameOf(id: string): string | undefined {
  const seg = id.split('|')[4] ?? '';
  if (!seg || seg.startsWith('dataSet:') || seg.startsWith('Modal.open') || seg.startsWith('Drawer.open')) return undefined;
  const name = seg.replace(/\(.*$/, '');
  return /^[A-Za-z_$][\w$]*$/.test(name) ? name : undefined;
}

/** 备注中的代码条件改为中文，通用规则，不针对某个功能 */
export function translateNote(s: string): string {
  return s
    .replace(/非\(\s*([\w.]+)\s*===\s*'([^']*)'\s*\)/g, '$1 不为「$2」')
    .replace(/([\w.]+)\s*===\s*'([^']*)'/g, '$1 为「$2」')
    .replace(/([\w.]+)\s*!==\s*'([^']*)'/g, '$1 不为「$2」')
    .replace(/点击\s*\S*\.js:\d+\s*之一后弹出/g, '点击触发按钮后弹出')
    .replace(/\S*\.(js|jsx|tsx?):\d+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function describeValue(field: string, v: string): string {
  if (v === '') return '（空）';
  if (field === 'state') {
    if (v === 'always') return '始终显示';
    if (v === 'data_dependent') return '依赖条件';
    if (v.startsWith('after:')) return `点击${describeElement(v.slice(6))}后出现`;
    return v;
  }
  if (field === 'note') return translateNote(v);
  return v;
}

function stepLine(op: MetaOp, idx: number): string {
  const kind = op.kind ? (KIND_TEXT[op.kind] ?? '操作') : '';
  const name = op.name ?? op.id;
  const el = op.element ? `；控件：${describeElement(op.element)}` : '';
  const api = op.api ? `；接口：${op.api}` : '';
  return `${idx + 1}. ${kind ? `【${kind}】` : ''}${name}${el}${api}`;
}

function loadOps(doc: FeatureDoc): Map<string, MetaOp> {
  return new Map((doc.meta_ops ?? []).map((m) => [m.id, m]));
}

function flowOps(flow: Flow, ops: Map<string, MetaOp>): MetaOp[] {
  return (flow.nodes ?? []).map((n) => ops.get(n.meta_op_id)).filter((x): x is MetaOp => !!x);
}

type LogicState = 'changed' | 'added' | 'removed' | 'same' | 'missing' | 'unknown';

export function buildFlowStepReport(input: ReportInput): { markdown: string; changedFlows: number; totalFlows: number } {
  const { diff } = input;
  const hasSource = !!(input.currentFns && input.v1Fns);

  const ctrlMarks = new Map<string, { mark: string; text: string }>();
  for (const c of diff.added) ctrlMarks.set(c.id, { mark: '🟢 新增控件', text: `新增控件 ${describeElement(c.id)}` });
  for (const c of diff.removed) ctrlMarks.set(c.id, { mark: '🔴 已移除控件', text: `移除控件 ${describeElement(c.id)}` });
  for (const ch of diff.changed) {
    const parts = ch.fields.map((f) => {
      const b = describeValue(f, String((ch.before as unknown as Record<string, unknown>)[f] ?? ''));
      const a = describeValue(f, String((ch.after as unknown as Record<string, unknown>)[f] ?? ''));
      return `${FIELD_CN[f] ?? f}：${b} → ${a}`;
    });
    ctrlMarks.set(ch.id, { mark: '🟡 属性变化', text: parts.join('；') });
  }

  const logicOf = (fn: string | undefined): LogicState => {
    if (!hasSource || !fn) return 'unknown';
    const a = input.v1Fns!.get(fn);
    const b = input.currentFns!.get(fn);
    if (a && b) return a === b ? 'same' : 'changed';
    if (b) return 'added';
    if (a) return 'removed';
    return 'missing';
  };
  const logicText: Record<LogicState, string> = {
    changed: '🟡 逻辑变化：处理函数源码已改', added: '🟢 新增处理函数', removed: '🔴 处理函数已删除',
    same: '', missing: '', unknown: '',
  };

  const curOps = loadOps(input.current);
  const v1Ops = loadOps(input.v1);
  const curFlows = input.current.flows ?? [];
  const v1Flows = input.v1.flows ?? [];
  const curIds = new Set(curFlows.map((f) => f.id));
  const v1ById = new Map(v1Flows.map((f) => [f.id, f]));

  // 流程匹配：先按 id 精确配对；再按步骤控件集合的重合度（Jaccard ≥ 0.5）配对，应对分析时 id 或标题变化
  const elemsOf = (f: Flow, ops: Map<string, MetaOp>) =>
    new Set(flowOps(f, ops).map((o) => o.element).filter((x): x is string => !!x));
  const pairOfCur = new Map<string, string>();
  const v1Used = new Set<string>();
  for (const f of curFlows) if (v1ById.has(f.id)) { pairOfCur.set(f.id, f.id); v1Used.add(f.id); }
  for (const f of curFlows) {
    if (pairOfCur.has(f.id)) continue;
    const ce = elemsOf(f, curOps);
    if (!ce.size) continue;
    let best: { id: string; score: number } | undefined;
    for (const v of v1Flows) {
      if (v1Used.has(v.id)) continue;
      const ve = elemsOf(v, v1Ops);
      const inter = [...ce].filter((x) => ve.has(x)).length;
      const score = inter / new Set([...ce, ...ve]).size;
      if (score >= 0.5 && (!best || score > best.score)) best = { id: v.id, score };
    }
    if (best) { pairOfCur.set(f.id, best.id); v1Used.add(best.id); }
  }

  // 同一流程在 V1 中对应的步骤里，被移除控件所在的步骤
  const removedStepsOf = (flowId: string): MetaOp[] => {
    const v1f = v1ById.get(pairOfCur.get(flowId) ?? '');
    if (!v1f) return [];
    return flowOps(v1f, v1Ops).filter((o) => o.element && diff.removed.some((r) => r.id === o.element));
  };

  // 每步的标记：控件变化 + 逻辑变化
  const stepMarks = (op: MetaOp): string[] => {
    const out: string[] = [];
    if (op.element && ctrlMarks.has(op.element)) {
      const m = ctrlMarks.get(op.element)!;
      out.push(`${m.mark}：${m.text}`);
    }
    const lg = logicOf(op.element ? handlerNameOf(op.element) : undefined);
    if (logicText[lg]) out.push(`${logicText[lg]}（${handlerNameOf(op.element!)}）`);
    return out;
  };

  let changedFlows = 0;
  const overview: string[] = [];
  const flowSections: string[] = [];

  for (const flow of curFlows) {
    const ops = flowOps(flow, curOps);
    const removedHits = removedStepsOf(flow.id);
    const marksPerStep = ops.map((op) => stepMarks(op));
    const hasChange = marksPerStep.some((m) => m.length) || removedHits.length > 0;
    if (hasChange) changedFlows++;
    const tags = [...new Set([...marksPerStep.flat().map((t) => t.split('：')[0].split('（')[0]), ...removedHits.map(() => '🔴 已移除控件')])];
    overview.push(`| ${flow.title ?? flow.id} | ${hasChange ? '🟡 **有变化**' : '无变化'} | ${hasChange ? tags.join('、') : '—'} |`);

    const v1Id = pairOfCur.get(flow.id);
    const isNew = !v1Id;
    const renamed = v1Id && v1Id !== flow.id ? `（流程 id 变更，对应 V1「${v1ById.get(v1Id)?.title ?? v1Id}」）` : '';
    const head = `### ${flow.title ?? flow.id}${isNew ? '（V1 分析中无对应流程）' : hasChange ? '（有变化）' : ''}${renamed}`;
    const lines = [head, ''];
    ops.forEach((op, i) => {
      const ms = marksPerStep[i];
      lines.push(`${stepLine(op, i)}${ms.length ? `  ← ${ms.join('；')}` : ''}`);
    });
    removedHits.forEach((op) => {
      lines.push(`- （V1 中的步骤，当前已移除）${op.name ?? op.id}；控件：${describeElement(op.element!)}  ← 🔴 已移除控件`);
    });
    lines.push('');
    flowSections.push(lines.join('\n'));
  }

  // 已移除流程：V1 有、当前 id 不存在；用处理函数核对源码是否仍在
  const removedOverview: string[] = [];
  const removedSections: string[] = [];
  for (const flow of v1Flows) {
    if (v1Used.has(flow.id)) continue;
    const ops = flowOps(flow, v1Ops);
    const fns = [...new Set(ops.map((o) => (o.element ? handlerNameOf(o.element) : undefined)).filter((x): x is string => !!x))];
    let verdict: string;
    if (!hasSource) verdict = '未做源码核对（未提供源码目录）';
    else if (!fns.length) verdict = '无法判断（步骤没有处理函数）';
    else {
      const present = fns.filter((f) => input.currentFns!.has(f));
      verdict = present.length
        ? `源码仍有处理函数 ${present.join('、')}，需确认是否为流程分析缺失`
        : `源码已无处理函数 ${fns.join('、')}，可判定为已移除`;
    }
    if (hasSource && !fns.length) {
      const apiOf = (o: MetaOp) => o.api ?? (o.element?.includes('@/') ? o.element.slice(o.element.indexOf('@') + 1) : undefined);
      const apis = [...new Set(ops.map(apiOf).filter((x): x is string => !!x))];
      if (!apis.length) verdict = '无法判断（步骤既无处理函数也无接口）';
      else if (input.currentText === undefined) verdict = '无法判断（未提供当前源码全文）';
      else {
        const tail = (a: string) => a.split('/').filter((x) => x && !x.startsWith('{')).slice(-3).join('/');
        const found = apis.filter((a) => input.currentText!.includes(tail(a)));
        verdict = found.length
          ? `源码仍有接口 ${found.join('、')}，需确认是否为流程分析缺失`
          : `源码中未找到接口 ${apis.join('、')}，可判定为已移除`;
      }
    }
    removedOverview.push(`| ${flow.title ?? flow.id} | 已移除 | ${verdict} |`);
    const lines = [`### ${flow.title ?? flow.id}（V1 流程，当前已不存在）`, `核对：${verdict}`, ''];
    ops.forEach((op, i) => {
      const mk = op.element && ctrlMarks.get(op.element);
      lines.push(`${stepLine(op, i)}${mk ? `  ← ${mk.mark}` : ''}`);
    });
    lines.push('');
    removedSections.push(lines.join('\n'));
  }

  const newFlowsCount = curFlows.filter((f) => !pairOfCur.has(f.id)).length;

  // 未被任何流程步骤引用的控件变化
  const referenced = new Set<string>();
  for (const op of curOps.values()) if (op.element) referenced.add(op.element);
  for (const f of curFlows) for (const op of removedStepsOf(f.id)) if (op.element) referenced.add(op.element);
  const unreferenced = [...ctrlMarks.entries()].filter(([id]) => !referenced.has(id));
  const flowOfElement = (el: string) =>
    curFlows.filter((f) => flowOps(f, curOps).some((o) => o.element === el)).map((f) => f.title ?? f.id);
  const triggersOf = new Map<string, string[]>();
  for (const c of [...diff.added, ...diff.removed]) if (c.triggers?.length) triggersOf.set(c.id, c.triggers);

  const out: string[] = [];
  out.push(`# ${input.feature}：流程变化报告`, '');
  out.push(`对比基线：${input.label}`, '');
  out.push(
    `结论：当前 ${curFlows.length} 条流程（其中新增 ${newFlowsCount} 条），${changedFlows} 条有变化；V1 中 ${removedOverview.length} 条流程在当前分析结果中已不存在；控件目录变化 ${ctrlMarks.size} 处，其中 ${unreferenced.length} 处未被任何流程步骤引用。`,
    '',
  );
  out.push(
    `> 步骤内容取自流程分析结果（feature.yaml）。控件变化来自控件目录对比；逻辑变化来自处理函数源码哈希对比（${hasSource ? '已执行' : '未执行：未提供源码目录'}），仅比较代码逻辑，注释改动不计入。两者通过语义 id 与函数名匹配。`,
    '',
  );

  out.push('## 一、流程总览', '', '| 流程 | 状态 | 变化 |', '|---|---|---|', ...overview, '');
  if (removedOverview.length) {
    out.push('| 已移除流程（V1 有） | 状态 | 源码核对 |', '|---|---|---|', ...removedOverview, '');
  }

  out.push('## 二、全部流程（逐步骤）', '');
  out.push(...flowSections);

  out.push('## 三、已移除的流程', '');
  out.push('> 「已移除」以源码核对为准：流程 id 不在当前分析结果中，且步骤所用处理函数也已不在源码中，才判定为已移除；若源码仍有，则为流程分析缺失。', '');
  out.push(...(removedSections.length ? removedSections : ['（无）', '']));

  out.push('## 四、控件变化未被流程引用', '');
  if (!unreferenced.length) out.push('（无）', '');
  for (const [id, mk] of unreferenced) {
    const via = (triggersOf.get(id) ?? []).flatMap((t) => flowOfElement(t));
    const where = via.length ? `；挂在触发按钮下，所属流程：${[...new Set(via)].join('、')}（流程步骤中未单独列出该控件）` : '';
    out.push(`- ${mk.mark}：${mk.text}${where}`);
  }
  if (unreferenced.length) out.push('', '以上控件存在于源码目录，但流程分析结果中没有对应步骤，需人工确认是否要补充流程。', '');

  out.push('## 五、待确认', '');
  out.push('- 同一控件可能被多条流程共用（如同一数据集接口），报告会在每条引用它的流程中都标出，不代表每条都确实受影响。');
  out.push('- 流程步骤来自历史分析（feature.yaml），可能缺漏或名称不准，请对照源码确认。');
  out.push('- 「无变化」仅表示该流程步骤所用控件与处理函数未变化，不代表整段业务逻辑未变化（例如处理函数内调用的其他函数改动，不在本次比对范围内）。', '');

  return { markdown: out.join('\n'), changedFlows, totalFlows: curFlows.length };
}
