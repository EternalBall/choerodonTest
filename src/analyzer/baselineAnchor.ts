import fs from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { featureBaselineDir } from '../compare/paths.js';
import { featureOutputSlug } from '../core/featurePaths.js';
import { logger } from '../core/logger.js';
import type { FeatureArtifact } from '../core/schema.js';

/**
 * 基线锚定：让“改动前后两次分析”的 id 与结构保持一致，对比才只剩真实改动。
 *
 * 做法两层：
 * 1. 提示词里带上基线（v1）的页面、操作、步骤骨架，要求未变化处原样沿用；
 * 2. 分析后确定性对齐：LLM 仍改了 id 的操作，按（类型, 页面, 接口/名称）唯一匹配回基线 id，
 *    并按“基线顺序在前、新增在后（按 id 字母序）”固定排序。
 */

type Op = FeatureArtifact['operations'][number];

export async function loadBaselineArtifact(
  feature: string,
  label = 'v1',
): Promise<FeatureArtifact | undefined> {
  const dir = featureBaselineDir(featureOutputSlug(feature), label);
  try {
    const text = await fs.readFile(path.join(dir, 'feature.yaml'), 'utf8');
    const y = parse(text) as FeatureArtifact;
    return y && Array.isArray(y.operations) ? y : undefined;
  } catch {
    return undefined;
  }
}

/** 提示词用的基线骨架：只放 id/类型/页面/接口/步骤要点，不放长文本 */
export function formatBaselineForPrompt(base: FeatureArtifact): string {
  const skeleton = {
    pages: (base.pages ?? []).map((p) => ({ id: p.id, route: p.route })),
    operations: base.operations.map((o) => ({
      id: o.id,
      type: o.type,
      name: o.name,
      page_id: o.page_id,
      api: o.api,
      steps: (o.steps ?? []).map((s) => ({ kind: s.kind, name: s.name, page_id: s.page_id, element: s.element, api: s.api })),
    })),
    elements_hints: base.elements_hints ?? [],
    field_rules: (base.field_rules ?? []).map((r) => ({
      name: r.name,
      label: r.label,
      control: r.control,
      editable_when: r.editable_when,
      readonly_when: r.readonly_when,
      row_gate: r.row_gate,
    })),
  };
  return [
    '【基线分析（沿用，非本次输入）】',
    '下面是改动前的分析骨架。要求：',
    '1. pages[].id、operations[].id、steps 的 kind/element 顺序，凡基线已有且源码未体现变化的，必须原样沿用，禁止改名、拆分、合并、重排；',
    '2. 只有源码中确有证据的增、删、改才允许与基线不同；新增 operation 的 id 沿用基线的命名风格；',
    '3. 不要因为表述习惯不同而重写基线已有内容；',
    '4. 沿用基线 step 时必须保留其 page_id（goto 必须带 page_id）；沿用基线元素名时，elements_hints 里要给出同名定义（基线已有的可原样沿用）。',
    JSON.stringify(skeleton),
  ].join('\n');
}

const norm = (s?: string) => (s ?? '').trim().toLowerCase();

/** 对齐键：接口优先，其次类型+页面+名称 */
function matchKeys(o: Op): string[] {
  const keys: string[] = [];
  if (o.api) keys.push(`api|${o.type}|${norm(o.api)}`);
  keys.push(`name|${o.type}|${norm(o.page_id)}|${norm(o.name)}`);
  return keys;
}

export type AnchorReport = { renamed: { from: string; to: string }[]; added: string[]; removed: string[] };

/** 把 LLM 改了 id 的操作映射回基线 id（唯一匹配才改），并固定排序 */
export function anchorToBaseline(
  artifact: FeatureArtifact,
  base: FeatureArtifact,
): { artifact: FeatureArtifact; report: AnchorReport } {
  const baseIds = new Set(base.operations.map((o) => o.id));
  const index = new Map<string, Op[]>();
  for (const o of base.operations) {
    for (const k of matchKeys(o)) index.set(k, [...(index.get(k) ?? []), o]);
  }
  const used = new Set(artifact.operations.filter((o) => baseIds.has(o.id)).map((o) => o.id));
  const renamed: AnchorReport['renamed'] = [];

  const ops = artifact.operations.map((o) => {
    if (baseIds.has(o.id)) return o;
    for (const k of matchKeys(o)) {
      const cands = (index.get(k) ?? []).filter((c) => !used.has(c.id));
      if (cands.length === 1) {
        used.add(cands[0]!.id);
        renamed.push({ from: o.id, to: cands[0]!.id });
        return { ...o, id: cands[0]!.id };
      }
    }
    return o;
  });

  const order = new Map(base.operations.map((o, i) => [o.id, i]));
  ops.sort((a, b) => {
    const ia = order.get(a.id);
    const ib = order.get(b.id);
    if (ia !== undefined && ib !== undefined) return ia - ib;
    if (ia !== undefined) return -1;
    if (ib !== undefined) return 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const curIds = new Set(ops.map((o) => o.id));
  const report: AnchorReport = {
    renamed,
    added: ops.filter((o) => !baseIds.has(o.id)).map((o) => o.id),
    removed: base.operations.filter((o) => !curIds.has(o.id)).map((o) => o.id),
  };
  logger.info(report, '基线锚定完成');
  return { artifact: { ...artifact, operations: ops }, report };
}

export type RepairReport = { filledPageIds: string[]; reusedElements: string[] };

/**
 * 编译前兜底：模型沿用基线骨架时可能漏写 goto 的 page_id、漏带元素定义，导致步骤校验整体回退模板。
 * 1. goto 缺 page_id 且所属能力有 page_id → 用能力的 page_id 补上（不覆盖已有值）；
 * 2. step/requires 引用的元素在当前 elements_hints 缺失、基线里有同名定义 → 从基线补入，并写入 risks 留痕。
 * 其余校验规则不放宽，补全后仍不合格的照常回退。
 */
export function repairFromBaseline(
  artifact: FeatureArtifact,
  base: FeatureArtifact,
): { artifact: FeatureArtifact; report: RepairReport } {
  const refName = (ref: string) => (ref.includes('.') ? ref.split('.').pop()! : ref);
  const have = new Set((artifact.elements_hints ?? []).map((h) => refName(h.ref)));
  const baseHints = new Map((base.elements_hints ?? []).map((h) => [refName(h.ref), h]));
  const filledPageIds: string[] = [];
  const reused = new Map<string, NonNullable<FeatureArtifact['elements_hints']>[number]>();

  const operations = artifact.operations.map((op) => {
    if (!op.steps?.length) return op;
    const steps = op.steps.map((s, i) => {
      if (s.kind === 'goto' && !s.page_id && op.page_id) {
        filledPageIds.push(`${op.id}#${i + 1}`);
        s = { ...s, page_id: op.page_id };
      }
      for (const name of [s.element, s.requires]) {
        if (name && !have.has(name) && !reused.has(name) && baseHints.has(name)) reused.set(name, baseHints.get(name)!);
      }
      return s;
    });
    return { ...op, steps };
  });

  const reusedElements = [...reused.keys()];
  const rs = artifact.review_suggestions;
  const next: FeatureArtifact = {
    ...artifact,
    operations,
    ...(reused.size ? { elements_hints: [...(artifact.elements_hints ?? []), ...reused.values()] } : {}),
    ...(reused.size && rs
      ? { review_suggestions: { ...rs, risks: [...(rs.risks ?? []), ...reusedElements.map((n) => `元素定义沿用基线：${n}`)] } }
      : {}),
  };
  if (filledPageIds.length || reusedElements.length) logger.info({ filledPageIds, reusedElements }, '基线兜底补全');
  return { artifact: next, report: { filledPageIds, reusedElements } };
}

/**
 * 字段规则以静态提取为准：可编辑字段（editable_when 非空）若源码里没有任何实际渲染的控件
 *（JSX name 属性 / 带 editor 的列），则从 field_rules 和各处 fields 列表中剔除。
 * rendered 为空（未提取到任何控件）时不处理，避免误删。
 */
export function pruneUnrenderedFields(
  artifact: FeatureArtifact,
  rendered: string[],
): { artifact: FeatureArtifact; dropped: string[] } {
  if (!rendered.length) return { artifact, dropped: [] };
  const ok = new Set(rendered);
  // 被当作可编辑目标的字段：规则里 editable_when 非空，或出现在任一 fields 列表（fill_form 目标 / 操作字段集）
  const targets = new Set(
    (artifact.field_rules ?? []).filter((r) => (r.editable_when?.length ?? 0) > 0).map((r) => r.name),
  );
  const collect = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(collect);
    else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        if (k === 'fields' && Array.isArray(x) && x.every((i) => typeof i === 'string')) {
          (x as string[]).forEach((i) => targets.add(i));
        } else collect(x);
      }
    }
  };
  collect(artifact.operations);
  collect(artifact.meta_ops);
  const dropped = [...targets].filter((n) => !ok.has(n)).sort();
  if (!dropped.length) return { artifact, dropped };
  const bad = new Set(dropped);
  const strip = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(strip);
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>).map(([k, x]) =>
          k === 'fields' && Array.isArray(x) && x.every((i) => typeof i === 'string')
            ? [k, (x as string[]).filter((i) => !bad.has(i))]
            : [k, strip(x)],
        ),
      );
    }
    return v;
  };
  const next = strip({
    ...artifact,
    field_rules: (artifact.field_rules ?? []).filter((r) => !bad.has(r.name)),
  }) as FeatureArtifact;
  logger.info({ dropped }, '字段规则剔除：源码中无实际渲染控件');
  return {
    artifact: { ...next, notes: [...(next.notes ?? []), `静态提取：以下字段源码未渲染，已从字段规则剔除：${dropped.join(', ')}`] },
    dropped,
  };
}
