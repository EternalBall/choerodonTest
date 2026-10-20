import type { CompareReportDocument } from './llmSummarizeDiff.js';

const CHANGE_LABEL: Record<string, string> = {
  added: '新增',
  removed: '移除',
  modified: '变更',
};

/** 简洁可读的对比报告 Markdown */
export function renderReportMarkdown(report: CompareReportDocument): string {
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

  if (report.notes?.length) {
    lines.push('');
    lines.push('## 补充');
    lines.push('');
    for (const n of report.notes) lines.push(`- ${n}`);
  }

  return lines.join('\n');
}
