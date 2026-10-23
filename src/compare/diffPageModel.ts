import type { PageModel } from '../core/schema.js';
import { deepEqual } from './deepEqual.js';

export type AttrDiff = { attr: string; before: unknown; after: unknown };
export type FieldChange = { name: string; change: 'added' | 'removed' | 'changed'; attrs: AttrDiff[] };
export type ObjectChange = { id: string; change: 'added' | 'removed' | 'changed'; attrs: AttrDiff[] };
export type FormChange = {
  id: string;
  change: 'added' | 'removed' | 'changed';
  attrs: AttrDiff[];
  fields: FieldChange[];
};

export type PageModelDiff = {
  /** 基线缺少 page_model（旧基线）时为 false：无法对比，需重存基线 */
  comparable: boolean;
  forms: FormChange[];
  tabs: ObjectChange[];
  buttons: ObjectChange[];
  drawers: ObjectChange[];
  tables: ObjectChange[];
};

const sortKey = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function diffFlat(b: Record<string, unknown> | undefined, a: Record<string, unknown> | undefined): AttrDiff[] {
  const keys = [...new Set([...Object.keys(b ?? {}), ...Object.keys(a ?? {})])].sort(sortKey);
  const out: AttrDiff[] = [];
  for (const attr of keys) {
    const x = b?.[attr];
    const y = a?.[attr];
    if (b && a && deepEqual(x, y)) continue;
    out.push({ attr, before: x, after: y });
  }
  return out;
}

type Field = PageModel['forms'][number]['fields'][number];

/** 字段的可比较属性摊平：control / props.* / ds.* / depends_on / derived_from */
function fieldAttrs(f: Field): Record<string, unknown> {
  const o: Record<string, unknown> = { control: f.control };
  for (const [k, v] of Object.entries(f.props ?? {})) o[`props.${k}`] = v;
  for (const [k, v] of Object.entries(f.ds_attrs ?? {})) o[`ds.${k}`] = v;
  if (f.depends_on) o.depends_on = f.depends_on;
  if (f.derived_from) o.derived_from = f.derived_from;
  return o;
}

function diffFields(before: Field[], after: Field[]): FieldChange[] {
  const mb = new Map(before.map((f) => [f.name, f]));
  const ma = new Map(after.map((f) => [f.name, f]));
  const out: FieldChange[] = [];
  for (const name of [...new Set([...mb.keys(), ...ma.keys()])].sort(sortKey)) {
    const b = mb.get(name);
    const a = ma.get(name);
    if (!b) out.push({ name, change: 'added', attrs: diffFlat(undefined, fieldAttrs(a!)) });
    else if (!a) out.push({ name, change: 'removed', attrs: diffFlat(fieldAttrs(b), undefined) });
    else {
      const attrs = diffFlat(fieldAttrs(b), fieldAttrs(a));
      if (attrs.length) out.push({ name, change: 'changed', attrs });
    }
  }
  return out;
}

function diffObjects<T extends { id: string }>(before: T[], after: T[], pick: (t: T) => Record<string, unknown>): ObjectChange[] {
  const mb = new Map(before.map((t) => [t.id, t]));
  const ma = new Map(after.map((t) => [t.id, t]));
  const out: ObjectChange[] = [];
  for (const id of [...new Set([...mb.keys(), ...ma.keys()])].sort(sortKey)) {
    const b = mb.get(id);
    const a = ma.get(id);
    if (!b) out.push({ id, change: 'added', attrs: [] });
    else if (!a) out.push({ id, change: 'removed', attrs: [] });
    else {
      const attrs = diffFlat(pick(b), pick(a));
      if (attrs.length) out.push({ id, change: 'changed', attrs });
    }
  }
  return out;
}

export function diffPageModel(before?: PageModel, after?: PageModel): PageModelDiff {
  if (!before || !after) {
    return { comparable: false, forms: [], tabs: [], buttons: [], drawers: [], tables: [] };
  }
  const mb = new Map(before.forms.map((f) => [f.id, f]));
  const ma = new Map(after.forms.map((f) => [f.id, f]));
  const forms: FormChange[] = [];
  for (const id of [...new Set([...mb.keys(), ...ma.keys()])].sort(sortKey)) {
    const b = mb.get(id);
    const a = ma.get(id);
    if (!b) forms.push({ id, change: 'added', attrs: [], fields: diffFields([], a!.fields) });
    else if (!a) forms.push({ id, change: 'removed', attrs: [], fields: diffFields(b.fields, []) });
    else {
      const attrs = diffFlat({ disabled: b.disabled, ds: b.ds }, { disabled: a.disabled, ds: a.ds });
      const fields = diffFields(b.fields, a.fields);
      if (attrs.length || fields.length) forms.push({ id, change: 'changed', attrs, fields });
    }
  }
  return {
    comparable: true,
    forms,
    tabs: diffObjects(before.tabs, after.tabs, (t) => ({ title: t.title })),
    buttons: diffObjects(before.buttons, after.buttons, (t) => ({
      text: t.text, icon: t.icon, disabled: t.disabled, permission: t.permission,
    })),
    drawers: diffObjects(before.drawers, after.drawers, (t) => ({ title: t.title })),
    tables: diffObjects(before.tables, after.tables, (t) => ({
      columns: t.columns.map((c) => `${c.name}${c.editor ? '*' : ''}`).sort(),
    })),
  };
}

export function pageModelChanged(d: PageModelDiff): boolean {
  return d.forms.length + d.tabs.length + d.buttons.length + d.drawers.length + d.tables.length > 0;
}
