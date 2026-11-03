import type { Suite } from '../core/schema.js';

/**
 * 测试数据策略（生成后处理，与具体功能无关）：
 * 1. 写操作用例（标签 update/delete，或带 openDetailRow 的 create，如「新增数据项」）只动测试自有数据：
 *    进详情 / 勾选行都限定为链接或行内文案以 ${ENV.TEST_DATA_PREFIX} 开头的记录，不碰业务数据。
 * 2. 进详情后紧接着要点的按钮（如「编辑」）作为 requireEnabled：该按钮禁用（单据状态不允许）就换下一条，
 *    都不行则标为「数据不具备」跳过，而不是卡到超时。
 * 3. 列表批量操作的「勾选第一行」改为 selectTableRow（同样限定自有数据）。
 */
const WRITE_TAGS = new Set(['update', 'delete']);
const OP_TAGS = new Set(['query', 'detail', 'create', 'update', 'delete', 'copy', 'preview', 'import', 'export']);
const PREFIX = '${ENV.TEST_DATA_PREFIX}';
const FIRST_ROW_CHECKBOX = /\.tableRowCheckboxFirst$/;

export type DataStrategyFix = { caseId: string; step: string; change: string };

function isWriteCase(c: Suite['cases'][number]): boolean {
  const tags = c.tags ?? [];
  if (tags.some((t) => WRITE_TAGS.has(t))) return true;
  // create 但需要先进已有记录的详情（如在已有单据下新增明细行）
  if (tags.includes('create') && c.steps.some((s) => s.action === 'openDetailRow')) return true;
  if (!tags.some((t) => OP_TAGS.has(t))) return c.steps.some((s) => s.action === 'clickExpectApi');
  return false;
}

export function applyDataStrategy(suite: Suite): DataStrategyFix[] {
  const fixes: DataStrategyFix[] = [];
  for (const c of suite.cases) {
    if (!isWriteCase(c)) continue;
    c.steps.forEach((step, i) => {
      if (step.action === 'openDetailRow') {
        step.args = { ...step.args, ownPrefix: step.args?.ownPrefix ?? PREFIX };
        const next = c.steps.slice(i + 1).find((s) => s.action === 'click' || s.action === 'clickExpectApi');
        const nextTarget = next && typeof next.args?.target === 'string' ? next.args.target : undefined;
        if (nextTarget && !step.args.requireEnabled) step.args.requireEnabled = nextTarget;
        fixes.push({ caseId: c.id, step: step.name, change: `只进测试自有数据${nextTarget ? `，要求 ${nextTarget} 可用` : ''}` });
      } else if (step.action === 'click' && typeof step.args?.target === 'string' && FIRST_ROW_CHECKBOX.test(step.args.target)) {
        step.action = 'selectTableRow';
        step.args = { ownPrefix: PREFIX };
        fixes.push({ caseId: c.id, step: step.name, change: '勾选第一行 → 勾选测试自有数据行' });
      }
    });
  }
  return fixes;
}
