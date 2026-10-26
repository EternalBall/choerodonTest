import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { FeatureArtifact } from '../../src/core/schema.js';
import type { FieldDiffItem } from '../../src/compare/diffFields.js';
import {
  attachFieldFactsToFlows,
  factMatchesFlow,
  flowReferencedNames,
  linkedFieldFactKeys,
  normDs,
} from '../../src/compare/linkFieldFacts.js';
import type { FlowChainDiff, ResolvedFlowStep } from '../../src/compare/resolveFlow.js';

const step = (partial: Partial<ResolvedFlowStep> & Pick<ResolvedFlowStep, 'kind' | 'meta_op_id'>): ResolvedFlowStep => ({
  index: 0,
  node_id: partial.meta_op_id,
  name: partial.meta_op_id,
  ...partial,
});

describe('linkFieldFacts', () => {
  it('normDs 忽略大小写与 .current', () => {
    assert.equal(normDs('detailDs'), 'detailds');
    assert.equal(normDs('detailDS.current'), 'detailds');
  });

  it('flowReferencedNames 合并步骤与 operation 字段', () => {
    const names = flowReferencedNames(
      [step({ kind: 'fill_form', meta_op_id: 'f', args: { fields: ['a', 'b'] } })],
      ['b', 'c'],
    );
    assert.deepEqual([...names].sort(), ['a', 'b', 'c']);
  });

  it('factMatchesFlow：按字段名命中，并受数据集约束；queryFields 不挂到非查询流程', () => {
    const fact: FieldDiffItem = {
      key: 'detailDS::fields::businessType',
      ds: 'detailDS',
      group: 'fields',
      name: 'businessType',
      change: 'changed',
      attrs: [{ attr: 'lookupUrl', before: 'A', after: 'B' }],
    };
    assert.equal(factMatchesFlow(fact, new Set(['businessType']), new Set(), false), true);
    assert.equal(factMatchesFlow(fact, new Set(['businessType']), new Set(['detailds']), false), true);
    assert.equal(factMatchesFlow(fact, new Set(['businessType']), new Set(['tableds']), false), false);
    assert.equal(factMatchesFlow(fact, new Set(['other']), new Set(['detailds']), false), false);
    const qf: FieldDiffItem = {
      key: 'tableDS::queryFields::tagGroupType',
      ds: 'tableDS',
      group: 'queryFields',
      name: 'tagGroupType',
      change: 'changed',
      attrs: [],
    };
    assert.equal(factMatchesFlow(qf, new Set(['tagGroupType']), new Set(['tableds']), false), false);
  });

  it('factMatchesFlow：查询流程只挂 queryFields', () => {
    const fact: FieldDiffItem = {
      key: 'tableDS::queryFields::status',
      ds: 'tableDS',
      group: 'queryFields',
      name: 'status',
      change: 'changed',
      attrs: [],
    };
    assert.equal(factMatchesFlow(fact, new Set(), new Set(['tableds']), true), true);
    assert.equal(
      factMatchesFlow(
        { ...fact, group: 'fields', key: 'tableDS::fields::status', name: 'status' },
        new Set(['status']),
        new Set(['tableds']),
        true,
      ),
      false,
    );
  });

  it('attachFieldFactsToFlows：挂到 fill_form 步骤并升为 modified', () => {
    const facts: FieldDiffItem[] = [
      {
        key: 'detailDS::fields::businessType',
        ds: 'detailDS',
        group: 'fields',
        name: 'businessType',
        change: 'changed',
        attrs: [{ attr: 'lookupUrl', before: 'old', after: 'new' }],
      },
      {
        key: 'dataItemTableDS::fields::collectionMethod',
        ds: 'dataItemTableDS',
        group: 'fields',
        name: 'collectionMethod',
        change: 'changed',
        attrs: [{ attr: 'lookupUrl', before: 'old', after: 'new' }],
      },
    ];
    const create: FlowChainDiff = {
      id: 'detail_create',
      title: '新建',
      change_type: 'unchanged',
      highlights: [],
      before: [
        step({ kind: 'goto', meta_op_id: 'g' }),
        step({ kind: 'fill_form', meta_op_id: 'fill', args: { fields: ['businessType', 'tagGroupCode'] } }),
      ],
      after: [
        step({ kind: 'goto', meta_op_id: 'g' }),
        step({ kind: 'fill_form', meta_op_id: 'fill', args: { fields: ['businessType', 'tagGroupCode'] } }),
      ],
    };
    const itemUpdate: FlowChainDiff = {
      id: 'data_item_update',
      title: '编辑数据项',
      change_type: 'unchanged',
      highlights: [],
      before: [step({ kind: 'fill_form', meta_op_id: 'fill', args: { fields: ['collectionMethod'] } })],
      after: [step({ kind: 'fill_form', meta_op_id: 'fill', args: { fields: ['collectionMethod'] } })],
    };
    const art = {
      operations: [
        { id: 'detail_create', name: '新建', type: 'create', fields: ['businessType'] },
        { id: 'data_item_update', name: '编辑数据项', type: 'update' },
      ],
      field_facts: [
        { ds: 'detailDS', group: 'fields', name: 'businessType', file: 'a', attrs: {} },
        { ds: 'dataItemTableDS', group: 'fields', name: 'collectionMethod', file: 'a', attrs: {} },
      ],
      page_model: {
        forms: [{ id: 'f1', ds: 'detailDs', fields: [{ name: 'businessType', control: 'Select' }] }],
        tabs: [],
        buttons: [],
        drawers: [],
        tables: [{ id: 't1', ds: 'dataItemTableDs' }],
        panels: [],
      },
    } as unknown as FeatureArtifact;

    const [outCreate, outItem] = attachFieldFactsToFlows([create, itemUpdate], facts, art, art);
    assert.equal(outCreate!.change_type, 'modified');
    const fill = outCreate!.step_changes?.find((c) => c.key.startsWith('fill_form:'));
    assert.ok(fill?.field_facts?.some((f) => f.name === 'businessType'));
    assert.ok(linkedFieldFactKeys([outCreate!]).has('detailDS::fields::businessType'));
    assert.equal(outItem!.change_type, 'modified');
    assert.ok(linkedFieldFactKeys([outItem!]).has('dataItemTableDS::fields::collectionMethod'));
  });

  it('attachFieldFactsToFlows：list_query 挂 queryFields 到 filter_query', () => {
    const facts: FieldDiffItem[] = [
      {
        key: 'tableDS::queryFields::status',
        ds: 'tableDS',
        group: 'queryFields',
        name: 'status',
        change: 'changed',
        attrs: [{ attr: 'lookupUrl', before: 'a', after: 'b' }],
      },
    ];
    const chain: FlowChainDiff = {
      id: 'list_query',
      title: '列表查询',
      change_type: 'unchanged',
      highlights: [],
      before: [
        step({ kind: 'goto', meta_op_id: 'g' }),
        step({ kind: 'filter_query', meta_op_id: 'q' }),
      ],
      after: [
        step({ kind: 'goto', meta_op_id: 'g' }),
        step({ kind: 'filter_query', meta_op_id: 'q' }),
      ],
    };
    const art = {
      operations: [{ id: 'list_query', name: '列表查询', type: 'query', fields: ['status'] }],
      page_model: {
        forms: [],
        tabs: [],
        buttons: [],
        drawers: [],
        tables: [{ id: 'index/page/tableDs', ds: 'tableDs' }],
        panels: [],
      },
    } as unknown as FeatureArtifact;

    const [out] = attachFieldFactsToFlows([chain], facts, art, art);
    assert.equal(out!.change_type, 'modified');
    const filter = out!.step_changes?.find((c) => c.key.startsWith('filter_query:'));
    assert.ok(filter?.field_facts?.some((f) => f.name === 'status'));
  });
});
