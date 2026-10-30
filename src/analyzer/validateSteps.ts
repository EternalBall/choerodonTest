import { MetaOpKindSchema } from '../core/schema.js';
import type { FeatureArtifact } from '../core/schema.js';

type Operation = FeatureArtifact['operations'][number];

export type StepIssue = { op: string; step?: number; message: string };

export type ValidatedStep = {
  kind: (typeof MetaOpKindSchema)['options'][number];
  name: string;
  page_id?: string;
  element?: string;
  api?: string;
  args?: Record<string, unknown>;
  note?: string;
  requires?: string;
};

const NEEDS_ELEMENT = new Set(['click', 'click_expect_api']);

function normApi(a: string): string {
  return a.replace(/\$\{[^}]*\}/g, '{p}').replace(/\{[^}]*\}/g, '{p}').replace(/\?.*$/, '').replace(/\/+$/, '');
}

/**
 * 模型有时在 step 里写 elements_hints 的完整 ref（如 dispatch.saveBtn），而元素名约定取最后一段（saveBtn）。
 * 仅当 element / requires 恰好等于某条 hint 的完整 ref 时才去掉前缀，其余原样保留，仍交给校验。
 */
export function normalizeStepElementRefs(artifact: FeatureArtifact): FeatureArtifact {
  const full = new Map<string, string>();
  for (const h of artifact.elements_hints ?? []) {
    if (h.ref.includes('.') && !h.ref.includes('|')) full.set(h.ref, h.ref.split('.').pop()!);
  }
  if (!full.size) return artifact;
  const fix = (v?: string) => (v && full.has(v) ? full.get(v) : v);
  return {
    ...artifact,
    operations: (artifact.operations ?? []).map((op) =>
      op.steps?.length
        ? { ...op, steps: op.steps.map((s) => ({ ...s, element: fix(s.element), requires: fix(s.requires) })) }
        : op,
    ),
  };
}

/** 收集产物里所有「有定义来源」的元素名：hints、控件、字段规则 + 外部传入的平台 kit/功能层键 */
export function collectKnownElements(artifact: FeatureArtifact, extra: Iterable<string> = []): Set<string> {
  const known = new Set<string>(extra);
  for (const h of artifact.elements_hints ?? []) {
    known.add(h.ref.includes('.') && !h.ref.includes('|') ? h.ref.split('.').pop()! : h.ref);
  }
  for (const e of artifact.page_edges ?? []) if (e.control?.element) known.add(e.control.element);
  for (const op of artifact.operations ?? []) {
    if (op.entry_control?.element) known.add(op.entry_control.element);
    if (op.row_target?.element) known.add(op.row_target.element);
    if (op.row_target?.cell_element) known.add(op.row_target.cell_element);
  }
  for (const r of artifact.field_rules ?? []) {
    known.add(r.name);
    known.add(`${r.name}Open`);
  }
  return known;
}

/**
 * 校验大模型给出的 steps：kind 白名单、首步 goto、元素有定义、接口可在源码清单中核对。
 * 任一硬错误 → ok=false（调用方回退规则模板）。
 */
export function validateOperationSteps(
  op: Operation,
  artifact: FeatureArtifact,
  known?: Set<string>,
): { ok: boolean; steps: ValidatedStep[]; issues: StepIssue[] } {
  const issues: StepIssue[] = [];
  const raw = op.steps ?? [];
  const steps: ValidatedStep[] = [];
  const pageIds = new Set((artifact.pages ?? []).map((p) => p.id));
  const apis = (artifact.apis ?? []).map(normApi);
  if (op.api) apis.push(normApi(op.api));

  raw.forEach((s, i) => {
    const err = (message: string) => issues.push({ op: op.id, step: i, message });
    const kind = MetaOpKindSchema.safeParse(s.kind);
    if (!kind.success) {
      err(`kind「${s.kind}」不在白名单内`);
      return;
    }
    if (s.page_id && !pageIds.has(s.page_id)) err(`page_id「${s.page_id}」不在 pages 中`);
    if (kind.data === 'goto') {
      const page = (artifact.pages ?? []).find((p) => p.id === s.page_id);
      if (!s.page_id) err('goto 缺 page_id');
      else if (page?.route?.includes(':')) err(`页面「${s.page_id}」路由带路径参数，不能直接 goto，应先到列表再 open_detail/点链接`);
    }
    if (NEEDS_ELEMENT.has(kind.data) && !s.element) err(`${kind.data} 缺 element`);
    if (s.element && known && !known.has(s.element)) {
      err(`element「${s.element}」在 kit/hints/控件定义中找不到`);
    }
    if (kind.data === 'click_expect_api') {
      if (!s.api) err('click_expect_api 缺 api');
      else if (!apis.includes(normApi(s.api))) err(`api「${s.api}」不在 apis[] / op.api 中，疑似编造`);
    }
    if (s.requires && known && !known.has(s.requires)) {
      err(`requires「${s.requires}」在 kit/hints/控件定义中找不到`);
    }
    steps.push({
      requires: s.requires,
      kind: kind.data,
      name: s.name,
      page_id: s.page_id,
      element: s.element,
      api: s.api,
      args: s.args,
      note: [s.note, s.evidence ? `依据:${s.evidence}` : ''].filter(Boolean).join('；') || undefined,
    });
  });

  if (!steps.length) issues.push({ op: op.id, message: 'steps 为空' });
  else if (steps[0]!.kind !== 'goto') issues.push({ op: op.id, step: 0, message: '第一步必须是 goto' });
  return { ok: issues.length === 0, steps, issues };
}
