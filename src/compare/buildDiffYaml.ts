import type { FeatureArtifact } from '../core/schema.js';
import type { ArtifactDiff } from './diffArtifact.js';
import type { SuiteCaseDiff } from './diffSuite.js';
import type { FlowChainDiff, ResolvedFlowStep } from './resolveFlow.js';
import type { OperationSchema } from '../core/schema.js';
import type { z } from 'zod';

type Operation = z.infer<typeof OperationSchema>;

/** 写入 diff 的精简步骤（去掉 index 冗余，便于 LLM 阅读） */
export type DiffFlowStep = Omit<ResolvedFlowStep, 'index'>;

export type CompareDiffDocument = {
  diff_version: '2';
  meta: {
    feature: string;
    slug: string;
    /** 固定语义：v1 侧 vs 功能目录根部 current */
    compare_mode: 'v1_vs_current';
    /** 比对主轴：完整测试流程链 */
    compare_axis: 'full_flow';
    baseline_label: string;
    baseline_created_at?: string;
    generated_at: string;
    logic_changed: boolean;
    suite_only_drift: boolean;
    sides: {
      baseline: { role: 'v1'; feature: string; suite?: string };
      current: { role: 'current'; feature: string; suite?: string };
    };
  };
  /** 主轴：每条测试流程的完整步骤链 before/after */
  flows: Array<{
    id: string;
    title: string;
    change_type: FlowChainDiff['change_type'];
    highlights: string[];
    before: DiffFlowStep[];
    after: DiffFlowStep[];
  }>;
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
    highlights: c.highlights,
    before: c.before.map(slimStep),
    after: c.after.map(slimStep),
  }));

  const doc: CompareDiffDocument = {
    diff_version: '2',
    meta: {
      feature: opts.feature,
      slug: opts.slug,
      compare_mode: 'v1_vs_current',
      compare_axis: 'full_flow',
      baseline_label: opts.baselineLabel,
      baseline_created_at: opts.baselineCreatedAt,
      generated_at: new Date().toISOString(),
      logic_changed: opts.logicChanged,
      suite_only_drift: opts.suiteOnlyDrift,
      sides: opts.sides,
    },
    flows,
  };

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
