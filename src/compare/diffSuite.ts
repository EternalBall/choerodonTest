import type { CaseDef, Suite } from '../core/schema.js';
import { deepEqual } from './deepEqual.js';

export type NormalizedStep = {
  action: string;
  name: string;
  argsSummary: string;
};

export type SuiteCaseDiff = {
  added: string[];
  removed: string[];
  changed: { id: string; before: NormalizedStep[]; after: NormalizedStep[] }[];
  unchanged: string[];
};

export function normalizeStep(step: CaseDef['steps'][number]): NormalizedStep {
  const args = step.args ?? {};
  const parts: string[] = [];
  for (const key of ['target', 'path', 'urlIncludes', 'successUrlIncludes', 'filterBar', 'table']) {
    if (args[key] !== undefined) parts.push(`${key}=${JSON.stringify(args[key])}`);
  }
  if (!parts.length && Object.keys(args).length) {
    parts.push(JSON.stringify(args));
  }
  return { action: step.action, name: step.name, argsSummary: parts.join(' ') };
}

export function diffSuites(before: Suite | undefined, after: Suite | undefined): SuiteCaseDiff {
  const mapA = new Map((before?.cases ?? []).map((c) => [c.id, c]));
  const mapB = new Map((after?.cases ?? []).map((c) => [c.id, c]));
  const added: string[] = [];
  const removed: string[] = [];
  const changed: SuiteCaseDiff['changed'] = [];
  const unchanged: string[] = [];

  for (const id of mapB.keys()) {
    if (!mapA.has(id)) added.push(id);
  }
  for (const id of mapA.keys()) {
    if (!mapB.has(id)) removed.push(id);
  }
  for (const [id, left] of mapA) {
    const right = mapB.get(id);
    if (!right) continue;
    const stepsA = left.steps.map(normalizeStep);
    const stepsB = right.steps.map(normalizeStep);
    if (deepEqual(stepsA, stepsB)) unchanged.push(id);
    else changed.push({ id, before: stepsA, after: stepsB });
  }
  return { added, removed, changed, unchanged };
}
