import type { ArtifactDiff } from './diffArtifact.js';
import type { SuiteCaseDiff } from './diffSuite.js';

function section(title: string, body: string): string {
  if (!body.trim()) return '';
  return `## ${title}\n\n${body}\n`;
}

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
  lines.push(`# 变更说明：${opts.feature}`);
  lines.push('');
  lines.push(`- **对比基线**: \`${opts.baselineLabel}/\`${opts.baselineCreatedAt ? `（${opts.baselineCreatedAt}）` : ''}`);
  lines.push(`- **当前**: \`artifacts/.../feature.yaml\` + \`cases/generated/.../suite.yaml\``);
  lines.push(`- **路径逻辑是否变更**: ${opts.logicChanged ? '是' : '否'}`);
  if (opts.suiteDiff) {
    lines.push(`- **仅脚本编译漂移**（元操作未变、suite 变）: ${opts.suiteOnlyDrift ? '是' : '否'}`);
  }
  lines.push('');

  // 能力摘要
  const opParts: string[] = [];
  const { operations } = opts.artifactDiff;
  if (operations.added.length) {
    opParts.push(
      `**新增能力** (${operations.added.length}): ${operations.added.map((o) => o.id).join(', ')}`,
    );
  }
  if (operations.removed.length) {
    opParts.push(
      `**移除能力** (${operations.removed.length}): ${operations.removed.map((o) => o.id).join(', ')}`,
    );
  }
  for (const c of operations.changed) {
    opParts.push(
      `- **${c.id}** 变更字段: ${c.fields.join(', ')}（执行顺序/接口/前置等见 execution_chain、api、preconditions）`,
    );
  }
  if (!opParts.length && operations.unchanged.length) {
    opParts.push(`能力层无变化（${operations.unchanged.join(', ')}）`);
  }
  lines.push(section('能力摘要（operations）', opParts.join('\n')));

  // meta_ops
  const mo = opts.artifactDiff.meta_ops;
  const moParts: string[] = [];
  if (!mo.added.length && !mo.removed.length && !mo.changed.length) {
    moParts.push('无 meta_ops 或相对基线无变化');
  } else {
    if (mo.added.length) moParts.push(`新增: ${mo.added.map((m) => m.id).join(', ')}`);
    if (mo.removed.length) moParts.push(`移除: ${mo.removed.map((m) => m.id).join(', ')}`);
    for (const c of mo.changed) {
      moParts.push(`- **${c.id}** 参数/就绪条件等已变`);
    }
  }
  lines.push(section('元操作（meta_ops，按 id 对齐）', moParts.join('\n')));

  // flows
  const fl = opts.artifactDiff.flows;
  const flParts: string[] = [];
  if (!fl.added.length && !fl.removed.length && !fl.sequenceChanged.length && !fl.changed.length) {
    flParts.push('无 flows 或相对基线无变化');
  } else {
    if (fl.added.length) flParts.push(`新增流程: ${fl.added.map((f) => f.id).join(', ')}`);
    if (fl.removed.length) flParts.push(`移除流程: ${fl.removed.map((f) => f.id).join(', ')}`);
    for (const s of fl.sequenceChanged) {
      flParts.push(`- **${s.id}** 节点顺序:`);
      flParts.push(`  - 基线: ${s.before.join(' → ') || '（空）'}`);
      flParts.push(`  - 当前: ${s.after.join(' → ') || '（空）'}`);
    }
  }
  lines.push(section('测试流程（flows / 节点级）', flParts.join('\n')));

  // 配套模型
  const modelParts: string[] = [];
  if (opts.artifactDiff.entry.changed) modelParts.push('- 入口 route/menu 有变化');
  if (opts.artifactDiff.page_states.changed) modelParts.push('- 页面状态 page_states 有变化');
  if (opts.artifactDiff.field_rules.changed) modelParts.push('- 字段规则 field_rules 有变化');
  if (opts.artifactDiff.validations.changed) modelParts.push('- 校验规则 validations 有变化');
  if (!modelParts.length) modelParts.push('配套模型无变化');
  lines.push(section('配套模型', modelParts.join('\n')));

  // suite
  if (opts.suiteDiff) {
    const s = opts.suiteDiff;
    const sp: string[] = [];
    if (s.added.length) sp.push(`新增用例: ${s.added.join(', ')}`);
    if (s.removed.length) sp.push(`移除用例: ${s.removed.join(', ')}`);
    for (const c of s.changed) {
      sp.push(`- **${c.id}** 步骤序列变化（按 case.id 对齐，语义 action+关键 args）`);
      sp.push(`  - 基线 (${c.before.length} 步): ${c.before.map((x) => x.action).join(' → ')}`);
      sp.push(`  - 当前 (${c.after.length} 步): ${c.after.map((x) => x.action).join(' → ')}`);
    }
    if (!s.added.length && !s.removed.length && !s.changed.length) {
      sp.push(`脚本层无变化（${s.unchanged.join(', ') || '无用例'}）`);
    }
    sp.push('');
    sp.push(
      '> 编译用例仅供执行核对；业务逻辑变更以 operations / flows / meta_ops 为准。',
    );
    lines.push(section('编译用例（suite.yaml，辅助）', sp.join('\n')));
  }

  return lines.filter(Boolean).join('\n');
}

export function artifactLogicChanged(diff: ArtifactDiff): boolean {
  if (diff.operations.added.length || diff.operations.removed.length || diff.operations.changed.length) {
    return true;
  }
  if (diff.meta_ops.added.length || diff.meta_ops.removed.length || diff.meta_ops.changed.length) {
    return true;
  }
  if (
    diff.flows.added.length ||
    diff.flows.removed.length ||
    diff.flows.changed.length ||
    diff.flows.sequenceChanged.length
  ) {
    return true;
  }
  if (
    diff.entry.changed ||
    diff.page_states.changed ||
    diff.field_rules.changed ||
    diff.validations.changed
  ) {
    return true;
  }
  return false;
}
