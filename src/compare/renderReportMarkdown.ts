import type { CompareDiffDocument } from './buildDiffYaml.js';
import type { CompareReportDocument } from './llmSummarizeDiff.js';

const CHANGE_LABEL: Record<string, string> = {
  added: '新增',
  removed: '移除',
  modified: '变更',
};

const FIELD_CHANGE_LABEL: Record<string, string> = {
  added: '新增',
  removed: '删除',
  changed: '变更',
};

/** 关键属性的中文标签：评审时一眼看出是必输性/可编辑性/校验/联动/值集变化 */
const ATTR_LABEL: Record<string, string> = {
  required: '必输性',
  disabled: '可编辑性',
  readOnly: '可编辑性',
  validator: '校验',
  dynamicProps: '联动',
  computedProps: '联动',
  lookupCode: '值集',
  lovCode: '值集',
};

function formatValue(v: unknown): string {
  if (v === undefined) return '（无）';
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const keys = Object.keys(v);
    if (keys.length === 1 && keys[0] === 'expr') return `\`${(v as { expr: string }).expr}\``;
  }
  return `\`${typeof v === 'string' ? v : JSON.stringify(v)}\``;
}

function attrLine(a: { attr: string; before: unknown; after: unknown }): string {
  const label = ATTR_LABEL[a.attr];
  const head = label ? `[${label}] ${a.attr}` : a.attr;
  return `${head}: ${formatValue(a.before)} → ${formatValue(a.after)}`;
}

type RenderItem = { key: string; change: string; attrs: { attr: string; before: unknown; after: unknown }[] };

function renderItems(lines: string[], title: string, items: RenderItem[]) {
  if (!items.length) return;
  lines.push(`- ${title}`);
  for (const it of items) {
    lines.push(`  - **${it.key}**（${FIELD_CHANGE_LABEL[it.change] ?? it.change}）`);
    for (const a of it.attrs) lines.push(`    - ${attrLine(a)}`);
  }
}

/** 字段级变更：操作/数据集 → 字段 → 属性: 旧值 → 新值；无变更写「无字段级变化」 */
function renderFieldChanges(lines: string[], fields: CompareDiffDocument['fields']) {
  lines.push('');
  lines.push('## 字段级变更');
  lines.push('');
  if (!fields) {
    lines.push('无字段级变化');
    return;
  }
  const byDs = new Map<string, typeof fields.field_facts>();
  for (const f of fields.field_facts) {
    const list = byDs.get(f.ds) ?? [];
    list.push(f);
    byDs.set(f.ds, list);
  }
  for (const [ds, list] of byDs) {
    lines.push(`- 数据集 **${ds}**`);
    for (const f of list) {
      const flows =
        'linked_flows' in f && Array.isArray((f as { linked_flows?: string[] }).linked_flows)
          ? (f as { linked_flows: string[] }).linked_flows
          : undefined;
      const flowNote = flows?.length ? `，关联流程：${flows.join('、')}` : '';
      lines.push(`  - 字段 **${f.name}**（${f.group}，${FIELD_CHANGE_LABEL[f.change]}${flowNote}）`);
      for (const a of f.attrs) lines.push(`    - ${attrLine(a)}`);
    }
  }
  renderItems(lines, '字段规则（field_rules）', fields.field_rules);
  renderItems(lines, '校验（validations）', fields.validations);
  renderItems(lines, '页面状态（page_states）', fields.page_states);
}

/**
 * 简洁可读的对比报告 Markdown。
 * fields 来自 diff.yaml 的确定性字段级结果（不经 LLM），缺省视为无字段级变化。
 */
export function renderReportMarkdown(
  report: CompareReportDocument,
  fields?: CompareDiffDocument['fields'],
): string {
  const lines: string[] = [];
  lines.push(`# ${report.feature}`);
  lines.push('');
  lines.push(report.summary);
  lines.push('');
  lines.push(`逻辑变更：${report.logic_changed ? '是' : '否'}`);

  if (report.flows.length) {
    lines.push('');
    lines.push('## 流程变更');
    lines.push('');
    for (const f of report.flows) {
      const label = CHANGE_LABEL[f.change_type] ?? f.change_type;
      const title = f.title ? ` ${f.title}` : '';
      lines.push(`- **${f.id}**${title}（${label}）：${f.what_changed}`);
    }
  }

  renderFieldChanges(lines, fields);

  if (report.notes?.length) {
    lines.push('');
    lines.push('## 补充');
    lines.push('');
    for (const n of report.notes) lines.push(`- ${n}`);
  }

  return lines.join('\n');
}
