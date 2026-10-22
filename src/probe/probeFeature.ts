import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { chromium, type Page } from '@playwright/test';
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
  /** 探测时页面所处阶段：初始 / 选中单据行后 / 详情页 / 点“编辑”后 */
  stage?: 'initial' | 'row_selected' | 'detail' | 'edit';
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
  pages: { route: string; ok: boolean; tableCount?: number; error?: string; note?: string }[];
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
  /** 列表里的单据号：选中该行并进入其详情页，补探测行依赖与详情页定位（只点击，不输入、不保存） */
  doc?: string;
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
      else if (route.includes(':') && !opts.doc) item.reason = '路由需要数据 id，未指定 --doc，不探测';
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
    const probeList = async (page: Page, list: ProbeItem[], stage: NonNullable<ProbeItem['stage']>) => {
      for (const it of list) {
        try {
          const target = resolveLocator(page, lib, it.def as never);
          const count = await target.count();
          const first = target.first();
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
          it.stage = stage;
          it.reason = undefined;
        } catch (e) {
          it.reason = `探测出错：${String(e).slice(0, 120)}`;
        }
      }
    };
    const staticRoutes = [...byRoute.keys()].filter((r) => !r.includes(':'));
    const detailRoutes = [...byRoute.keys()].filter((r) => r.includes(':'));
    const T = opts.timeoutMs ?? 45_000;
    for (const route of staticRoutes) {
      const list = byRoute.get(route)!;
      const page = await ctx.newPage();
      const pr: ProbeReport['pages'][number] = { route, ok: false };
      try {
        await page.goto(route, { waitUntil: 'domcontentloaded', timeout: T });
        // 登录态失效会被重定向到登录页：先等页面稳定再判断，避免空等 45 秒后才报超时
        await page.waitForSelector('.page-content, .c7n-pro-table, input[type="password"]', { timeout: T });
        if (/login|oauth|sso/i.test(new URL(page.url()).pathname)) throw new Error('登录态失效（已被重定向到登录页），请先运行 ata auth');
        await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
        pr.tableCount = await page.locator('.c7n-pro-table').count();
        await probeList(page, list, 'initial');
        pr.ok = true;

        // 指定单据：选中头表该行（单击行，触发行表查询）→ 复探依赖数据的定位 → 点单号链接进详情
        if (opts.doc) {
          const row = page.locator('.c7n-pro-table').nth(0).locator('tr.c7n-pro-table-row').filter({ hasText: opts.doc }).first();
          if ((await row.count()) === 0) {
            pr.note = `头表当前页没有单据 ${opts.doc}（可能在其它分页），未选中行`;
          } else {
            await row.click();
            await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
            await probeList(page, list.filter((i) => i.verdict !== 'ok'), 'row_selected');
            const linkDef = loc.locators?.instructionDocNumLink;
            const linkCss = typeof linkDef?.css === 'string' ? linkDef.css : undefined;
            const link = linkCss ? row.locator(linkCss).first() : undefined;
            if (!link || (await link.count()) === 0) {
              pr.note = `单据 ${opts.doc} 的单号不是链接（该功能仅部分状态可进详情），未进入详情页`;
            } else {
              await link.click();
              await page.waitForURL(/detail|dist/, { timeout: 20_000 }).catch(() => undefined);
              // 详情页数据异步渲染：.page-content 在列表页就已存在，不能当就绪信号；
              // 等详情自己的内容（表头/表体行/按钮）出现，再等网络空闲
              await page.waitForSelector('.c7n-pro-table th[data-index], button.c7n-pro-btn', { timeout: T }).catch(() => undefined);
              await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
              await page.waitForTimeout(1500);
              const url = new URL(page.url()).pathname;
              pages.push({ route: url, ok: /detail|dist/.test(url), note: '由列表点击单号进入' });
              for (const dr of detailRoutes) await probeList(page, byRoute.get(dr)!, 'detail');

              // 编辑态：点“编辑”（不保存、不改任何字段）后复探详情里仍未通过的定位
              const editDef = (merged.btnEdit ?? loc.locators?.btnEdit) as never;
              const editBtn = editDef ? resolveLocator(page, lib, editDef) : undefined;
              if (editBtn && (await editBtn.count()) === 1) {
                await editBtn.click();
                await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
                await page.waitForTimeout(1500);
                for (const dr of detailRoutes) await probeList(page, byRoute.get(dr)!.filter((i) => i.verdict !== 'ok'), 'edit');
              } else {
                pages.push({ route: url, ok: true, note: '未找到唯一的“编辑”按钮，未进入编辑态' });
              }
            }
          }
        }
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
  for (const p of r.pages) L.push(`| ${p.route} | ${p.ok ? '已打开' : '失败'} | ${p.tableCount ?? '-'} | ${p.error ?? p.note ?? ''} |`);
  L.push('', '## 定位核对', '', '| 定位键 | 阶段 | 结论 | 匹配数 | 可见 | 样例 | 建议状态 | 备注 |', '|---|---|---|---|---|---|---|---|');
  for (const it of r.items) {
    const s = it.sample ? `<${it.sample.tag}> ${it.sample.cls}` : '-';
    L.push(`| ${it.key} | ${it.stage ?? '-'} | ${it.verdict} | ${it.count ?? '-'} | ${it.visible ?? '-'} | ${s} | ${it.suggested ?? '-'} | ${it.reason ?? ''} |`);
  }
  L.push('', '说明：建议状态只写在报告里，不会自动改 elements.yaml；探测只证明“此刻页面上能匹配到”，不证明语义正确（如 nth 指向的是不是想要的那张表）。missing 不等于定位错误：行内链接要有数据行、下拉与弹层要先交互才会出现，需结合数据和操作判断。');
  return L.join('\n') + '\n';
}
