import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import type { ControlDiff } from '../../src/compare/controlCatalogDiff.js';
import { buildFlowStepReport, handlerNameOf, translateNote } from '../../src/compare/flowStepReport.js';
import { fingerprintFunctions } from '../../src/compare/sourceFingerprint.js';

const emptyDiff = (): ControlDiff => ({ added: [], removed: [], possiblyMoved: [], changed: [], unchanged: 0 });

/** 用一个与具体功能无关的假想功能构造输入（名称故意与现有功能不同） */
const doc = (flows: { id: string; title: string; ops: { id: string; name: string; kind: string; element?: string }[] }[]) => ({
  flows: flows.map((f) => ({ id: f.id, title: f.title, nodes: f.ops.map((o) => ({ id: `${f.id}_n_${o.id}`, meta_op_id: o.id })) })),
  meta_ops: flows.flatMap((f) => f.ops.map((o) => ({ id: o.id, name: o.name, kind: o.kind, element: o.element }))),
});

const EL_SAVE = 'src/page.js|Button|保存||handleSave';

describe('handlerNameOf', () => {
  it('取出处理函数名，忽略数据集与带参数写法', () => {
    assert.equal(handlerNameOf(EL_SAVE), 'handleSave');
    assert.equal(handlerNameOf("src/page.js|Button|删除||handelDelTag('send')"), 'handelDelTag');
    assert.equal(handlerNameOf('src/page.js|Table|Table||dataSet:ds@/v1/x'), undefined);
  });
});

describe('translateNote', () => {
  it('通用地翻译代码条件与文件行号，不依赖具体取值', () => {
    assert.equal(translateNote("条件：非(mode==='draft')"), '条件：mode 不为「draft」');
    assert.equal(translateNote("条件：kind==='A'"), '条件：kind 为「A」');
    assert.equal(translateNote('点击 src/a/index.js:1914 之一后弹出'), '点击触发按钮后弹出');
  });
});

describe('fingerprintFunctions', () => {
  it('注释与空白改动不计入，逻辑改动才变化', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fp-'));
    const file = path.join(dir, 'index.js');
    const v1 = 'const handleSave = () => { return api(1); };\n';
    await fs.writeFile(file, v1, 'utf8');
    const a = await fingerprintFunctions(dir);
    await fs.writeFile(file, '// 注释\nconst handleSave = () => {\n  // 说明\n  return api(1);\n};\n', 'utf8');
    const b = await fingerprintFunctions(dir);
    assert.equal(a.get('handleSave'), b.get('handleSave'), '注释和空白不应改变哈希');
    await fs.writeFile(file, 'const handleSave = () => { return api(2); };\n', 'utf8');
    const c = await fingerprintFunctions(dir);
    assert.notEqual(a.get('handleSave'), c.get('handleSave'), '逻辑改动应改变哈希');
    await fs.rm(dir, { recursive: true, force: true });
  });
});

describe('buildFlowStepReport（与功能无关）', () => {
  const v1 = doc([
    { id: 'f_save', title: '保存记录', ops: [{ id: 'o1', name: '点击保存', kind: 'click', element: EL_SAVE }] },
    { id: 'f_gone', title: '导出清单', ops: [{ id: 'o2', name: '点击导出', kind: 'click', element: 'src/page.js|Button|导出||handleExport' }] },
  ]);
  const cur = doc([{ id: 'f_save', title: '保存记录', ops: [{ id: 'o1', name: '点击保存', kind: 'click', element: EL_SAVE }] }]);

  it('未做源码比对时，已移除流程标注为未核对，不据 id 直接判定', () => {
    const r = buildFlowStepReport({ feature: '示例', label: 'V1 vs 当前', diff: emptyDiff(), current: cur, v1 });
    assert.match(r.markdown, /未做源码核对/);
    assert.equal(r.totalFlows, 1);
  });

  it('处理函数在当前源码中仍存在时，不判定为已移除', () => {
    const r = buildFlowStepReport({
      feature: '示例', label: 'V1 vs 当前', diff: emptyDiff(), current: cur, v1,
      currentFns: new Map([['handleSave', 'aaa'], ['handleExport', 'bbb']]),
      v1Fns: new Map([['handleSave', 'aaa'], ['handleExport', 'bbb']]),
    });
    assert.match(r.markdown, /源码仍有处理函数 handleExport，需确认是否为流程分析缺失/);
    assert.doesNotMatch(r.markdown, /源码已无处理函数/);
  });

  it('处理函数已从源码删除时，判定为已移除', () => {
    const r = buildFlowStepReport({
      feature: '示例', label: 'V1 vs 当前', diff: emptyDiff(), current: cur, v1,
      currentFns: new Map([['handleSave', 'aaa']]),
      v1Fns: new Map([['handleSave', 'aaa'], ['handleExport', 'bbb']]),
    });
    assert.match(r.markdown, /源码已无处理函数 handleExport，可判定为已移除/);
  });

  it('处理函数逻辑改变时，步骤标记为逻辑变化，流程计为有变化', () => {
    const r = buildFlowStepReport({
      feature: '示例', label: 'V1 vs 当前', diff: emptyDiff(), current: cur, v1,
      currentFns: new Map([['handleSave', 'NEW']]),
      v1Fns: new Map([['handleSave', 'OLD']]),
    });
    assert.match(r.markdown, /逻辑变化：处理函数源码已改（handleSave）/);
    assert.equal(r.changedFlows, 1);
  });

  it('未变化的流程也逐步骤列出', () => {
    const r = buildFlowStepReport({
      feature: '示例', label: 'V1 vs 当前', diff: emptyDiff(), current: cur, v1,
      currentFns: new Map([['handleSave', 'aaa']]), v1Fns: new Map([['handleSave', 'aaa']]),
    });
    assert.match(r.markdown, /### 保存记录\n\n1\. 【点击】点击保存/);
  });
});
