import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { PATHS } from '../core/paths.js';
import type { FeatureArtifact } from '../core/schema.js';
import { logger } from '../core/logger.js';
import { featureSlug } from './featureSlug.js';
import { featureArtifactDir } from '../core/featurePaths.js';

export type ElementMap = Record<string, Record<string, unknown>>;

/** 加载 Choerodon 平台组件定位库 */
export async function loadPlatformKit(
  platform = 'choerodon',
): Promise<ElementMap> {
  const file = path.join(PATHS.platformKnowledge, platform, 'kit.yaml');
  try {
    const raw = await fs.readFile(file, 'utf8');
    const data = YAML.parse(raw) as ElementMap;
    // 去掉 note 等非定位字段（保留在 yaml 给人看，写入 elements 时剔除）
    return stripMeta(data || {});
  } catch (e) {
    logger.warn({ file, err: String(e) }, '未加载到平台 kit，使用空底');
    return {};
  }
}

/** 功能层元素覆盖 */
export async function loadFeatureElementsOverlay(feature: string): Promise<ElementMap> {
  const slug = featureSlug(feature);
  const file = path.join(PATHS.knowledge, slug, 'elements.yaml');
  try {
    const raw = await fs.readFile(file, 'utf8');
    const data = YAML.parse(raw);
    // 支持 { ns: { ... } } 或扁平 { key: def }
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const obj = data as Record<string, unknown>;
      if (obj[slug] && typeof obj[slug] === 'object') {
        return stripMeta(obj[slug] as ElementMap);
      }
      // 扁平
      const first = Object.values(obj)[0];
      if (first && typeof first === 'object' && ('css' in (first as object) || 'role' in (first as object))) {
        return stripMeta(obj as ElementMap);
      }
      if (obj[slug]) return stripMeta(obj[slug] as ElementMap);
      return stripMeta(obj as ElementMap);
    }
    return {};
  } catch {
    return {};
  }
}

function stripMeta(map: ElementMap): ElementMap {
  const out: ElementMap = {};
  for (const [k, v] of Object.entries(map)) {
    if (!v || typeof v !== 'object') continue;
    if (k === 'note' || k.startsWith('_')) continue;
    const { note: _n, ...rest } = v as Record<string, unknown>;
    if (Object.keys(rest).length) out[k] = rest;
  }
  return out;
}

/**
 * 页面 DOM 解析产出的元素草案（artifacts/<slug>/page-locators.yaml 的 elements_draft.<slug>）。
 * 命名空间层 = 功能 slug，键并入该功能的元素库；不存在则为空。
 */
export async function loadLocateDraft(feature: string): Promise<ElementMap[string]> {
  return (await loadLocateDraftFull(feature)).draft;
}

type DraftNode = { name?: string; text?: string; locator_key?: string };

/** 草案 + 节点（节点用于给多实例组件取实例文案，如页签名） */
async function loadLocateDraftFull(feature: string): Promise<{ draft: ElementMap[string]; nodes: DraftNode[] }> {
  try {
    const file = path.join(featureArtifactDir(feature), 'page-locators.yaml');
    const y = YAML.parse(await fs.readFile(file, 'utf8')) as {
      elements_draft?: Record<string, Record<string, unknown>>;
      pages?: { nodes?: DraftNode[] }[];
    };
    return {
      draft: (y?.elements_draft?.[featureSlug(feature)] ?? {}) as ElementMap[string],
      nodes: (y?.pages ?? []).flatMap((p) => p?.nodes ?? []),
    };
  } catch {
    return { draft: {}, nodes: [] };
  }
}

/**
 * 字段类定位的作用域。生成器统一写 `.page-content <sel>`（可读），建库时改写为：
 * 有可见的 c7n-pro 弹层（Modal/Drawer）时只在弹层内找，否则在页面主体内找。
 * 依据：c7n-pro Modal 经 Portal 渲染在 .page-content 之外（DEV 实测 LOV/复制弹窗），
 * 写死 .page-content 会让弹窗里的字段永远找不到。
 */
// 不用 c7n-pro-modal-active：它只标在「最上层带遮罩」的弹层上（choerodon-ui modal-container/ModalContainer.js:605），
// 叠层 LOV 关闭前后、无遮罩抽屉都会让字段所在弹层不带 active（DEV 实测数据项抽屉字段 0 命中）。改用 Playwright :visible。
export const ACTIVE_MODAL_CSS = '.c7n-pro-modal-wrapper:visible';
const PAGE_CONTENT_PREFIX = '.page-content ';

export function inActiveArea(sel: string): string {
  return `${ACTIVE_MODAL_CSS} ${sel}, body:not(:has(${ACTIVE_MODAL_CSS})) .page-content ${sel}`;
}

export function scopeFieldCss(css: string): string {
  if (!css.startsWith(PAGE_CONTENT_PREFIX) || css.includes(',')) return css;
  return inActiveArea(css.slice(PAGE_CONTENT_PREFIX.length));
}

/**
 * 多实例 kit 组件：同一 kit 定义命中页面上所有实例，必须带实例文案才能唯一定位。
 * 值 = 该组件的 ARIA role（choerodon-ui lib/tabs/TabBar.js 给每个页签渲染 role: 'tab'）。
 */
const TEXT_INSTANCE_KITS: Record<string, string> = { tabsTab: 'tab' };

const COMPONENT_SUFFIX = /\s*(页签|标签页|标签|tab)$/i;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 多实例 kit 引用 → role+name；拿不到实例文案时标 ambiguous（执行前拦截，不在运行时撞 strict mode） */
function expandInstanceKit(
  key: string,
  kit: string,
  own: Record<string, unknown>,
  nodes: DraftNode[],
): Record<string, unknown> {
  const role = TEXT_INSTANCE_KITS[kit];
  const node = nodes.find((n) => n.locator_key === key);
  const fromNode = node?.text || (node?.name && COMPONENT_SUFFIX.test(node.name) ? node.name.replace(COMPONENT_SUFFIX, '') : undefined);
  const label = String(own.text ?? own.name ?? fromNode ?? '').trim();
  const within = own.within ? { within: own.within } : {};
  if (!label) {
    return { ...own, ambiguous: `多实例组件 ${kit} 缺少实例文案（定位草稿需补 text）` };
  }
  return { role, name: `^\\s*${escapeRe(label)}`, ...within };
}

/**
 * 合并：platform ← feature overlay ← field_rules ← hints（hints 不覆盖已有 css）
 */
export async function buildFeatureElementLib(
  feature: string,
  artifact?: FeatureArtifact,
): Promise<ElementMap> {
  const base = await loadPlatformKit();
  const overlay = await loadFeatureElementsOverlay(feature);
  const merged: ElementMap = { ...base, ...overlay };
  // 页面 DOM 解析草案：只补充 kit / overlay 没有的 key，不覆盖已有定义
  const { draft, nodes } = await loadLocateDraftFull(feature);
  for (const [k, def] of Object.entries(draft)) {
    if (k in merged) continue;
    const { kit, ...own } = def as Record<string, unknown> & { kit?: string };
    if (kit && TEXT_INSTANCE_KITS[kit]) {
      merged[k] = expandInstanceKit(k, kit, own, nodes);
      continue;
    }
    // kit 引用项展开成平台 kit 的定义（供 within 等引用），自带字段优先
    merged[k] = kit && base[kit] ? { ...base[kit], ...own } : (own as Record<string, unknown>);
  }

  if (artifact?.field_rules?.length) {
    for (const rule of artifact.field_rules) {
      if (merged[rule.name]?.css) continue;
      const css = cssForFieldRule(rule.name, rule.control);
      if (css) merged[rule.name] = { css };
      if (rule.control === 'lov' && !merged[`${rule.name}Open`]) {
        merged[`${rule.name}Open`] = {
          css: `.page-content .c7n-pro-select-wrapper:has(input[name="${rule.name}"]) .icon-search`,
        };
      }
    }
  }

  if (artifact?.elements_hints?.length) {
    for (const hint of artifact.elements_hints) {
      const key = hint.ref.includes('.') ? hint.ref.split('.').pop()! : hint.ref;
      const existing = merged[key];
      // 已有可靠 css 时，不要用仅 role/name 的 hint 盖掉
      if (existing?.css && !hint.css) continue;

      const next: Record<string, unknown> = {};
      if (hint.role) next.role = hint.role;
      if (hint.name) next.name = hint.name;
      if (hint.testId) next.testId = hint.testId;
      if (hint.label) next.label = hint.label;
      if (hint.placeholder) next.placeholder = hint.placeholder;
      if (hint.text) next.text = hint.text;
      if (hint.css) next.css = hint.css;
      if (hint.within) next.within = hint.within;

      // role=input/lov/intlInput 等非 Playwright role：转成 css
      const role = String(hint.role || '');
      if (!next.css && ['input', 'intlInput', 'intl', 'lov', 'switch', 'filterBar'].includes(role)) {
        const fieldName = guessNameFromHint(hint.name, key);
        const css = cssForFieldRule(fieldName, role === 'lov' ? 'lov' : role === 'switch' ? 'switch' : 'input');
        if (role === 'filterBar') {
          next.css = '.c7n-pro-table-dynamic-filter-bar';
          delete next.role;
          delete next.name;
        } else if (role === 'lov') {
          merged[`${fieldName}Open`] = {
            css: `.page-content .c7n-pro-select-wrapper:has(input[name="${fieldName}"]) .icon-search`,
          };
          continue;
        } else if (css) {
          next.css = css;
          delete next.role;
          delete next.name;
        }
      }

      if (Object.keys(next).length) {
        merged[key] = { ...existing, ...next };
      }
    }
  }

  // 人工校正（knowledge/features/<slug>/elements.yaml）优先级最高：
  // 动机——LLM 的 elements_hints 可能带错的 text/css 组合，不应盖掉人工核对过的定位
  for (const [key, def] of Object.entries(overlay)) {
    merged[key] = { ...def };
  }

  // 字段作用域改写（人工 overlay 不动）
  for (const [key, def] of Object.entries(merged)) {
    if (key in overlay || typeof def.css !== 'string') continue;
    const css = scopeFieldCss(def.css);
    if (css !== def.css) merged[key] = { ...def, css };
  }

  return merged;
}

function guessNameFromHint(label: string | undefined, key: string): string {
  const map: Record<string, string> = {
    物料编码: 'materialCode',
    物料描述: 'materialName',
    基本计量单位: 'primaryUomLov',
    启用状态: 'enableFlag',
  };
  if (label && map[label]) return map[label];
  if (/^[a-zA-Z]/.test(key)) return key.replace(/Open$/, '');
  return key;
}

export function cssForFieldRule(name: string, control?: string): string | undefined {
  if (!name || !/^[a-zA-Z]/.test(name)) return undefined;
  if (control === 'switch') {
    return `.page-content input.c7n-pro-switch[name="${name}"]`;
  }
  if (control === 'lov') {
    return undefined; // 用 *Open 触发器
  }
  if (control === 'number') {
    return `.page-content input.c7n-pro-input-number[name="${name}"]`;
  }
  return `.page-content input.c7n-pro-input[name="${name}"]`;
}

/** Lov 的打开图标（*Open）定位：限定在含目标 input 的 select-wrapper 内 */
export function lovOpenCss(name: string): string {
  return `.page-content .c7n-pro-select-wrapper:has(input[name="${name}"]) .icon-search`;
}
