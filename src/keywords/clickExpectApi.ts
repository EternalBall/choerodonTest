import { clickWithDiagnosis, DataNotReadyError } from './scope.js';
import type { Page, Response } from '@playwright/test';
import type { ActionContext } from './index.js';

/**
 * 点击后等待业务接口：
 * - 匹配 urlIncludes 的请求若 HTTP/业务失败 → 立即失败（含唯一性校验）
 * - 仅当命中 successUrlIncludes（默认=urlIncludes）且成功 → 通过
 *
 * args:
 *   target, urlIncludes, successUrlIncludes?, methods?, timeout?, optionalToast?, toastTimeout?
 */
export async function clickExpectApi(
  ctx: ActionContext,
  args: Record<string, unknown>,
): Promise<void> {
  const target = String(args.target || '');
  if (!target) throw new Error('clickExpectApi 需要 target');

  const needles = normalizeNeedles(args.urlIncludes ?? args.url);
  if (!needles.length) {
    throw new Error('clickExpectApi 需要 urlIncludes（如 mt-material/save/ui）');
  }
  const successNeedles = normalizeNeedles(args.successUrlIncludes);
  const successList = successNeedles.length ? successNeedles : needles;

  // 未显式指定时：写接口默认 POST/PUT；查询类接口（list/query/detail/page）常为 GET，一并放行
  const readLike = needles.some((n) => /\/(list|query|detail|page)(\/|$|\?)/i.test(n));
  const defaultMethods = readLike ? ['GET', 'POST', 'PUT'] : ['POST', 'PUT'];
  const methods = (Array.isArray(args.methods) ? args.methods : defaultMethods).map((m) =>
    String(m).toUpperCase(),
  );
  const timeout = Number(args.timeout ?? 30_000);

  const resultPromise = waitApiOutcome(ctx.page, {
    needles,
    successList,
    methods,
    timeout,
  });

  let loc = ctx.el(target);
  if (args.hasText != null) {
    loc = loc.filter({ hasText: String(args.hasText) });
  }
  if (args.exactText != null) {
    const s = String(args.exactText).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    loc = loc.filter({ hasText: new RegExp(`^${s}$`) });
  }
  if (args.first === true || args.nth === 0) {
    loc = loc.first();
  } else if (typeof args.nth === 'number') {
    loc = loc.nth(Number(args.nth));
  }
  // 点击本身失败（目标不存在 / 被遮挡）要单独报，不能混成「没等到接口」
  try {
    await clickWithDiagnosis(loc, String(target), Number(args.clickTimeout ?? 20_000));
  } catch (e) {
    resultPromise.catch(() => undefined);
    throw e;
  }
  let outcome: Outcome;
  try {
    outcome = await resultPromise;
  } catch (e) {
    // 没有发出请求时，多半是前端校验拦截：把页面上的校验信息带进报错，便于区分「数据不全」与「接口问题」
    const hints = await collectValidationHints(ctx.page);
    throw new Error(`${(e as Error).message}${hints ? `；页面提示：${hints}` : '；页面上没有可见的校验提示'}`);
  }

  // 唯一约束冲突（如 MT_UK_..._U1、「已存在」）：同组合的数据已在环境里，属数据冲突而非功能失败
  if (outcome.kind === 'fail' && /(_UK_|_U\d\b|已存在|duplicate key|unique constraint)/i.test(outcome.message ?? '')) {
    throw new DataNotReadyError(`数据冲突：保存被唯一约束拦截（${String(outcome.message).split('\n')[0]}），同样的数据已存在，需换一条测试数据或先清理`);
  }
  if (outcome.kind === 'fail') {
    throw new Error(
      `接口失败 status=${outcome.status} url=${outcome.url}\n${outcome.message || '(无响应体)'}`,
    );
  }

  if (args.optionalToast) {
    const { expect } = await import('@playwright/test');
    try {
      await expect(ctx.el(String(args.optionalToast))).toBeVisible({
        timeout: Number(args.toastTimeout ?? 8_000),
      });
    } catch {
      throw new Error(
        `接口已成功（${outcome.status} ${outcome.url}），但未出现成功提示: ${args.optionalToast}`,
      );
    }
  }
}

/** 收集可见的表单校验 / 通知文案（仅用于报错诊断） */
async function collectValidationHints(page: Page): Promise<string> {
  const texts = await page
    .locator(
      '.c7n-pro-validation-message, .c7n-pro-notification-notice, .c7n-notification-notice, .c7n-message-notice, .c7n-pro-message-notice',
    )
    .evaluateAll((els) =>
      els
        .filter((e) => (e as unknown as { getClientRects(): { length: number } }).getClientRects().length)
        .map((e) => String((e as unknown as { innerText?: string }).innerText ?? "").trim())
        .filter(Boolean),
    )
    .catch(() => [] as string[]);
  const invalid = await page
    .locator('[class*="-invalid"] input[name], [class*="-invalid"] textarea[name]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('name')).filter(Boolean))
    .catch(() => [] as (string | null)[]);
  const parts = [...new Set(texts)].slice(0, 5);
  if (invalid.length) parts.push(`校验未通过字段: ${[...new Set(invalid)].join(', ')}`);
  return parts.join(' | ');
}

type Outcome =
  | { kind: 'ok'; status: number; url: string }
  | { kind: 'fail'; status: number; url: string; message: string };

function waitApiOutcome(
  page: Page,
  opts: {
    needles: string[];
    successList: string[];
    methods: string[];
    timeout: number;
  },
): Promise<Outcome> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          `点击后未等到成功接口（监听=${opts.needles.join('|')}，成功需=${opts.successList.join('|')}）`,
        ),
      );
    }, opts.timeout);

    const onResponse = (r: Response) => {
      void (async () => {
        if (settled) return;
        if (!opts.methods.includes(r.request().method().toUpperCase())) return;
        const url = r.url();
        if (!opts.needles.some((n) => url.includes(n))) return;

        const bodyText = await r.text().catch(() => '');
        let body: unknown = null;
        try {
          body = bodyText ? JSON.parse(bodyText) : null;
        } catch {
          body = bodyText.slice(0, 800);
        }

        const biz = analyzeHzeroBody(body);
        const status = r.status();
        if (!r.ok() || biz.failed) {
          settled = true;
          cleanup();
          resolve({
            kind: 'fail',
            status,
            url,
            message: biz.message || (typeof body === 'string' ? body : JSON.stringify(body)),
          });
          return;
        }

        if (opts.successList.some((n) => url.includes(n))) {
          settled = true;
          cleanup();
          resolve({ kind: 'ok', status, url });
        }
        // check 成功但尚未 save：继续等
      })().catch((e) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(e);
      });
    };

    const cleanup = () => {
      clearTimeout(timer);
      page.off('response', onResponse);
    };

    page.on('response', onResponse);
  });
}

function normalizeNeedles(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  return [String(raw)].filter(Boolean);
}

function analyzeHzeroBody(body: unknown): { failed: boolean; message: string } {
  if (!body || typeof body !== 'object') {
    return { failed: false, message: '' };
  }
  const o = body as Record<string, unknown>;
  const failed =
    o.failed === true ||
    o.success === false ||
    o.status === false ||
    (typeof o.code === 'string' &&
      o.code.length > 0 &&
      !['0', 'ok', 'success', '200'].includes(o.code.toLowerCase()) &&
      Boolean(o.message || o.msg || o.errorMessage));

  const message = String(
    o.message ?? o.msg ?? o.errorMessage ?? o.errorMsg ?? o.exception ?? '',
  );
  return { failed, message };
}
