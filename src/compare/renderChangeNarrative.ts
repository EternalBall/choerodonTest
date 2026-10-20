import type { ArtifactDiff } from './diffArtifact.js';
import type { SuiteCaseDiff } from './diffSuite.js';

/** @deprecated 主报告已改为 renderReportMarkdown；保留作本地预览兜底 */
export function renderChangeNarrative(opts: {
  feature: string;
  baselineLabel: string;
  baselineCreatedAt?: string;
  artifactDiff: ArtifactDiff;
  suiteDiff?: SuiteCaseDiff;
  logicChanged: boolean;
  suiteOnlyDrift: boolean;
}): string {
  const lines: string[] = [];
  lines.push(`# ${opts.feature}`);
  lines.push('');
  lines.push(
    opts.logicChanged
      ? `相对基线 \`${opts.baselineLabel}\`，完整测试流程存在逻辑变更。`
      : `相对基线 \`${opts.baselineLabel}\`，完整测试流程无逻辑变更。`,
  );

  const changed = opts.artifactDiff.flow_chains.filter((c) => c.change_type !== 'unchanged');
  if (changed.length) {
    lines.push('');
    lines.push('## 流程变更');
    lines.push('');
    for (const c of changed) {
      const chain =
        c.change_type === 'removed'
          ? c.before.map((s) => s.meta_op_id).join(' → ')
          : c.after.map((s) => s.meta_op_id).join(' → ');
      const detail = c.highlights.length ? c.highlights.join('；') : chain;
      lines.push(`- **${c.id}** ${c.title}（${c.change_type}）：${detail}`);
    }
  }

  if (opts.suiteDiff && opts.suiteOnlyDrift) {
    lines.push('');
    lines.push('- 补充：仅编译用例漂移，流程逻辑未变');
  }

  return lines.join('\n');
}

export { artifactLogicChanged } from './diffArtifact.js';
