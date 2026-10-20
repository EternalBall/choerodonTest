import type { CompareReportDocument } from './llmSummarizeDiff.js';

/** 由 report.yaml 生成便于阅读的 Markdown（可选副产物） */
export function renderReportMarkdown(report: CompareReportDocument): string {
  const lines: string[] = [];
  lines.push(`# 对比报告：${report.feature}`);
  lines.push('');
  lines.push(`- **路径逻辑变更**: ${report.logic_changed ? '是' : '否'}`);
  lines.push(`- **模型**: ${report.meta.model}`);
  lines.push(`- **生成时间**: ${report.meta.generated_at}`);
  lines.push('');
  lines.push('## 总览');
  lines.push('');
  lines.push(report.executive_summary);
  lines.push('');
  lines.push('## 能力（operations）');
  lines.push('');
  for (const c of report.capabilities) {
    if (c.change_type === 'unchanged') continue;
    lines.push(`- **${c.operation_id}**（${c.change_type}）：${c.narrative}`);
  }
  if (report.meta_ops_summary) {
    lines.push('');
    lines.push('## 元操作');
    lines.push('');
    lines.push(report.meta_ops_summary);
  }
  if (report.flows_summary) {
    lines.push('');
    lines.push('## 测试流程');
    lines.push('');
    lines.push(report.flows_summary);
  }
  if (report.models_summary) {
    lines.push('');
    lines.push('## 配套模型');
    lines.push('');
    lines.push(report.models_summary);
  }
  if (report.suite_summary) {
    lines.push('');
    lines.push('## 编译用例（辅助）');
    lines.push('');
    lines.push(report.suite_summary);
  }
  if (report.path_readable.length) {
    lines.push('');
    lines.push('## 路径可读类别');
    lines.push('');
    for (const p of report.path_readable) {
      lines.push(`- **${p.category}**：${p.narrative}`);
    }
  }
  if (report.risks.length) {
    lines.push('');
    lines.push('## 风险');
    lines.push('');
    for (const r of report.risks) lines.push(`- ${r}`);
  }
  if (report.reviewer_checklist.length) {
    lines.push('');
    lines.push('## 评审清单');
    lines.push('');
    for (const r of report.reviewer_checklist) lines.push(`- [ ] ${r}`);
  }
  return lines.join('\n');
}
