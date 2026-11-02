import type { CatalogControl } from '../analyzer/controlCatalog.js';

export type ControlChange = {
  id: string;
  fields: string[];
  before: CatalogControl;
  after: CatalogControl;
};

export type ControlDiff = {
  added: CatalogControl[];
  removed: CatalogControl[];
  /** 文件/handler 变化但 tag、文案、容器相同：多半是改名或移动，未计入 added/removed 的配对 */
  possiblyMoved: { before: CatalogControl; after: CatalogControl }[];
  changed: ControlChange[];
  unchanged: number;
};

/** 语义 id 去掉文件路径与 #序号后的键：tag|label|ctx|handler，用于识别移动 */
const contentKey = (c: CatalogControl): string => {
  const parts = c.id.split('|');
  return parts.slice(1, 5).join('|').replace(/#\d+$/, '');
};

const attrs = (c: CatalogControl): Record<string, string> => ({
  tag: c.tag,
  label: c.label,
  state: c.state,
  triggers: (c.triggers ?? []).join(','),
  // 备注中的文件路径与行号随任何编辑漂移，比较时去掉，只看语义内容
  note: c.note.replace(/[\w./-]*\.(js|jsx|ts|tsx):\d+/g, '').replace(/、/g, ','),
  ambiguous: String(!!c.ambiguous),
});

/**
 * 按语义 id 对齐两份控件目录（确定性，不调用 LLM）。
 * id 中的文件路径变化会表现为 removed + added，因此额外按内容键配对，标为 possiblyMoved。
 */
export function diffControlCatalogs(before: CatalogControl[], after: CatalogControl[]): ControlDiff {
  const mb = new Map(before.map((c) => [c.id, c]));
  const ma = new Map(after.map((c) => [c.id, c]));
  const changed: ControlChange[] = [];
  let unchanged = 0;
  const removedRaw: CatalogControl[] = [];
  const addedRaw: CatalogControl[] = [];
  for (const [id, b] of mb) {
    const a = ma.get(id);
    if (!a) {
      removedRaw.push(b);
      continue;
    }
    const ab = attrs(b);
    const aa = attrs(a);
    const fields = Object.keys(ab).filter((k) => ab[k] !== aa[k]);
    if (fields.length) changed.push({ id, fields, before: b, after: a });
    else unchanged++;
  }
  for (const [id, a] of ma) if (!mb.has(id)) addedRaw.push(a);

  // 内容键配对：同一内容在不同文件/不同 handler 下出现，视为移动或改名
  const addedByKey = new Map<string, CatalogControl[]>();
  for (const a of addedRaw) {
    const k = contentKey(a);
    addedByKey.set(k, [...(addedByKey.get(k) ?? []), a]);
  }
  const possiblyMoved: ControlDiff['possiblyMoved'] = [];
  const removed: CatalogControl[] = [];
  for (const b of removedRaw) {
    const pool = addedByKey.get(contentKey(b));
    if (pool?.length) {
      const a = pool.shift()!;
      possiblyMoved.push({ before: b, after: a });
    } else removed.push(b);
  }
  const movedAfterIds = new Set(possiblyMoved.map((m) => m.after.id));
  const added = addedRaw.filter((a) => !movedAfterIds.has(a.id));
  return { added, removed, possiblyMoved, changed, unchanged };
}

/** 生成可读的 Markdown 摘要 */
export function renderControlDiffMd(d: ControlDiff, title: string): string {
  const line = (c: CatalogControl) => `- \`${c.id.split('|').slice(1).join('|')}\`（${c.file.split('/').pop()}:${c.line}）`;
  const out: string[] = [`# ${title}`, ''];
  out.push(`未变 ${d.unchanged}｜属性变化 ${d.changed.length}｜新增 ${d.added.length}｜移除 ${d.removed.length}｜疑似移动/改名 ${d.possiblyMoved.length}`, '');
  out.push('## 新增', ...(d.added.length ? d.added.map(line) : ['无']), '');
  out.push('## 移除', ...(d.removed.length ? d.removed.map(line) : ['无']), '');
  out.push('## 属性变化', ...(d.changed.length
    ? d.changed.map((c) => `- \`${c.id.split('|').slice(1).join('|')}\`：${c.fields.join('、')}（${c.fields.map((f) => `${f}: ${String((c.before as unknown as Record<string, unknown>)[f] ?? '')} → ${String((c.after as unknown as Record<string, unknown>)[f] ?? '')}`).join('；')}）`)
    : ['无']), '');
  out.push('## 疑似移动/改名', ...(d.possiblyMoved.length
    ? d.possiblyMoved.map((m) => `- ${m.before.file.split('/').pop()} → ${m.after.file.split('/').pop()}：\`${m.after.id.split('|').slice(1).join('|')}\``)
    : ['无']), '');
  return out.join('\n');
}
