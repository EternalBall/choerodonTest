import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { chromium } from '@playwright/test';
import { featureArtifactDir, featureArtifactFile, toArtifactDirName } from '../core/featurePaths.js';
import { resolveLocator } from '../keywords/resolveElement.js';
import { buildFeatureElementLib } from '../knowledge/platformKit.js';
import { resolveHints } from '../analyzer/featureCoverage.js';
import { judgeProbe, needsInteraction, suggestStatus, type ProbeVerdict } from './judge.js';

/**
 * 只读探测：打开功能页面，核对 needs_review 定位在真实 DOM 里是否成立。
 * 只使用 goto / count / isVisible / evaluate(只读)，不点击、不输入、不保存。
 */

export type ProbeItem = {
  page: string;
  route: string;
  key: string;
  def: Record<string, unknown>;
  verdict: ProbeVerdict | 'skipped';
  count?: number;
  visible?: boolean;
  /** 第一个匹配元素的 tag / class（只读取） */
  sample?: { tag: string; cls: string; text: string };
  suggested?: 'proposed' | 'needs_review';
  reason?: string;
};

export type ProbeReport = {
  feature: string;
  slug: string;
  baseURL: string;
  generatedAt: string;
  pages: { route: string; ok: boolean; tableCount?: number; error?: string }[];
  items: ProbeItem[];
  summary: Record<string, number>;
};

export type ProbeOptions = {
  feature: string;
  projectRoot: string;
  baseURL: string;
  storageState: string;
  proxy?: string;
  /** 只探测这些状态的定位（默认 needs_review） */
  statuses?: string[];
  timeoutMs?: number;
};

export async function probeFeature(opts: ProbeOptions): Promise<ProbeReport> {
  const slug = toArtifactDirName(opts.feature);
  const root = path.resolve(opts.projectRoot);
  const featureYaml = YAML.parse(await fs.readFile(featureArtifactFile(opts.feature), 'utf8')) as Record<string, any>;
  const locText = await fs.readFile(path.join(featureArtifactDir(opts.feature), 'page-locators.yaml'), 'utf8').catch(() => '');
  if (!locText) throw new Error('缺少 page-locators.yaml，请先跑 ata gen 生成页面定位草案');
  const loc = YAML.parse(locText) as { pages?: { file_entry: string; nodes: { locator_key?: string }[] }[]; locators?: Record<string, Record<string, unknown>> };
  const merged = (await buildFeatureElementLib(opts.feature, featureYaml as never)) as Record<string, Record<string, unknown>>;
  const lib = { [slug]: merged };

  // route → 源码文件（用 source_hint 解析），再映射到 page-locators 的页面
  const files = await listFiles(root);
  const routeOfEntry = new Map<string, string>();
  for (const p of (featureYaml.pages ?? []) as { scope?: string; route?: string; source_hint?: string }[]) {
    if (p.scope !== 'in_feature' || !p.route || !p.source_hint) continue;
    for (const h of resolveHints(p.source_hint, files).hits) routeOfEntry.set(h, p.route);
  }

  const wanted = new Set(opts.statuses ?? ['needs_review']);
  const items: ProbeItem[] = [];
  const byRoute = new Map<string, ProbeItem[]>();
  for (const pg of loc.pages ?? []) {
    const abs = path.resolve(root, pg.file_entry);
    const route = routeOfEntry.get(abs);
    const keys = [...new Set(pg.nodes.map((n) => n.locator_key).filter((k): k is string => !!k))];
    for (const key of keys) {
      const def = (merged[key] ?? loc.locators?.[key]) as Record<string, unknown> | undefined;
      if (!def) continue;
      const status = (loc.locators?.[key]?.status as string | undefined) ?? 'proposed';
      if (!wanted.has(status)) continue;
      const withinCss = typeof def.within === 'string' ? (merged[String(def.within).split('.').pop()!]?.css as string | undefined) : undefined;
      const item: ProbeItem = { page: pg.file_entry, route: route ?? '', key, def, verdict: 'skipped' };
      if (!route) item.reason = '页面无独立路由（弹层/子组件），本期不探测';
      else if (route.includes(':')) item.reason = '路由需要数据 id，本期不探测';
      else if (needsInteraction(key, def.css as string | undefined, withinCss)) item.reason = '需要先交互（弹层/下拉）才出现，本期不探测';
      items.push(item);
      if (!item.reason) (byRoute.get(route!) ?? byRoute.set(route!, []).get(route!)!).push(item);
    }
  }

  const pages: ProbeReport['pages'] = [];
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
    ...(opts.proxy ? { proxy: { server: opts.proxy } } : {}),
  });
  try {
    const ctx = await browser.newContext({ storageState: opts.storageState, baseURL: opts.baseURL, ignoreHTTPSErrors: true });
    for (const [route, list] of byRoute) {
      const page = await ctx.newPage();
      const pr: ProbeReport['pages'][number] = { route, ok: false };
      try {
        await page.goto(route, { waitUntil: 'domcontentloaded', timeout: opts.timeoutMs ?? 45_000 });
        await page.waitForSelector('.page-content, .c7n-pro-table', { timeout: opts.timeoutMs ?? 45_000 });
        await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
        if (/login|oauth|sso/i.test(new URL(page.url()).pathname)) throw new Error('登录态失效，请先运行 ata auth');
        pr.tableCount = await page.locator('.c7n-pro-table').count();
        for (const it of list) {
          try {
            const loc = resolveLocator(page, lib, it.def as never);
            const count = await loc.count();
            const first = loc.first();
            const visible = count > 0 ? await first.isVisible() : false;
            it.count = count;
            it.visible = visible;
            if (count > 0) {
              it.sample = await first.evaluate((el: { tagName: string; textContent: string | null; getAttribute(n: string): string | null }) => ({
                tag: el.tagName.toLowerCase(),
                cls: String(el.getAttribute('class') ?? '').slice(0, 80),
                text: (el.textContent ?? '').trim().slice(0, 30),
              }));
            }
            it.verdict = judgeProbe({ count, firstVisible: visible }, it.def.css as string | undefined);
            it.suggested = suggestStatus(it.verdict);
          } catch (e) {
            it.reason = `探测出错：${String(e).slice(0, 120)}`;
          }
        }
        pr.ok = true;
      } catch (e) {
        pr.error = String(e).slice(0, 200);
        for (const it of list) it.reason = `页面未能打开：${pr.error}`;
      } finally {
        await page.close();
      }
      pages.push(pr);
    }
  } finally {
    await browser.close();
  }

  const summary: Record<string, number> = {};
  for (const it of items) summary[it.verdict] = (summary[it.verdict] ?? 0) + 1;
  return { feature: String(featureYaml.feature ?? opts.feature), slug, baseURL: opts.baseURL, generatedAt: new Date().toISOString(), pages, items, summary };
}

async function listFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  const skip = new Set(['node_modules', 'stores', 'services', 'models', 'assets', 'styles', '__tests__']);
  const walk = async (dir: string) => {
    let ents;
    try {
      ents = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!skip.has(e.name)) await walk(p);
      } else if (/\.(tsx|jsx|js)$/.test(e.name)) out.push(p);
    }
  };
  for (const pkg of await fs.readdir(path.join(root, 'packages')).catch(() => [] as string[])) await walk(path.join(root, 'packages', pkg, 'src', 'routes'));
  return out;
}

export function renderProbeMd(r: ProbeReport): string {
  const L: string[] = [`# ${r.feature} 只读探测报告`, '', `环境：${r.baseURL}　时间：${r.generatedAt}`, '只读：仅 goto / count / isVisible / 读取属性，未做任何点击、输入或保存。', ''];
  L.push('## 汇总', '', Object.entries(r.summary).map(([k, v]) => `- ${k}：${v}`).join('\n') || '无待探测项', '');
  L.push('## 页面', '', '| 路由 | 结果 | .c7n-pro-table 数 | 说明 |', '|---|---|---|---|');
  for (const p of r.pages) L.push(`| ${p.route} | ${p.ok ? '已打开' : '失败'} | ${p.tableCount ?? '-'} | ${p.error ?? ''} |`);
  L.push('', '## 定位核对', '', '| 定位键 | 结论 | 匹配数 | 可见 | 样例 | 建议状态 | 备注 |', '|---|---|---|---|---|---|---|');
  for (const it of r.items) {
    const s = it.sample ? `<${it.sample.tag}> ${it.sample.cls}` : '-';
    L.push(`| ${it.key} | ${it.verdict} | ${it.count ?? '-'} | ${it.visible ?? '-'} | ${s} | ${it.suggested ?? '-'} | ${it.reason ?? ''} |`);
  }
  L.push('', '说明：建议状态只写在报告里，不会自动改 elements.yaml；探测只证明“此刻页面上能匹配到”，不证明语义正确（如 nth 指向的是不是想要的那张表）。missing 不等于定位错误：行内链接要有数据行、下拉与弹层要先交互才会出现，需结合数据和操作判断。');
  return L.join('\n') + '\n';
}
