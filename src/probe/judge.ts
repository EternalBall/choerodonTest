/** 只读探测的结论判定（纯函数，不依赖浏览器） */

export type ProbeObservation = {
  /** locator.count() */
  count: number;
  /** 第一个匹配元素是否可见（count=0 时为 false） */
  firstVisible: boolean;
};

export type ProbeVerdict = 'ok' | 'multiple' | 'missing' | 'hidden';

/**
 * - missing：0 个匹配
 * - hidden：有匹配但第一个不可见
 * - multiple：匹配多个且定位里没有 nth / first 收敛（需要补 nth 或更精确的定位）
 * - ok：恰好一个可见，或已用 nth 收敛后可见
 */
export function judgeProbe(obs: ProbeObservation, css?: string): ProbeVerdict {
  if (obs.count === 0) return 'missing';
  if (!obs.firstVisible) return 'hidden';
  const narrowed = !!css && />>\s*nth=/.test(css);
  if (obs.count > 1 && !narrowed) return 'multiple';
  return 'ok';
}

/** 探测结论 → 对元素状态的建议（只写进报告，不改 elements.yaml） */
export function suggestStatus(v: ProbeVerdict): 'proposed' | 'needs_review' {
  // missing 不建议 blocked：行内链接、下拉、弹层里的元素在无数据/未交互时本来就匹配不到
  return v === 'ok' ? 'proposed' : 'needs_review';
}

/** 需要先交互（点击打开）才会出现在 DOM 里的定位，本期不探测 */
export function needsInteraction(key: string, css: string | undefined, withinCss: string | undefined): boolean {
  if (/InModal$/.test(key)) return true;
  const all = `${css ?? ''} ${withinCss ?? ''}`;
  return /c7n-pro-modal|c7n-pro-popup|c7n-pro-dropdown|c7n-pro-select-dropdown|ant-popover|\.modal\b|\.drawer\b/.test(all);
}
