import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { PATHS } from '../core/paths.js';
import type { FeatureArtifact } from '../core/schema.js';
import { logger } from '../core/logger.js';
import { featureSlug } from './featureSlug.js';

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
 * 合并：platform ← feature overlay ← field_rules ← hints（hints 不覆盖已有 css）
 */
export async function buildFeatureElementLib(
  feature: string,
  artifact?: FeatureArtifact,
): Promise<ElementMap> {
  const base = await loadPlatformKit();
  const overlay = await loadFeatureElementsOverlay(feature);
  const merged: ElementMap = { ...base, ...overlay };

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

function cssForFieldRule(name: string, control?: string): string | undefined {
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
