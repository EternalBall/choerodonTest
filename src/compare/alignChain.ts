/**
 * 对两条步骤 id 序列做 LCS 对齐，识别插入 / 删除 / 替换 / 保留。
 * 例：1→2→3 vs 1→2→2.5→3 → insert 2.5（夹在 2 与 3 之间），而非按位「替换」。
 */

export type ChainEditOp = 'keep' | 'insert' | 'delete' | 'replace';

export type ChainEdit = {
  op: ChainEditOp;
  /** 基线侧步骤（delete/replace/keep） */
  before?: string;
  /** 当前侧步骤（insert/replace/keep） */
  after?: string;
  /** 插入点：紧邻的前驱 / 后继（便于叙述「插在 2 与 3 之间」） */
  after_step?: string;
  before_step?: string;
};

export function alignStepIds(before: string[], after: string[]): ChainEdit[] {
  const n = before.length;
  const m = after.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (before[i - 1] === after[j - 1]) dp[i]![j] = dp[i - 1]![j - 1]! + 1;
      else dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
    }
  }

  // 回溯得到 keep 集合，再扫一遍产出编辑脚本
  const keepPairs: Array<{ bi: number; aj: number }> = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (before[i - 1] === after[j - 1]) {
      keepPairs.push({ bi: i - 1, aj: j - 1 });
      i--;
      j--;
    } else if (dp[i - 1]![j]! >= dp[i]![j - 1]!) i--;
    else j--;
  }
  keepPairs.reverse();

  const edits: ChainEdit[] = [];
  let bi = 0;
  let aj = 0;
  for (const pair of keepPairs) {
    const deleted = before.slice(bi, pair.bi);
    const inserted = after.slice(aj, pair.aj);
    pushReplaceOrSplit(edits, deleted, inserted, before, after, bi, aj);
    edits.push({ op: 'keep', before: before[pair.bi], after: after[pair.aj] });
    bi = pair.bi + 1;
    aj = pair.aj + 1;
  }
  pushReplaceOrSplit(edits, before.slice(bi), after.slice(aj), before, after, bi, aj);

  // 补全 insert 的前后邻接
  for (let k = 0; k < edits.length; k++) {
    const e = edits[k]!;
    if (e.op !== 'insert') continue;
    e.after_step = findNeighbor(edits, k, -1);
    e.before_step = findNeighbor(edits, k, 1);
  }
  return edits;
}

function pushReplaceOrSplit(
  edits: ChainEdit[],
  deleted: string[],
  inserted: string[],
  _before: string[],
  _after: string[],
  _bi: number,
  _aj: number,
): void {
  const dLen = deleted.length;
  const iLen = inserted.length;
  const paired = Math.min(dLen, iLen);
  for (let k = 0; k < paired; k++) {
    if (deleted[k] === inserted[k]) {
      edits.push({ op: 'keep', before: deleted[k], after: inserted[k] });
    } else {
      edits.push({ op: 'replace', before: deleted[k], after: inserted[k] });
    }
  }
  for (let k = paired; k < dLen; k++) {
    edits.push({ op: 'delete', before: deleted[k] });
  }
  for (let k = paired; k < iLen; k++) {
    edits.push({ op: 'insert', after: inserted[k] });
  }
}

function findNeighbor(edits: ChainEdit[], from: number, dir: -1 | 1): string | undefined {
  for (let k = from + dir; k >= 0 && k < edits.length; k += dir) {
    const e = edits[k]!;
    if (e.op === 'keep' || e.op === 'replace') {
      return dir < 0 ? e.after ?? e.before : e.after ?? e.before;
    }
    if (e.op === 'insert' && dir > 0) return e.after;
    if (e.op === 'delete' && dir < 0) return e.before;
  }
  return undefined;
}

export function formatChain(ids: string[]): string {
  return ids.length ? ids.join(' → ') : '（空）';
}

export function summarizeEdits(edits: ChainEdit[]): string[] {
  const lines: string[] = [];
  for (const e of edits) {
    if (e.op === 'keep') continue;
    if (e.op === 'insert') {
      const where =
        e.after_step && e.before_step
          ? `插在「${e.after_step}」与「${e.before_step}」之间`
          : e.after_step
            ? `接在「${e.after_step}」之后`
            : e.before_step
              ? `插在「${e.before_step}」之前`
              : '插入';
      lines.push(`新增步骤「${e.after}」（${where}）`);
    } else if (e.op === 'delete') {
      lines.push(`移除步骤「${e.before}」`);
    } else if (e.op === 'replace') {
      lines.push(`步骤「${e.before}」变为「${e.after}」`);
    }
  }
  return lines;
}

/**
 * 分析编辑对整条流程的影响（启发式，供报告/LLM）。
 * 核心：插入/删除不只是局部步骤，会改变后续步骤的上下文与副作用边界。
 */
export function analyzeChainImpact(opts: {
  before: string[];
  after: string[];
  edits: ChainEdit[];
}): string[] {
  const { before, after, edits } = opts;
  const impact: string[] = [];
  const inserts = edits.filter((e) => e.op === 'insert');
  const deletes = edits.filter((e) => e.op === 'delete');
  const replaces = edits.filter((e) => e.op === 'replace');

  if (!inserts.length && !deletes.length && !replaces.length) return impact;

  impact.push(`整链：${formatChain(before)} 变为 ${formatChain(after)}`);

  for (const e of inserts) {
    const step = e.after ?? '';
    const tail = stepsAfterInsert(after, step);
    const hints: string[] = [];
    if (looksLikeAssert(step)) {
      hints.push('增加校验门禁，后续步骤仅在断言通过后继续');
    }
    if (looksLikeQuery(step)) {
      hints.push('可能改变后续步骤依赖的数据上下文');
    }
    if (looksLikeMutate(step)) {
      hints.push('在后续步骤前引入状态变更，可能影响其后操作的前置条件');
    }
    if (looksLikeSave(step)) {
      hints.push('在链路中提前落库，改变后续步骤是否仍面对未保存草稿');
    }
    if (tail.length) {
      hints.push(`其后步骤（${tail.join(' → ')}）的执行条件与时机随之变化`);
    } else {
      hints.push('位于链尾，主要影响流程终点结果');
    }
    impact.push(`插入「${step}」：${hints.join('；')}`);
  }

  for (const e of deletes) {
    const step = e.before ?? '';
    const hints: string[] = [];
    if (looksLikeSave(step)) {
      hints.push('本流程不再落库，副作用可能上移到独立保存流程或仅改本地状态');
    }
    if (looksLikeAssert(step)) {
      hints.push('去掉校验门禁，失败可能延后到更后步骤才暴露');
    }
    if (looksLikeQuery(step)) {
      hints.push('后续步骤可能缺少查询所得数据');
    }
    hints.push('原紧随其后的步骤前移，整链更短');
    impact.push(`移除「${step}」：${hints.join('；')}`);
  }

  for (const e of replaces) {
    impact.push(
      `「${e.before}」→「${e.after}」：整链入口/上下文节点替换，后续步骤均在新上下文下执行`,
    );
  }

  return impact;
}

function stepsAfterInsert(after: string[], inserted: string): string[] {
  const idx = after.indexOf(inserted);
  if (idx < 0) return [];
  return after.slice(idx + 1);
}

function looksLikeAssert(id: string): boolean {
  return /assert|校验|断言/i.test(id);
}
function looksLikeQuery(id: string): boolean {
  return /query|search|filter|查询|筛选/i.test(id);
}
function looksLikeSave(id: string): boolean {
  return /save|submit|保存|提交/i.test(id);
}
function looksLikeMutate(id: string): boolean {
  return /toggle|fill|click|edit|switch|切换|填写/i.test(id);
}
