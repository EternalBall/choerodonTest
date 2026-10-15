import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { writeYamlFile } from '../core/config.js';
import { PATHS } from '../core/paths.js';
import type { FeatureArtifact, Suite } from '../core/schema.js';
import { logger } from '../core/logger.js';
import { featureSlug } from '../knowledge/featureSlug.js';
import { ensureMetaOpsAndFlows } from './defaultFlows.js';
import { compileFlowToSteps } from './compileFlow.js';

/**
 * 将 feature 分析结果编译为可执行的 suite YAML。
 * 用例只从 flows 生成；operations 仅作能力摘要（审核）。
 */
export function featureToSuite(artifact: FeatureArtifact, baseURL?: string): Suite {
  const ns = slugNs(artifact.feature);
  const { meta_ops, flows } = ensureMetaOpsAndFlows(artifact);
  const enriched: FeatureArtifact = { ...artifact, meta_ops, flows };

  const cases: Suite['cases'] = [];
  for (const flow of flows) {
    try {
      const steps = compileFlowToSteps(flow, meta_ops, enriched);
      cases.push({
        id: `TC_${ns.toUpperCase()}_${flow.id.toUpperCase()}`,
        title: flow.title,
        tags: [
          artifact.feature,
          ...(flow.tags || []),
          ...(flow.source === 'user' ? ['flow:user'] : ['flow:default']),
        ],
        steps,
      });
    } catch (e) {
      logger.warn(
        { flow: flow.id, err: e instanceof Error ? e.message : String(e) },
        '跳过无法编译的 flow',
      );
    }
  }

  if (!cases.length) {
    logger.warn({ feature: artifact.feature }, '无可用 flows，生成空套件占位');
  }

  return {
    suite: `${artifact.feature} 自动生成`,
    baseURL,
    cases,
  };
}

/** 供 solidify / CLI 写回 feature 时合并默认 flows */
export function withEnsuredFlows(artifact: FeatureArtifact): FeatureArtifact {
  const { meta_ops, flows } = ensureMetaOpsAndFlows(artifact);
  return { ...artifact, meta_ops, flows };
}

export async function writeGeneratedSuite(
  suite: Suite,
  feature: string,
): Promise<string> {
  const file = path.join(PATHS.generatedCases, `${slugNs(feature)}.yaml`);
  await writeYamlFile(file, suite);
  logger.info({ file }, '已生成用例配置');
  return file;
}

export async function writeFeatureElementsStub(
  feature: string,
  artifact?: FeatureArtifact,
): Promise<string> {
  const ns = slugNs(feature);
  const { buildFeatureElementLib } = await import('../knowledge/platformKit.js');
  const merged = await buildFeatureElementLib(feature, artifact);

  if (merged.pickerConfirm && typeof merged.pickerConfirm === 'object') {
    const pc = merged.pickerConfirm as Record<string, unknown>;
    if (!pc.within) pc.within = `${ns}.pickerDialog`;
  }
  if (!merged.pickerConfirm) {
    merged.pickerConfirm = {
      role: 'button',
      name: '确定',
      within: `${ns}.pickerDialog`,
    };
  }
  if (!merged.pickerOpen) merged.pickerOpen = { role: 'button', name: '选择' };
  if (!merged.pickerDialog) merged.pickerDialog = { role: 'dialog' };
  if (!merged.pickerSearch) merged.pickerSearch = { placeholder: '搜索' };
  if (!merged.copyDrawer) {
    merged.copyDrawer = {
      css: '.c7n-pro-modal-wrapper.c7n-pro-modal-drawer.c7n-pro-modal-active:has(.c7n-pro-modal-title:text-is("复制"))',
    };
  }
  if (!merged.copyTargetCode) {
    merged.copyTargetCode = {
      css: '.c7n-pro-modal-wrapper.c7n-pro-modal-active input.c7n-pro-input[name="targetMaterialCode"]',
    };
  }
  if (!merged.copyConfirm) {
    merged.copyConfirm = {
      css: '.c7n-pro-modal-wrapper.c7n-pro-modal-active .c7n-pro-modal-footer button.c7n-pro-btn-primary',
    };
  }
  if (!merged.drawer) {
    merged.drawer = {
      css: '.c7n-pro-modal-wrapper.c7n-pro-modal-drawer.c7n-pro-modal-active',
    };
  }
  if (!merged.siteAssignmentBtn) {
    merged.siteAssignmentBtn = { role: 'button', name: '站点分配' };
  }
  if (!merged.siteAssignmentTable) {
    merged.siteAssignmentTable = { css: '.c7n-pro-table.c7n-pro-table-bordered' };
  }
  if (!merged.siteAttrLink) {
    merged.siteAttrLink = {
      css: '.action-link a',
      within: `${ns}.siteAssignmentTable`,
      note: '无 href 的 a；勿用 role=link / 勿裸 text',
    };
  }
  if (!merged.tableActionLink) {
    merged.tableActionLink = { css: '.action-link a' };
  }
  if (!merged.siteAddLineBtn) {
    merged.siteAddLineBtn = {
      css: 'thead button:has(.icon-add)',
      within: `${ns}.siteAssignmentTable`,
    };
  }
  if (!merged.siteRemoveLineBtn) {
    merged.siteRemoveLineBtn = {
      css: 'tbody tr.c7n-pro-table-row button:has(.icon-remove)',
      within: `${ns}.siteAssignmentTable`,
    };
  }
  if (!merged.siteEnableFlag) {
    merged.siteEnableFlag = {
      css: 'tr.c7n-pro-table-row input.c7n-pro-switch[name="enableFlag"]',
      within: `${ns}.siteAssignmentTable`,
      note: '已落库行可改的 Switch',
    };
  }
  if (!merged.siteRevisionFlag) {
    merged.siteRevisionFlag = {
      css: 'tr.c7n-pro-table-row input.c7n-pro-switch[name="revisionFlag"]',
      within: `${ns}.siteAssignmentTable`,
    };
  }
  if (!merged.siteLovOpen) {
    merged.siteLovOpen = {
      css: '.c7n-pro-select-wrapper:has(input[name="siteLov"]) .icon-search',
    };
  }
  if (!merged.siteLovCell) {
    merged.siteLovCell = {
      css: 'td[data-index="siteLov"] .c7n-pro-table-cell-inner-editable',
      within: `${ns}.siteAssignmentTable`,
    };
  }
  if (!merged.tableLovOpen) {
    merged.tableLovOpen = {
      css: '.c7n-pro-select-wrapper:has(input.c7n-pro-input) .icon-search',
    };
  }
  if (!merged.siteDeleteConfirm) {
    merged.siteDeleteConfirm = {
      css: '.c7n-popover .c7n-popover-buttons .c7n-btn-primary',
    };
  }
  if (!merged.extendAttrBtn) {
    merged.extendAttrBtn = { role: 'button', name: '扩展属性' };
  }
  if (!merged.secondaryUomTable) {
    merged.secondaryUomTable = {
      css: '.c7n-pro-table:has(th:text-is("默认辅单位"))',
    };
  }
  if (!merged.defaultSecondaryUomRadio) {
    merged.defaultSecondaryUomRadio = {
      css: '.c7n-radio-wrapper:not(.c7n-radio-wrapper-checked)',
      within: `${ns}.secondaryUomTable`,
    };
  }

  const stub: Record<string, Record<string, unknown>> = { [ns]: merged };
  const file = path.join(PATHS.elements, `${ns}.generated.yaml`);
  const header =
    `# generated from knowledge/platform + knowledge/features — do not hand-edit as source of truth\n` +
    `# curated overrides: knowledge/features/${featureSlug(feature)}/elements.yaml\n`;
  await fs.mkdir(path.dirname(file), { recursive: true });
  const body = YAML.stringify(stub);
  await fs.writeFile(file, header + body, 'utf8');
  logger.info({ file, keys: Object.keys(merged).length }, '已生成元素库（平台 kit 合并）');
  return file;
}

function slugNs(feature: string): string {
  const ascii = feature.replace(/[^\w]+/g, '_').replace(/^_|_$/g, '');
  if (ascii && /[a-zA-Z]/.test(ascii)) return ascii.toLowerCase();
  return `feat_${Buffer.from(feature).toString('hex').slice(0, 8)}`;
}
