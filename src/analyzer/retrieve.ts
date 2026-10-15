import fs from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';
import { logger } from '../core/logger.js';

export type CodeSnippet = {
  relativePath: string;
  absolutePath: string;
  content: string;
};

export type RetrieveResult = {
  root: string;
  snippets: CodeSnippet[];
};

const CODE_GLOB = '**/*.{ts,tsx,js,jsx,vue}';
const IGNORE = ['**/node_modules/**', '**/dist/**', '**/.git/**', '**/coverage/**', '**/*.d.ts'];

/** 本功能内应优先纳入的关联页（同目录族），跨功能目录不主动扩扫 */
const IN_FEATURE_BOOST =
  /materiallist|materialdetail|materialsiteassignment|copydrawer|sitesassignment|stories\/material/i;

/** 跨功能包：命中时降低分，避免把对方整页源码当成本功能深挖证据 */
const EXTERNAL_FEATURE_PENALTY =
  /materialsiteproperties|materialcategory|materialplan(?!ager)/i;

/**
 * 检索功能相关源码片段，供 DeepSeek 分析。
 * 优先：功能名命中 + List/Detail/本功能关联页；再扩扫同 feature 目录内文件。
 * 不主动扩扫独立功能包（如 MaterialSiteProperties）。
 */
export async function retrieveFeatureCode(opts: {
  feature: string;
  projectRoot: string;
  maxFiles?: number;
  maxCharsPerFile?: number;
}): Promise<RetrieveResult> {
  const root = path.resolve(opts.projectRoot);
  const maxFiles = opts.maxFiles ?? 28;
  const maxChars = opts.maxCharsPerFile ?? 6000;
  const needle = opts.feature.trim().toLowerCase();

  const all = await fg(CODE_GLOB, {
    cwd: root,
    absolute: true,
    onlyFiles: true,
    ignore: IGNORE,
    caseSensitiveMatch: false,
  });

  const scored = all
    .map((abs) => {
      const rel = path.relative(root, abs).replace(/\\/g, '/');
      const lower = rel.toLowerCase();
      const base = path.basename(abs).toLowerCase();
      let score = 0;

      if (lower.includes(needle) || base.includes(needle)) score += 50;
      if (/list|detail|create|edit|form|drawer|modal|service|stor(y|ies)|route|index/i.test(rel)) {
        score += 10;
      }
      if (IN_FEATURE_BOOST.test(lower)) score += 35;
      if (EXTERNAL_FEATURE_PENALTY.test(lower)) score -= 40;
      if (base === 'index.tsx' || base === 'index.ts' || base === 'index.js') score += 5;
      score += 1;

      return { abs, rel, score };
    })
    .filter((x) => x.score > 1)
    .sort((a, b) => b.score - a.score);

  const pickedRel = new Set<string>();
  const picked: Array<{ abs: string; rel: string }> = [];

  const push = (abs: string, rel: string) => {
    if (pickedRel.has(rel) || picked.length >= maxFiles) return;
    // 跨功能整包不主动纳入（除非功能关键词就在对方名上）
    if (EXTERNAL_FEATURE_PENALTY.test(rel.toLowerCase()) && !rel.toLowerCase().includes(needle)) {
      return;
    }
    pickedRel.add(rel);
    picked.push({ abs, rel });
  };

  for (const item of scored) {
    push(item.abs, item.rel);
  }

  // 以高分命中文件为种子，扩扫同 feature 目录（如 .../Material/**），不含兄弟功能包
  const seeds = scored.filter((x) => x.score >= 40).slice(0, 8);
  for (const seed of seeds) {
    const featureDir = guessFeatureDir(seed.rel);
    if (!featureDir) continue;
    const siblings = all.filter((abs) => {
      const rel = path.relative(root, abs).replace(/\\/g, '/');
      return (
        rel.startsWith(featureDir + '/') &&
        !EXTERNAL_FEATURE_PENALTY.test(rel.toLowerCase())
      );
    });
    for (const abs of siblings) {
      const rel = path.relative(root, abs).replace(/\\/g, '/');
      push(abs, rel);
      if (picked.length >= maxFiles) break;
    }
    if (picked.length >= maxFiles) break;
  }

  const snippets: CodeSnippet[] = [];
  for (const item of picked) {
    try {
      const raw = await fs.readFile(item.abs, 'utf8');
      snippets.push({
        relativePath: item.rel,
        absolutePath: item.abs,
        content: raw.slice(0, maxChars),
      });
    } catch {
      // skip
    }
  }

  logger.info(
    { root, feature: opts.feature, files: snippets.length },
    'retrieveFeatureCode',
  );

  return { root, snippets };
}

/** .../routes/product/Material/xxx → .../routes/product/Material */
function guessFeatureDir(rel: string): string | undefined {
  const norm = rel.replace(/\\/g, '/');
  const m = norm.match(/^(.*\/(?:Material|material)(?:Manager)?)(?=\/)/);
  if (m) return m[1];
  // 通用：取含 List|Detail 的父目录的上一级（功能根）
  const parts = norm.split('/');
  const idx = parts.findIndex((p) => /List|Detail|SiteAssignment|CopyDrawer/i.test(p));
  if (idx > 0) return parts.slice(0, idx).join('/');
  return undefined;
}

export function formatSnippetsForPrompt(snippets: CodeSnippet[], maxTotalChars = 80_000): string {
  const parts: string[] = [];
  let used = 0;
  for (const s of snippets) {
    const block = `===== FILE: ${s.relativePath} =====\n${s.content}\n`;
    if (used + block.length > maxTotalChars) break;
    parts.push(block);
    used += block.length;
  }
  return parts.join('\n');
}
