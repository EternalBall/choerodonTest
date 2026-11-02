import type { ControlDiff } from './controlCatalogDiff.js';

/**
 * 流程变化报告（脚本生成，不调用 LLM）。
 * 步骤内容取自 feature.yaml：flow.nodes → meta_ops（名称、类型、元素、接口）。
 * 变化标记取自源码控件目录差异：步骤的 element 与控件语义 id 精确匹配。
 * 不让 LLM 写步骤描述，避免之前出现的编造操作。
 * 输出文字全部中文化；数据集名、接口路径、处理函数名属于代码标识，保留原文便于定位代码。
 */

type MetaOp = { id: string; name?: string; kind?: string; element?: string; api?: string; note?: string };
type FlowNode = { id: string; meta_op_id: string };
type Flow = { id: string; title?: string; nodes?: FlowNode[] };
type FeatureDoc = { flows?: Flow[]; meta_ops?: MetaOp[] };

export type StepMark = { mark: string; text: string };

const TAG_CN: Record<string, string> = {
  Table: '表格', Tabs: '页签', Tab: '页签', Form: '表单', Button: '按钮', Select: '下拉框', Input: '输入框',
  Checkbox: '复选框', Radio: '单选框', Switch: '开关', Tooltip: '提示', Modal: '弹窗', Drawer: '抽屉',
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

/** 语义控件 id（path|tag|label|ctx|handler）→ 中文描述 */
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

/** 备注中的代码条件与文件路径改为中文 */
export function translateNote(s: string): string {
  return s
    .replace(/非\(dimension==='process'\)/g, '维度不是「工序」')
    .replace(/dimension==='process'/g, '维度是「工序」')
    .replace(/dimension==='splice'/g, '维度是「拼卷」')
    .replace(/点击\s*\S*index\.js:\d+\s*之一后弹出/g, '点击触发按钮后弹出')
    .replace(/\S*index\.js:\d+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function describeValue(field: string, v: string): string {
  if (v === '') return '（空）';
  if (field === 'state') {
    if (v === 'always') return '始终显示';
    if (v === 'data_dependent') return '依赖数据';
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

export function buildFlowStepReport(opts: {
  feature: string;
  label: string;
  diff: ControlDiff;
  current: FeatureDoc;
  v1: FeatureDoc;
}): { markdown: string; changedFlows: number; totalFlows: number } {
  const { diff } = opts;
  const marks = new Map<string, StepMark>();
  for (const c of diff.added) marks.set(c.id, { mark: '🟢 新增控件', text: `新增控件 ${describeElement(c.id)}` });
  for (const c of diff.removed) marks.set(c.id, { mark: '🔴 已移除控件', text: `移除控件 ${describeElement(c.id)}` });
  for (const ch of diff.changed) {
    const parts = ch.fields.map((f) => {
      const b = describeValue(f, String((ch.before as unknown as Record<string, unknown>)[f] ?? ''));
      const a = describeValue(f, String((ch.after as unknown as Record<string, unknown>)[f] ?? ''));
      return `${FIELD_CN[f] ?? f}：${b} → ${a}`;
    });
    marks.set(ch.id, { mark: '🟡 属性变化', text: parts.join('；') });
  }

  const curOps = loadOps(opts.current);
  const v1Ops = loadOps(opts.v1);
  const curFlows = opts.current.flows ?? [];
  const v1Flows = opts.v1.flows ?? [];
  const curIds = new Set(curFlows.map((f) => f.id));
  const v1ById = new Map(v1Flows.map((f) => [f.id, f]));

  // 同 id 的 V1 流程里，被移除控件所在的步骤，记为当前流程的已移除步骤
  const removedStepsOf = (flowId: string): MetaOp[] => {
    const v1f = v1ById.get(flowId);
    if (!v1f) return [];
    return flowOps(v1f, v1Ops).filter((o) => o.element && diff.removed.some((r) => r.id === o.element));
  };

  const overview: string[] = [];
  let changedFlows = 0;
  for (const flow of curFlows) {
    const hits = flowOps(flow, curOps).filter((o) => o.element && marks.has(o.element));
    const removedHits = removedStepsOf(flow.id);
    const all = [...hits, ...removedHits];
    if (all.length) changedFlows++;
    overview.push(
      `| ${flow.title ?? flow.id} | ${all.length ? '🟡 **有变化**' : '无变化'} | ${
        all.length ? [...new Set(all.map((o) => (o.element && marks.get(o.element)?.mark) || '🔴 已移除控件'))].join('、') : '—'
      } |`,
    );
  }

  const changedSections: string[] = [];
  for (const flow of curFlows) {
    const ops = flowOps(flow, curOps);
    const removedHits = removedStepsOf(flow.id);
    if (!ops.some((o) => o.element && marks.has(o.element)) && !removedHits.length) continue;
    const lines = [`### ${flow.title ?? flow.id}`, ''];
    ops.forEach((op, i) => {
      const mk = op.element && marks.get(op.element);
      lines.push(`${stepLine(op, i)}${mk ? `  ← ${mk.mark}：${mk.text}` : ''}`);
    });
    removedHits.forEach((op) => {
      lines.push(`- （V1 中的步骤，当前已移除）${op.name ?? op.id}；控件：${describeElement(op.element!)}  ← 🔴 已移除控件`);
    });
    lines.push('');
    changedSections.push(lines.join('\n'));
  }

  const removedSections: string[] = [];
  for (const flow of v1Flows) {
    if (curIds.has(flow.id)) continue;
    const ops = flowOps(flow, v1Ops);
    const lines = [`### ${flow.title ?? flow.id}（V1 流程，当前已不存在）`, ''];
    ops.forEach((op, i) => {
      const mk = op.element && marks.get(op.element);
      lines.push(`${stepLine(op, i)}${mk ? `  ← ${mk.mark}：${mk.text}` : ''}`);
    });
    lines.push('');
    removedSections.push(lines.join('\n'));
  }

  // 未被任何流程步骤引用的源码变化
  const referenced = new Set<string>();
  for (const op of curOps.values()) if (op.element) referenced.add(op.element);
  for (const f of curFlows) for (const op of removedStepsOf(f.id)) if (op.element) referenced.add(op.element);
  const unreferenced = [...marks.entries()].filter(([id]) => !referenced.has(id));

  const flowOfElement = (el: string) =>
    curFlows.filter((f) => flowOps(f, curOps).some((o) => o.element === el)).map((f) => f.title ?? f.id);
  const triggersOf = new Map<string, string[]>();
  for (const c of [...diff.added, ...diff.removed]) if (c.triggers?.length) triggersOf.set(c.id, c.triggers);

  const out: string[] = [];
  out.push(`# ${opts.feature}：流程变化报告`, '');
  out.push(`对比基线：${opts.label}`, '');
  out.push(
    `结论：共 ${curFlows.length} 条流程，其中 ${changedFlows} 条步骤引用了源码控件变化；已移除流程 ${v1Flows.filter((f) => !curIds.has(f.id)).length} 条；源码控件变化 ${marks.size} 处，其中 ${unreferenced.length} 处未被任何流程步骤引用。`,
    '',
  );
  out.push('> 步骤内容取自流程分析结果（feature.yaml）；变化标记由源码控件目录对比脚本确定性算出，二者通过控件语义 id 精确匹配。流程分析结果可能不完整，以变化标记为准。', '');

  out.push('## 一、流程总览', '', '| 流程 | 状态 | 变化 |', '|---|---|---|', ...overview, '');

  out.push('## 二、有变化的流程（逐步骤）', '');
  out.push(...(changedSections.length ? changedSections : ['（无）', '']));

  out.push(
    '## 三、已移除的流程',
    '',
    '> 这里的「已移除」是指流程 id 不在当前流程分析结果中，不等于源码已删除。例如「勾选机台（工位卡片）」在源码中仍有对应处理函数，需对照源码确认。',
    '',
  );
  out.push(...(removedSections.length ? removedSections : ['（无）', '']));

  out.push('## 四、源码变化未被流程引用', '');
  if (!unreferenced.length) out.push('（无）', '');
  for (const [id, mk] of unreferenced) {
    const via = (triggersOf.get(id) ?? []).flatMap((t) => flowOfElement(t));
    const where = via.length ? `；挂在触发按钮下，所属流程：${[...new Set(via)].join('、')}（流程步骤中未单独列出该控件）` : '';
    out.push(`- ${mk.mark}：${mk.text}${where}`);
  }
  if (unreferenced.length) out.push('', '以上控件存在于源码目录，但流程分析结果中没有对应步骤，需人工确认是否要补充流程。', '');

  out.push('## 五、待确认', '');
  out.push('- 同一控件可能被多条流程共用（如同一数据集接口），报告会在每条引用它的流程中都标出，不代表每条都确实受影响。');
  out.push('- 流程分析结果来自历史分析，步骤可能缺漏或名称不准，请对照源码确认。');
  out.push('- V1 流程中含分析阶段产生的操作（如「双击工单条定位到已派工单」）未在源码中找到依据，可能是分析误判，请勿当作已移除的真实流程。', '');

  return { markdown: out.join('\n'), changedFlows, totalFlows: curFlows.length };
}
