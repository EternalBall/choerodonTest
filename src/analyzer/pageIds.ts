const RESERVED_PAGE_IDS = new Set(['list', 'detail', 'site_assignment', 'site_properties']);

export function pageIdFromSource(sourceHint: string): string | undefined {
  const first = sourceHint.split(/[\s（(+,，]/)[0]?.trim();
  if (!first) return undefined;
  const parts = first.split('/').filter(Boolean);
  if (!parts.length) return undefined;
  const base = parts[parts.length - 1].replace(/\.[a-z]+$/i, '');
  const name = /^index$/i.test(base) && parts.length >= 2 ? parts[parts.length - 2] : base;
  const id = name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  return id || undefined;
}

type Obj = Record<string, unknown>;

/** 用源码路径派生页面 id，跨版本稳定；LLM 起的 id 仅在无源码路径或冲突时保留 */
export function stabilizePageIds(artifact: Obj): Obj {
  const pages = (Array.isArray(artifact.pages) ? artifact.pages : []) as Obj[];
  const taken = new Set(pages.map((p) => String(p.id)));
  const rename = new Map<string, string>();
  for (const p of pages) {
    const oldId = String(p.id);
    if (RESERVED_PAGE_IDS.has(oldId) || typeof p.source_hint !== 'string') continue;
    const next = pageIdFromSource(p.source_hint);
    if (!next || next === oldId || RESERVED_PAGE_IDS.has(next) || taken.has(next)) continue;
    rename.set(oldId, next);
    taken.add(next);
  }
  if (!rename.size) return artifact;

  const m = (v: unknown): unknown => (typeof v === 'string' && rename.has(v) ? rename.get(v) : v);
  const remapKeys = (o: Obj, keys: string[]): Obj => {
    const out: Obj = { ...o };
    for (const k of keys) if (k in out) out[k] = m(out[k]);
    return out;
  };

  const operations = Array.isArray(artifact.operations)
    ? (artifact.operations as Obj[]).map((op) => {
        const next = remapKeys(op, ['page_id', 'page']);
        if (Array.isArray(op.steps)) {
          next.steps = (op.steps as Obj[]).map((s) => remapKeys(s, ['page_id']));
        }
        return next;
      })
    : artifact.operations;

  const pageEdges = Array.isArray(artifact.page_edges)
    ? (artifact.page_edges as Obj[]).map((e) => {
        const from = String(e.from_page ?? '');
        const to = String(e.to_page ?? '');
        const next = remapKeys(e, ['from_page', 'to_page']);
        if (e.id === `${from}_to_${to}`) next.id = `${m(from)}_to_${m(to)}`;
        return next;
      })
    : artifact.page_edges;

  return {
    ...artifact,
    pages: pages.map((p) => remapKeys(p, ['id'])),
    operations,
    page_edges: pageEdges,
    page_states: Array.isArray(artifact.page_states)
      ? (artifact.page_states as Obj[]).map((s) => remapKeys(s, ['page_id', 'page']))
      : artifact.page_states,
  };
}
