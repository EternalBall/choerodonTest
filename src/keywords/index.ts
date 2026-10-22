import { expect, type Locator, type Page } from '@playwright/test';
import type { AssertSchema } from '../core/schema.js';
import type { z } from 'zod';
import { waitReady, type ReadySpec } from './waitReady.js';
import type { createElResolver } from './resolveElement.js';
import { tableFilterQuery } from './tableFilterQuery.js';
import { pickLov } from './pickLov.js';
import { pickSelect } from './pickSelect.js';
import { clickExpectApi } from './clickExpectApi.js';
import { assertTableEmpty, assertTableHasRows } from './tableAssert.js';
import { openDetailRow } from './openDetailRow.js';
import type { VarMap } from './vars.js';

type El = ReturnType<typeof createElResolver>;
type AssertDef = z.infer<typeof AssertSchema>;

export type ActionContext = {
  page: Page;
  el: El;
  baseURL?: string;
  /** 同 case 内跨步骤变量 */
  vars: VarMap;
};

type ActionHandler = (ctx: ActionContext, args: Record<string, unknown>) => Promise<void>;

function str(v: unknown, name: string): string {
  if (typeof v !== 'string' || !v) throw new Error(`缺少参数: ${name}`);
  return v;
}

export const actions: Record<string, ActionHandler> = {
  async goto(ctx, args) {
    const pathOrUrl = str(args.path ?? args.url, 'path|url');
    const waitUntil = (args.waitUntil as 'domcontentloaded' | 'load' | 'networkidle' | 'commit') || 'domcontentloaded';
    await ctx.page.goto(pathOrUrl, { waitUntil });
    await waitReady(ctx.page, ctx.el, args.ready as ReadySpec | undefined);
  },

  async click(ctx, args) {
    let loc;
    if (args.target) {
      loc = ctx.el(str(args.target, 'target'));
    } else if (args.text != null) {
      // 无 href 的 <a onClick> 等：用文案，勿依赖 role=link
      loc = ctx.page.getByText(String(args.text), { exact: false });
    } else if (args.role && args.name != null) {
      loc = ctx.page.getByRole(String(args.role) as 'button' | 'link', {
        name: new RegExp(escapeRegExp(String(args.name))),
      });
    } else {
      throw new Error('click 需要 target，或 text，或 role + name');
    }
    if (args.hasText != null) {
      loc = loc.filter({ hasText: String(args.hasText) });
    }
    if (args.exactText != null) {
      loc = loc.filter({ hasText: new RegExp(`^${escapeRegExp(String(args.exactText))}$`) });
    }
    if (args.first === true || args.nth === 0) {
      loc = loc.first();
    } else if (typeof args.nth === 'number') {
      loc = loc.nth(Number(args.nth));
    }
    await loc.click();
  },

  async fill(ctx, args) {
    await ctx.el(str(args.target, 'target')).fill(str(args.value, 'value'));
  },

  async fillForm(ctx, args) {
    const raw = args.fields;
    if (!raw) throw new Error('fillForm 需要 fields');

    // 数组：[{ name|target, value?, control?, first?, option? }]
    if (Array.isArray(raw)) {
      for (const item of raw) {
        if (!item || typeof item !== 'object') continue;
        const o = item as Record<string, unknown>;
        const control = String(o.control || 'text');
        const name = o.name != null ? String(o.name) : undefined;
        const target = o.target != null ? String(o.target) : undefined;
        if (control === 'select') {
          await pickSelect(ctx, {
            name,
            target,
            first: o.first !== false,
            option: o.option ?? o.value,
          });
          continue;
        }
        if (control === 'switch') {
          // c7n Switch：input 本体不可填，点外层 label 切换；value 为 Y/true/1 视为开启
          const want = /^(y|true|1)$/i.test(String(o.value ?? 'Y'));
          const input = target ? ctx.el(target) : ctx.page.locator(`input[name="${name}"]`).first();
          if ((await input.isChecked()) !== want) {
            // input 自身带 class c7n-pro-switch（且不可点），实际可点的是外层 label
            const wrapper = input.locator('xpath=ancestor::label[1]');
            await wrapper.click();
          }
          continue;
        }
        if (control === 'lov') {
          if (!target && !o.open) {
            throw new Error('fillForm lov 字段需要 open/target（元素库 Lov 搜索图标）');
          }
          await pickLov(ctx, {
            open: String(o.open || target),
            first: o.first !== false,
            row: o.value ? { value: String(o.value) } : { first: true },
          });
          continue;
        }
        const value = o.value != null ? String(o.value) : '';
        if (!value) throw new Error(`fillForm 文本字段 ${name || target} 需要 value`);
        if (target) await ctx.el(target).fill(value);
        else if (name) {
          await ctx.page.locator(`input[name="${name}"]`).first().fill(value);
        } else {
          throw new Error('fillForm 字段需要 name 或 target');
        }
      }
      return;
    }

    const fields = raw as Record<string, string>;
    for (const [target, value] of Object.entries(fields)) {
      await ctx.el(target).fill(String(value));
    }
    const saveAs = args.saveAs as Record<string, string> | undefined;
    if (saveAs) {
      for (const [fieldTarget, varName] of Object.entries(saveAs)) {
        const v = fields[fieldTarget];
        if (v != null) ctx.vars[varName] = String(v);
      }
    }
  },

  async setVar(ctx, args) {
    const values =
      (args.values as Record<string, string> | undefined) ||
      (args as Record<string, unknown>);
    for (const [k, v] of Object.entries(values)) {
      if (k === 'values') continue;
      if (v == null) continue;
      ctx.vars[k] = String(v);
    }
  },

  async press(ctx, args) {
    await ctx.el(str(args.target, 'target')).press(str(args.key, 'key'));
  },

  /** 仅跑步骤级 assert（元操作 kind=assert） */
  async assert(_ctx, _args) {
    /* asserts 由 config-driven 的 runAsserts 执行 */
  },

  tableFilterQuery,
  pickLov,
  pickSelect,
  clickExpectApi,
  openDetailRow,
  assertTableHasRows,
  assertTableEmpty,

  async pickFromTable(ctx, args) {
    await ctx.el(str(args.open, 'open')).click();

    const dialog = ctx.el(str(args.dialog, 'dialog'));
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    await waitReady(ctx.page, ctx.el, {
      hidden: typeof args.dialogSpin === 'string' ? args.dialogSpin : undefined,
    });

    const search = args.search as { target?: string; value?: string } | undefined;
    if (search?.target && search.value) {
      await ctx.el(search.target).fill(search.value);
      await ctx.el(search.target).press('Enter');
    }

    const row = args.row as { by?: string; value?: string } | undefined;
    const rowValue = row?.value;
    if (!rowValue) throw new Error('pickFromTable 需要 row.value');

    const rowLocator = dialog.getByRole('row', { name: new RegExp(rowValue) });
    await expect(rowLocator.first()).toBeVisible({ timeout: 15_000 });
    await rowLocator.first().click();

    if (args.confirm) {
      await ctx.el(str(args.confirm, 'confirm')).click();
    }
    await expect(dialog).toBeHidden({ timeout: 15_000 });
  },

  async assertVisible(ctx, args) {
    await expect(ctx.el(str(args.target, 'target'))).toBeVisible();
  },

  async waitFor(ctx, args) {
    await waitReady(ctx.page, ctx.el, {
      visible: args.visible as string | undefined,
      hidden: args.hidden as string | undefined,
      response: args.response as string | undefined,
    });
  },

  async login(ctx, args) {
    const path = str(args.path ?? '/login', 'path');
    await ctx.page.goto(path, { waitUntil: 'domcontentloaded' });
    await ctx.el(str(args.userTarget ?? 'auth.username', 'userTarget')).fill(str(args.username, 'username'));
    await ctx.el(str(args.passTarget ?? 'auth.password', 'passTarget')).fill(str(args.password, 'password'));
    await ctx.el(str(args.submitTarget ?? 'auth.submit', 'submitTarget')).click();
    if (args.ready) {
      await waitReady(ctx.page, ctx.el, { visible: String(args.ready) });
    }
  },
};

export async function runAsserts(ctx: ActionContext, asserts: AssertDef[]): Promise<void> {
  for (const a of asserts) {
    switch (a.type) {
      case 'visible':
        await expect(ctx.el(a.target!)).toBeVisible();
        break;
      case 'hidden':
        await expect(ctx.el(a.target!)).toBeHidden();
        break;
      case 'textContains':
        await expect(ctx.el(a.target!)).toContainText(a.value ?? '');
        break;
      case 'valueEquals':
        await expect(ctx.el(a.target!)).toHaveValue(a.value ?? '');
        break;
      case 'urlContains':
        await expect(ctx.page).toHaveURL(new RegExp(a.value ?? ''));
        break;
      default:
        throw new Error(`未知断言: ${(a as AssertDef).type}`);
    }
  }
}

export function listActions(): string[] {
  return Object.keys(actions);
}

export function registerAction(name: string, handler: ActionHandler): void {
  actions[name] = handler;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export type { Locator };
