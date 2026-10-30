type Obj = Record<string, unknown>;

/** ref 形如 `<前缀>.<名字>`；前缀由 LLM 自由起名，跨次分析会漂移。步骤 element 通常只写裸名。 */
export function refName(ref: string): string {
  const i = ref.indexOf('.');
  return i > 0 && i < ref.length - 1 ? ref.slice(i + 1) : ref;
}

/**
 * 统一元素引用：elements_hints 的 ref 规范为 `<page_id>.<名字>`，步骤 element / 元操作 element
 * 若为裸名或旧前缀，按名字对齐到同一规范 ref。页面取该名字被引用时所在操作的多数页面，无引用则取主页面。
 * 归一后重复 ref 保留先出现的一条。
 */
export function canonicalizeElementRefs(artifact: Obj): Obj {
  const ops = (Array.isArray(artifact.operations) ? artifact.operations : []) as Obj[];
  const metas = (Array.isArray(artifact.meta_ops) ? artifact.meta_ops : []) as Obj[];
  const hints = (Array.isArray(artifact.elements_hints) ? artifact.elements_hints : []) as Obj[];
  if (!hints.length) return artifact;

  const pageVotes = (pairs: [unknown, unknown][]) => {
    const votes = new Map<string, Map<string, number>>();
    for (const [name, page] of pairs) {
      if (typeof name !== 'string' || typeof page !== 'string') continue;
      const m = votes.get(name) ?? new Map<string, number>();
      m.set(page, (m.get(page) ?? 0) + 1);
      votes.set(name, m);
    }
    return votes;
  };
  const best = (m: Map<string, number> | undefined): string | undefined => {
    let out: string | undefined;
    let n = -1;
    for (const [k, c] of m ?? []) if (c > n) { out = k; n = c; }
    return out;
  };

  const opPairs: [unknown, unknown][] = [];
  for (const o of ops) for (const s of (Array.isArray(o.steps) ? o.steps : []) as Obj[]) {
    if (typeof s.element === 'string') opPairs.push([refName(s.element), o.page_id]);
  }
  for (const m of metas) if (typeof m.element === 'string') opPairs.push([refName(m.element), m.page_id]);
  const votes = pageVotes(opPairs);

  const pageCount = new Map<string, number>();
  for (const o of ops) if (typeof o.page_id === 'string') pageCount.set(o.page_id, (pageCount.get(o.page_id) ?? 0) + 1);
  const primary = best(pageCount);
  if (!primary) return artifact;

  const canonOf = new Map<string, string>();
  for (const h of hints) {
    const name = refName(String(h.ref ?? ''));
    if (!canonOf.has(name)) canonOf.set(name, `${best(votes.get(name)) ?? primary}.${name}`);
  }
  const canonEl = (el: unknown): unknown => {
    if (typeof el !== 'string') return el;
    const name = refName(el);
    return canonOf.get(name) ?? el;
  };

  const seen = new Set<string>();
  const elements_hints = hints
    .map((h) => ({ ...h, ref: canonOf.get(refName(String(h.ref ?? ''))) ?? h.ref }))
    .filter((h) => {
      const key = String(h.ref);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  const operations = ops.map((o) => ({
    ...o,
    steps: Array.isArray(o.steps)
      ? (o.steps as Obj[]).map((s) => (s.element === undefined ? s : { ...s, element: canonEl(s.element) }))
      : o.steps,
  }));
  const meta_ops = metas.map((m) => (m.element === undefined ? m : { ...m, element: canonEl(m.element) }));

  return { ...artifact, operations, meta_ops, elements_hints };
}

/** 返回 ref 的名字部分未在源码文本中出现的 ref 列表，供人工核对（不改变 state） */
export function ungroundedRefs(hints: Obj[], sourceText: string): string[] {
  const out: string[] = [];
  for (const h of hints) {
    const ref = String(h.ref ?? '');
    const name = refName(ref);
    if (name && !sourceText.includes(name)) out.push(ref);
  }
  return out;
}
