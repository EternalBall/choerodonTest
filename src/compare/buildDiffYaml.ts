import type { FeatureArtifact } from '../core/schema.js';
import type { ArtifactDiff } from './diffArtifact.js';
import type { FieldDiffItem, ListDiffItem } from './diffFields.js';
import type { SuiteCaseDiff } from './diffSuite.js';
import type { FlowChainDiff, ResolvedFlowStep, StepChange } from './resolveFlow.js';
import type { PageModelDiff } from './diffPageModel.js';
import type { OperationSchema } from '../core/schema.js';
import type { z } from 'zod';

export type FieldDiffItemWithFlows = FieldDiffItem & { linked_flows?: string[] };

type Operation = z.infer<typeof OperationSchema>;

/** 写入 diff 的精简步骤（去掉 index 冗余，便于 LLM 阅读） */
export type DiffFlowStep = Omit<ResolvedFlowStep, 'index'>;

export type CompareDiffDocument = {
  diff_version: '3';
  meta: {
    feature: string;
    slug: string;
    /** 固定语义：v1 侧 vs 功能目录根部 current */
    compare_mode: 'v1_vs_current';
    /** 比对主轴：完整测试流程链 */
    compare_axis: 'full_flow';
    baseline_label: string;
    baseline_created_at?: string;
    /** 基线来自 ata/ 版本时记录来源（ata 根目录与版本号）；v1 基线流程不出现 */
    baseline_source?: { type: 'ata'; path: string; version: string };
    generated_at: string;
    logic_changed: boolean;
    suite_only_drift: boolean;
    sides: {
      baseline: { role: 'v1' | 'ata'; feature: string; suite?: string };
      current: { role: 'current'; feature: string; suite?: string };
    };
  };
  /** 主轴：每条测试流程的完整步骤链 before/after */
  flows: Array<{
    id: string;
    title: string;
    change_type: FlowChainDiff['change_type'];
    /** 整条流程新增/删除，可能只是分析波动，需结合源码确认 */
    unconfirmed?: boolean;
    highlights: string[];
    step_changes?: StepChange[];
    stale_reasons?: string[];
    /** 关联到本流程、未挂到具体步骤的 field_facts */
    field_facts?: FieldDiffItem[];
    before: DiffFlowStep[];
    after: DiffFlowStep[];
  }>;
  /** 页面结构变更：表单/字段/页签/按钮/抽屉/表格（静态提取，确定性）；基线缺模型时 comparable=false */
  structure?: PageModelDiff;
  /** 辅轴：能力摘要变更（简要） */
  operations?: {
    added: Array<{ id: string; name: string }>;
    removed: Array<{ id: string; name: string }>;
    changed: Array<{
      id: string;
      fields: Array<{ field: string; before: unknown; after: unknown }>;
    }>;
  };
  /** 配套模型 / 入口（仅有变更时出现） */
  supporting?: {
    entry?: { before: FeatureArtifact['entry']; after: FeatureArtifact['entry'] };
    page_states?: boolean;
    field_rules?: boolean;
    validations?: boolean;
  };
  /** 字段级变更（仅有变更时出现）：字段事实 + 字段规则/校验/页面状态逐项 diff */
  fields?: {
    field_facts: FieldDiffItemWithFlows[];
    field_rules: ListDiffItem[];
    validations: ListDiffItem[];
    page_states: ListDiffItem[];
  };
  /** 编译用例辅助（不作为逻辑主结论） */
  suite?: {
    added: string[];
    removed: string[];
    changed: string[];
  };
};

function pickOpField(op: Operation, field: string): unknown {
  return (op as Record<string, unknown>)[field];
}

function slimStep(s: ResolvedFlowStep): DiffFlowStep {
  const { index: _i, ...rest } = s;
  return rest;
}

export function buildDiffYaml(opts: {
  feature: string;
  slug: string;
  baselineLabel: string;
  baselineCreatedAt?: string;
  baselineSource?: { type: 'ata'; path: string; version: string };
  beforeArtifact: FeatureArtifact;
  afterArtifact: FeatureArtifact;
  artifactDiff: ArtifactDiff;
  suiteDiff?: SuiteCaseDiff;
  logicChanged: boolean;
  suiteOnlyDrift: boolean;
  sides: CompareDiffDocument['meta']['sides'];
}): CompareDiffDocument {
  const flows = opts.artifactDiff.flow_chains.map((c) => ({
    id: c.id,
    title: c.title,
    change_type: c.change_type,
    ...(c.unconfirmed ? { unconfirmed: true } : {}),
    highlights: c.highlights,
    ...(c.step_changes ? { step_changes: c.step_changes } : {}),
    ...(c.stale_reasons ? { stale_reasons: c.stale_reasons } : {}),
    ...(c.field_facts?.length ? { field_facts: c.field_facts } : {}),
    before: c.before.map(slimStep),
    after: c.after.map(slimStep),
  }));

  const doc: CompareDiffDocument = {
    diff_version: '3',
    meta: {
      feature: opts.feature,
      slug: opts.slug,
      compare_mode: 'v1_vs_current',
      compare_axis: 'full_flow',
      baseline_label: opts.baselineLabel,
      baseline_created_at: opts.baselineCreatedAt,
      ...(opts.baselineSource ? { baseline_source: opts.baselineSource } : {}),
      generated_at: new Date().toISOString(),
      logic_changed: opts.logicChanged,
      suite_only_drift: opts.suiteOnlyDrift,
      sides: opts.sides,
    },
    flows,
  };

  const pm = opts.artifactDiff.page_model;
  if (!pm.comparable || pm.forms.length || pm.tabs.length || pm.buttons.length || pm.drawers.length || pm.tables.length || pm.panels.length) {
    doc.structure = pm;
  }

  const op = opts.artifactDiff.operations;
  if (op.added.length || op.removed.length || op.changed.length) {
    doc.operations = {
      added: op.added.map((o) => ({ id: o.id, name: o.name })),
      removed: op.removed.map((o) => ({ id: o.id, name: o.name })),
      changed: op.changed.map((c) => ({
        id: c.id,
        fields: c.fields.map((field) => ({
          field,
          before: pickOpField(c.before, field),
          after: pickOpField(c.after, field),
        })),
      })),
    };
  }

  const supporting: NonNullable<CompareDiffDocument['supporting']> = {};
  if (opts.artifactDiff.entry.changed) {
    supporting.entry = {
      before: opts.beforeArtifact.entry,
      after: opts.afterArtifact.entry,
    };
  }
  if (opts.artifactDiff.page_states.changed) supporting.page_states = true;
  if (opts.artifactDiff.field_rules.changed) supporting.field_rules = true;
  if (opts.artifactDiff.validations.changed) supporting.validations = true;
  if (Object.keys(supporting).length) doc.supporting = supporting;

  const d = opts.artifactDiff;
  if (
    d.field_facts.length ||
    d.field_rules_items.length ||
    d.validations_items.length ||
    d.page_states_items.length
  ) {
    const flowByFact = new Map<string, string[]>();
    for (const chain of d.flow_chains) {
      const keys = [
        ...(chain.field_facts ?? []).map((f) => f.key),
        ...(chain.step_changes ?? []).flatMap((s) => (s.field_facts ?? []).map((f) => f.key)),
      ];
      for (const k of keys) {
        const list = flowByFact.get(k) ?? [];
        if (!list.includes(chain.id)) list.push(chain.id);
        flowByFact.set(k, list);
      }
    }
    doc.fields = {
      field_facts: d.field_facts.map((f) => {
        const linked = flowByFact.get(f.key);
        return linked?.length ? { ...f, linked_flows: linked } : f;
      }),
      field_rules: d.field_rules_items,
      validations: d.validations_items,
      page_states: d.page_states_items,
    };
  }

  if (opts.suiteDiff) {
    const s = opts.suiteDiff;
    if (s.added.length || s.removed.length || s.changed.length) {
      doc.suite = {
        added: s.added,
        removed: s.removed,
        changed: s.changed.map((c) => c.id),
      };
    }
  }

  return doc;
}
