import type { FeatureArtifact } from '../core/schema.js';
import type { ArtifactDiff } from './diffArtifact.js';
import type { SuiteCaseDiff } from './diffSuite.js';
import type { OperationSchema } from '../core/schema.js';
import type { z } from 'zod';

type Operation = z.infer<typeof OperationSchema>;

export type CompareDiffDocument = {
  diff_version: '1';
  meta: {
    feature: string;
    slug: string;
    /** 固定语义：v1 侧 vs 功能目录根部 current */
    compare_mode: 'v1_vs_current';
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
  path: {
    entry?: { before: FeatureArtifact['entry']; after: FeatureArtifact['entry'] };
    operations: {
      added: Operation[];
      removed: Operation[];
      changed: Array<{
        id: string;
        fields: Array<{ field: string; before: unknown; after: unknown }>;
      }>;
      unchanged_ids: string[];
    };
    meta_ops: {
      added: ArtifactDiff['meta_ops']['added'];
      removed: ArtifactDiff['meta_ops']['removed'];
      changed: Array<{
        id: string;
        before: ArtifactDiff['meta_ops']['changed'][number]['before'];
        after: ArtifactDiff['meta_ops']['changed'][number]['after'];
      }>;
      unchanged_ids: string[];
    };
    flows: {
      added: ArtifactDiff['flows']['added'];
      removed: ArtifactDiff['flows']['removed'];
      sequence_changed: ArtifactDiff['flows']['sequenceChanged'];
      unchanged_ids: string[];
    };
    page_states?: { before: FeatureArtifact['page_states']; after: FeatureArtifact['page_states'] };
    field_rules?: { before: FeatureArtifact['field_rules']; after: FeatureArtifact['field_rules'] };
    validations?: { before: FeatureArtifact['validations']; after: FeatureArtifact['validations'] };
  };
  suite?: SuiteCaseDiff;
};

function pickOpField(op: Operation, field: string): unknown {
  return (op as Record<string, unknown>)[field];
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
  const operationsChanged = opts.artifactDiff.operations.changed.map((c) => ({
    id: c.id,
    fields: c.fields.map((field) => ({
      field,
      before: pickOpField(c.before, field),
      after: pickOpField(c.after, field),
    })),
  }));

  const doc: CompareDiffDocument = {
    diff_version: '1',
    meta: {
      feature: opts.feature,
      slug: opts.slug,
      compare_mode: 'v1_vs_current',
      baseline_label: opts.baselineLabel,
      baseline_created_at: opts.baselineCreatedAt,
      generated_at: new Date().toISOString(),
      logic_changed: opts.logicChanged,
      suite_only_drift: opts.suiteOnlyDrift,
      sides: opts.sides,
    },
    path: {
      operations: {
        added: opts.artifactDiff.operations.added,
        removed: opts.artifactDiff.operations.removed,
        changed: operationsChanged,
        unchanged_ids: opts.artifactDiff.operations.unchanged,
      },
      meta_ops: {
        added: opts.artifactDiff.meta_ops.added,
        removed: opts.artifactDiff.meta_ops.removed,
        changed: opts.artifactDiff.meta_ops.changed.map((c) => ({
          id: c.id,
          before: c.before,
          after: c.after,
        })),
        unchanged_ids: opts.artifactDiff.meta_ops.unchanged,
      },
      flows: {
        added: opts.artifactDiff.flows.added,
        removed: opts.artifactDiff.flows.removed,
        sequence_changed: opts.artifactDiff.flows.sequenceChanged,
        unchanged_ids: opts.artifactDiff.flows.unchanged,
      },
    },
  };

  if (opts.artifactDiff.entry.changed) {
    doc.path.entry = { before: opts.beforeArtifact.entry, after: opts.afterArtifact.entry };
  }
  if (opts.artifactDiff.page_states.changed) {
    doc.path.page_states = {
      before: opts.beforeArtifact.page_states,
      after: opts.afterArtifact.page_states,
    };
  }
  if (opts.artifactDiff.field_rules.changed) {
    doc.path.field_rules = {
      before: opts.beforeArtifact.field_rules,
      after: opts.afterArtifact.field_rules,
    };
  }
  if (opts.artifactDiff.validations.changed) {
    doc.path.validations = {
      before: opts.beforeArtifact.validations,
      after: opts.afterArtifact.validations,
    };
  }
  if (opts.suiteDiff) {
    doc.suite = opts.suiteDiff;
  }

  return doc;
}
