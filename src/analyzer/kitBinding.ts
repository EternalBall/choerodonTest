import { cssForFieldRule, lovOpenCss } from '../knowledge/platformKit.js';
import { buttonKeyFromText } from './btnKeys.js';
import { lookupKnownLib, matchLibAlias } from './libComponents.js';
import type { PrunedFile, PrunedNode, PrunedPage } from './pruneJsx.js';

/** 页面 DOM 结构解析的产物类型（对应 knowledge/prompts/page-dom-and-locator.md §3，schema_version page_dom_locator/v1） */

export type LocatorStatus = 'proposed' | 'needs_review' | 'blocked';
export type NodeLocStatus = 'bound' | 'unbound' | 'needs_kit' | 'needs_probe' | 'unresolved_custom';

export type LocatorDef = {
  kit?: string;
  css?: string;
  role?: string;
  name?: string;
  text?: string;
  label?: string;
  placeholder?: string;
  testId?: string;
  within?: string;
  evidence?: string;
  status?: LocatorStatus;
};

export type LocNode = {
  id: string;
  name: string;
  kind: 'c7n' | 'native' | 'custom' | 'unknown';
  component: string;
  props?: Record<string, string | number | boolean>;
  region?: string;
  evidence: { file: string; note: string }[];
  locator_key?: string;
  locator_status: NodeLocStatus;
  /** 透明容器（如 TarzanSpin）：自身无定位意义，子节点照常解析；不计入覆盖率分母 */
  transparent?: boolean;
  /** 确定性绑定无法起名时给 LLM 的候选（角色 + 名称） */
  suggest?: { role?: string; name?: string; text?: string };
};

export type LocGap = {
  type: 'needs_kit' | 'unresolved_custom' | 'ambiguous_multi_instance' | 'dynamic_dom' | 'large_file_truncated';
  node_id?: string;
  detail: string;
  suggested_action: 'add_kit' | 'follow_source' | 'probe_dom' | 'manual_overlay';
  /** 聚类用的原因标签（体检命令统计）：custom_unresolved:<来源> / kit_missing:<组件> / overlay_table / multi_table_nth / dup_button_text / table_no_dataset */
  cause?: string;
};

export type LocPage = {
  id: string;
  name: string;
  file_entry: string;
  regions: { id: string; name: string; kind_hint: string }[];
  nodes: LocNode[];
};

export type PageLocateResult = {
  schema_version: 'page_dom_locator/v1';
  feature: string;
  slug: string;
  confidence: number;
  pages: LocPage[];
  locators: Record<string, LocatorDef>;
  elements_draft_namespace: string;
  elements_draft: Record<string, Record<string, Record<string, unknown>>>;
  gaps: LocGap[];
  followups: { path: string; reason: string; depth: number }[];
  notes: string[];
};

const LAYOUT_WRAPPERS = new Set(['Header', 'Content']);
/** 纯展示组件：无交互定位价值，不记节点也不算缺口 */
const DISPLAY_ONLY = new Set([
  'Badge', 'Tooltip', 'Icon', 'Tag', 'Divider', 'Row', 'Col', 'Spin',
  // 展示/结构类：Output 是只读展示，Option/Item/ItemGroup 是父组件的子项声明，Column 是 Table 列声明
  'Output', 'Option', 'Select.Option', 'Item', 'ItemGroup', 'Form.Item', 'Column', 'Timeline', 'Timeline.Item',
  'Progress', 'Card', 'ModalProvider', 'Steps', 'Steps.Step', 'Step',
]);
const FIELD_CONTROL: Record<string, string> = {
  TextField: 'input',
  TextArea: 'input',
  IntlField: 'input',
  UrlField: 'input',
  Password: 'input',
  NumberField: 'number',
  Currency: 'number',
  CurrencyField: 'number',
  Switch: 'switch',
  Lov: 'lov',
  Select: 'select',
  DatePicker: 'date',
  DateTimePicker: 'date',
  TimePicker: 'date',
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const unbrace = (v: unknown): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const m = /^\{(.*)\}$/.exec(v);
  return m ? m[1] : v;
};
const ident = (v: unknown): string | undefined => {
  const u = unbrace(v);
  return u && /^[A-Za-z_]\w*$/.test(u) ? u : undefined;
};

/** purchaseListDS / lineDs / detailDs → purchaseListTable / lineTable / detailTable */
export function tableKeyFromDataSet(ds: string): string {
  const base = ds
    .replace(/(DS|Ds|DataSet|Dataset)$/, '')
    .replace(/Table$/, '')
    .replace(/^\w/, (c) => c.toLowerCase());
  return `${base || 'main'}Table`;
}

type Ctx = {
  slug: string;
  nodes: LocNode[];
  regions: LocPage['regions'];
  locators: Record<string, LocatorDef>;
  gaps: LocGap[];
  file: PrunedFile;
  pageId: string;
  nextId: number;
  tableCount: number;
  tableIdx: number;
  btnTexts: Map<string, string[]>;
  /** 当前根的上下文（pruneJsx.rootCtx） */
  rootCtx: string;
  /** 图标按钮按「作用域|图标名」计数，判多实例 */
  iconCounts: Map<string, number>;
  /** 当前节点祖先累计的三元分支路径 */
  branchPath: string[];
  /** 当前根下标；弹窗/抽屉根各自的 Table 计划与计数 */
  rootIdx: number;
  overlayPlans: Map<number, { cond: boolean }[]>;
  overlayTableIdx: Map<number, number>;
  /** 同文案按钮的出现信息（节点对象 → 信息），用于判断重复是否真的冲突 */
  btnOcc: Map<string, BtnOcc[]>;
  btnOccOf: WeakMap<PrunedNode, BtnOcc>;
  followedTags: Set<string>;
  libAliases: Record<string, string>;
  /** 列数组变量名 → 表格语义键（<Table columns={x} dataSet={yDS}> 预扫得到） */
  tableOfColumns: Map<string, string>;
  /** 位于弹窗/浮层、没有 locator 的表格键：引用它的 within 需摘除 */
  overlayTableKeys: Set<string>;
  /** 当前节点是否经条件/循环到达（含祖先） */
  cond: boolean;
  /** 主树内 Table 的稳定性判定（按源码顺序）：positive 正向 nth / negative 反向 nth / unstable */
  tablePlan: { idx: number; cond: boolean }[];
  followedHasTable: boolean;
  /** 当前遍历的根是否为弹窗/浮层/变量里的 JSX（非主渲染树） */
  overlay: boolean;
};

function addLocator(ctx: Ctx, key: string, def: LocatorDef): boolean {
  if (ctx.locators[key]) return JSON.stringify(ctx.locators[key]) === JSON.stringify(def);
  ctx.locators[key] = def;
  return true;
}


/**
 * 确定性预绑定：c7n 组件 + 字面量 props → kit key / 字段 locator。
 * 只做有把握的；其余留给 LLM（unbound / needs_kit）。不编造 css。
 */
type BtnOcc = { node: PrunedNode; ctxName: string; overlay: boolean; branches: string[] };

export type BindOptions = {
  /** 库别名前缀 → 包名（loadLibAliases），用于识别 hzero/hcm 库组件 */
  libAliases?: Record<string, string>;
};

export function bindPage(page: PrunedPage, feature: string, slug: string, bopts: BindOptions = {}): PageLocateResult {
  const locators: Record<string, LocatorDef> = {};
  const gaps: LocGap[] = [];
  const pages: LocPage[] = [];
  const followups: PageLocateResult['followups'] = [];
  const overlayTableKeys = new Set<string>();

  for (const f of page.files) {
    const ctx: Ctx = {
      slug,
      nodes: [],
      regions: [],
      locators,
      gaps,
      file: f,
      pageId: f.file.split('/').slice(-2).join('_').replace(/\.\w+$/, '').replace(/[^\w]+/g, '_'),
      nextId: 1,
      tableCount: 0,
      tableIdx: 0,
      btnTexts: new Map(),
      rootCtx: '',
      iconCounts: new Map(),
      branchPath: [],
      rootIdx: -1,
      overlayPlans: new Map(),
      overlayTableIdx: new Map(),
      btnOcc: new Map(),
      btnOccOf: new WeakMap(),
      overlay: false,
      libAliases: bopts.libAliases ?? {},
      overlayTableKeys,
      cond: false,
      tablePlan: [],
      followedHasTable: false,
      tableOfColumns: new Map(),
      followedTags: new Set(page.followed.filter((x) => x.from === f.file).map((x) => x.tag)),
    };
    // 主页面（页面级）表格总数 = 排除 Modal 内容后的 Table；这里按源码顺序统计所有 c7n Table
    const countTables = (ns: PrunedNode[]): number =>
      ns.reduce((a, n) => a + (n.kind === 'c7n' && n.tag === 'Table' ? 1 : 0) + countTables(n.children), 0);
    // 主渲染树 = 非 Modal.open 等调用内的 JSX（pruneJsx.rootOverlay）
    const mainRoots = f.roots.filter((_, i) => !f.rootOverlay[i]);
    ctx.tableCount = countTables(mainRoots);
    const plan = (ns: PrunedNode[], cond: boolean) => {
      for (const n of ns) {
        const c = cond || !!n.conditional;
        if (n.kind === 'c7n' && n.tag === 'Table') ctx.tablePlan.push({ idx: ctx.tablePlan.length, cond: c });
        plan(n.children, c);
      }
    };
    plan(mainRoots, false);
    // Modal.open / Drawer.open 内容各自一棵树：表格在弹层容器内，按该根内的顺序编号
    f.roots.forEach((r, i) => {
      if (!f.rootOverlay[i] || !['modal', 'drawer'].includes(f.rootCtx[i] ?? '')) return;
      const arr: { cond: boolean }[] = [];
      const collect = (ns: PrunedNode[], cond: boolean) => {
        for (const n of ns) {
          const c = cond || !!n.conditional;
          if (n.kind === 'c7n' && n.tag === 'Table') arr.push({ cond: c });
          collect(n.children, c);
        }
      };
      collect([r], false);
      ctx.overlayPlans.set(i, arr);
    });
    // 被跟进的组件里若也有主树 Table，页面实际 DOM 顺序会与本文件源码顺序交错
    const mainTags = new Set<string>();
    const collectTags = (ns: PrunedNode[]) => {
      for (const n of ns) {
        if (n.kind === 'custom') mainTags.add(n.tag.split('.')[0]);
        collectTags(n.children);
      }
    };
    collectTags(mainRoots);
    // 只算在主渲染树里使用的被跟进组件（Modal.open 里的组件打开前不在 DOM，不会与主树 Table 交错）
    for (const fl of page.followed.filter((x) => x.from === f.file && mainTags.has(x.tag))) {
      const tf = page.files.find((x) => x.file === fl.to);
      if (tf && countTables(tf.roots.filter((_, i) => !tf.rootOverlay[i])) > 0) ctx.followedHasTable = true;
    }

    const scanTables = (ns: PrunedNode[]) => {
      for (const n of ns) {
        if (n.kind === 'c7n' && n.tag === 'Table') {
          const ds = ident(n.props.dataSet);
          const cv = ident(n.props.columns);
          if (ds && cv) ctx.tableOfColumns.set(cv, tableKeyFromDataSet(ds));
        }
        scanTables(n.children);
      }
    };
    scanTables(f.roots);

    // 记录同文案按钮出现信息（判多实例是否真冲突）
    const scanBtn = (ns: PrunedNode[], ov: boolean, rc: string, path: string[]) => {
      for (const n of ns) {
        const pth = n.branch ? [...path, ...n.branch] : path;
        if (n.kind === 'c7n' && /Button$/.test(n.tag) && n.text) {
          const occ: BtnOcc = { node: n, ctxName: rc, overlay: ov, branches: pth };
          ctx.btnOcc.set(n.text, [...(ctx.btnOcc.get(n.text) ?? []), occ]);
          ctx.btnOccOf.set(n, occ);
          ctx.btnTexts.set(n.text, [...(ctx.btnTexts.get(n.text) ?? []), String(n.line)]);
        }
        scanBtn(n.children, ov, rc, pth);
      }
    };
    f.roots.forEach((r, i) => scanBtn([r], !!f.rootOverlay[i], f.rootCtx[i] ?? '', []));

    // 图标按钮（无文案、icon 为字面量）按作用域计数
    f.roots.forEach((r, i) => {
      const walk = (ns: PrunedNode[]) => {
        for (const n of ns) {
          if (n.kind === 'c7n' && /Button$/.test(n.tag) && !n.text) {
            const ic = literalIcon(n);
            if (ic) {
              const k = `${iconScope(f.rootCtx[i] ?? '')}|${ic}`;
              ctx.iconCounts.set(k, (ctx.iconCounts.get(k) ?? 0) + 1);
            }
          }
          walk(n.children);
        }
      };
      walk([r]);
    });

    f.roots.forEach((r, i) => {
      ctx.overlay = !!f.rootOverlay[i];
      ctx.rootCtx = f.rootCtx[i] ?? '';
      ctx.rootIdx = i;
      ctx.branchPath = [];
      visit(ctx, r, undefined);
    });

    for (const u of f.unresolved) {
      followups.push({ path: u.source, reason: `${f.file}: <${u.tag}> ${u.reason}`, depth: 1 });
    }
    if (f.truncated) {
      gaps.push({ type: 'large_file_truncated', detail: `${f.file} JSX 节点超限，已截断`, suggested_action: 'follow_source' });
    }
    pages.push({
      id: ctx.pageId,
      name: f.file,
      file_entry: f.file,
      regions: ctx.regions,
      nodes: ctx.nodes,
    });
  }

  // within 指向弹窗内表格（无 locator）的定位：摘掉 within，降为 needs_review，避免运行期引用不存在的元素
  for (const [k, d] of Object.entries(locators)) {
    const ref = d.within?.split('.').pop();
    if (ref && overlayTableKeys.has(ref) && !(ref in locators)) {
      delete d.within;
      d.status = 'needs_review';
      d.evidence = `${d.evidence ?? ''}（所属表格在弹窗内，未限定表格范围）`;
      void k;
    }
  }

  return {
    schema_version: 'page_dom_locator/v1',
    feature,
    slug,
    confidence: 0.6,
    pages,
    locators,
    elements_draft_namespace: slug,
    elements_draft: {},
    gaps,
    followups,
    notes: ['确定性预绑定结果；confidence 待 LLM 与质量门校正'],
  };
}

function mk(ctx: Ctx, n: PrunedNode, region: string | undefined, extra: Partial<LocNode> = {}): LocNode {
  const node: LocNode = {
    id: `${ctx.pageId}.n${ctx.nextId++}`,
    name: n.text ?? n.tag,
    kind: n.kind,
    component: n.tag,
    ...(Object.keys(n.props).length ? { props: n.props } : {}),
    ...(region ? { region } : {}),
    evidence: [{ file: ctx.file.file, note: `L${n.line} <${n.tag}>` }],
    locator_status: 'unbound',
    ...extra,
  };
  ctx.nodes.push(node);
  return node;
}

function visit(ctx: Ctx, n: PrunedNode, region: string | undefined, cond = false): void {
  const saved = ctx.cond;
  const savedBranch = ctx.branchPath;
  ctx.cond = cond || !!n.conditional;
  if (n.branch) ctx.branchPath = [...ctx.branchPath, ...n.branch];
  let childRegion = region;
  let overlayChildren = false;
  const ev = `${ctx.file.file}:${n.line}`;

  if (n.kind === 'custom' || n.kind === 'unknown') {
    if (LAYOUT_WRAPPERS.has(n.tag)) {
      childRegion = n.tag === 'Header' ? 'header' : 'content';
      if (!ctx.regions.some((r) => r.id === childRegion)) {
        ctx.regions.push({ id: childRegion!, name: n.tag === 'Header' ? '页头操作区' : '内容区', kind_hint: 'layout' });
      }
    } else if (n.kind === 'custom' && ctx.followedTags.has(n.tag.split('.')[0])) {
      // 已跟进展开：其内部节点在被跟进文件的页面里，这里只记一个区域占位
      if (!ctx.regions.some((r) => r.id === n.tag)) {
        ctx.regions.push({ id: n.tag, name: `${n.tag}（内容见被跟进文件）`, kind_hint: 'followed_custom' });
      }
    } else if (n.kind === 'custom') {
      const spec = ctx.file.imports[n.tag.split('.')[0]] ?? '来源未知';
      const lib = matchLibAlias(spec, ctx.libAliases);
      if (lib) {
        // 库组件：源码不在仓库内，无法展开。已登记的（Lov/EditTable/Upload/Checkbox）记为「已知、待探测」，未登记的记 lib_unknown
        const known = lookupKnownLib(lib.pkg, spec, lib.prefix, ctx.file.importNames[n.tag.split('.')[0]]);
        if (known?.info.role === 'wrapper' || known?.info.role === 'display-only') {
          mk(ctx, n, region, { locator_status: 'unbound', transparent: true });
          overlayChildren = false;
        } else {
        if (known?.info.role === 'drawer') overlayChildren = true;
        const node = mk(ctx, n, region, { locator_status: known ? 'needs_probe' : 'unresolved_custom' });
        ctx.gaps.push({
          type: known ? 'dynamic_dom' : 'unresolved_custom',
          node_id: node.id,
          detail: known
            ? `<${n.tag}> 来自库 ${lib.pkg}（${spec}），已登记为 ${known.info.role}；库源码不在仓库内，DOM 未核实，需探测后再定位`
            : `<${n.tag}> 来自库 ${lib.pkg}（${spec}），未登记且库源码不在仓库内`,
          suggested_action: 'probe_dom',
          cause: known ? `lib_known:${known.key}` : `lib_unknown:${lib.pkg}:${spec}`,
        });
        }
      } else {
        // 已被跟进展开的自定义组件：子树在对应文件里，不算缺口
        const node = mk(ctx, n, region, { locator_status: 'unresolved_custom' });
        ctx.gaps.push({
          type: 'unresolved_custom',
          node_id: node.id,
          detail: `<${n.tag}>（${spec}）的内部 DOM 未展开，不得绑定其 DOM`,
          suggested_action: 'follow_source',
          cause: `custom_unresolved:${spec}`,
        });
      }
    }
  } else if (n.kind === 'c7n') {
    childRegion = bindC7n(ctx, n, region, ev) ?? region;
  }

  const savedOverlay = ctx.overlay;
  if (overlayChildren) ctx.overlay = true;
  for (const c of n.children) visit(ctx, c, childRegion, ctx.cond);
  ctx.overlay = savedOverlay;
  ctx.cond = saved;
  ctx.branchPath = savedBranch;
}

function bindC7n(ctx: Ctx, n: PrunedNode, region: string | undefined, ev: string): string | undefined {
  const tag = n.tag;

  if (tag === 'Table') {
    const ds = ident(n.props.dataSet);
    const key = ds ? tableKeyFromDataSet(ds) : undefined;
    if (ctx.overlay && key && ctx.overlayPlans.has(ctx.rootIdx)) {
      return bindModalTable(ctx, n, key, region, ev);
    }
    if (ctx.overlay) {
      if (key) ctx.overlayTableKeys.add(key);
      const node = mk(ctx, n, region, { locator_status: 'needs_probe' });
      ctx.gaps.push({
        type: 'dynamic_dom',
        node_id: node.id,
        detail: `${key ?? 'Table'} 位于弹窗/浮层 JSX（非主渲染树），打开前不在 DOM 中，需探测弹窗容器后再定位`,
        suggested_action: 'probe_dom',
        cause: 'overlay_table',
      });
      return region;
    }
    const idx = ctx.tableIdx++;
    if (!key) {
      const node = mk(ctx, n, region, { locator_status: 'needs_probe' });
      ctx.gaps.push({ type: 'ambiguous_multi_instance', node_id: node.id, detail: 'Table 无字面量 dataSet，无法起语义名', suggested_action: 'probe_dom', cause: 'table_no_dataset' });
      return undefined;
    }
    const total = ctx.tablePlan.length || ctx.tableCount;
    const multi = total > 1 || ctx.followedHasTable;
    if (!multi) {
      addLocator(ctx, key, { kit: 'table', evidence: ev, status: 'proposed' });
      mk(ctx, n, region, { locator_key: key, locator_status: 'bound' });
      return bindColumnLinks(ctx, n, key, region, ev);
    }
    // 多表定位：只有「渲染顺序可由源码确定」时才给确定性下标。
    // 正向：自己及之前所有 Table 都无条件渲染 → nth=idx；反向：自己及之后都无条件 → nth=idx-total（Playwright 负下标从末尾数）；
    // 否则（条件/循环渲染居中，或被跟进组件里也有 Table）顺序不可由源码确定 → 待探测
    const plan = ctx.tablePlan;
    const frontStable = !ctx.followedHasTable && plan.slice(0, idx + 1).every((t) => !t.cond);
    const backStable = !ctx.followedHasTable && plan.slice(idx).every((t) => !t.cond);
    const nth = frontStable ? idx : backStable ? idx - total : idx;
    const stable = frontStable || backStable;
    const why = frontStable
      ? `前 ${idx + 1} 个 Table 均无条件渲染，源码顺序即 DOM 顺序`
      : backStable
        ? `自身及之后 ${total - idx} 个 Table 均无条件渲染，从末尾数下标稳定`
        : ctx.followedHasTable
          ? '被跟进的子组件里也有 Table，页面内 DOM 顺序与本文件源码顺序交错'
          : '该 Table 前后存在条件/循环渲染的 Table，DOM 下标不可由源码确定';
    addLocator(ctx, key, {
      css: `.c7n-pro-table >> nth=${nth}`,
      evidence: `${ev}（同页第 ${idx + 1}/${total} 个 Table；${why}）`,
      status: stable ? 'proposed' : 'needs_review',
    });
    const node = mk(ctx, n, region, { locator_key: key, locator_status: stable ? 'bound' : 'needs_probe' });
    if (!stable) {
      ctx.gaps.push({
        type: 'ambiguous_multi_instance',
        node_id: node.id,
        detail: `同页有 ${total} 个 c7n Table，${key} 暂按 nth=${nth}：${why}`,
        suggested_action: 'probe_dom',
        cause: ctx.followedHasTable ? 'multi_table_interleaved' : 'multi_table_unstable',
      });
    }
    addLocator(ctx, `${key}Row`, {
      css: `.c7n-pro-table >> nth=${nth} >> tr.c7n-pro-table-row`,
      evidence: ev,
      status: stable ? 'proposed' : 'needs_review',
    });
    return bindColumnLinks(ctx, n, key, region, ev);
  }

  if (tag === 'Button' || tag === 'PermissionButton') {
    if (!n.text) {
      const ic = literalIcon(n);
      return ic ? bindIconButton(ctx, n, ic, region, ev) : (mk(ctx, n, region, { locator_status: 'unbound' }), region);
    }
    const handler = ident(n.props.onClick);
    const key = handler ? `btn${cap(handler.replace(/^handle|^on/, ''))}` : buttonKeyFromText(n.text);
    const occ = ctx.btnOccOf.get(n);
    const others = (ctx.btnOcc.get(n.text) ?? []).filter((o) => o !== occ);
    // 三元的 T / F 分支互斥：运行时至多渲染其一，不构成冲突
    const exclusive = (o: BtnOcc) =>
      ctx.branchPath.some((b) => o.branches.some((c) => b.split(':')[0] === c.split(':')[0] && b !== c));
    const isModal = ctx.rootCtx === 'modal';
    // 主树按钮不与弹窗里的同名按钮冲突（弹窗里的那个会另外限定到弹窗）；弹窗里的只与弹窗里的同名按钮比较
    const conflicts = others.filter((o) => !exclusive(o) && (isModal ? o.ctxName === 'modal' : o.ctxName !== 'modal'));
    const dup = conflicts.length > 0;
    const scopedToModal = !!key && isModal && !dup && others.some((o) => o.ctxName !== 'modal' && !exclusive(o));
    if (!key || dup) {
      const node = mk(ctx, n, region, {
        locator_status: 'unbound',
        suggest: { role: 'button', name: n.text },
      });
      if (dup) {
        ctx.gaps.push({
          type: 'ambiguous_multi_instance',
          node_id: node.id,
          detail: `文案「${n.text}」的按钮在本文件出现 ${conflicts.length + 1} 次且无法由三元分支或弹窗作用域区分，需 within/region`,
          suggested_action: 'probe_dom',
          cause: 'dup_button_text',
        });
      }
      return region;
    }
    if (scopedToModal) {
      addLocator(ctx, 'modal', { kit: 'modal', evidence: ev, status: 'proposed' });
      const mk2 = `${key}InModal`;
      addLocator(ctx, mk2, {
        role: 'button',
        name: n.text,
        within: `${ctx.slug}.modal`,
        evidence: `${ev}（Modal.open 内，页面上另有同名按钮，限定到弹窗；弹窗容器取 kit modal，未核实该弹窗是否为居中弹层）`,
        status: 'needs_review',
      });
      mk(ctx, n, region, { locator_key: mk2, locator_status: 'bound' });
      return region;
    }
    addLocator(ctx, key, { role: 'button', name: n.text, evidence: ev, status: 'proposed' });
    mk(ctx, n, region, { locator_key: key, locator_status: 'bound' });
    return region;
  }

  if (FIELD_CONTROL[tag]) {
    const name = typeof n.props.name === 'string' && !n.props.name.startsWith('{') ? n.props.name : undefined;
    const ctl = FIELD_CONTROL[tag];
    if (!name || !/^[a-zA-Z]/.test(name)) {
      // 列 editor 里的控件：字段名就是列 name，定位到该列单元格（点击单元格进入编辑，见 choerodon-table-row-edit 手册）
      const col = ctx.file.columns.find((c) => c.editors?.some((e) => e.tag === tag && e.line === n.line));
      if (col && /^[A-Za-z]\w*$/.test(col.name)) {
        const tk = col.group ? ctx.tableOfColumns.get(col.group) : undefined;
        const ck = `${col.name}Cell`;
        addLocator(ctx, ck, {
          css: `td[data-index="${col.name}"]`,
          ...(tk ? { within: `${ctx.slug}.${tk}` } : {}),
          evidence: `${ev}（列 ${col.name} 的 editor 控件 <${tag}>，字段名取自列 name）`,
          status: tk ? 'proposed' : 'needs_review',
        });
        mk(ctx, n, region, { locator_key: ck, locator_status: 'bound' });
        return region;
      }
      // rc-form 旧写法：getFieldDecorator('x')(<Ctl />)，字段名已知但旧版控件 DOM 未核实
      const dec = ctx.file.decorated.find((d) => d.tag === tag && d.line === n.line);
      if (dec) {
        const node = mk(ctx, n, region, { locator_status: 'needs_probe' });
        ctx.gaps.push({
          type: 'dynamic_dom',
          node_id: node.id,
          detail: `旧版 Form 控件 <${tag}>，字段名 ${dec.name}（getFieldDecorator）；旧版控件 DOM 未核实，需探测`,
          suggested_action: 'probe_dom',
          cause: 'legacy_form_field',
        });
        return region;
      }
      const hint = [n.props.placeholder, n.props.label].find((v) => typeof v === 'string' && !v.startsWith('{')) as string | undefined;
      mk(ctx, n, region, { locator_status: 'unbound', ...(hint ? { suggest: { name: hint } } : {}) });
      return region;
    }
    if (ctl === 'lov') {
      addLocator(ctx, `${name}Open`, { css: lovOpenCss(name), evidence: ev, status: 'needs_review' });
      mk(ctx, n, region, { locator_key: `${name}Open`, locator_status: 'bound' });
    } else if (ctl === 'select' || ctl === 'date') {
      addLocator(ctx, name, {
        css: `.page-content .c7n-pro-${ctl === 'date' ? 'calendar-picker' : 'select'}-wrapper:has(input[name="${name}"])`,
        evidence: ev,
        status: 'needs_review',
      });
      mk(ctx, n, region, { locator_key: name, locator_status: 'bound' });
    } else {
      const css = cssForFieldRule(name, ctl);
      if (css) addLocator(ctx, name, { css, evidence: ev, status: 'proposed' });
      mk(ctx, n, region, { locator_key: name, locator_status: css ? 'bound' : 'unbound' });
    }
    return region;
  }

  if (tag === 'Dropdown') {
    mk(ctx, n, region, { locator_key: 'dropdownMenu', locator_status: 'bound' });
    return region;
  }
  if (tag === 'Menu' || tag === 'Form') return region;
  if (DISPLAY_ONLY.has(tag)) return region;
  if (tag === 'Popconfirm') {
    mk(ctx, n, region, { locator_key: 'tableDeletePopover', locator_status: 'bound' });
    return region;
  }
  if (tag === 'Menu.Item') {
    mk(ctx, n, region, { locator_key: 'dropdownMenuItem', locator_status: 'bound' });
    return region;
  }
  if (tag === 'Collapse' || tag === 'Panel' || tag === 'Collapse.Panel') {
    const title = typeof n.props.header === 'string' ? n.props.header : tag;
    const id = tag === 'Collapse' ? 'collapse' : `panel_${ctx.regions.length + 1}`;
    ctx.regions.push({ id, name: title, kind_hint: tag === 'Collapse' ? 'collapse' : 'panel' });
    mk(ctx, n, region, { locator_status: 'unbound' });
    return id;
  }
  if (tag === 'Tabs' || tag === 'Tabs.TabPane' || tag === 'TabPane') {
    const key = tag === 'Tabs' ? 'tabsRoot' : 'tabsTab';
    mk(ctx, n, region, { locator_key: key, locator_status: 'bound' });
    return region;
  }

  // 未收录的 c7n 组件：不编造 css
  const node = mk(ctx, n, region, { locator_status: 'needs_kit' });
  ctx.gaps.push({
    type: 'needs_kit',
    node_id: node.id,
    detail: `c7n 组件 <${tag}> 在 kit 中无对应键，需补 kit 或 manual_overlay`,
    suggested_action: 'add_kit',
    cause: `kit_missing:${tag}`,
  });
  return region;
}

/** 列内链接：columns={xxx} 对应列数组里 renderer 带 <a>/Button 的列 → `td[data-index] a`，within 对应表 */
function bindColumnLinks(ctx: Ctx, n: PrunedNode, key: string, region: string | undefined, ev: string): string | undefined {
  void ev;
  const colVar = ident(n.props.columns);
  for (const col of ctx.file.columns) {
    if (!col.link || !colVar || col.group !== colVar) continue;
    if (!/^[A-Za-z]\w*$/.test(col.name)) continue;
    const lk = `${col.name}Link`;
    if (
      addLocator(ctx, lk, {
        css: `td[data-index="${col.name}"] a`,
        within: `${ctx.slug}.${key}`,
        evidence: `${ctx.file.file}（列 ${col.name} 的 renderer 内 <${col.link.tag}>）`,
        status: 'proposed',
      })
    ) {
      mk(ctx, { ...n, tag: `${col.link.tag}（列 ${col.name}）`, kind: 'native', text: col.link.text, props: {}, children: [] }, region, {
        locator_key: lk,
        locator_status: 'bound',
      });
    }
  }
  return region;
}

/** 图标按钮的字面量 icon（如 add / remove / edit-o），非字面量返回 undefined */
function literalIcon(n: PrunedNode): string | undefined {
  const v = n.props.icon;
  return typeof v === 'string' && /^[a-z][\w-]*$/.test(v) ? v : undefined;
}

/** 根上下文 → 作用域：header=列头（thead），renderer/editor=行内（tbody 行），空=主树，其它=其它浮层/回调 */
function iconScope(rootCtx: string): 'thead' | 'row' | 'main' | 'other' {
  if (rootCtx === 'header') return 'thead';
  if (rootCtx === 'renderer' || rootCtx === 'editor') return 'row';
  return rootCtx === '' ? 'main' : 'other';
}

const camel = (s: string) => s.split('-').map(cap).join('');

/**
 * 图标按钮：c7n 图标按钮渲染为 button 内含 `.icon-<name>`，与 kit 的 tableAddLineBtn / tableRemoveLineBtn
 * （button:has(.icon-add) / button:has(.icon-remove)）同一约定。add / remove 来自已核实的 kit 条目；
 * 其它图标名按同一类名约定类推，标 needs_review。同作用域同图标出现多次则无法单凭 css 区分，记缺口。
 */
function bindIconButton(ctx: Ctx, n: PrunedNode, icon: string, region: string | undefined, ev: string): string | undefined {
  const scope = iconScope(ctx.rootCtx);
  const handler = ident(n.props.onClick);
  const stem = handler ? cap(handler.replace(/^handle|^on/, '')) : `Icon${camel(icon)}`;
  const key = scope === 'thead' ? `thead${stem}Btn` : scope === 'row' ? `row${stem}Btn` : `btn${stem}`;
  const prefix = scope === 'thead' ? '.c7n-pro-table thead ' : scope === 'row' ? '.c7n-pro-table-tbody tr.c7n-pro-table-row ' : '';
  const verified = icon === 'add' || icon === 'remove';
  const dup = (ctx.iconCounts.get(`${scope}|${icon}`) ?? 0) > 1;
  addLocator(ctx, key, {
    css: `${prefix}button:has(.icon-${icon})`,
    evidence: `${ev}（图标按钮 icon="${icon}"，无文案；${scope === 'row' ? '行内按钮按行重复，调用方需限定行；' : ''}${verified ? 'icon-add / icon-remove 约定见 kit' : '类名按 icon-<name> 约定类推，未在 UAT 核实'}）`,
    status: verified && !dup && scope !== 'row' ? 'proposed' : 'needs_review',
  });
  const unsure = dup || scope === 'row' || scope === 'other';
  const node = mk(ctx, n, region, { locator_key: key, locator_status: unsure ? 'needs_probe' : 'bound' });
  if (unsure) {
    ctx.gaps.push({
      type: 'ambiguous_multi_instance',
      node_id: node.id,
      detail: dup
        ? `同作用域（${scope}）内图标 ${icon} 的按钮出现多次，仅凭 css 无法区分`
        : scope === 'row'
          ? `行内按钮（图标 ${icon}）每行重复，需在用例里限定行`
          : `位于回调/浮层（${ctx.rootCtx}）内的图标按钮，渲染时机不由主树决定`,
      suggested_action: 'probe_dom',
      cause: dup ? 'dup_icon_button' : scope === 'row' ? 'row_icon_button' : 'other_icon_button',
    });
  }
  return region;
}

/**
 * Modal.open / Drawer.open 内容里的表格：先限定到 kit 的 modal / drawer 容器，再在容器内取表。
 * 容器内多表时按该根内的顺序给下标（规则同主树：无条件渲染才给确定性下标）。容器本身未核实每个弹层的具体形态，标 needs_review。
 */
function bindModalTable(ctx: Ctx, n: PrunedNode, key: string, region: string | undefined, ev: string): string | undefined {
  const plan = ctx.overlayPlans.get(ctx.rootIdx)!;
  const idx = ctx.overlayTableIdx.get(ctx.rootIdx) ?? 0;
  ctx.overlayTableIdx.set(ctx.rootIdx, idx + 1);
  const container = ctx.rootCtx === 'drawer' ? 'drawer' : 'modal';
  addLocator(ctx, container, { kit: container, evidence: ev, status: 'proposed' });
  const total = plan.length;
  let css = '.c7n-pro-table';
  let note = '弹层内仅一个 Table';
  let stable = true;
  if (total > 1) {
    const front = plan.slice(0, idx + 1).every((t) => !t.cond);
    const back = plan.slice(idx).every((t) => !t.cond);
    stable = front || back;
    css = `.c7n-pro-table >> nth=${front ? idx : back ? idx - total : idx}`;
    note = front
      ? `弹层内前 ${idx + 1} 个 Table 均无条件渲染`
      : back
        ? `弹层内自身及之后的 Table 均无条件渲染，从末尾数`
        : '弹层内该 Table 前后有条件/循环渲染的 Table，下标不可由源码确定';
  }
  const mkey = `${key}InModal`;
  addLocator(ctx, mkey, {
    css,
    within: `${ctx.slug}.${container}`,
    evidence: `${ev}（${ctx.rootCtx === 'drawer' ? 'Drawer' : 'Modal'}.open 内容；${note}；弹层容器取 kit ${container}，未核实该弹层形态）`,
    status: 'needs_review',
  });
  const node = mk(ctx, n, region, { locator_key: mkey, locator_status: stable ? 'bound' : 'needs_probe' });
  if (!stable) {
    ctx.gaps.push({
      type: 'ambiguous_multi_instance',
      node_id: node.id,
      detail: `弹层内有 ${total} 个 Table，${mkey} 暂按 ${css}：${note}`,
      suggested_action: 'probe_dom',
      cause: 'modal_table_unstable',
    });
  }
  return bindColumnLinks(ctx, n, mkey, region, ev);
}
