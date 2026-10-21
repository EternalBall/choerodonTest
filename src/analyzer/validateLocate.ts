import type { LocGap, LocatorDef, PageLocateResult } from './kitBinding.js';

export type LocateViolation = { gate: number; message: string };

const CONTAINERS = new Set(['Collapse', 'Panel', 'Collapse.Panel', 'Menu', 'Dropdown', 'Tabs', 'Form', 'Modal']);
const CONCRETE_KEYS = ['css', 'role', 'name', 'text', 'testId', 'label', 'placeholder'] as const;

/** 顶层（括号/方括号外）是否含逗号并集 */
export function hasCommaUnion(css: string): boolean {
  let depth = 0;
  let quote = '';
  for (const ch of css) {
    if (quote) {
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (ch === ',' && depth === 0) return true;
  }
  return false;
}

const hasConcrete = (d: LocatorDef) => CONCRETE_KEYS.some((k) => d[k] !== undefined);

/** 由 locators 推导 elements_draft：仅含自带选择器、未 blocked 的项（kit 引用项由平台 kit 提供，不重复写） */
export function deriveElementsDraft(r: PageLocateResult): PageLocateResult['elements_draft'] {
  const ns: Record<string, Record<string, unknown>> = {};
  for (const [key, d] of Object.entries(r.locators)) {
    if (d.status === 'blocked' || !hasConcrete(d)) continue;
    const { evidence: _e, status: _s, kit: _k, ...rest } = d;
    void _e; void _s; void _k;
    ns[key] = rest;
  }
  return Object.keys(ns).length ? { [r.slug]: ns } : {};
}

/**
 * 质量门禁（prompt §4 的 8 项）：失败不抛错，而是降级——降低 confidence、写 gaps、必要时改状态，
 * 绝不把未达标的项当成 bound 放行。
 */
export function applyQualityGates(
  r: PageLocateResult,
  ctx: { kitKeys: Set<string> },
): { result: PageLocateResult; violations: LocateViolation[] } {
  const violations: LocateViolation[] = [];
  const gaps: LocGap[] = [...r.gaps];
  const locators: Record<string, LocatorDef> = {};
  for (const [k, v] of Object.entries(r.locators)) locators[k] = { ...v };
  const pages = r.pages.map((p) => ({ ...p, nodes: p.nodes.map((n) => ({ ...n })) }));
  let penalty = 0;
  const fail = (gate: number, message: string, w = 0.05) => {
    violations.push({ gate, message });
    penalty += w;
  };

  // 1 feature / slug
  const badStr = (s: unknown) => typeof s !== 'string' || !s.trim() || s.includes('[object');
  if (badStr(r.feature) || badStr(r.slug) || !/^[A-Za-z_]\w*$/.test(r.slug)) {
    fail(1, `feature/slug 非法：feature=${String(r.feature)} slug=${String(r.slug)}`, 0.3);
  }

  // 3 element_N 序号 key（locators / locator_key）
  const seqKey = /^element[_-]?\d+$/i;
  for (const k of Object.keys(locators)) {
    if (seqKey.test(k)) {
      fail(3, `序号 key「${k}」不是语义名`);
      locators[k].status = 'blocked';
    }
  }

  // 4 逗号并集 CSS
  for (const [k, d] of Object.entries(locators)) {
    if (d.css && hasCommaUnion(d.css)) {
      fail(4, `locator「${k}」css 含逗号并集（会触发 strict mode）：${d.css}`);
      locators[k].status = 'blocked';
    }
  }

  // 8 bound 定位需要证据：locator 自身有 evidence，或被其 bound 节点的 evidence 覆盖
  const keyNodeEvidence = new Map<string, number>();
  for (const p of pages) {
    for (const n of p.nodes) {
      if (n.locator_key && n.evidence?.length) keyNodeEvidence.set(n.locator_key, (keyNodeEvidence.get(n.locator_key) ?? 0) + n.evidence.length);
    }
  }
  for (const [k, d] of Object.entries(locators)) {
    if (d.status === 'blocked') continue;
    if (!d.evidence?.trim() && !keyNodeEvidence.get(k)) {
      fail(8, `locator「${k}」无任何 evidence`);
      locators[k].status = 'needs_review';
      gaps.push({ type: 'dynamic_dom', detail: `locator「${k}」缺少源码证据，已降为 needs_review`, suggested_action: 'probe_dom' });
    }
  }

  for (const p of pages) {
    for (const n of p.nodes) {
      // 6 custom 未展开不得 bound
      if (n.kind === 'custom' && n.locator_status === 'bound') {
        fail(6, `自定义组件 <${n.component}> 未展开却标记 bound（${n.id}）`);
        n.locator_status = 'unresolved_custom';
        gaps.push({ type: 'unresolved_custom', node_id: n.id, detail: `<${n.component}> 未展开，bound 被撤销`, suggested_action: 'follow_source' });
      }
      if (n.kind === 'c7n' && !CONTAINERS.has(n.component)) {
        // 2 c7n 叶子要么 bound（且 key 可解析）要么 needs_kit（unbound 视同 needs_kit）
        if (n.locator_status === 'bound') {
          const k = n.locator_key;
          if (!k || !(k in locators || ctx.kitKeys.has(k))) {
            fail(7, `节点 ${n.id} 的 locator_key「${k ?? ''}」既不在 locators 也不在 kit`);
            n.locator_status = 'needs_kit';
            gaps.push({ type: 'needs_kit', node_id: n.id, detail: `locator_key「${k ?? ''}」无定义`, suggested_action: 'add_kit' });
          } else if (k in locators && locators[k].status === 'blocked') {
            n.locator_status = 'needs_kit';
          }
        } else if (n.locator_status === 'unbound') {
          const own = gaps.find((g) => g.node_id === n.id);
          if (own) {
            // 已有明确缺口说明：按缺口类型落状态，不算违规
            n.locator_status = own.type === 'needs_kit' ? 'needs_kit' : own.type === 'unresolved_custom' ? 'unresolved_custom' : 'needs_probe';
          } else {
            fail(2, `c7n 节点 <${n.component}>（${n.id}）未绑定也未标 needs_kit`, 0.01);
            n.locator_status = 'needs_kit';
            gaps.push({ type: 'needs_kit', node_id: n.id, detail: `<${n.component}> 暂无定位绑定`, suggested_action: 'add_kit' });
          }
        }
        // 5 多实例同类：多个节点共用同一个 locator_key 且没有 within / nth / kit 消歧
        if (n.locator_status === 'bound' && n.locator_key && n.locator_key in locators) {
          const d = locators[n.locator_key];
          const shared = p.nodes.filter((m) => m !== n && m.kind === 'c7n' && m.locator_key === n.locator_key).length;
          const disamb = !!d.within || /nth=\d+/.test(d.css ?? '') || !!d.kit;
          if (shared && !disamb) {
            fail(5, `同类多实例 <${n.component}>（${n.id}）与其它节点共用 locator「${n.locator_key}」且缺少 within/nth`);
            n.locator_status = 'needs_probe';
            gaps.push({ type: 'ambiguous_multi_instance', node_id: n.id, detail: `共用 locator「${n.locator_key}」，缺少 within/区域`, suggested_action: 'probe_dom' });
          }
        }
      }
    }
  }

  const draft = deriveElementsDraft({ ...r, locators });
  // 7 elements_draft 与 locators 一致
  const given = Object.keys(r.elements_draft?.[r.slug] ?? {}).sort().join(',');
  const want = Object.keys(draft[r.slug] ?? {}).sort().join(',');
  if (r.elements_draft && Object.keys(r.elements_draft).length && given !== want) {
    fail(7, `elements_draft key 集合与 locators 不一致（已按 locators 重新推导）：模型=[${given}] 推导=[${want}]`, 0.02);
  }

  const result: PageLocateResult = {
    ...r,
    pages,
    locators,
    gaps: dedupeGaps(gaps),
    elements_draft: draft,
    elements_draft_namespace: r.slug,
    confidence: Math.max(0, Math.round(((typeof r.confidence === 'number' ? r.confidence : 0.5) - penalty) * 100) / 100),
  };
  return { result, violations };
}

function dedupeGaps(gs: LocGap[]): LocGap[] {
  const seen = new Set<string>();
  return gs.filter((g) => {
    const k = `${g.type}|${g.node_id ?? ''}|${g.detail}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
