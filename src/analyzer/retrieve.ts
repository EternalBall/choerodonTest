import fs from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';
import { logger } from '../core/logger.js';
import {
  CHILD_FULL_MAX_CHARS,
  defaultPriority,
  extractJsxEntryInfo,
  isLikelyPageIndex,
  isMegalith,
  resolveLocalImportCandidates,
  sliceMegalithForJsxEntry,
  sortSnippetsForPrompt,
  type PrioritizedSnippet,
} from './jsxEntry.js';

export type CodeSnippet = {
  relativePath: string;
  absolutePath: string;
  content: string;
  /** 越大越先入 prompt；缺省由 formatSnippetsForPrompt 按路径启发 */
  priority?: number;
  note?: string;
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
 * 大页 index 按 JSX 入口切片，并强制带上 JSX 引用的本地子组件全文。
 */
export async function retrieveFeatureCode(opts: {
  feature: string;
  projectRoot: string;
  maxFiles?: number;
  maxCharsPerFile?: number;
  /** 功能源码目录（相对 projectRoot 或绝对路径）；提供时读该目录完整文件，不做关键词检索 */
  featureDir?: string;
}): Promise<RetrieveResult> {
  const root = path.resolve(opts.projectRoot);
  if (opts.featureDir) return retrieveFeatureDir(root, opts.featureDir);
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
  all.sort(); // 同上：固定顺序，兄弟目录扩扫的入选顺序才可复现

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
    // 同分按路径字典序，保证检索结果与 prompt 确定（fast-glob 返回顺序不稳定；handoff 模式靠 prompt 哈希复用应答）
    .sort((a, b) => b.score - a.score || (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));

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

  const byRel = new Map(all.map((abs) => [path.relative(root, abs).replace(/\\/g, '/'), abs]));

  const snippets: CodeSnippet[] = [];
  for (const item of picked) {
    try {
      const raw = await fs.readFile(item.abs, 'utf8');
      snippets.push(await materializeSnippet(root, item.rel, item.abs, raw, maxChars, byRel));
    } catch {
      // skip
    }
  }

  const expanded = await expandJsxChildren(root, snippets, byRel, {
    // 为 JSX 子组件预留名额：可略超 maxFiles
    hardMaxFiles: maxFiles + 12,
  });

  logger.info(
    { root, feature: opts.feature, files: expanded.length },
    'retrieveFeatureCode',
  );

  return { root, snippets: expanded };
}

const DIR_GLOB = '**/*.{ts,tsx,js,jsx}';
const DIR_IGNORE = [
  '**/node_modules/**',
  '**/*.d.ts',
  '**/*.test.*',
  '**/*.spec.*',
  '**/__snapshots__/**',
];

/**
 * 按功能目录读取完整文件：关键词检索会截断且漏文件，
 * 用户明确指定目录时应拿到该目录的全部源码，且不混入目录外文件。
 * 巨石 index 仍按 JSX 入口切片，避免单文件占满 prompt。
 */
async function retrieveFeatureDir(root: string, featureDir: string): Promise<RetrieveResult> {
  const dir = path.resolve(root, featureDir);
  const abs = await fg(DIR_GLOB, {
    cwd: dir,
    absolute: true,
    onlyFiles: true,
    ignore: DIR_IGNORE,
  });
  const items = abs
    .map((a) => ({ abs: a, rel: path.relative(root, a).replace(/\\/g, '/') }))
    .sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0)); // 固定顺序，保证 prompt 可复现

  const byRel = new Map(items.map((i) => [i.rel, i.abs]));
  const snippets: CodeSnippet[] = [];
  let totalChars = 0;
  for (const item of items) {
    const content = await fs.readFile(item.abs, 'utf8');
    const snip = await materializeSnippet(root, item.rel, item.abs, content, Number.POSITIVE_INFINITY, byRel);
    snippets.push(snip);
    totalChars += snip.content.length;
  }

  const expanded = await expandJsxChildren(root, snippets, byRel, {
    hardMaxFiles: items.length + 8,
  });

  logger.info(
    { root, featureDir: dir, files: expanded.length, totalChars },
    'retrieveFeatureCode(dir)',
  );
  return { root, snippets: expanded };
}

/**
 * 读入后：巨石页 index → JSX 切片；其它按 maxChars 截断。
 */
async function materializeSnippet(
  _root: string,
  rel: string,
  abs: string,
  raw: string,
  maxChars: number,
  _byRel: Map<string, string>,
): Promise<CodeSnippet> {
  if (isLikelyPageIndex(rel) && isMegalith(raw)) {
    const { content, info } = sliceMegalithForJsxEntry(raw);
    logger.info(
      {
        file: rel,
        originalChars: raw.length,
        sliceChars: content.length,
        jsxTags: info.jsxTags,
        children: info.localImportPaths,
        entryLabels: info.entryLabels,
      },
      'jsxEntry: megalith sliced',
    );
    return {
      relativePath: rel,
      absolutePath: abs,
      content,
      priority: defaultPriority(rel, 'jsx-megalith-slice'),
      note: 'jsx-megalith-slice',
    };
  }

  const truncated = Number.isFinite(maxChars) ? raw.slice(0, maxChars) : raw;
  return {
    relativePath: rel,
    absolutePath: abs,
    content: truncated,
    priority: defaultPriority(rel),
  };
}

/**
 * 对已切片/已纳入的页 index，强制补齐 JSX 引用的本地子组件全文。
 */
async function expandJsxChildren(
  root: string,
  snippets: CodeSnippet[],
  byRel: Map<string, string>,
  opts: { hardMaxFiles: number },
): Promise<CodeSnippet[]> {
  const bySnippet = new Map(snippets.map((s) => [s.relativePath, { ...s }]));
  const extras: CodeSnippet[] = [];

  const resolveChild = async (
    parentRel: string,
    spec: string,
  ): Promise<{ rel: string; abs: string } | undefined> => {
    for (const cand of resolveLocalImportCandidates(parentRel, spec)) {
      if (byRel.has(cand)) {
        return { rel: cand, abs: byRel.get(cand)! };
      }
      const absTry = path.resolve(root, cand);
      try {
        await fs.access(absTry);
        return { rel: cand.replace(/\\/g, '/'), abs: absTry };
      } catch {
        // continue
      }
    }
    return undefined;
  };

  const ensureChildFull = async (parentRel: string, spec: string) => {
    const hit = await resolveChild(parentRel, spec);
    if (!hit) return;

    try {
      const raw = await fs.readFile(hit.abs, 'utf8');
      const content = raw.slice(0, CHILD_FULL_MAX_CHARS);
      const upgraded: CodeSnippet = {
        relativePath: hit.rel,
        absolutePath: hit.abs,
        content,
        priority: defaultPriority(hit.rel, 'jsx-child-full'),
        note: 'jsx-child-full',
      };

      if (bySnippet.has(hit.rel)) {
        bySnippet.set(hit.rel, upgraded);
        logger.info(
          { parent: parentRel, child: hit.rel, chars: content.length, mode: 'upgrade' },
          'jsxEntry: child full',
        );
        return;
      }
      if (bySnippet.size + extras.length >= opts.hardMaxFiles) return;
      extras.push(upgraded);
      bySnippet.set(hit.rel, upgraded);
      logger.info(
        { parent: parentRel, child: hit.rel, chars: content.length, mode: 'add' },
        'jsxEntry: child full',
      );
    } catch {
      // skip
    }
  };

  for (const snip of [...bySnippet.values()]) {
    if (!isLikelyPageIndex(snip.relativePath) && snip.note !== 'jsx-megalith-slice') {
      if (!snip.content.includes('import ') || !/<[A-Z]/.test(snip.content)) continue;
    }

    const info = extractJsxEntryInfo(snip.content);
    const fromNote = [...snip.content.matchAll(/local_children:\s*([^\n*]+)/g)].flatMap((m) =>
      m[1].split(',').map((s) => s.trim()).filter(Boolean),
    );
    const specs = [...new Set([...info.localImportPaths, ...fromNote])];
    for (const spec of specs) {
      await ensureChildFull(snip.relativePath, spec);
    }
  }

  return sortSnippetsForPrompt(
    [...bySnippet.values()].map((s) => ({
      ...s,
      priority: s.priority ?? defaultPriority(s.relativePath, s.note),
    })),
  );
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
  const ordered = sortSnippetsForPrompt(
    snippets.map((s) => ({
      ...s,
      priority: s.priority ?? defaultPriority(s.relativePath, s.note),
    })),
  ) as PrioritizedSnippet[];

  const parts: string[] = [];
  const dropped: string[] = [];
  let used = 0;
  for (const s of ordered) {
    const label = s.note ? `${s.relativePath} [${s.note}]` : s.relativePath;
    const block = `===== FILE: ${label} =====\n${s.content}\n`;
    // 超限后不再放入任何后续文件，并记录被丢弃者
    if (dropped.length > 0 || used + block.length > maxTotalChars) {
      dropped.push(s.relativePath);
      continue;
    }
    parts.push(block);
    used += block.length;
  }
  if (dropped.length > 0) {
    logger.warn(
      { maxTotalChars, used, dropped, order: ordered.map((s) => s.relativePath) },
      'formatSnippetsForPrompt: 超出总字符上限，以下文件被丢弃（已按 JSX 子组件优先排序）',
    );
  }
  return parts.join('\n');
}
